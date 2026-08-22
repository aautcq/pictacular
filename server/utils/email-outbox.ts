import type { EmailOutboxModel } from '../generated/prisma/models/EmailOutbox'
import type { EmailLang } from './i18n/emails'
import type { EmailType } from './mailer'
import { sendEmail } from './mailer'
import { prisma } from './prisma'

// Successive retry delays applied after each failed attempt (issue #92):
// 1m, 5m, 15m, 1h, 6h. Index 0 is the delay applied after the 1st failure,
// and so on — once `attempts` reaches this array's length, the row is
// `dead` rather than scheduled for another attempt. Exported so the
// scheduled retry task (issue #97) drives the same schedule off
// `next_attempt_at` instead of duplicating it.
export const BACKOFF_SCHEDULE_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
]

export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length

// Attempts to send a single outbox row's email and records the outcome
// (issue #92, extracted for #97 so both the inline post-create attempt and
// the scheduled retry task share one place for the send-then-record and
// backoff/dead-letter bookkeeping).
//
// Guards its final write with a `status: row.status` condition (optimistic
// concurrency) rather than a plain `update` by id: the scheduled task's
// "pending rows are always due" query (#97) can otherwise race the inline
// attempt this same row just got from `issueEmailViaOutbox` below, and
// without this guard the loser of that race would overwrite the winner's
// `attempts`/`status` with stale data instead of harmlessly no-op'ing.
export async function attemptEmailOutboxSend(row: EmailOutboxModel) {
  try {
    await sendEmail({ email: row.recipient_email, link: row.link }, row.type as EmailType, row.lang as EmailLang)

    // Kept out of the `catch` below on purpose: catching errors thrown by
    // *this* update too (e.g. a transient DB blip after a successful send)
    // would wrongly record an actually-delivered email as a failed attempt.
    try {
      await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: 'sent' },
      })
    }
    catch (error) {
      console.error('Failed to mark email outbox row as sent', error)
    }
  }
  catch (error) {
    const attempts = row.attempts + 1
    const isDead = attempts >= MAX_ATTEMPTS
    const delayMs = BACKOFF_SCHEDULE_MS[attempts - 1]

    try {
      await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: row.status },
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
  }
}

// Shared "issue an email via the outbox" helper (issue #92), reused by
// every issue-*-email call-site instead of calling sendEmail directly:
// writes a `pending` row first (the durable, queryable side effect), then
// attempts the send inline without the caller awaiting it — matching the
// existing issue-*-email helpers' "durable side effect synchronous,
// delivery fire-and-forget" split.
export async function issueEmailViaOutbox(type: EmailType, recipientEmail: string, link: string, lang: EmailLang) {
  const row = await prisma.emailOutbox.create({
    data: { type, recipient_email: recipientEmail, link, lang },
  })

  void attemptEmailOutboxSend(row)
}
