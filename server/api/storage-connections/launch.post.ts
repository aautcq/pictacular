import { randomBytes, randomUUID } from 'node:crypto'
import { encodeStorageConnectionLaunch } from '#server/utils/jwt'
import { prisma } from '#server/utils/prisma'

// GitHub raw URL for the CloudFormation template CloudFormation itself
// fetches when a User clicks "Launch Stack" (issue #149's template) — this
// only resolves once that template is actually merged to `main`, a
// deployment-order dependency called out in this ticket's PR description.
const cfnTemplateUrl = 'https://raw.githubusercontent.com/aautcq/pictacular/main/cloudformation/create-bucket.yaml'

// AWS Console region the CloudFormation "quick-create" URL opens in — the
// stack/Role/bucket it creates are not confined to this region (S3
// buckets and IAM Roles are global/all-region resources), this only picks
// which regional Console UI walks the User through creating them.
const cfnConsoleRegion = 'us-east-1'

function randomSuffix() {
  return randomBytes(8).toString('hex')
}

// Starts a "create a new bucket" Storage Connection (issue #150) by
// generating every value CloudFormation's stack needs up front —
// Pictacular can't learn a bucket name or Role ARN back out of a
// CloudFormation stack it doesn't own/query, and the User is never asked
// to paste either back in, so both are generated here, pre-filled into
// the Launch Stack URL as parameters, and remembered via the signed
// `pending_token` returned alongside it for the later confirm step (POST
// /api/storage-connections) to redeem.
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

  const existing = await prisma.awsCredentials.findUnique({ where: { user_id: user.id } })
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'storage.already_connected',
    })
  }

  const { aws_account_id } = result.data
  const suffix = randomSuffix()
  const externalId = randomUUID()
  const bucket = `pictacular-${suffix}`
  const roleName = `pictacular-storage-${suffix}`
  const roleArn = `arn:aws:iam::${aws_account_id}:role/${roleName}`
  const allowedOrigin = getRequestURL(event).origin

  const pendingToken = encodeStorageConnectionLaunch({
    user_id: user.id,
    external_id: externalId,
    bucket,
    role_arn: roleArn,
  })

  const stackParams = new URLSearchParams({
    templateURL: cfnTemplateUrl,
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
  // (which only ever carries `region`).
  const launchUrl = `https://console.aws.amazon.com/cloudformation/home?region=${cfnConsoleRegion}#/stacks/create/review?${stackParams.toString()}`

  return {
    launch_url: launchUrl,
    pending_token: pendingToken,
  }
})
