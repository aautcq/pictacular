import { z } from 'zod'

// Password-complexity rule ported from the former
// ValidatePasswordComplexity class-validator constraint: at least 3 of the
// 4 character classes (upper/lower case, digit, special character) must be
// present.
function hasSufficientPasswordComplexity(password: string, minComplexity = 3) {
  const rules = [/[A-Z]/, /[a-z]/, /\d/, /\W/]
  const satisfiedRules = rules.filter(rule => rule.test(password)).length

  return satisfiedRules >= minComplexity
}

// zod schema replacing the former RegisterDto (class-validator), including
// the password-complexity and password/password_confirmation match rules.
export const registerSchema = z
  .object({
    email: z.string().email(),
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
  .refine(data => data.password === data.password_confirmation, {
    message: 'password_confirmation and password must match',
    path: ['password_confirmation'],
  })

export type RegisterInput = z.infer<typeof registerSchema>
