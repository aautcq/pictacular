import type { H3Event } from 'h3'
import { issueEmailViaOutbox } from './email-outbox'
import { getPreferredLang } from './i18n/lang'
import { generateUniqueInvitationToken } from './invitation-token'
import { prisma } from './prisma'

// Creates (or reuses, for a resend) the pending Invitation row for one
// email on one Album, then routes the invitation email through the
// durable outbox (issueEmailViaOutbox, issue #92/#96) instead of a bare
// sendEmail call, awaiting only the pending row write (so the send
// outcome is queryable as soon as the caller responds) while the actual
// send stays off the request's critical path/response. Re-inviting an
// email that already has a pending Invitation for this Album reuses its
// existing token and resends the same link rather than erroring (issue
// #52 acceptance criteria), since the (album_id, email) pair is unique.
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

  await issueEmailViaOutbox('invitation', email, link, lang)
}
