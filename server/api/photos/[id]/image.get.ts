import { photoArchiveState } from '#server/utils/archived-photo'
import { requirePhotoIdParam, withStorageConnectionGuard } from '#server/utils/photo-guards'
import { requirePhotoImageAccess } from '#server/utils/photo-image-access'
import { parsePhotoImageResizeParams, resizePhotoImage } from '#server/utils/photo-image-resize'
import { fetchPhotoObject } from '#server/utils/storage'

// Serves one of the authenticated User's viewable Photos' actual bytes
// (issue #168): the owner, or any other member of an Album it's been
// added to (see requirePhotoImageAccess). Resizes/transcodes in-process
// via `resizePhotoImage` whenever the request carries `width`/`height`/
// `format` query params — the `photo` `@nuxt/image` provider (see
// app/providers/photo.ts) is what puts those on `NuxtImg`'s requests;
// `@nuxt/image`'s own `ipx` layer can't be used here since its
// server-side fetch can't carry this request's session cookie. A request
// with none of those params (the Download action's direct fetch) gets
// the untouched original.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requirePhotoIdParam(event)

  const access = await requirePhotoImageAccess(id, user.id)

  // An Archived Photo's bytes aren't actually readable from S3 until a
  // Restore Request completes (issue #145) — the client already shows a
  // placeholder instead of ever requesting this URL for one, but a direct
  // request (or a stale cached entry outliving a Photo going archived)
  // must fail cleanly rather than surface a raw AWS `InvalidObjectState`.
  const archiveState = photoArchiveState({
    storage_class: access.storage_class,
    restore_ongoing: access.restore_ongoing,
    restore_expires_at: access.restore_expires_at,
  })
  if (archiveState === 'archived' || archiveState === 'restoring') {
    throw createError({
      statusCode: 409,
      statusMessage: 'photos.archived',
    })
  }

  const object = await withStorageConnectionGuard(access.ownerId, () => fetchPhotoObject(access.storageConnection, access.key))
  const resizeParams = parsePhotoImageResizeParams(getQuery(event))
  const { stream, contentType } = await resizePhotoImage(object.Body as any, object.ContentType ?? access.mime_type, resizeParams)

  setResponseHeader(event, 'content-type', contentType)
  // Only the untouched original has a Content-Length known up front — a
  // resized/transcoded variant's byte size isn't known until the sharp
  // pipeline finishes, so it's left for the runtime to chunk instead.
  if (stream === object.Body && object.ContentLength !== undefined)
    setResponseHeader(event, 'content-length', object.ContentLength)
  // Private (tied to this User's own session, not shareable) — a plain
  // TTL is enough to bound how long a cached copy could outlive e.g. a
  // Photo delete, mirroring the 1h expiry the presigned URL this replaces
  // already used, without any active cache-purge-on-delete plumbing.
  setResponseHeader(event, 'cache-control', 'private, max-age=3600')

  return sendStream(event, stream)
})
