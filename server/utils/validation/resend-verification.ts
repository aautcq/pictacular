import { z } from 'zod'

// zod schema for the resend-verification-email endpoint: only an email is
// needed, the same shape as resetPasswordSchema.
export const resendVerificationSchema = z.object({
  email: z.email(),
})

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>
