import { Buffer } from 'node:buffer'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { decodeAwsCredentials } from './jwt'

export interface AwsCredentials {
  bucket: string
  region: string
  tokens: string
}

// Plain S3 client factory (no DI container, no class), ported from the
// former NestJS StorageService. Only the client-init + signed-URL surface
// needed for the login avatar URL is ported here; bucket lifecycle
// management (create/list/store/destroy) belongs to the future
// AWS-credentials/photo-upload tickets.
function createClient(awsCredentials: AwsCredentials) {
  const decoded = decodeAwsCredentials(awsCredentials.tokens)
  if (!decoded) {
    throw createError({
      statusCode: 401,
      statusMessage: 'auth.invalid_aws_credentials',
    })
  }

  return new S3Client({
    region: awsCredentials.region,
    credentials: {
      accessKeyId: decoded.access_key_id,
      secretAccessKey: decoded.secret_access_key,
    },
  })
}

export async function generateSecureAvatarUrl(awsCredentials: AwsCredentials, key: string, expiresIn = 3600) {
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
