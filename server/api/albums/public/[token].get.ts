import { memberSelect } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { serializeAlbumPublic } from '#server/utils/serialize-album'

// Public endpoint (no auth) backing an Album's Public Share Link (issue
// #53): resolves a share token to that Album's title/cover/Photos only —
// no like/edit/collaborate actions, no Collaborator list, matching
// serializeAlbumPublic. A non-existent (or rotated-out — see
// share-link.post.ts) token gets the same 404 either way, so it can't be
// distinguished from a probing guess.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  const album = token
    ? await prisma.album.findUnique({
        where: { share_token: token },
        include: { admin: { select: memberSelect } },
      })
    : null

  if (!album || !token) {
    throw createError({
      statusCode: 404,
      statusMessage: 'albums.not_found',
    })
  }

  return serializeAlbumPublic(album, token)
})
