import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers'

// A minimal in-process "virtual authenticator" standing in for a real
// platform/roaming FIDO2 authenticator in black-box HTTP tests: it produces
// genuine "none"-attestation registration responses and ECDSA (ES256)
// assertion responses that verifyRegistrationResponse/verifyAuthenticationResponse
// (server/utils/webauthn.ts) accept, without needing a browser or real hardware.
//
// Flag byte layout (https://www.w3.org/TR/webauthn-2/#flags): UP=0x01,
// UV=0x04, AT=0x40. Both ceremonies set UP+UV since verify*Response defaults
// requireUserVerification to true. Registration additionally sets AT since
// it carries attested credential data (credential ID + public key); the
// counter is always encoded as 0 so assertions never trip the
// monotonic-counter replay check.
const flagsUserPresentAndVerified = 0x01 | 0x04
const flagsAttestedCredentialData = 0x40

function rpIdHash(rpId: string) {
  return createHash('sha256').update(rpId).digest()
}

function clientDataJSON(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string) {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
}

export function createVirtualAuthenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string, y: string }
  const x = Buffer.from(jwk.x, 'base64url')
  const y = Buffer.from(jwk.y, 'base64url')
  const credentialId = randomBytes(32)

  const cosePublicKey = isoCBOR.encode(new Map<number, unknown>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, x],
    [-3, y],
  ]))

  function createRegistrationResponse(rpId: string, origin: string, challenge: string) {
    const counter = Buffer.alloc(4)
    const credentialIdLength = Buffer.alloc(2)
    credentialIdLength.writeUInt16BE(credentialId.byteLength)

    const authenticatorData = Buffer.concat([
      rpIdHash(rpId),
      Buffer.from([flagsUserPresentAndVerified | flagsAttestedCredentialData]),
      counter,
      Buffer.alloc(16), // aaguid
      credentialIdLength,
      credentialId,
      cosePublicKey,
    ])

    const attestationObject = isoCBOR.encode(new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authenticatorData],
    ]))

    const id = isoBase64URL.fromBuffer(credentialId)

    return {
      id,
      rawId: id,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON('webauthn.create', challenge, origin)),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
      },
      clientExtensionResults: {},
      type: 'public-key' as const,
    }
  }

  function createAssertionResponse(rpId: string, origin: string, challenge: string) {
    const authenticatorData = Buffer.concat([
      rpIdHash(rpId),
      Buffer.from([flagsUserPresentAndVerified]),
      Buffer.alloc(4), // counter
    ])

    const clientData = clientDataJSON('webauthn.get', challenge, origin)
    const signatureBase = Buffer.concat([authenticatorData, createHash('sha256').update(clientData).digest()])
    const signature = sign('sha256', signatureBase, privateKey)

    const id = isoBase64URL.fromBuffer(credentialId)

    return {
      id,
      rawId: id,
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientData),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(signature),
      },
      clientExtensionResults: {},
      type: 'public-key' as const,
    }
  }

  return { createRegistrationResponse, createAssertionResponse }
}
