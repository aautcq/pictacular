import type { CORSRule } from '@aws-sdk/client-s3'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import {

  CreateBucketCommand,
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetBucketLocationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { decodeAwsCredentials } from './jwt'

export interface AwsCredentials {
  bucket: string
  region: string
  tokens: string
}

// Bucket region used when a User asks Pictacular to create a new bucket for
// them (they never pick one themselves); an existing/connected bucket's own
// region is looked up instead (see connectExistingBucket below).
const defaultRegion = 'eu-west-3'

// File extensions the legacy import/check-bucket flow treated as "photos"
// (see docs/legacy-features.md) — no per-object HeadObject/mime-type round
// trip, matching this app's "no image resizing/thumbnailing" scope.
const imageExtensionPattern = /\.(?:jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i

// Plain S3 client factory (no DI container, no class), ported from the
// former NestJS StorageService. `endpoint`/`forcePathStyle` are only ever
// set in test envs, to point this at an in-process fake S3 double instead
// of real AWS (see test/e2e/fake-s3-server.ts) — production never sets
// AWS_S3_ENDPOINT, so real requests always go to AWS's own endpoints.
function createClientFromTokens(tokens: string, region: string) {
  const decoded = decodeAwsCredentials(tokens)
  if (!decoded) {
    throw createError({
      statusCode: 401,
      statusMessage: 'auth.invalid_aws_credentials',
    })
  }

  const endpoint = process.env.AWS_S3_ENDPOINT

  return new S3Client({
    region,
    credentials: {
      accessKeyId: decoded.access_key_id,
      secretAccessKey: decoded.secret_access_key,
    },
    ...(endpoint && { endpoint, forcePathStyle: true }),
  })
}

function createClient(awsCredentials: AwsCredentials) {
  return createClientFromTokens(awsCredentials.tokens, awsCredentials.region)
}

// A permissive read-only CORS rule (mirroring the legacy StorageUtility's
// `corsRule`) scoped to this app's own origin, so the client can load
// signed image URLs directly from the bucket.
function corsRule(allowedOrigin: string) {
  return {
    ID: 'pictacular-cors',
    AllowedHeaders: ['*'],
    AllowedMethods: ['GET'],
    AllowedOrigins: [allowedOrigin],
    ExposeHeaders: [],
    MaxAgeSeconds: 3000,
  }
}

// S3 rejects a bad AWS key pair itself (as opposed to a bucket-specific
// problem) with one of these error names, regardless of which operation
// triggered it. HEAD responses (HeadBucketCommand) never carry a body per
// HTTP semantics, so the SDK can't parse an error name/code out of them —
// fall back to the raw 403 status for those.
function isCredentialsError(error: unknown) {
  const name = (error as { name?: string } | null)?.name
  const httpStatusCode = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
  return name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch' || httpStatusCode === 403
}

// Creates a brand-new private bucket for a User's Storage Connection
// ("create new" onboarding mode) and sets up its CORS rule, porting
// StorageUtility#createBucket + #setupBucket.
export async function createBucket(tokens: string, allowedOrigin: string) {
  const client = createClientFromTokens(tokens, defaultRegion)
  const bucket = `pictacular-${randomUUID()}`

  try {
    await client.send(new CreateBucketCommand({
      Bucket: bucket,
      CreateBucketConfiguration: { LocationConstraint: defaultRegion },
    }))
    await client.send(new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: [corsRule(allowedOrigin)] },
    }))
  }
  catch (error) {
    if (isCredentialsError(error)) {
      throw createError({ statusCode: 401, statusMessage: 'storage.invalid_credentials' })
    }
    throw createError({ statusCode: 502, statusMessage: 'storage.bucket_setup_failed' })
  }

  return { bucket, region: defaultRegion }
}

// Verifies an existing bucket is reachable with the given AWS key pair
// ("connect existing" onboarding mode), merges Pictacular's CORS rule into
// whatever CORS configuration is already there, and reports the bucket's
// own region — porting StorageUtility#getBucket + #setupBucket + #getRegion.
export async function connectExistingBucket(tokens: string, bucket: string, allowedOrigin: string) {
  const client = createClientFromTokens(tokens, defaultRegion)

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  }
  catch (error) {
    if (isCredentialsError(error)) {
      throw createError({ statusCode: 401, statusMessage: 'storage.invalid_credentials' })
    }
    throw createError({ statusCode: 404, statusMessage: 'storage.bucket_not_found' })
  }

  let existingRules: CORSRule[] = []
  try {
    const cors = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
    existingRules = cors.CORSRules ?? []
  }
  catch {
    // Bucket has no CORS configuration yet — start from an empty rule set.
  }

  await client.send(new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: { CORSRules: [...existingRules, corsRule(allowedOrigin)] },
  }))

  let region = defaultRegion
  try {
    const location = await client.send(new GetBucketLocationCommand({ Bucket: bucket }))
    // AWS reports an empty LocationConstraint for buckets in us-east-1
    // specifically (its historical "US Standard" default) rather than
    // omitting/erroring — that's a *successful* lookup, not a fallback case.
    region = location.LocationConstraint || 'us-east-1'
  }
  catch {
    // Fall back to the default region when the location lookup isn't
    // permitted by the given AWS key pair.
  }

  return { bucket, region }
}

// Reports whether a connected bucket already contains image files, so the
// onboarding client can offer a later "import existing photos" step —
// porting the checkBucket usecase's `has_photos` shape.
export async function bucketHasImages(awsCredentials: AwsCredentials) {
  const client = createClient(awsCredentials)
  const { Contents } = await client.send(new ListObjectsV2Command({ Bucket: awsCredentials.bucket, MaxKeys: 100 }))

  return (Contents ?? []).some(({ Key }) => Key && imageExtensionPattern.test(Key))
}

export interface BucketImageObject {
  key: string
  size: number
  last_modified: Date
}

// Walks every page of a connected bucket's contents (issue #54's Photo
// import), collecting every object whose key looks like an image (the
// same extension check bucketHasImages uses, no per-object HeadObject
// round trip) across as many `ListObjectsV2` pages as the bucket has —
// porting the legacy StorageUtility#listData loop's pagination, minus its
// per-object mime-type lookup (see mimeTypeFromKey below instead).
export async function listAllBucketImages(awsCredentials: AwsCredentials): Promise<BucketImageObject[]> {
  const client = createClient(awsCredentials)
  const images: BucketImageObject[] = []
  let continuationToken: string | undefined

  do {
    const { Contents, IsTruncated, NextContinuationToken } = await client.send(new ListObjectsV2Command({
      Bucket: awsCredentials.bucket,
      MaxKeys: 100,
      ContinuationToken: continuationToken,
    }))

    for (const { Key, Size, LastModified } of Contents ?? []) {
      if (Key && imageExtensionPattern.test(Key))
        images.push({ key: Key, size: Size ?? 0, last_modified: LastModified ?? new Date() })
    }

    continuationToken = IsTruncated ? NextContinuationToken : undefined
  } while (continuationToken)

  return images
}

const mimeTypesByExtension: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

// Derives an imported Photo's mime_type from its key's file extension (no
// per-object HeadObject round trip — see listAllBucketImages above), so
// every imported Photo row still gets a real `image/*` mime_type despite
// the bucket walk itself being extension-only.
export function mimeTypeFromKey(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase() ?? ''
  return mimeTypesByExtension[extension] ?? 'application/octet-stream'
}

// Generates a time-limited signed URL for any object in a User's own
// bucket (avatars, Photos, ...) — generic over bucket + key, not
// per-asset-type.
export async function generateSecureObjectUrl(awsCredentials: AwsCredentials, key: string, expiresIn = 3600) {
  const client = createClient(awsCredentials)
  const command = new GetObjectCommand({ Bucket: awsCredentials.bucket, Key: key })

  return getSignedUrl(client, command, { expiresIn })
}

// Uploads a User's avatar image (base64-in-JSON, per the legacy upload
// contract preserved by this rebuild) to their own Storage Connection
// bucket under a fixed per-user key, so re-uploading always replaces the
// previous avatar object rather than accumulating orphaned ones.
export async function uploadAvatarObject(awsCredentials: AwsCredentials, userId: number, mimeType: string, base64: string) {
  const client = createClient(awsCredentials)
  const key = `avatars/${userId}`

  await client.send(new PutObjectCommand({
    Bucket: awsCredentials.bucket,
    Key: key,
    Body: Buffer.from(base64, 'base64'),
    ContentType: mimeType,
  }))

  return key
}

// Uploads a Photo (base64-in-JSON, matching the avatar upload contract) to
// a User's own Storage Connection bucket, under a key that can never
// collide with another upload (unlike avatars, a User may have any number
// of Photos), returning the storage key + byte size persisted on the
// Photo row.
export async function uploadPhotoObject(awsCredentials: AwsCredentials, userId: number, filename: string, mimeType: string, base64: string) {
  const client = createClient(awsCredentials)
  const body = Buffer.from(base64, 'base64')
  const key = `photos/${userId}/${randomUUID()}-${filename}`

  await client.send(new PutObjectCommand({
    Bucket: awsCredentials.bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
  }))

  return { key, size: body.byteLength }
}

// Deletes a Photo's underlying bucket object (issue #50), used alongside
// removing its Photo row so a deleted Photo never leaves an orphaned S3
// object behind.
export async function deletePhotoObject(awsCredentials: AwsCredentials, key: string) {
  const client = createClient(awsCredentials)

  await client.send(new DeleteObjectCommand({ Bucket: awsCredentials.bucket, Key: key }))
}
