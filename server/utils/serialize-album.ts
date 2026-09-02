import type { AlbumMember } from './album-guards'
import type { AwsCredentials } from './storage'
import { prisma } from './prisma'
import { photoImageUrl, publicPhotoImageUrl } from './serialize-photo'

export interface AlbumCoverRow {
  album_id: number
  photo: {
    id: number
    user: { aws_credentials: AwsCredentials | null }
  }
}

export interface AlbumSummarySource {
  id: number
  title: string | null
  description: string | null
  created_at: Date
  admin: AlbumMember
}

// Resolves an Album cover row to this app's own stable image URL (or
// null if there's no cover yet, or the covering Photo's owner has no
// storage connected) — the Public Share Link variant when `publicToken`
// is given (serializeAlbumPublic), the session-authed variant otherwise.
// Shared by every response shape that includes a cover.
function resolveCoverUrl(cover: AlbumCoverRow | null, publicToken?: string): string | null {
  if (!cover?.photo.user.aws_credentials)
    return null

  return publicToken ? publicPhotoImageUrl(publicToken, cover.photo.id) : photoImageUrl(cover.photo.id)
}

// Shared response shape for every Album view that only needs a cover
// (list + lightweight show, issue #51): title/description + this app's
// own stable cover-photo URL derived from the Album's most recently
// added Photo, + admin only — no full photo list/Collaborators, keeping
// list/summary views fast per docs/legacy-features.md. `photoCount`
// (issue #136) is the raw count of AlbumsOnPhotos rows for the Album,
// regardless of whether each Photo's owner currently has a working
// Storage Connection — it must not silently shrink just because a Photo
// would otherwise be filtered out of a full photo list.
export async function serializeAlbumSummary(album: AlbumSummarySource, cover: AlbumCoverRow | null, photoCount: number, publicToken?: string) {
  return {
    id: album.id,
    title: album.title,
    description: album.description,
    created_at: album.created_at,
    admin: album.admin,
    cover: resolveCoverUrl(cover, publicToken),
    photo_count: photoCount,
  }
}

export interface AlbumLightSource {
  id: number
  admin: AlbumMember
}

// Lightweight Album show response (issue #51): "cover photo + admin info
// only" per docs/legacy-features.md — deliberately narrower than
// serializeAlbumSummary (no title/description), for contexts like a
// photo picker that only need to render a cover thumbnail + who owns it.
export async function serializeAlbumLight(album: AlbumLightSource, cover: AlbumCoverRow | null) {
  return {
    id: album.id,
    admin: album.admin,
    cover: resolveCoverUrl(cover),
  }
}

// Loads the single Photo used as an Album's cover: the most recently
// added one, so adding a new Photo to an otherwise-empty Album gives it a
// cover immediately.
export async function loadAlbumCover(albumId: number): Promise<AlbumCoverRow | null> {
  return prisma.albumsOnPhotos.findFirst({
    where: { album_id: albumId },
    orderBy: { assigned_at: 'desc' },
    include: { photo: { include: { user: { include: { aws_credentials: true } } } } },
  })
}

// Counts the raw number of AlbumsOnPhotos rows for a single Album (issue
// #136), deliberately not filtering out Photos whose owner has no Storage
// Connection — pairs with loadAlbumCover for the single-Album call sites
// that don't already have every row in memory (unlike loadAlbumCovers/
// serializeAlbumFull/serializeAlbumPublic below).
export async function countAlbumPhotos(albumId: number): Promise<number> {
  return prisma.albumsOnPhotos.count({ where: { album_id: albumId } })
}

export interface AlbumCoversAndCounts {
  covers: Map<number, AlbumCoverRow>
  photoCounts: Map<number, number>
}

// Batch version of loadAlbumCover for list/search endpoints (issue #51):
// one query for every candidate row across all given Albums, then picks
// each Album's most recent row in memory, instead of one round-trip per
// Album (which doesn't scale with page size). Also derives each Album's
// photo_count (issue #136) from the same in-memory row set, instead of a
// separate COUNT query per page.
export async function loadAlbumCovers(albumIds: number[]): Promise<AlbumCoversAndCounts> {
  if (albumIds.length === 0)
    return { covers: new Map(), photoCounts: new Map() }

  const rows = await prisma.albumsOnPhotos.findMany({
    where: { album_id: { in: albumIds } },
    orderBy: { assigned_at: 'desc' },
    include: { photo: { include: { user: { include: { aws_credentials: true } } } } },
  })

  const covers = new Map<number, AlbumCoverRow>()
  const photoCounts = new Map<number, number>()
  for (const row of rows) {
    if (!covers.has(row.album_id))
      covers.set(row.album_id, row)
    photoCounts.set(row.album_id, (photoCounts.get(row.album_id) ?? 0) + 1)
  }

  return { covers, photoCounts }
}

// Public Share Link response shape (issue #53): title/description/cover/
// admin/created_at (the same fields as serializeAlbumSummary), deliberately
// narrower than serializeAlbumFull — no Collaborators (anonymous visitors
// have no business seeing who else has access) and no Photos (an Album
// can hold thousands — see loadAlbumPhotosPagePublic for the paginated
// counterpart, GET /api/albums/public/:token/photos).
export async function serializeAlbumPublic(album: AlbumSummarySource & { id: number }, token: string) {
  const [cover, photoCount] = await Promise.all([loadAlbumCover(album.id), countAlbumPhotos(album.id)])
  return serializeAlbumSummary(album, cover, photoCount, token)
}

export interface AlbumFullSource extends AlbumSummarySource {
  users: AlbumMember[]
}

// Full Album response shape (single Album show, issue #51): summary +
// Collaborators (every member other than the admin) — deliberately no
// Photos (an Album can hold thousands, so listing them is paginated
// separately via GET /api/albums/:id/photos, see loadAlbumPhotosPage
// below), unlike the earlier version of this endpoint which embedded
// every assigned Photo directly.
export async function serializeAlbumFull(album: AlbumFullSource) {
  const [cover, photoCount] = await Promise.all([loadAlbumCover(album.id), countAlbumPhotos(album.id)])
  const summary = await serializeAlbumSummary(album, cover, photoCount)

  return {
    ...summary,
    collaborators: album.users.filter(member => member.id !== album.admin.id),
  }
}

export interface AlbumPhotoIdPage {
  ids: number[]
  hasMore: boolean
}

// Shared keyset-cursor page of an Album's assigned Photo ids (issue
// #170), ordered newest-assigned-first (`assigned_at DESC, photo_id DESC`
// — matching serializeAlbumFull/serializeAlbumPublic's previous
// `orderBy: { assigned_at: 'desc' }`), mirroring GET /api/photos' own
// "raw-SQL id selection, then Prisma hydration" split (see
// server/api/photos/index.get.ts) since Prisma's query builder can't
// express a single tuple-comparison keyset predicate. `cursorAssignedAt`
// is the assigned_at of the AlbumsOnPhotos row for `cursorPhotoId` —
// callers must resolve and validate it first (see
// findAlbumPhotoAssignment), the same "resolve cursor row, 400 if it
// doesn't belong to this Album" contract GET /api/photos already uses.
export async function loadAlbumPhotoIdPage(albumId: number, cursorPhotoId: number | undefined, cursorAssignedAt: Date | undefined, limit: number): Promise<AlbumPhotoIdPage> {
  const rows = (cursorPhotoId !== undefined && cursorAssignedAt !== undefined)
    ? await prisma.$queryRaw<{ photo_id: number }[]>`
        SELECT photo_id FROM "AlbumsOnPhotos"
        WHERE album_id = ${albumId}
          AND (assigned_at, photo_id) < (${cursorAssignedAt}::timestamptz, ${cursorPhotoId}::int)
        ORDER BY assigned_at DESC, photo_id DESC
        LIMIT ${limit + 1}
      `
    : await prisma.$queryRaw<{ photo_id: number }[]>`
        SELECT photo_id FROM "AlbumsOnPhotos"
        WHERE album_id = ${albumId}
        ORDER BY assigned_at DESC, photo_id DESC
        LIMIT ${limit + 1}
      `

  const hasMore = rows.length > limit
  return { ids: rows.slice(0, limit).map(row => row.photo_id), hasMore }
}

// Resolves a page-boundary Photo id's own AlbumsOnPhotos assignment,
// anchoring loadAlbumPhotoIdPage's keyset comparison — null when the
// given Photo was never assigned to this Album (a stale/forged cursor),
// so the route can 400 rather than silently restart from page 1.
export async function findAlbumPhotoAssignment(albumId: number, photoId: number): Promise<{ assigned_at: Date } | null> {
  return prisma.albumsOnPhotos.findUnique({
    where: { photo_id_album_id: { photo_id: photoId, album_id: albumId } },
    select: { assigned_at: true },
  })
}
