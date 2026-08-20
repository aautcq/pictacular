import type { H3Event } from 'h3'
import { prisma } from './prisma'

export interface AlbumMember {
  id: number
  first_name: string
  last_name: string
}

export interface AlbumWithMembers {
  id: number
  title: string | null
  description: string | null
  created_at: Date
  admin_id: number
  admin: AlbumMember
  users: AlbumMember[]
  share_token: string | null
}

export const memberSelect = { id: true, first_name: true, last_name: true } as const

// Parses and validates the `id` route param shared by every
// single-Album endpoint (show, light show, update, delete, add/remove
// photo), mirroring requirePhotoIdParam in photo-guards.ts.
export function requireAlbumIdParam(event: H3Event): number {
  const id = Number(getRouterParam(event, 'id'))

  if (!Number.isInteger(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_payload',
    })
  }

  return id
}

// Loads an Album only if the requesting User is one of its members (the
// admin, or a Collaborator, issue #52),
// throwing the same 404 either way an Album that doesn't exist would, so a
// non-member can never distinguish "not found" from "not allowed" by
// probing ids.
export async function requireAlbumMembership(albumId: number, userId: number): Promise<AlbumWithMembers> {
  const album = await prisma.album.findFirst({
    where: { id: albumId, users: { some: { id: userId } } },
    include: {
      admin: { select: memberSelect },
      users: { select: memberSelect },
    },
  })

  if (!album) {
    throw createError({
      statusCode: 404,
      statusMessage: 'albums.not_found',
    })
  }

  return album
}

// Enforces the "delete restricted to the admin" acceptance criterion
// (issue #51): a Collaborator can see the Album (they already passed
// requireAlbumMembership) but gets a 403 — not a 404, since they do know
// it exists — when attempting an admin-only action.
export function requireAlbumAdmin(album: Pick<AlbumWithMembers, 'admin_id'>, userId: number): void {
  if (album.admin_id !== userId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'albums.admin_only',
    })
  }
}

// Parses and validates the `photoId` route param shared by the
// add/remove-Photo-from-Album endpoints.
export function requirePhotoIdRouteParam(event: H3Event): number {
  const id = Number(getRouterParam(event, 'photoId'))

  if (!Number.isInteger(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_payload',
    })
  }

  return id
}

// Loads one of the requesting User's own Photos (never someone else's —
// an Album member can only add/remove Photos from their own library),
// throwing 404 when it doesn't exist or belongs to another User.
export async function requireOwnPhoto(photoId: number, userId: number) {
  const photo = await prisma.photo.findFirst({ where: { id: photoId, user_id: userId } })

  if (!photo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'albums.photo_not_found',
    })
  }

  return photo
}
