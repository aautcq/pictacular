import process from 'node:process'
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts'
import { createError } from 'h3'

export interface AssumedRoleCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: Date
}

// Same "invoke run() directly, no request context" accommodation as
// jwt.ts's verifyToken (see server/tasks/archived-photos/scan.ts): a
// Storage Connection's S3 client is now built via assumeRole below, which
// this module's own callers reach from that same request-context-free
// scan task, so Pictacular's own AWS credentials (used to sign the
// AssumeRole call itself, distinct from the User's assumed-role
// credentials this function returns) need the same
// useRuntimeConfig()-or-env-var fallback.
function pictacularOwnCredentials() {
  return typeof useRuntimeConfig === 'function'
    ? useRuntimeConfig().aws
    : {
        accessKeyId: process.env.NUXT_AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.NUXT_AWS_SECRET_ACCESS_KEY as string,
      }
}

function stsClient() {
  const { accessKeyId, secretAccessKey } = pictacularOwnCredentials()
  // Reuses the same fake-double endpoint every test file already sets for
  // S3 (see test/e2e/fake-s3-server.ts), rather than introducing a second
  // AWS_STS_ENDPOINT env var every one of those files would otherwise
  // also need to set — the fake double hosts both protocols on one port.
  const endpoint = process.env.AWS_S3_ENDPOINT

  return new STSClient({
    // STS itself is region-agnostic for AssumeRole (a single global/
    // regional endpoint signs for any Role in any region); this is purely
    // the SDK's own required client region, unrelated to the bucket's.
    region: 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint && { endpoint }),
  })
}

// Assumed-role sessions are cached in-memory (per roleArn+externalId pair)
// rather than re-calling AssumeRole on every single S3 operation — AWS
// STS sessions are valid for up to an hour, and every caller of
// createClient (server/utils/storage.ts) already happens per-request, so
// without this cache a single page load touching several Photos would
// otherwise cost one AssumeRole round trip per object.
const assumedRoleCache = new Map<string, AssumedRoleCredentials>()

// Re-assume ahead of actual expiry, so a session already borderline-
// expired by network latency alone is never handed to a caller.
const REFRESH_MARGIN_MS = 5 * 60 * 1000

function cacheKey(roleArn: string, externalId: string) {
  return `${roleArn}::${externalId}`
}

// Assumes a User's own Storage Connection Role (issue #150), caching the
// resulting session credentials until they're close to expiring. Thrown
// errors are namespaced the same way the rest of this app's AWS-facing
// code is (see server/api/storage-connections/index.post.ts's
// storage.invalid_role/storage.bucket_not_ready mapping) so callers can
// surface a single consistent "storage connection is broken" error
// regardless of whether AssumeRole itself failed or a later S3 call did.
export async function assumeRole(roleArn: string, externalId: string): Promise<AssumedRoleCredentials> {
  const key = cacheKey(roleArn, externalId)
  const cached = assumedRoleCache.get(key)
  if (cached) {
    if (cached.expiration.getTime() - REFRESH_MARGIN_MS > Date.now())
      return cached

    // Opportunistic eviction (no separate sweep/timer): a Storage
    // Connection's Role+ExternalId pair is freshly randomized per
    // connection (see server/api/storage-connections/launch.post.ts), so
    // without this a long-running server process would otherwise
    // accumulate one stale cache entry per connection ever made, forever.
    assumedRoleCache.delete(key)
  }

  try {
    const response = await stsClient().send(new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'pictacular',
      ExternalId: externalId,
    }))

    const credentials = response.Credentials
    if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken || !credentials.Expiration) {
      throw createError({ statusCode: 502, statusMessage: 'storage.connection_failed' })
    }

    const assumed: AssumedRoleCredentials = {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey,
      sessionToken: credentials.SessionToken,
      expiration: credentials.Expiration,
    }
    assumedRoleCache.set(key, assumed)
    return assumed
  }
  catch (error) {
    assumedRoleCache.delete(key)
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error

    throw createError({ statusCode: 401, statusMessage: 'storage.invalid_role', cause: error })
  }
}
