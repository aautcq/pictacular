import type { AlbumMember } from './album-guards'
import type { AwsCredentials } from './storage'
import { prisma } from './prisma'
import { serializePhoto } from './serialize-photo'
import { generateSecureObjectUrl } from './storage'

export interface AlbumCoverRow {
  album_id: number
  photo: {
    key: string
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

// Resolves an Album cover row to a signed URL (or null if there's no
// cover yet, or the covering Photo's owner has no storage connected).
// Shared by every response shape that includes a cover.
async function resolveCoverUrl(cover: AlbumCoverRow | null): Promise<string | null> {
  return cover?.photo.user.aws_credentials
    ? generateSecureObjectUrl(cover.photo.user.aws_credentials, cover.photo.key)
    : null
}

// Shared response shape for every Album view that only needs a cover
// (list + lightweight show, issue #51): title/description + a signed
// cover-photo URL derived from the Album's most recently added Photo, +
// admin only — no full photo list/Collaborators, keeping list/summary
// views fast per docs/legacy-features.md.
export async function serializeAlbumSummary(album: AlbumSummarySource, cover: AlbumCoverRow | null) {
  return {
    id: album.id,
    title: album.title,
    description: album.description,
    created_at: album.created_at,
    admin: album.admin,
    cover: await resolveCoverUrl(cover),
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
    cover: await resolveCoverUrl(cover),
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

// Batch version of loadAlbumCover for list/search endpoints (issue #51):
// one query for every candidate row across all given Albums, then picks
// each Album's most recent row in memory, instead of one round-trip per
// Album (which doesn't scale with page size).
export async function loadAlbumCovers(albumIds: number[]): Promise<Map<number, AlbumCoverRow>> {
  if (albumIds.length === 0)
    return new Map()

  const rows = await prisma.albumsOnPhotos.findMany({
    where: { album_id: { in: albumIds } },
    orderBy: { assigned_at: 'desc' },
    include: { photo: { include: { user: { include: { aws_credentials: true } } } } },
  })

  const covers = new Map<number, AlbumCoverRow>()
  for (const row of rows) {
    if (!covers.has(row.album_id))
      covers.set(row.album_id, row)
  }

  return covers
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

  const summary = await serializeAlbumSummary(album, rows[0] ?? null)

  const photos = (await Promise.all(rows.map(async (row) => {
    const { aws_credentials } = row.photo.user
    if (!aws_credentials)
      return null
    const { user: _user, ...photo } = row.photo
    return serializePhoto(photo, aws_credentials, currentUserId)
  }))).filter(photo => photo !== null)

  return {
    ...summary,
    collaborators: album.users.filter(member => member.id !== album.admin.id),
    photos,
  }
}
