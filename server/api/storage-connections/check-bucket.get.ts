import { storageConnectionBrokenError, withStorageConnectionGuard } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { bucketHasImages } from '#server/utils/storage'

// Reports whether the authenticated User's connected bucket already
// contains images (issue #49's `check-bucket`), so the onboarding client
// can offer a later "import existing photos" step — plus, since issue
// #54's Photo import made chunked/resumable, the persisted state of an
// import against this bucket (`import_in_progress`/`import_completed` +
// its last completed result), so the Storage Connection onboarding
// screen can restore the right state after a page reload mid- or
// post-import (its own progress/result refs being ephemeral, unlike this
// endpoint's DB-backed read) instead of re-offering an import that's
// already done, or silently dropping one still in flight.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { storage_connection: true },
  })

  if (!account.storage_connection) {
    throw createError({
      statusCode: 400,
      statusMessage: 'storage.connection_required',
    })
  }

  if (account.storage_connection.broken)
    throw createError(storageConnectionBrokenError)

  const has_photos = await withStorageConnectionGuard(user.id, () => bucketHasImages(account.storage_connection!))

  return {
    has_photos,
    import_in_progress: account.storage_connection.import_cursor !== null,
    import_completed: account.storage_connection.import_completed_at !== null,
    imported: account.storage_connection.import_last_imported ?? 0,
    albums: account.storage_connection.import_last_albums ?? 0,
  }
})
