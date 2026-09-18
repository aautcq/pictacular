import type { H3Event } from 'h3'
import type { AwsCredentials } from './storage'
// Imported directly (rather than relying on Nitro's auto-import) since
// withStorageConnectionGuard (issue #153) is also reached from the
// archived-photos scan task, which has no HTTP entry point and so runs
// with no live Nitro request to auto-import createError from (see
// server/utils/storage.ts's own identical precedent for the same task).
import { createError } from 'h3'
import { prisma } from './prisma'

// The single error every photo-related action throws once a Storage
// Connection is known to be broken (issue #153) — a hard, app-wide block
// until the User relaunches the CloudFormation stack and reconnects,
// rather than each action surfacing its own unrelated AWS-level failure
// (a 502 from a HeadObject call, an opaque SDK exception from a
// PutObject, ...). Exported so every guard/route below (and the frontend
// error translation table) shares this one code.
export const storageConnectionBrokenError = { statusCode: 403, statusMessage: 'storage.connection_broken' } as const

// True only for the specific, already-namespaced error `assumeRole`
// (server/utils/sts.ts) throws when a Role can no longer be assumed at
// all (deleted/revoked CloudFormation stack) — never for a transient
// network blip or an unrelated AWS-level failure, which is exactly the
// "not on transient/network errors" distinction issue #153 requires
// before ever flipping a connection to broken.
function isUnassumableRoleError(error: unknown): boolean {
  return !!error && typeof error === 'object'
    && (error as { statusCode?: number }).statusCode === 401
    && (error as { statusMessage?: string }).statusMessage === 'storage.invalid_role'
}

// Flips a Storage Connection's `broken` flag (issue #153) — idempotent,
// safe to call even if it's already broken (e.g. a second action failing
// before the User has had a chance to reconnect).
async function markStorageConnectionBroken(ownerId: number): Promise<void> {
  await prisma.awsCredentials.update({
    where: { user_id: ownerId },
    data: { broken: true },
  })
}

// Wraps any single S3/STS operation an already-connected Photo action
// performs (upload, delete, restore, import, view, ...), turning the one
// specific "Role can no longer be assumed" failure into this connection
// being marked broken and every caller seeing the same
// storageConnectionBrokenError — rather than that one action merely
// failing with an error unrelated actions wouldn't share. Any other
// error (a genuine transient AWS hiccup, a real 404/502 from the
// operation itself) passes through untouched.
export async function withStorageConnectionGuard<T>(ownerId: number, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (isUnassumableRoleError(error)) {
      await markStorageConnectionBroken(ownerId)
      throw createError(storageConnectionBrokenError)
    }
    throw error
  }
}

// Shared guard for every Photo endpoint (issue #50): loads the
// authenticated User's account with their Storage Connection, throwing the
// same `photos.storage_connection_required` error every one of them needs
// — collapsing what used to be an identical
// `findUniqueOrThrow` + `if (!aws_credentials) throw ...` block repeated in
// each route file. Also hard-blocks (issue #153) a connection already
// known to be broken from a previous failed action, before even
// attempting another AWS round trip that's certain to fail the same way.
export async function requirePhotoStorageConnection(userId: number): Promise<{ id: number, aws_credentials: AwsCredentials }> {
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { aws_credentials: true },
  })

  if (!account.aws_credentials) {
    throw createError({
      statusCode: 400,
      statusMessage: 'photos.storage_connection_required',
    })
  }

  if (account.aws_credentials.broken) {
    throw createError(storageConnectionBrokenError)
  }

  return { id: account.id, aws_credentials: account.aws_credentials }
}

// Parses and validates the `id` route param shared by every
// single-Photo endpoint (delete, like, unlike), throwing the same
// `photos.invalid_payload` error each of them needs for a non-numeric id.
export function requirePhotoIdParam(event: H3Event): number {
  const id = Number(getRouterParam(event, 'id'))

  if (!Number.isInteger(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'photos.invalid_payload',
    })
  }

  return id
}
