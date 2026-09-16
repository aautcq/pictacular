import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'

// Browser-driven test (issue #52): an Album admin invites a brand-new
// email address as a Collaborator through the Album show page's
// Collaborators modal; the invitee (a separate, cookie-isolated browser
// page — nobody is logged in yet) follows the emailed invitation link,
// lands on the Invitation screen, signs up, then verifies their account —
// at which point they're automatically granted Collaborator access,
// covering the full "invite → invitation link → signup → verify →
// Collaborator access granted" journey from the acceptance criteria.
describe('album collaborators + invitations journey', async () => {
  await setup({ browser: true })

  const emailPrefix = `collaborators-journey-${Date.now()}`
  const adminEmail = `${emailPrefix}-admin@example.com`
  const inviteeEmail = `${emailPrefix}-invitee@example.com`
  const password = 'Str0ng!Pass'

  afterAll(async () => {
    await prisma.invitation.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await prisma.album.deleteMany({ where: { admin: { email: adminEmail } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('invites a new email, then grants Collaborator access once they sign up and verify', async () => {
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        first_name: 'Ada',
        last_name: 'Admin',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${emailPrefix}-admin`,
      },
    })

    const adminPage = await createPage('/login')
    await adminPage.getByLabel('Email').fill(adminEmail)
    await adminPage.getByLabel('Password').fill(password)
    await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await adminPage.waitForURL(u => !u.pathname.endsWith('/login'))

    await adminPage.goto(url('/albums'))
    await adminPage.getByRole('link', { name: 'New album' }).click()
    await adminPage.waitForURL(url('/albums/new'))
    await adminPage.getByLabel('Title').fill('Team Trip')
    await adminPage.getByRole('button', { name: 'Create album' }).click()
    await adminPage.waitForURL(/\/albums\/\d+$/)

    // "Collaborators" lives behind the "Settings" dropdown menu (see
    // app/pages/albums/[id].vue's settingsItems), not a standalone button.
    await adminPage.getByRole('button', { name: 'Settings' }).click()
    await adminPage.getByRole('menuitem', { name: 'Collaborators' }).click()
    // The typeahead (see ADR 0012) never suggests a brand-new invitee, so
    // the raw-email fallback item is what gets picked here — typing a
    // full, unmatched email surfaces an `Invite "…"` item; selecting it
    // invites immediately (no separate submit button).
    const dialog = adminPage.getByRole('dialog')
    await dialog.getByPlaceholder('Search by name or email…').fill(inviteeEmail)
    await dialog.getByText(`Invite "${inviteeEmail}"`).click()
    // Scoped to the toast's visible title to avoid Playwright strict-mode
    // matching the aria-live announcer span too (see
    // i18n-error-messages.browser.test.ts's identical fix).
    await adminPage.locator('[data-slot="title"]').getByText('1 invitation sent.').waitFor()

    const album = await prisma.album.findFirstOrThrow({ where: { admin_id: admin.id, title: 'Team Trip' } })
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { album_id_email: { album_id: album.id, email: inviteeEmail } },
    })

    await adminPage.close()

    // A fresh, cookie-isolated page: the invitee is anonymous, not the
    // signed-in admin above.
    const inviteePage = await createPage(`/invitations/${invitation.token}`)
    await inviteePage.getByText('Team Trip').waitFor()

    // getByLabel doesn't work on this page: Nuxt UI's FormField provides the
    // same `id` ref to both its label `for` and the nested UInput's `id`, yet
    // on this page they still render with different values post-hydration
    // (confirmed independent of this page's async data-fetching pattern —
    // likely an upstream Nuxt UI/Vue useId() quirk). Target inputs by `name`
    // instead until that's root-caused upstream.
    await inviteePage.locator('input[name="first_name"]').fill('Ivy')
    await inviteePage.locator('input[name="last_name"]').fill('Invitee')
    await inviteePage.locator('input[name="password"]').fill(password)
    await inviteePage.locator('input[name="password_confirmation"]').fill(password)
    await inviteePage.getByRole('button', { name: 'Sign up and join album' }).click()
    await inviteePage.getByText('Check your inbox').waitFor()

    const invitee = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail } })

    const stillPendingAlbum = await prisma.album.findUniqueOrThrow({ where: { id: album.id }, include: { users: true } })
    expect(stillPendingAlbum.users.map(u => u.id)).not.toContain(invitee.id)

    await inviteePage.goto(url(`/verification/${invitee.verification_token}`))
    await inviteePage.getByText('Your account is verified').waitFor()

    const finalAlbum = await prisma.album.findUniqueOrThrow({ where: { id: album.id }, include: { users: true } })
    expect(finalAlbum.users.map(u => u.id)).toContain(invitee.id)

    const remainingInvitation = await prisma.invitation.findUnique({
      where: { album_id_email: { album_id: album.id, email: inviteeEmail } },
    })
    expect(remainingInvitation).toBeNull()

    await inviteePage.close()
  }, 60_000)
})
