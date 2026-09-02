import { requireAlbumIdParam, requireAlbumMembership } from '#server/utils/album-guards'
import { serializeAlbumFull } from '#server/utils/serialize-album'

// Full Album show (issue #51): photos, admin, and Collaborators, for the
// Album's own page. Restricted to members (404 for anyone else, so a
// non-member can't tell an Album exists by probing ids).
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  const album = await requireAlbumMembership(id, user.id)
  const full = await serializeAlbumFull(album)

  // Issue #53: only the admin can generate/see the Public Share Link
  // token, so a Collaborator's full show response never leaks it.
  return { ...full, share_token: album.admin_id === user.id ? album.share_token : null }
})
