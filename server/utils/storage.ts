import type { CORSRule, GetObjectCommandOutput } from '@aws-sdk/client-s3'
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
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  RestoreObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
// Imported directly (rather than relying on Nitro's auto-import) since
// this module's headObjectRestoreStatus/restoreObject (issue #145) are
// also reached from the archived-photos scan task, which has no HTTP
// entry point and so runs with no live Nitro request to auto-import
// createError from (see server/tasks/archived-photos/scan.ts and its
// test's "invoke run() directly" precedent) — every other call site
// still behaves identically, since h3's own `createError` is exactly what
// the auto-import itself resolves to.
import { createError } from 'h3'
import { extractTakenAt } from './exif'
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
  storage_class: string
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
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }))

    for (const { Key, Size, LastModified, StorageClass } of Contents ?? []) {
      if (Key && imageExtensionPattern.test(Key))
        images.push({ key: Key, size: Size ?? 0, last_modified: LastModified ?? new Date(), storage_class: StorageClass ?? 'STANDARD' })
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

function extensionFromKey(key: string): string {
  return key.split('.').pop()?.toLowerCase() ?? ''
}

// Derives an imported Photo's mime_type from its key's file extension (no
// per-object HeadObject round trip — see listAllBucketImages above), so
// every imported Photo row still gets a real `image/*` mime_type despite
// the bucket walk itself being extension-only.
export function mimeTypeFromKey(key: string): string {
  return mimeTypesByExtension[extensionFromKey(key)] ?? 'application/octet-stream'
}

// Bytes read from the start of an object when hunting for EXIF (issue
// #162) — generous enough to cover a JPEG's APP1 segment and most HEIC
// files' `meta` box without downloading the whole (often multi-MB)
// original.
export const EXIF_RANGE_BYTES = 131_072

// Extensions with no EXIF/metadata container whatsoever, at the format
// level — no amount of bytes read will ever contain a date, so unlike
// every other supported extension, a miss on the initial ranged read
// never escalates to a full-object GetObject for these (see
// fetchTakenAt below).
const noExifContainerExtensions = new Set(['gif', 'bmp'])

async function bodyToBuffer(body: NonNullable<GetObjectCommandOutput['Body']>): Promise<Buffer> {
  return Buffer.from(await body.transformToByteArray())
}

// Fetches a Photo's Taken At date (issue #162) by reading just enough of
// its underlying S3 object to find EXIF metadata: a small ranged read
// first (cheap, and sufficient for JPEG and most real-world HEIC files),
// escalating to a full-object read only when that misses — and only for
// formats capable of carrying EXIF at all (TIFF's IFD and some HEIC
// `meta` boxes can legally sit anywhere in the file, including past the
// initial range, hence bothering to escalate for them; GIF/BMP can never
// contain EXIF no matter how much is read, so a miss there goes straight
// to null rather than paying for a wasted full download). Any AWS-level
// failure (bad credentials, missing object, ...) is swallowed to null
// rather than surfaced — a Photo import/upload must never fail just
// because its Taken At couldn't be determined; callers fall back to
// `last_modified` themselves.
export async function fetchTakenAt(awsCredentials: AwsCredentials, key: string): Promise<Date | null> {
  const client = createClient(awsCredentials)

  try {
    const rangeResponse = await client.send(new GetObjectCommand({
      Bucket: awsCredentials.bucket,
      Key: key,
      Range: `bytes=0-${EXIF_RANGE_BYTES - 1}`,
    }))
    const rangeTakenAt = await extractTakenAt(await bodyToBuffer(rangeResponse.Body!))
    if (rangeTakenAt)
      return rangeTakenAt

    if (noExifContainerExtensions.has(extensionFromKey(key)))
      return null

    const fullResponse = await client.send(new GetObjectCommand({ Bucket: awsCredentials.bucket, Key: key }))
    return await extractTakenAt(await bodyToBuffer(fullResponse.Body!))
  }
  catch {
    return null
  }
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

export interface RestoreStatus {
  storage_class: string
  ongoing: boolean
  expires_at: Date | null
}

// AWS reports a Restore Request's status as a single `Restore` header
// string on the HeadObject response, e.g. `ongoing-request="true"` while
// in flight, or `ongoing-request="false", expiry-date="<RFC 7231 date>"`
// once completed (absent entirely when no restore has ever been
// requested) — there's no structured field for this on the SDK response,
// so it has to be parsed out here.
function parseRestoreHeader(header: string | undefined): { ongoing: boolean, expires_at: Date | null } {
  if (!header)
    return { ongoing: false, expires_at: null }

  const expiryMatch = header.match(/expiry-date="([^"]+)"/)

  return {
    ongoing: /ongoing-request="true"/.test(header),
    expires_at: expiryMatch ? new Date(expiryMatch[1]!) : null,
  }
}

// Reads a single object's current storage class + Restore Request status
// (issue #145) via `HeadObject` — only ever called for a Photo already
// known to be archived from the free `ListObjectsV2` `StorageClass` field
// (see listAllBucketImages above), never per-Photo on every scan/request.
// Any AWS-level failure (bad/revoked credentials, permission error, ...)
// is surfaced as the same namespaced error code `restoreObject` below
// uses, rather than bubbling up as an unhandled 500 — this is the only
// AWS call the restore endpoints make before deciding whether to issue a
// `RestoreObjectCommand` at all.
export async function headObjectRestoreStatus(awsCredentials: AwsCredentials, key: string): Promise<RestoreStatus> {
  const client = createClient(awsCredentials)

  try {
    const response = await client.send(new HeadObjectCommand({ Bucket: awsCredentials.bucket, Key: key }))
    const { ongoing, expires_at } = parseRestoreHeader(response.Restore)

    return { storage_class: response.StorageClass ?? 'STANDARD', ongoing, expires_at }
  }
  catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'photos.restore_failed',
      cause: error,
    })
  }
}

// A Restore Request's temporary availability window (issue #145): fixed
// and not user-selectable in this iteration, mirroring the fixed Standard
// retrieval tier decision — Pictacular never makes an Archived Photo
// permanently readable (that would require copying it to `STANDARD`,
// silently changing the User's storage costs, which is explicitly out of
// scope).
const RESTORE_REQUEST_DAYS = 7

// Issues a Restore Request for a single object at the Standard retrieval
// tier (issue #145) — always called only after a `headObjectRestoreStatus`
// check confirms no restore is already in flight or unexpired, but AWS can
// still reject a genuinely concurrent second request (e.g. a restore
// started directly in the AWS console between that check and this call)
// with a 409 `RestoreAlreadyInProgress`; that's treated as a no-op success
// rather than surfaced as a failure, since the end state — a restore is in
// progress — is exactly what was being asked for.
export async function restoreObject(awsCredentials: AwsCredentials, key: string): Promise<void> {
  const client = createClient(awsCredentials)

  try {
    await client.send(new RestoreObjectCommand({
      Bucket: awsCredentials.bucket,
      Key: key,
      RestoreRequest: {
        Days: RESTORE_REQUEST_DAYS,
        GlacierJobParameters: { Tier: 'Standard' },
      },
    }))
  }
  catch (error) {
    if ((error as { name?: string } | null)?.name === 'RestoreAlreadyInProgress')
      return

    throw createError({
      statusCode: 502,
      statusMessage: 'photos.restore_failed',
    })
  }
}
