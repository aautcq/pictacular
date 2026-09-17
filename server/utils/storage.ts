import type { GetObjectCommandOutput } from '@aws-sdk/client-s3'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import {

  DeleteObjectCommand,
  GetBucketLocationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
import { assumeRole } from './sts'

export interface AwsCredentials {
  bucket: string
  region: string
  role_arn: string
  external_id: string
}

// The single region a "create a new bucket" CloudFormation stack is ever
// launched/created in (issue #150) — a CloudFormation stack's resources
// (the bucket and Role included) are created in whichever region the
// stack itself runs in, so this is the same region
// server/api/storage-connections/launch.post.ts pre-selects in the Launch
// Stack Console URL and the one confirmStorageConnection below assumes/
// falls back to before it can look up the bucket's real region: one
// shared constant, so the two can never independently drift apart.
export const CREATE_BUCKET_STACK_REGION = 'us-east-1'

// File extensions the legacy import/check-bucket flow treated as "photos"
// (see docs/legacy-features.md) — no per-object HeadObject/mime-type round
// trip, matching this app's "no image resizing/thumbnailing" scope.
const imageExtensionPattern = /\.(?:jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i

// Plain S3 client factory (no DI container, no class), ported from the
// former NestJS StorageService. `endpoint`/`forcePathStyle` are only ever
// set in test envs, to point this at an in-process fake S3 double instead
// of real AWS (see test/e2e/fake-s3-server.ts) — production never sets
// AWS_S3_ENDPOINT, so real requests always go to AWS's own endpoints.
// Building a client now requires assuming the User's own cross-account
// Role first (issue #150): unlike the old key-pair flow, there's no
// long-lived AWS credential stored per User at all any more, only the
// Role ARN + External ID needed to assume a short session on demand (see
// server/utils/sts.ts's own in-memory session cache, which is what keeps
// this from costing a fresh AssumeRole round trip on every single call
// below).
async function createClient(awsCredentials: AwsCredentials) {
  const { accessKeyId, secretAccessKey, sessionToken } = await assumeRole(awsCredentials.role_arn, awsCredentials.external_id)
  const endpoint = process.env.AWS_S3_ENDPOINT

  return new S3Client({
    region: awsCredentials.region,
    credentials: { accessKeyId, secretAccessKey, sessionToken },
    ...(endpoint && { endpoint, forcePathStyle: true }),
  })
}

// Confirms a launched "create new bucket" CloudFormation stack has
// actually finished (issue #150): assumes the generated Role (the same
// AssumeRole call every other S3 operation below makes, but here it's the
// very first thing that can succeed at all — a stack still mid-create
// hasn't finished creating the Role yet, so this call itself is the
// "is it ready?" check, no CloudFormation Outputs/DescribeStacks polling
// needed) and looks up the bucket's own region (mirroring the legacy
// StorageUtility#getRegion the former "connect existing bucket" mode
// used), rather than trusting a value Pictacular itself already knows the
// stack was asked to use.
export async function confirmStorageConnection(roleArn: string, externalId: string, bucket: string) {
  const client = await createClient({ bucket, region: CREATE_BUCKET_STACK_REGION, role_arn: roleArn, external_id: externalId })

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  }
  catch (error) {
    throw createError({ statusCode: 502, statusMessage: 'storage.bucket_not_ready', cause: error })
  }

  let region = CREATE_BUCKET_STACK_REGION
  try {
    const location = await client.send(new GetBucketLocationCommand({ Bucket: bucket }))
    // AWS reports an empty LocationConstraint for buckets in us-east-1
    // specifically (its historical "US Standard" default) rather than
    // omitting/erroring — that's a *successful* lookup, not a fallback case.
    region = location.LocationConstraint || CREATE_BUCKET_STACK_REGION
  }
  catch {
    // Fall back to the default region when the location lookup isn't
    // permitted by the generated Role's policy.
  }

  return { bucket, region }
}

// Reports whether a connected bucket already contains image files, so the
// onboarding client can offer a later "import existing photos" step —
// porting the checkBucket usecase's `has_photos` shape.
export async function bucketHasImages(awsCredentials: AwsCredentials) {
  const client = await createClient(awsCredentials)
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
  const client = await createClient(awsCredentials)
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
  try {
    const client = await createClient(awsCredentials)
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
  const client = await createClient(awsCredentials)
  const command = new GetObjectCommand({ Bucket: awsCredentials.bucket, Key: key })

  return getSignedUrl(client, command, { expiresIn })
}

// Fetches a Photo's underlying object bytes as a stream (issue #168), for
// GET /api/photos/[id]/image and its Public Share Link counterpart to pipe
// straight through to the response rather than buffering a potentially
// multi-MB original in memory (unlike bodyToBuffer above, which the
// EXIF/Taken At read path needs a full in-memory Buffer for). The route
// handler is responsible for streaming `Body` on to its own response.
export async function fetchPhotoObject(awsCredentials: AwsCredentials, key: string) {
  const client = await createClient(awsCredentials)

  return client.send(new GetObjectCommand({ Bucket: awsCredentials.bucket, Key: key }))
}

// Uploads a User's avatar image (base64-in-JSON, per the legacy upload
// contract preserved by this rebuild) to their own Storage Connection
// bucket under a fixed per-user key, so re-uploading always replaces the
// previous avatar object rather than accumulating orphaned ones.
export async function uploadAvatarObject(awsCredentials: AwsCredentials, userId: number, mimeType: string, base64: string) {
  const client = await createClient(awsCredentials)
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
  const client = await createClient(awsCredentials)
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
  const client = await createClient(awsCredentials)

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
  try {
    const client = await createClient(awsCredentials)
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
  try {
    const client = await createClient(awsCredentials)
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
