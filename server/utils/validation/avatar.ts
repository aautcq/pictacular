import { z } from 'zod'

// zod schema for the avatar-upload endpoint, matching the legacy
// base64-in-JSON upload contract (no multipart, no server-side image
// processing — see docs/legacy-features.md "Out of Scope").
export const avatarUploadSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.string().regex(/^image\//, { message: 'mime_type must be an image type' }),
  base64: z.base64().min(1),
})

export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>
