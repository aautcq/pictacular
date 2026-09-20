import { randomBytes, randomUUID } from 'node:crypto'
import { encodeStorageConnectionLaunch } from '#server/utils/jwt'
import { prisma } from '#server/utils/prisma'
import { CREATE_BUCKET_STACK_REGION } from '#server/utils/storage'

// CloudFormation's own CreateStack API only accepts a TemplateURL that
// points at an object in Amazon S3 (or an SSM document) — never an
// arbitrary HTTPS host such as raw.githubusercontent.com, which it rejects
// with "TemplateURL must be a supported URL" — so the version-controlled
// templates under cloudformation/*.yaml (issue #149/#151) are mirrored to
// a Pictacular-owned S3 bucket (see cloudformation/README.md) and this
// only builds URLs against that bucket's base URL, read from config.
function cfnTemplateUrl(mode: 'create' | 'connect') {
  const { cfnTemplatesBaseUrl } = useRuntimeConfig().aws
  const filename = mode === 'create' ? 'create-bucket.yaml' : 'connect-bucket.yaml'
  return `${cfnTemplatesBaseUrl}/${filename}`
}

function randomSuffix() {
  return randomBytes(8).toString('hex')
}

// Starts a Storage Connection, either "create a new bucket" (issue #150)
// or "connect an existing bucket" (issue #152), by generating every value
// CloudFormation's stack needs up front (except, for "connect" mode, the
// bucket name itself, which only the User can supply — Pictacular has no
// way to know it ahead of time) — Pictacular can't learn a Role ARN back
// out of a CloudFormation stack it doesn't own/query, and the User is
// never asked to paste it back in, so it's predicted here (from the
// User's AWS Account ID plus a generated Role name, pre-filled as a stack
// parameter either template accepts), pre-filled into the Launch Stack
// URL, and remembered via the signed `pending_token` returned alongside it
// for the later confirm step (POST /api/storage-connections) to redeem.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = storageConnectionLaunchSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'validation.invalid_payload',
      data: {
        errors: result.error.issues.map(issue => ({
          name: issue.path[0],
          message: issue.message,
        })),
      },
    })
  }

  const existing = await prisma.storageConnection.findUnique({ where: { user_id: user.id } })
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'storage.already_connected',
    })
  }

  const { mode, aws_account_id } = result.data
  const suffix = randomSuffix()
  const externalId = randomUUID()
  // "Create" mode generates its own bucket name (Pictacular owns it
  // outright); "connect" mode uses the bucket the User already named —
  // the one value this endpoint can't generate on their behalf.
  const bucket = mode === 'create' ? `pictacular-${suffix}` : result.data.bucket
  const roleName = `pictacular-storage-${suffix}`
  const roleArn = `arn:aws:iam::${aws_account_id}:role/${roleName}`
  const allowedOrigin = getRequestURL(event).origin

  const pendingToken = encodeStorageConnectionLaunch({
    user_id: user.id,
    external_id: externalId,
    bucket,
    role_arn: roleArn,
    mode,
  })

  const stackParams = new URLSearchParams({
    templateURL: cfnTemplateUrl(mode),
    stackName: 'pictacular-storage-connection',
    param_ExternalId: externalId,
    param_BucketName: bucket,
    param_RoleName: roleName,
    param_AllowedOrigin: allowedOrigin,
  })
  // AWS's own "Launch Stack" URL shape: the CloudFormation Console is a
  // single-page app, so everything past `/stacks/create/review?` — the
  // template URL and every stack parameter — lives inside the URL
  // fragment (`#...`), not as this URL's own top-level query string
  // (which only ever carries `region`). The `region` here only picks
  // which Console region opens (IAM Roles are global, and "connect" mode
  // never creates a bucket), so it's the same fixed region for both modes.
  const launchUrl = `https://console.aws.amazon.com/cloudformation/home?region=${CREATE_BUCKET_STACK_REGION}#/stacks/create/review?${stackParams.toString()}`

  return {
    launch_url: launchUrl,
    pending_token: pendingToken,
  }
})
