import { PrismaClient } from '@prisma/client'

// Nitro convention: a single module-level singleton, reused across
// hot-reloads in dev and across requests in prod, instead of a DI container.
export const prisma = new PrismaClient()
