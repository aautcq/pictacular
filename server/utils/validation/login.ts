import { z } from 'zod'

// zod schema replacing the former LoginDto (class-validator). Password
// complexity is intentionally not re-validated here: any non-empty password
// is passed through to the credential check, since a wrong-complexity
// password is just another wrong password.
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export type LoginInput = z.infer<typeof loginSchema>
