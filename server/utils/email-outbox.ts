import type { EmailLang } from './i18n/emails'
import type { EmailType } from './mailer'
import { sendEmail } from './mailer'
import { prisma } from './prisma'

// Successive retry delays applied after each failed attempt (issue #92):
// 1m, 5m, 15m, 1h, 6h. Index 0 is the delay applied after the 1st failure,
// and so on — once `attempts` reaches this array's length, the row is
// `dead` rather than scheduled for another attempt. Actually driving
// retries off `next_attempt_at` is a separate future call-site (a
// scheduled task); this helper only performs the initial inline attempt.
const BACKOFF_SCHEDULE_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
]

const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length

// Shared "issue an email via the outbox" helper (issue #92), reused by
// every issue-*-email call-site instead of calling sendEmail directly:
// writes a `pending` row first (the durable, queryable side effect), then
// attempts the send inline without the caller awaiting it — matching the
// existing issue-*-email helpers' "durable side effect synchronous,
// delivery fire-and-forget" split — and updates the row to `sent`/`failed`
// (or `dead` once attempts are exhausted) based on the outcome.
export async function issueEmailViaOutbox(type: EmailType, recipientEmail: string, link: string, lang: EmailLang) {
  const row = await prisma.emailOutbox.create({
    data: { type, recipient_email: recipientEmail, link, lang },
  })

  sendEmail({ email: recipientEmail, link }, type, lang)
    .then(async () => {
      // Kept out of the `.catch` below on purpose: a `.then().catch()`
      // chain would also catch errors thrown by *this* update (e.g. a
      // transient DB blip after a successful send), which would wrongly
      // record an actually-delivered email as a failed attempt.
      try {
        await prisma.emailOutbox.update({
          where: { id: row.id },
          data: { status: 'sent' },
        })
      }
      catch (error) {
        console.error('Failed to mark email outbox row as sent', error)
      }
    })
    .catch(async (error: unknown) => {
      const attempts = row.attempts + 1
      const isDead = attempts >= MAX_ATTEMPTS
      const delayMs = BACKOFF_SCHEDULE_MS[attempts - 1]

      try {
        await prisma.emailOutbox.update({
          where: { id: row.id },
          data: {
            status: isDead ? 'dead' : 'failed',
            attempts,
            next_attempt_at: isDead ? null : delayMs ? new Date(Date.now() + delayMs) : null,
            last_error: error instanceof Error ? error.message : String(error),
          },
        })
      }
      catch (updateError) {
        console.error('Failed to update email outbox row', updateError)
      }
    })
}
