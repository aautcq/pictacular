import { z } from 'zod'

// zod schema for the Photo-upload endpoint, matching the same
// base64-in-JSON upload contract as the avatar upload (no multipart, no
// server-side image processing — see docs/legacy-features.md "Out of
// Scope"). `last_modified` is optional so a client can report the file's
// own capture/modified time (e.g. from `File#lastModified`); it defaults
// to upload time server-side when omitted.
export const photoUploadSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.string().regex(/^image\//, { message: 'mime_type must be an image type' }),
  base64: z.base64().min(1),
  last_modified: z.iso.datetime({ offset: true }).optional(),
})

export type PhotoUploadInput = z.infer<typeof photoUploadSchema>

// zod schema for GET /api/photos' pagination query params.
export const photoListQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(60),
})

export type PhotoListQuery = z.infer<typeof photoListQuerySchema>

// zod schema for GET /api/photos/search's query params (issue #190):
// `album_id`, when given, scopes the search to one Album's own Photos
// (filename only) instead of the requesting User's whole library
// (filename OR Album title) — see server/api/photos/search.get.ts. A
// smaller max/default `limit` than the list endpoints above: search
// results are a single capped batch of "best matches", never
// further-paginated, so there's no reason to allow as large a page as a
// keyset-paginated list.
export const photoSearchQuerySchema = z.object({
  q: z.string().min(1),
  album_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

export type PhotoSearchQuery = z.infer<typeof photoSearchQuerySchema>
