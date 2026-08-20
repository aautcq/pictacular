import { z } from 'zod'

// zod schemas replacing the former CreateBiometricsDto/VerifyBiometricsDto
// (class-validator), matching @simplewebauthn/server's RegistrationResponseJSON
// / AuthenticationResponseJSON shapes returned by the browser's WebAuthn
// ceremonies. The `challenge` field of the old DTOs is dropped: the
// challenge is no longer trusted from the client, it's read from the
// webauthnChallengeCookie set by the preceding options call instead.
export const registerCredentialSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    authenticatorData: z.string().optional(),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  type: z.literal('public-key'),
})

export const verifyAssertionSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  type: z.literal('public-key'),
})

export type RegisterCredentialInput = z.infer<typeof registerCredentialSchema>
export type VerifyAssertionInput = z.infer<typeof verifyAssertionSchema>
