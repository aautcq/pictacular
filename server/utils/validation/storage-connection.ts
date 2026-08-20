import { z } from 'zod'

// zod schema for the Storage Connection onboarding endpoint: a User submits
// their AWS key pair plus a mode, either asking Pictacular to create a new
// bucket for them or naming an existing bucket to connect (see
// docs/legacy-features.md "Storage Connection").
export const storageConnectionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('create'),
    access_key_id: z.string().min(1),
    secret_access_key: z.string().min(1),
  }),
  z.object({
    mode: z.literal('connect'),
    access_key_id: z.string().min(1),
    secret_access_key: z.string().min(1),
    bucket: z.string().min(1),
  }),
])

export type StorageConnectionInput = z.infer<typeof storageConnectionSchema>
