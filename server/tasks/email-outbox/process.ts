import type { Task } from 'nitropack/types'
import { attemptEmailOutboxSend } from '../../utils/email-outbox'
import { prisma } from '../../utils/prisma'

// Not using Nitro's `defineTask` runtime helper here (it's normally
// auto-imported): that module's `runTask` export pulls in a
// build-only virtual import at load time, which throws when this file is
// imported standalone by a Vitest spec (issue #97) to invoke `run()`
// directly — there's no HTTP entry point for a scheduled task, so that's
// this feature's test seam. `defineTask` itself is just an identity
// function (it only guards against a missing `run`, which is always
// provided below), so a plain object typed as `Task` is equivalent.

// Terminal rows older than this are purged (issue #97's purge half of the
// outbox mechanism), so the table doesn't grow unbounded once rows have
// either delivered or been dead-lettered.
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

const emailOutboxProcessTask: Task = {
  meta: {
    name: 'email-outbox:process',
    description: 'Retries due email outbox rows with backoff, dead-letters exhausted rows, and purges old sent/dead rows',
  },
  async run() {
    const now = new Date()

    // Due rows: `pending` rows haven't been attempted yet (no
    // `next_attempt_at` set) so they're always eligible; `failed` rows are
    // only eligible once their backoff delay has elapsed.
    const dueRows = await prisma.emailOutbox.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        OR: [
          { next_attempt_at: null },
          { next_attempt_at: { lte: now } },
        ],
      },
    })

    await Promise.all(dueRows.map(row => attemptEmailOutboxSend(row)))

    await prisma.emailOutbox.deleteMany({
      where: {
        status: { in: ['sent', 'dead'] },
        updated_at: { lt: new Date(now.getTime() - PURGE_AFTER_MS) },
      },
    })

    return { result: 'success' }
  },
}

export default emailOutboxProcessTask
