import type { H3Event } from 'h3'
import { getPreferredLang } from './i18n/lang'
import { generateUniqueInvitationToken } from './invitation-token'
import { sendEmail } from './mailer'
import { prisma } from './prisma'

// Creates (or reuses, for a resend) the pending Invitation row for one
// email on one Album, then emails an invitation link — mirroring
// issuePasswordResetEmail's "durable side effect synchronous, delivery
// fire-and-forget" split. Re-inviting an email that already has a pending
// Invitation for this Album reuses its existing token and resends the same
// link rather than erroring (issue #52 acceptance criteria), since the
// (album_id, email) pair is unique.
export async function issueInvitationEmail(event: H3Event, albumId: number, email: string) {
  const existing = await prisma.invitation.findUnique({
    where: { album_id_email: { album_id: albumId, email } },
  })

  const token = existing?.token ?? await generateUniqueInvitationToken()

  if (!existing) {
    await prisma.invitation.create({
      data: { album_id: albumId, email, token },
    })
  }

  const link = `${getRequestURL(event).origin}/invitations/${token}`
  const lang = getPreferredLang(event)

  // Fire-and-forget, matching the other issue-*-email helpers: email
  // delivery is not on the request's critical path/response.
  sendEmail({ email, link }, 'invitation', lang)
    .catch(error => console.error('Failed to send invitation email', error))
}
