import { photoArchiveState } from '#server/utils/archived-photo'
import { requirePhotoIdParam } from '#server/utils/photo-guards'
import { requirePublicPhotoImageAccess } from '#server/utils/photo-image-access'
import { parsePhotoImageResizeParams, resizePhotoImage } from '#server/utils/photo-image-resize'
import { fetchPhotoObject } from '#server/utils/storage'

// Public Share Link counterpart of GET /api/photos/[id]/image (issue
// #168): no session at all, authorized purely by the Album's own
// `share_token` in the URL (see requirePublicPhotoImageAccess), mirroring
// GET /api/albums/public/[token] and serializeAlbumPublic. Otherwise
// identical resize behavior — see photos/[id]/image.get.ts for the full
// rationale.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  const id = requirePhotoIdParam(event)

  if (!token) {
    throw createError({
      statusCode: 404,
      statusMessage: 'albums.not_found',
    })
  }

  const access = await requirePublicPhotoImageAccess(token, id)

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

  const object = await fetchPhotoObject(access.awsCredentials, access.key)
  const resizeParams = parsePhotoImageResizeParams(getQuery(event))
  const { stream, contentType } = await resizePhotoImage(object.Body as any, object.ContentType ?? access.mime_type, resizeParams)

  setResponseHeader(event, 'content-type', contentType)
  if (stream === object.Body && object.ContentLength !== undefined)
    setResponseHeader(event, 'content-length', object.ContentLength)
  // Public (no session involved at all, same spirit as the Album's own
  // public response) — a plain TTL is enough, matching the presigned
  // URL's previous 1h expiry, without any active cache-purge plumbing.
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')

  return sendStream(event, stream)
})
