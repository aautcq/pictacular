import { z } from 'zod'
import { hasSufficientPasswordComplexity } from './password-complexity'
import { passwordConfirmationMatches, passwordConfirmationRefinementOptions } from './password-confirmation'

// zod schema replacing the former SetPasswordDto (class-validator), used by
// the set-password endpoint. The former DTO only carried a bare `password`
// field; this adds a `password_confirmation` field validated with the same
// former IsEqualTo custom validator used by registerSchema (password and
// password_confirmation must match), and applies the same
// password-complexity rule as registration to the new password.
export const setPasswordSchema = z
  .object({
    password: z
      .string()
      .min(1)
      .refine(password => hasSufficientPasswordComplexity(password), {
        message: 'password complexity is not sufficient (min 3 / 4)',
      }),
    password_confirmation: z.string().min(1),
  })
  .refine(passwordConfirmationMatches, passwordConfirmationRefinementOptions)

export type SetPasswordInput = z.infer<typeof setPasswordSchema>
