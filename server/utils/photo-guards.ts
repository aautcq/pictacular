import type { H3Event } from 'h3'
import type { AwsCredentials } from './storage'
import { prisma } from './prisma'

// Shared guard for every Photo endpoint (issue #50): loads the
// authenticated User's account with their Storage Connection, throwing the
// same `photos.storage_connection_required` error every one of them needs
// — collapsing what used to be an identical
// `findUniqueOrThrow` + `if (!aws_credentials) throw ...` block repeated in
// each route file.
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
