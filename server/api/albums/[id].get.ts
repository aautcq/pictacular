import { requireAlbumIdParam, requireAlbumMembership } from '../../utils/album-guards'
import { serializeAlbumFull } from '../../utils/serialize-album'

// Full Album show (issue #51): photos, admin, and Collaborators, for the
// Album's own page. Restricted to members (404 for anyone else, so a
// non-member can't tell an Album exists by probing ids).
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  const album = await requireAlbumMembership(id, user.id)

  return serializeAlbumFull(album, user.id)
})
