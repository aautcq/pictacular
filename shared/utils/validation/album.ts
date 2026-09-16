import { z } from 'zod'

// zod schema for the create-Album endpoint (issue #51): matches the
// legacy createAlbum DTO shape (title/description), per ADR 0001's "zod
// replacing class-validator, same fields as the legacy schemas" decision.
export const albumCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
})

export type AlbumCreateInput = z.infer<typeof albumCreateSchema>

// zod schema for the update-Album endpoint: both fields optional so a
// rename-only or description-only edit doesn't need to resend the other.
export const albumUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
})

export type AlbumUpdateInput = z.infer<typeof albumUpdateSchema>

// zod schema for GET /api/albums' pagination query params, mirroring the
// Photo list endpoint's keyset-cursor contract (see validation/photo.ts).
export const albumListQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export type AlbumListQuery = z.infer<typeof albumListQuerySchema>

// zod schema for GET /api/albums/:id/photos' (and its Public Share Link
// counterpart's) pagination query params — an Album can hold thousands of
// Photos, so both mirror the personal Photo list endpoint's keyset-cursor
// contract and default limit (see validation/photo.ts) rather than the
// Album list's smaller one, since these paginate Photos, not Albums.
export const albumPhotosQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(60),
})

export type AlbumPhotosQuery = z.infer<typeof albumPhotosQuerySchema>

// zod schema for GET /api/albums/search's keyword query param.
export const albumSearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export type AlbumSearchQuery = z.infer<typeof albumSearchQuerySchema>

// zod schema for the add-Collaborators endpoint (issue #52): a non-empty
// list of emails, capped the same way a photo picker caps a batch, so a
// single request can't be used to hammer the invitation-email pipeline.
export const albumCollaboratorsSchema = z.object({
  emails: z.array(z.email()).min(1).max(20),
})

export type AlbumCollaboratorsInput = z.infer<typeof albumCollaboratorsSchema>

// zod schema for GET /api/albums/:id/collaborator-suggestions' keyword
// query param (see ADR 0012): same shape as albumSearchQuerySchema, kept
// separate since the two searches have unrelated result sets/limits.
export const albumCollaboratorSuggestionsQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
})

export type AlbumCollaboratorSuggestionsQuery = z.infer<typeof albumCollaboratorSuggestionsQuerySchema>
