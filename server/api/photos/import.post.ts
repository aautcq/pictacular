import { requirePhotoStorageConnection, withStorageConnectionGuard } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'
import { fetchTakenAt, listAllBucketImages, mimeTypeFromKey } from '#server/utils/storage'
import { sendMessageToUser } from '#server/utils/websocket'

// Imports the authenticated User's pre-existing bucket contents into
// Pictacular (issue #54): walks every page of the connected bucket,
// derives an Album title from each image's top-level folder prefix
// (creating one Album per User + title, reusing an existing one if the
// User already has an Album with that title), creates a Photo row for
// every image found, links it into its derived Album, and reports
// progress over the existing WS infra (server/utils/websocket.ts) as it
// goes — so the Storage Connection onboarding screen's import step can
// show live progress instead of one opaque wait. Runs to completion
// within the request (unlike the legacy Express usecase's fire-and-forget
// promise) since this app's WS layer is only used to notify already-open
// tabs, not to signal HTTP completion.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const account = await requirePhotoStorageConnection(user.id)

  const images = await withStorageConnectionGuard(account.id, () => listAllBucketImages(account.aws_credentials))
  const albumIdsByTitle = new Map<string, number>()
  let imported = 0

  for (const image of images) {
    const [firstSegment, ...rest] = image.key.split('/')
    const albumTitle = rest.length > 0 ? firstSegment : null

    let albumId: number | null = null
    if (albumTitle) {
      albumId = albumIdsByTitle.get(albumTitle) ?? null
      if (albumId === null) {
        const existingAlbum = await prisma.album.findFirst({ where: { admin_id: user.id, title: albumTitle } })
        const album = existingAlbum ?? await prisma.album.create({
          data: {
            title: albumTitle,
            admin: { connect: { id: user.id } },
            users: { connect: { id: user.id } },
          },
        })
        albumId = album.id
        albumIdsByTitle.set(albumTitle, albumId)
      }
    }

    // Re-running an import (a retried request, or re-connecting the same
    // bucket) must not create a second Photo row for an object this User
    // already has one for — reuse the existing row instead of inserting a
    // duplicate.
    const existingPhoto = await prisma.photo.findFirst({
      where: { user_id: account.id, key: image.key },
      include: { likes: { select: { id: true } } },
    })
    // Only fetched for a Photo actually being created here — re-running an
    // import against an already-imported object never re-fetches its
    // Taken At (issue #162 is forward-only, no backfill of pre-existing
    // Photos).
    const taken_at = existingPhoto ? undefined : await fetchTakenAt(account.aws_credentials, image.key)

    const photo = existingPhoto ?? await prisma.photo.create({
      data: {
        key: image.key,
        mime_type: mimeTypeFromKey(image.key),
        size: image.size,
        last_modified: image.last_modified,
        taken_at,
        // Free from the same `ListObjectsV2` page as the rest of `image`
        // (issue #145) — an imported Photo that's already Archived is
        // reflected immediately, without waiting for the next
        // `archived-photos:scan` pass.
        storage_class: image.storage_class,
        user: { connect: { id: account.id } },
      },
      include: { likes: { select: { id: true } } },
    })

    if (albumId) {
      await prisma.albumsOnPhotos.upsert({
        where: { photo_id_album_id: { photo_id: photo.id, album_id: albumId } },
        create: { photo_id: photo.id, album_id: albumId },
        update: {},
      })
    }

    imported += 1

    const serialized = serializePhoto(photo, user.id)
    sendMessageToUser(user.id, 'import:progress', { imported, total: images.length, photo: serialized })
  }

  const summary = { imported, albums: albumIdsByTitle.size }
  sendMessageToUser(user.id, 'import:completed', summary)

  return summary
})
