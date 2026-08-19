// Shared "is-equal-to" refinement (ported from the former IsEqualTo
// class-validator constraint), used by any zod schema pairing a `password`
// field with a `password_confirmation` field (register, set-password).
export function passwordConfirmationMatches(data: { password: string, password_confirmation: string }) {
  return data.password === data.password_confirmation
}

export const passwordConfirmationRefinementOptions = {
  message: 'password_confirmation and password must match',
  path: ['password_confirmation'],
}
