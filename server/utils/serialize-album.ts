import type { AlbumMember } from './album-guards'
import type { AwsCredentials } from './storage'
import { prisma } from './prisma'
import { photoImageUrl, publicPhotoImageUrl, serializePhoto } from './serialize-photo'

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
// admin/created_at (the same fields as serializeAlbumSummary) + every
// assigned Photo, deliberately narrower than serializeAlbumFull — no
// Collaborators (anonymous visitors have no business seeing who else has
// access), and each Photo omits `liked`/like-eligibility entirely (there's
// no signed-in User to like on behalf of), keeping "no like/edit/
// collaborate actions available" true at the response-shape level, not
// just in the client UI. Every Photo URL (cover included) is scoped under
// this Album's own `share_token` (issue #168), not the session-authed
// endpoint serializePhoto/serializeAlbumFull use, since there's no
// session at all to authorize against here.
export async function serializeAlbumPublic(album: AlbumSummarySource & { id: number }, token: string) {
  const rows = await prisma.albumsOnPhotos.findMany({
    where: { album_id: album.id },
    orderBy: { assigned_at: 'desc' },
    include: { photo: { include: { user: { include: { aws_credentials: true } } } } },
  })

  const summary = await serializeAlbumSummary(album, rows[0] ?? null, rows.length, token)

  const photos = rows
    .filter(row => row.photo.user.aws_credentials)
    .map(row => ({
      id: row.photo.id,
      url: publicPhotoImageUrl(token, row.photo.id),
      mime_type: row.photo.mime_type,
      size: row.photo.size,
      last_modified: row.photo.last_modified,
      created_at: row.photo.created_at,
    }))

  return { ...summary, photos }
}

export interface AlbumFullSource extends AlbumSummarySource {
  users: AlbumMember[]
}

// Full Album response shape (single Album show, issue #51): summary +
// Collaborators (every member other than the admin) + every assigned
// Photo, each serialized the same way the personal photo library does
// (see serializePhoto) so the client's photo grid/details components work
// unchanged inside an Album.
export async function serializeAlbumFull(album: AlbumFullSource, currentUserId: number) {
  const rows = await prisma.albumsOnPhotos.findMany({
    where: { album_id: album.id },
    orderBy: { assigned_at: 'desc' },
    include: { photo: { include: { user: { include: { aws_credentials: true } }, likes: { select: { id: true } } } } },
  })

  const summary = await serializeAlbumSummary(album, rows[0] ?? null, rows.length)

  const photos = rows
    .filter(row => row.photo.user.aws_credentials)
    .map((row) => {
      const { user: _user, ...photo } = row.photo
      return serializePhoto(photo, currentUserId)
    })

  return {
    ...summary,
    collaborators: album.users.filter(member => member.id !== album.admin.id),
    photos,
  }
}
