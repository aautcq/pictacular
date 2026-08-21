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

    await adminPage.getByRole('button', { name: 'Collaborators' }).click()
    await adminPage.getByRole('dialog').getByLabel('Invite by email').fill(inviteeEmail)
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Invite' }).click()
    await adminPage.getByRole('status').getByText('1 invitation sent.').waitFor()

    const album = await prisma.album.findFirstOrThrow({ where: { admin_id: admin.id, title: 'Team Trip' } })
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { album_id_email: { album_id: album.id, email: inviteeEmail } },
    })

    await adminPage.close()

    // A fresh, cookie-isolated page: the invitee is anonymous, not the
    // signed-in admin above.
    const inviteePage = await createPage(`/invitations/${invitation.token}`)
    await inviteePage.getByText('Team Trip').waitFor()

    await inviteePage.getByLabel('First name').fill('Ivy')
    await inviteePage.getByLabel('Last name').fill('Invitee')
    await inviteePage.getByLabel('Password', { exact: true }).fill(password)
    await inviteePage.getByLabel('Confirm password').fill(password)
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
