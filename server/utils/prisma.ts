import process from 'node:process'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '#server/generated/prisma/client'

// Prisma 7 no longer validates the datasource url itself (it's configured
// via prisma.config.ts for the CLI only, not at Client runtime), and the
// pg driver silently falls back to its own connection defaults when
// `connectionString` is undefined — so fail fast here instead.
if (!process.env.NUXT_DATABASE_URL)
  throw new Error('Environment variable not found: NUXT_DATABASE_URL')

// Nitro convention: a single module-level singleton, reused across
// hot-reloads in dev and across requests in prod, instead of a DI container.
// Prisma 7's pg driver adapter defaults (0ms connect timeout, 10s idle
// timeout) differ from Prisma 6's built-in pool (5s connect timeout, 300s
// idle timeout) — match the old behavior explicitly to avoid connection
// churn under concurrent load.
const adapter = new PrismaPg({
  connectionString: process.env.NUXT_DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 300_000,
})
export const prisma = new PrismaClient({ adapter })
