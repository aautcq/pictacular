import { requireAlbumIdParam, requireAlbumMembership } from '#server/utils/album-guards'
import { loadAlbumCover, serializeAlbumLight } from '#server/utils/serialize-album'

// Lightweight Album show (issue #51): cover + admin only, for fast
// summary contexts (e.g. a photo picker listing which Albums a Photo
// could be added to) that don't need the full photo list/Collaborators
// or even the title/description that the regular list view needs.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  const album = await requireAlbumMembership(id, user.id)

  return serializeAlbumLight(album, await loadAlbumCover(id))
})
