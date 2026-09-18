import type { AwsCredentials } from './storage'
import { storageConnectionBrokenError } from './photo-guards'
import { prisma } from './prisma'

export interface PhotoImageAccess {
  ownerId: number
  key: string
  mime_type: string
  storage_class: string | null
  restore_ongoing: boolean
  restore_expires_at: Date | null
  awsCredentials: AwsCredentials
}

function toAccess(photo: { key: string, mime_type: string, storage_class: string | null, restore_ongoing: boolean, restore_expires_at: Date | null, user_id: number, user: { aws_credentials: (AwsCredentials & { broken: boolean }) | null } }): PhotoImageAccess | null {
  if (!photo.user.aws_credentials)
    return null

  // A Photo whose owner's Storage Connection is already known to be
  // broken (issue #153) can never actually be fetched from S3 either way
  // — blocked with the same app-wide error every other photo action uses,
  // rather than only discovering this once the AWS call below fails.
  if (photo.user.aws_credentials.broken)
    throw createError(storageConnectionBrokenError)

  return {
    ownerId: photo.user_id,
    key: photo.key,
    mime_type: photo.mime_type,
    storage_class: photo.storage_class,
    restore_ongoing: photo.restore_ongoing,
    restore_expires_at: photo.restore_expires_at,
    awsCredentials: photo.user.aws_credentials,
  }
}

// Authorizes GET /api/photos/[id]/image (issue #168): a Photo's bytes are
// viewable by its owner, or by any other member (Collaborator) of an
// Album it's been added to — mirroring exactly who can already see that
// Photo via serializeAlbumFull, since that's always embedded the owner's
// signed URL regardless of who was asking. Throws the same 404 whether
// the Photo doesn't exist, belongs to nobody the requester shares an
// Album with, or its owner has no Storage Connection (bytes literally
// aren't reachable), so a non-member can't distinguish those cases by
// probing ids.
export async function requirePhotoImageAccess(photoId: number, userId: number): Promise<PhotoImageAccess> {
  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      OR: [
        { user_id: userId },
        { albums: { some: { album: { users: { some: { id: userId } } } } } },
      ],
    },
    include: { user: { include: { aws_credentials: true } } },
  })

  const access = photo && toAccess(photo)
  if (!access) {
    throw createError({
      statusCode: 404,
      statusMessage: 'photos.not_found',
    })
  }

  return access
}

// Authorizes GET /api/albums/public/[token]/photos/[id]/image (issue
// #168): a Public Share Link grants read access to every Photo assigned
// to that Album, to anyone holding the link — no session/Collaborator
// check at all, matching serializeAlbumPublic. A token that doesn't
// resolve to an Album, or resolves to one this Photo isn't actually
// assigned to, gets the same 404 as an unknown Album (see
// albums/public/[token].get.ts) either way.
export async function requirePublicPhotoImageAccess(token: string, photoId: number): Promise<PhotoImageAccess> {
  const membership = await prisma.albumsOnPhotos.findFirst({
    where: { photo_id: photoId, album: { share_token: token } },
    include: { photo: { include: { user: { include: { aws_credentials: true } } } } },
  })

  const access = membership && toAccess(membership.photo)
  if (!access) {
    throw createError({
      statusCode: 404,
      statusMessage: 'albums.not_found',
    })
  }

  return access
}
