import { z } from 'zod'
import { hasSufficientPasswordComplexity } from './password-complexity'

// zod schema replacing the former UpdateUserDto (class-validator), used by
// the self-service update-profile endpoint. Unlike the former DTO (which
// required id/email/password on every request), every field is optional
// here since the target user is always the authenticated caller (never
// taken from the request body) and a caller may only want to change one
// field at a time. When password is supplied, password_confirmation must
// also be supplied and match it (same "is-equal-to" rule as register/
// set-password), and the new password must meet the same complexity rule.
// A password change also requires current_password: auth here is purely
// cookie/JWT-based with no re-auth step, so without this check anyone
// riding an existing session (stolen token, XSS, shared device) could
// silently take over the account by setting a new password without ever
// knowing the old one.
export const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    current_password: z.string().min(1).optional(),
    password: z
      .string()
      .min(1)
      .refine(password => hasSufficientPasswordComplexity(password), {
        message: 'password complexity is not sufficient (min 3 / 4)',
      })
      .optional(),
    password_confirmation: z.string().min(1).optional(),
  })
  .refine(
    data => (data.password === undefined) === (data.password_confirmation === undefined),
    {
      message: 'password_confirmation and password must match',
      path: ['password_confirmation'],
    },
  )
  .refine(
    data => data.password === undefined || data.password === data.password_confirmation,
    {
      message: 'password_confirmation and password must match',
      path: ['password_confirmation'],
    },
  )
  .refine(
    data => data.password === undefined || data.current_password !== undefined,
    {
      message: 'current_password is required to change password',
      path: ['current_password'],
    },
  )

export type UpdateUserInput = z.infer<typeof updateUserSchema>
