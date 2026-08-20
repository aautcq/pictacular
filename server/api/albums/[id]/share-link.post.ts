import { requireAlbumAdmin, requireAlbumIdParam, requireAlbumMembership } from '../../../utils/album-guards'
import { prisma } from '../../../utils/prisma'
import { generateUniqueShareToken } from '../../../utils/share-link-token'

// Generates (or rotates) an Album's Public Share Link token (issue #53),
// admin-only: any prior token is simply overwritten, so an already
// shared-out link stops working the moment a new one is generated —
// there's no separate "rotate" endpoint, calling this again *is* the
// rotation.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  const album = await requireAlbumMembership(id, user.id)
  requireAlbumAdmin(album, user.id)

  const share_token = await generateUniqueShareToken()

  await prisma.album.update({ where: { id }, data: { share_token } })

  return { share_token }
})
