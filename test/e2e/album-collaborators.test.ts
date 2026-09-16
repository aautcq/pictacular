import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP tests for Album Collaborators + Invitations (issue #52):
// adding Collaborators by email (existing Users linked immediately, unknown
// emails invited instead), the admin-only restriction on both add/remove,
// re-inviting an already-pending email resending rather than erroring, the
// public Invitation-token lookup, and the auto-accept-on-verify flow for a
// brand-new invitee. Albums don't require a Storage Connection to manage
// (only Photos do), so — unlike albums.test.ts — no fake S3 double is
// needed here.
describe('album collaborators + invitations', async () => {
  await setup()

  const emailPrefix = `collaborators-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail(label: string) {
    return `${emailPrefix}-${label}@example.com`
  }

  async function createVerifiedUser(label: string) {
    const email = uniqueEmail(label)
    await $fetch('/api/auth/users', {
      method: 'POST',
      body: {
        email,
        first_name: 'John',
        last_name: 'Doe',
        password,
        password_confirmation: password,
      },
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    await $fetch(`/api/auth/verify/${user.verification_token}`)

    return { id: user.id, email }
  }

  async function loginCookieHeader(email: string) {
    const loginResponse = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })

    return loginResponse.headers.getSetCookie()
      .map(cookie => cookie.split(';')[0])
      .join('; ')
  }

  async function createLoggedInUser(label: string) {
    const user = await createVerifiedUser(label)
    const cookieHeader = await loginCookieHeader(user.email)
    return { ...user, cookieHeader }
  }

  async function createAlbum(cookieHeader: string, overrides: Record<string, unknown> = {}) {
    return $fetch<{ id: number }>('/api/albums', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { title: 'My Album', description: 'A description', ...overrides },
    })
  }

  let admin: Awaited<ReturnType<typeof createLoggedInUser>>
  let existingUser: Awaited<ReturnType<typeof createLoggedInUser>>
  let other: Awaited<ReturnType<typeof createLoggedInUser>>

  beforeAll(async () => {
    admin = await createLoggedInUser('admin')
    existingUser = await createLoggedInUser('existing')
    other = await createLoggedInUser('other')
  })

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: { recipient_email: { startsWith: emailPrefix } } })
    await prisma.invitation.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await prisma.album.deleteMany({ where: { admin_id: { in: [admin.id, existingUser.id, other.id] } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  describe('add collaborators', () => {
    it('connects an existing User by email immediately', async () => {
      const album = await createAlbum(admin.cookieHeader)

      const response = await $fetch<{ collaborators: { id: number }[], linked: string[], invited: string[] }>(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [existingUser.email] },
      })

      expect(response.collaborators.map(c => c.id)).toContain(existingUser.id)
      expect(response.linked).toEqual([existingUser.email])
      expect(response.invited).toEqual([])

      const row = await prisma.album.findUniqueOrThrow({ where: { id: album.id }, include: { users: true } })
      expect(row.users.map(u => u.id)).toContain(existingUser.id)
    })

    it('creates a pending Invitation for an unknown email instead of a Collaborator', async () => {
      const album = await createAlbum(admin.cookieHeader)
      const invitedEmail = uniqueEmail('unknown-invitee')

      const response = await $fetch<{ collaborators: { id: number }[], linked: string[], invited: string[] }>(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [invitedEmail] },
      })

      expect(response.collaborators).toEqual([])
      expect(response.linked).toEqual([])
      expect(response.invited).toEqual([invitedEmail])

      const invitation = await prisma.invitation.findUniqueOrThrow({
        where: { album_id_email: { album_id: album.id, email: invitedEmail } },
      })
      expect(invitation.token).toBeTruthy()

      // Issue #96: the invitation email is routed through the durable
      // outbox instead of a bare sendEmail call, so poll for the pending
      // row to settle rather than asserting immediately.
      const outboxRow = await vi.waitFor(async () => {
        const row = await prisma.emailOutbox.findFirstOrThrow({
          where: { recipient_email: invitedEmail, type: 'invitation' },
        })
        expect(row.status).not.toBe('pending')
        return row
      })
      expect(outboxRow).toMatchObject({
        recipient_email: invitedEmail,
        type: 'invitation',
        link: expect.stringContaining(`/invitations/${invitation.token}`),
      })
    })

    it('resends rather than erroring when re-inviting an already-pending email', async () => {
      const album = await createAlbum(admin.cookieHeader)
      const invitedEmail = uniqueEmail('resend-invitee')

      await $fetch(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [invitedEmail] },
      })
      const first = await prisma.invitation.findUniqueOrThrow({
        where: { album_id_email: { album_id: album.id, email: invitedEmail } },
      })

      await $fetch(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [invitedEmail] },
      })

      const invitations = await prisma.invitation.findMany({ where: { album_id: album.id, email: invitedEmail } })
      expect(invitations).toHaveLength(1)
      expect(invitations[0]!.token).toBe(first.token)

      // Issue #96: each resend creates its own outbox row (the send is
      // re-attempted with the same reused token/link), so there should be
      // two settled rows for this email by now.
      const outboxRows = await vi.waitFor(async () => {
        const rows = await prisma.emailOutbox.findMany({
          where: { recipient_email: invitedEmail, type: 'invitation' },
        })
        expect(rows).toHaveLength(2)
        expect(rows.every(row => row.status !== 'pending')).toBe(true)
        return rows
      })
      expect(outboxRows.every(row => row.link.includes(`/invitations/${first.token}`))).toBe(true)
    })

    it('rejects a non-admin member with 403', async () => {
      const album = await createAlbum(admin.cookieHeader)
      await prisma.album.update({ where: { id: album.id }, data: { users: { connect: { id: other.id } } } })

      await expect(
        $fetch(`/api/albums/${album.id}/collaborators`, {
          method: 'POST',
          headers: { cookie: other.cookieHeader },
          body: { emails: [uniqueEmail('irrelevant')] },
        }),
      ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'albums.admin_only' })
    })

    it('passes through a linked Collaborator\'s avatar_url as-is (no signing for other members)', async () => {
      const album = await createAlbum(admin.cookieHeader)
      const collaborator = await createLoggedInUser('with-avatar')
      await prisma.user.update({ where: { id: collaborator.id }, data: { avatar_url: 'https://example.com/avatar.png' } })

      const response = await $fetch<{ collaborators: { id: number, avatar_url: string | null }[] }>(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [collaborator.email] },
      })

      expect(response.collaborators.find(c => c.id === collaborator.id)?.avatar_url).toBe('https://example.com/avatar.png')
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(admin.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/collaborators`, {
          method: 'POST',
          headers: { cookie: other.cookieHeader },
          body: { emails: [uniqueEmail('irrelevant')] },
        }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an empty emails list with 400', async () => {
      const album = await createAlbum(admin.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/collaborators`, {
          method: 'POST',
          headers: { cookie: admin.cookieHeader },
          body: { emails: [] },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'validation.invalid_payload' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums/1/collaborators', { method: 'POST', body: { emails: ['x@example.com'] } }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('remove collaborator', () => {
    it('disconnects a Collaborator from the Album', async () => {
      const album = await createAlbum(admin.cookieHeader)
      await prisma.album.update({ where: { id: album.id }, data: { users: { connect: { id: existingUser.id } } } })

      const response = await $fetch<{ collaborators: { id: number }[] }>(`/api/albums/${album.id}/collaborators/${existingUser.id}`, {
        method: 'DELETE',
        headers: { cookie: admin.cookieHeader },
      })

      expect(response.collaborators.map(c => c.id)).not.toContain(existingUser.id)
    })

    it('rejects removing the admin with 400', async () => {
      const album = await createAlbum(admin.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/collaborators/${admin.id}`, {
          method: 'DELETE',
          headers: { cookie: admin.cookieHeader },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'albums.cannot_remove_admin' })
    })

    it('rejects a non-admin member with 403', async () => {
      const album = await createAlbum(admin.cookieHeader)
      await prisma.album.update({
        where: { id: album.id },
        data: { users: { connect: [{ id: existingUser.id }, { id: other.id }] } },
      })

      await expect(
        $fetch(`/api/albums/${album.id}/collaborators/${existingUser.id}`, {
          method: 'DELETE',
          headers: { cookie: other.cookieHeader },
        }),
      ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'albums.admin_only' })
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(admin.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/collaborators/${existingUser.id}`, {
          method: 'DELETE',
          headers: { cookie: other.cookieHeader },
        }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums/1/collaborators/1', { method: 'DELETE' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  // Issue #171 / ADR 0012: suggestions are scoped to Users who already
  // collaborate with the requesting admin on some *other* Album — never
  // the full user directory, and never someone who's never collaborated
  // with this admin at all. Uses its own fresh Users/admin (rather than
  // the outer `admin`/`existingUser`/`other`, which accumulate ad hoc
  // Collaborator links from earlier describe blocks in this file) so
  // "never collaborated with this admin" is actually true.
  describe('collaborator suggestions', () => {
    it('suggests a User who collaborates with the admin on another Album', async () => {
      const suggestAdmin = await createLoggedInUser('suggest-admin-1')
      const collaboratorElsewhere = await createLoggedInUser('suggest-collab-1')

      const otherAlbum = await createAlbum(suggestAdmin.cookieHeader)
      await prisma.album.update({ where: { id: otherAlbum.id }, data: { users: { connect: { id: collaboratorElsewhere.id } } } })

      const targetAlbum = await createAlbum(suggestAdmin.cookieHeader)

      const response = await $fetch<{ suggestions: { id: number, email: string }[] }>(`/api/albums/${targetAlbum.id}/collaborator-suggestions`, {
        headers: { cookie: suggestAdmin.cookieHeader },
        query: { q: collaboratorElsewhere.email.slice(0, 6) },
      })

      expect(response.suggestions.map(s => s.id)).toContain(collaboratorElsewhere.id)
    })

    it('does not suggest a User who has never collaborated with the admin anywhere', async () => {
      const suggestAdmin = await createLoggedInUser('suggest-admin-2')
      const stranger = await createLoggedInUser('suggest-stranger-2')

      const targetAlbum = await createAlbum(suggestAdmin.cookieHeader)

      const response = await $fetch<{ suggestions: { id: number }[] }>(`/api/albums/${targetAlbum.id}/collaborator-suggestions`, {
        headers: { cookie: suggestAdmin.cookieHeader },
        query: { q: stranger.email.slice(0, 6) },
      })

      expect(response.suggestions.map(s => s.id)).not.toContain(stranger.id)
    })

    it('does not suggest a User who is already a Collaborator on this same Album', async () => {
      const suggestAdmin = await createLoggedInUser('suggest-admin-3')
      const collaboratorElsewhere = await createLoggedInUser('suggest-collab-3')

      const otherAlbum = await createAlbum(suggestAdmin.cookieHeader)
      await prisma.album.update({ where: { id: otherAlbum.id }, data: { users: { connect: { id: collaboratorElsewhere.id } } } })

      const targetAlbum = await createAlbum(suggestAdmin.cookieHeader)
      await prisma.album.update({ where: { id: targetAlbum.id }, data: { users: { connect: { id: collaboratorElsewhere.id } } } })

      const response = await $fetch<{ suggestions: { id: number }[] }>(`/api/albums/${targetAlbum.id}/collaborator-suggestions`, {
        headers: { cookie: suggestAdmin.cookieHeader },
        query: { q: collaboratorElsewhere.email.slice(0, 6) },
      })

      expect(response.suggestions.map(s => s.id)).not.toContain(collaboratorElsewhere.id)
    })

    it('rejects a non-admin member with 403', async () => {
      const album = await createAlbum(admin.cookieHeader)
      await prisma.album.update({ where: { id: album.id }, data: { users: { connect: { id: other.id } } } })

      await expect(
        $fetch(`/api/albums/${album.id}/collaborator-suggestions`, {
          headers: { cookie: other.cookieHeader },
          query: { q: 'a' },
        }),
      ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'albums.admin_only' })
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(admin.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/collaborator-suggestions`, {
          headers: { cookie: other.cookieHeader },
          query: { q: 'a' },
        }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects a missing query with 400', async () => {
      const album = await createAlbum(admin.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/collaborator-suggestions`, {
          headers: { cookie: admin.cookieHeader },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'albums.invalid_query' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums/1/collaborator-suggestions', { query: { q: 'a' } }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('invitation token lookup', () => {
    it('returns the Album summary and invited email for a pending Invitation', async () => {
      const album = await createAlbum(admin.cookieHeader, { title: 'Invitation Lookup Album' })
      const invitedEmail = uniqueEmail('lookup-invitee')

      await $fetch(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [invitedEmail] },
      })
      const invitation = await prisma.invitation.findUniqueOrThrow({
        where: { album_id_email: { album_id: album.id, email: invitedEmail } },
      })

      const response = await $fetch<{ id: number, title: string, email: string, has_pending_account: boolean }>(`/api/invitations/${invitation.token}`)

      expect(response.id).toBe(album.id)
      expect(response.title).toBe('Invitation Lookup Album')
      expect(response.email).toBe(invitedEmail)
      expect(response.has_pending_account).toBe(false)
    })

    it('reports has_pending_account once the invited email registers (unverified) on its own', async () => {
      const album = await createAlbum(admin.cookieHeader, { title: 'Pending Account Album' })
      const invitedEmail = uniqueEmail('pending-account-invitee')

      await $fetch(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [invitedEmail] },
      })
      const invitation = await prisma.invitation.findUniqueOrThrow({
        where: { album_id_email: { album_id: album.id, email: invitedEmail } },
      })

      await $fetch('/api/auth/users', {
        method: 'POST',
        body: {
          email: invitedEmail,
          first_name: 'Not',
          last_name: 'Yet Verified',
          password,
          password_confirmation: password,
        },
      })

      const response = await $fetch<{ has_pending_account: boolean }>(`/api/invitations/${invitation.token}`)
      expect(response.has_pending_account).toBe(true)
    })

    it('rejects an unknown token with 404', async () => {
      await expect(
        $fetch('/api/invitations/not-a-real-token'),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'invitations.not_found' })
    })
  })

  describe('auto-accept on verify', () => {
    it('adds a newly-verified invitee as a Collaborator and clears the Invitation', async () => {
      const album = await createAlbum(admin.cookieHeader, { title: 'Auto Accept Album' })
      const invitedEmail = uniqueEmail('auto-accept-invitee')

      await $fetch(`/api/albums/${album.id}/collaborators`, {
        method: 'POST',
        headers: { cookie: admin.cookieHeader },
        body: { emails: [invitedEmail] },
      })

      await $fetch('/api/auth/users', {
        method: 'POST',
        body: {
          email: invitedEmail,
          first_name: 'Jane',
          last_name: 'Invitee',
          password,
          password_confirmation: password,
        },
      })
      const invitee = await prisma.user.findUniqueOrThrow({ where: { email: invitedEmail } })

      await $fetch(`/api/auth/verify/${invitee.verification_token}`)

      const row = await prisma.album.findUniqueOrThrow({ where: { id: album.id }, include: { users: true } })
      expect(row.users.map(u => u.id)).toContain(invitee.id)

      const invitation = await prisma.invitation.findUnique({
        where: { album_id_email: { album_id: album.id, email: invitedEmail } },
      })
      expect(invitation).toBeNull()
    })
  })
})
