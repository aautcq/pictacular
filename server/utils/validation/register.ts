import { z } from 'zod'
import { hasSufficientPasswordComplexity } from './password-complexity'
import { passwordConfirmationMatches, passwordConfirmationRefinementOptions } from './password-confirmation'

// zod schema replacing the former RegisterDto (class-validator), including
// the password-complexity and password/password_confirmation match rules.
export const registerSchema = z
  .object({
    email: z.email(),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    password: z
      .string()
      .min(1)
      .refine(password => hasSufficientPasswordComplexity(password), {
        message: 'password complexity is not sufficient (min 3 / 4)',
      }),
    password_confirmation: z.string().min(1),
  })
  .refine(passwordConfirmationMatches, passwordConfirmationRefinementOptions)

export type RegisterInput = z.infer<typeof registerSchema>
