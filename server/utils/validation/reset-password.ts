import { z } from 'zod'

// zod schema replacing the former ResetPasswordDto (class-validator), used
// by the request-reset endpoint.
export const resetPasswordSchema = z.object({
  email: z.email(),
})

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
