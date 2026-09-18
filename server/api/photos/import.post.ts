import { requirePhotoStorageConnection, withStorageConnectionGuard } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'
import { fetchTakenAt, listAllBucketImages, listBucketImagePage, mimeTypeFromKey } from '#server/utils/storage'
import { sendMessageToUser } from '#server/utils/websocket'

// Imports the authenticated User's pre-existing bucket contents into
// Pictacular (issue #54): derives an Album title from each image's
// top-level folder prefix (creating one Album per User + title, reusing
// an existing one if the User already has an Album with that title),
// creates a Photo row for every image found, links it into its derived
// Album, and reports progress over the existing WS infra
// (server/utils/websocket.ts) as it goes — so the Storage Connection
// onboarding screen's import step can show live progress instead of one
// opaque wait.
//
// Processes exactly one `ListObjectsV2` page (up to 1000 objects) per
// request rather than the whole bucket in one go: a "many many photos"
// bucket can take well over 30 minutes to walk end-to-end (per-image EXIF
// reads + DB writes, not just listing), which is too long to trust a
// single HTTP request/connection to survive uninterrupted (proxy/idle
// timeouts, a dropped client, ...). The client (useBucketImport) is
// expected to keep calling this endpoint until the response's `done` is
// true; progress across those separate requests is persisted on the
// Storage Connection itself (`import_cursor`/`import_total`/
// `import_imported`/`import_album_ids`) so a request that never lands
// still leaves the import resumable from exactly where it left off, with
// no re-scanned or duplicated Photos (re-running any page is already
// idempotent via the existing-Photo lookup below).
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const account = await requirePhotoStorageConnection(user.id)
  const { aws_credentials } = account

  // A fresh start (no cursor persisted yet, i.e. either the very first
  // page of a new import, or resuming one that was already fully
  // consumed and reset below) needs its total image count computed once,
  // up front, via a fast list-only pass (no per-object round trip — see
  // listAllBucketImages) purely for progress reporting; every later page
  // of the same import reuses that persisted total instead of re-walking
  // the whole bucket again.
  const total = aws_credentials.import_cursor === null && aws_credentials.import_total === null
    ? (await withStorageConnectionGuard(account.id, () => listAllBucketImages(aws_credentials))).length
    : aws_credentials.import_total!

  const { images, nextContinuationToken } = await withStorageConnectionGuard(account.id, () => listBucketImagePage(aws_credentials, aws_credentials.import_cursor ?? undefined))
  const albumIdsByTitle = new Map<string, number>()
  const albumIds = new Set(aws_credentials.import_album_ids)
  let imported = aws_credentials.import_imported

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
      albumIds.add(albumId)
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
    const taken_at = existingPhoto ? undefined : await fetchTakenAt(aws_credentials, image.key)

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
    sendMessageToUser(user.id, 'import:progress', { imported, total, photo: serialized })
  }

  const done = !nextContinuationToken

  // Persist this page's progress before returning: while still in
  // progress, as the resumption point for the next request. Once done,
  // the working counters reset back to a blank slate (matching this
  // endpoint's pre-chunking idempotent-rerun contract: re-running an
  // already-finished import starts its own count fresh rather than
  // accumulating on top of a previous run's), while `import_completed_at`
  // + `import_last_imported`/`import_last_albums` separately snapshot
  // this run's final result permanently — see the schema comment on
  // AwsCredentials for why check-bucket.get.ts needs that separate,
  // non-resetting snapshot.
  await prisma.awsCredentials.update({
    where: { id: aws_credentials.id },
    data: done
      ? {
          import_cursor: null,
          import_total: null,
          import_imported: 0,
          import_album_ids: [],
          import_completed_at: new Date(),
          import_last_imported: imported,
          import_last_albums: albumIds.size,
        }
      : {
          import_cursor: nextContinuationToken,
          import_total: total,
          import_imported: imported,
          import_album_ids: [...albumIds],
        },
  })

  const summary = { imported, albums: albumIds.size }

  if (done)
    sendMessageToUser(user.id, 'import:completed', summary)

  return { ...summary, done }
})
