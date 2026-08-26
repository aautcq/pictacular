import { setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import emailOutboxProcessTask from '../../server/tasks/email-outbox/process'
import { prisma } from '../../server/utils/prisma'

// There's no HTTP entry point for a scheduled task (issue #97), so this
// spec invokes the task's `run()` directly instead of going through
// `$fetch` — the equivalent of `runTask('email-outbox:process')` from
// inside a booted Nitro server, and the seam the issue calls out
// explicitly as this feature's exception to the usual HTTP-only black-box
// convention.
async function runEmailOutboxProcessTask() {
  return emailOutboxProcessTask.run({ name: 'email-outbox:process', payload: {}, context: {} })
}

describe('email outbox scheduled retry + purge task', async () => {
  await setup()

  const emailPrefix = `outbox-task-${Date.now()}`

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  async function createRow(overrides: Record<string, unknown> = {}) {
    return prisma.emailOutbox.create({
      data: {
        type: 'verification',
        recipient_email: uniqueEmail(),
        lang: 'en',
        link: 'https://pictacular.test/verification/token',
        ...overrides,
      },
    })
  }

  // `updated_at` is a Prisma `@updatedAt` field: any `prisma.emailOutbox.update`
  // call (including the task's own send-result bookkeeping) stamps it to
  // "now", so backdating it for the purge tests below has to bypass Prisma
  // with a raw statement instead.
  async function backdateUpdatedAt(id: number, date: Date) {
    await prisma.$executeRaw`UPDATE email_outbox SET updated_at = ${date} WHERE id = ${id}`
  }

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: { recipient_email: { startsWith: emailPrefix } } })
  })

  // BREVO_API_KEY isn't a real key in this environment, so every send
  // attempt the task makes is expected to fail rather than succeed —
  // matching the existing outbox coverage in auth-register.test.ts.

  it('attempts a pending row (always immediately due) and records it as a failed first attempt', async () => {
    const row = await createRow({ status: 'pending' })

    await runEmailOutboxProcessTask()

    const updated = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })
    expect(updated.status).toBe('failed')
    expect(updated.attempts).toBe(1)
    expect(updated.next_attempt_at).toBeTruthy()
    expect(updated.next_attempt_at!.getTime()).toBeGreaterThan(Date.now())
    expect(updated.last_error).toBeTruthy()
  })

  it('retries a failed row whose backoff has elapsed, advancing attempts and the backoff schedule', async () => {
    const row = await createRow({
      status: 'failed',
      attempts: 1,
      next_attempt_at: new Date(Date.now() - 1000),
      last_error: 'previous attempt failed',
    })

    await runEmailOutboxProcessTask()

    const updated = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })
    expect(updated.status).toBe('failed')
    expect(updated.attempts).toBe(2)
    expect(updated.next_attempt_at).toBeTruthy()
    expect(updated.next_attempt_at!.getTime()).toBeGreaterThan(Date.now())
  })

  it('leaves a failed row alone while its backoff has not elapsed yet', async () => {
    const notYetDue = new Date(Date.now() + 60 * 60 * 1000)
    const row = await createRow({
      status: 'failed',
      attempts: 1,
      next_attempt_at: notYetDue,
      last_error: 'previous attempt failed',
    })

    await runEmailOutboxProcessTask()

    const updated = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })
    expect(updated.status).toBe('failed')
    expect(updated.attempts).toBe(1)
    expect(updated.next_attempt_at).toEqual(notYetDue)
  })

  it('dead-letters a row that fails on its 5th attempt, clearing next_attempt_at', async () => {
    const row = await createRow({
      status: 'failed',
      attempts: 4,
      next_attempt_at: new Date(Date.now() - 1000),
      last_error: 'previous attempt failed',
    })

    await runEmailOutboxProcessTask()

    const updated = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })
    expect(updated.status).toBe('dead')
    expect(updated.attempts).toBe(5)
    expect(updated.next_attempt_at).toBeNull()
  })

  it('purges sent and dead rows older than 30 days', async () => {
    const oldSent = await createRow({ status: 'sent' })
    const oldDead = await createRow({ status: 'dead', attempts: 5 })
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await backdateUpdatedAt(oldSent.id, staleDate)
    await backdateUpdatedAt(oldDead.id, staleDate)

    await runEmailOutboxProcessTask()

    await expect(prisma.emailOutbox.findUnique({ where: { id: oldSent.id } })).resolves.toBeNull()
    await expect(prisma.emailOutbox.findUnique({ where: { id: oldDead.id } })).resolves.toBeNull()
  })

  it('does not purge sent/dead rows within the last 30 days, nor pending/failed rows regardless of age', async () => {
    const recentSent = await createRow({ status: 'sent' })
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    const oldFailed = await createRow({
      status: 'failed',
      attempts: 1,
      next_attempt_at: new Date(Date.now() + 60 * 60 * 1000),
    })
    await backdateUpdatedAt(oldFailed.id, staleDate)

    await runEmailOutboxProcessTask()

    await expect(prisma.emailOutbox.findUnique({ where: { id: recentSent.id } })).resolves.not.toBeNull()
    await expect(prisma.emailOutbox.findUnique({ where: { id: oldFailed.id } })).resolves.not.toBeNull()
  })
})
