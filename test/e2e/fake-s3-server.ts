import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'

// A minimal in-process "virtual S3" standing in for real AWS S3 in
// black-box HTTP tests, in the same spirit as
// test/e2e/webauthn-authenticator.ts's virtual authenticator: it implements
// just enough of the S3 REST API (path-style addressing, since
// AWS_S3_ENDPOINT/forcePathStyle point the real @aws-sdk/client-s3 client
// here — see server/utils/storage.ts) for the Storage Connection endpoints
// under test, without mocking any of this app's own modules.
//
// Bad-credentials failures are simulated by sentinel access-key IDs (S3
// itself doesn't validate SigV4 signatures here — that's the AWS SDK's own,
// already-trusted signing code, not something this app owns) rather than
// implementing real request signing verification.
export const badAccessKeyId = 'BAD_ACCESS_KEY_ID'

interface Bucket {
  cors: string | null
  keys: string[]
}

export interface FakeS3Server {
  url: string
  reset: () => void
  seedBucket: (bucket: string, keys?: string[]) => void
  close: () => Promise<void>
}

function xmlError(code: string, message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message><RequestId>fake-s3</RequestId></Error>`
}

function accessKeyIdFromAuthHeader(authHeader: string | undefined) {
  return authHeader?.match(/Credential=([^/]+)\//)?.[1]
}

export async function startFakeS3Server(): Promise<FakeS3Server> {
  const buckets = new Map<string, Bucket>()

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const [, bucketName, ...keyParts] = url.pathname.split('/')
    const key = keyParts.join('/')
    const bucket = bucketName ? buckets.get(bucketName) : undefined

    if (accessKeyIdFromAuthHeader(req.headers.authorization) === badAccessKeyId) {
      res.writeHead(403, { 'Content-Type': 'application/xml' })
      res.end(xmlError('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.'))
      return
    }

    if (req.method === 'HEAD' && bucketName && !key) {
      res.writeHead(bucket ? 200 : 404)
      res.end()
      return
    }

    if (req.method === 'PUT' && bucketName && !key && !url.search) {
      buckets.set(bucketName, bucket ?? { cors: null, keys: [] })
      res.writeHead(200, { Location: `/${bucketName}` })
      res.end()
      return
    }

    if (req.method === 'PUT' && bucketName && url.searchParams.has('cors')) {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        buckets.set(bucketName, { cors: body, keys: bucket?.keys ?? [] })
        res.writeHead(200)
        res.end()
      })
      return
    }

    if (req.method === 'GET' && bucketName && url.searchParams.has('cors')) {
      if (!bucket?.cors) {
        res.writeHead(404, { 'Content-Type': 'application/xml' })
        res.end(xmlError('NoSuchCORSConfiguration', 'The CORS configuration does not exist'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      res.end(`<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>${bucket.cors}</CORSConfiguration>`)
      return
    }

    if (req.method === 'GET' && bucketName && url.searchParams.has('location')) {
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      res.end(`<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">eu-west-3</LocationConstraint>`)
      return
    }

    if (req.method === 'GET' && bucketName && url.searchParams.get('list-type') === '2') {
      const contents = (bucket?.keys ?? [])
        .map(objectKey => `<Contents><Key>${objectKey}</Key><LastModified>2024-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>`)
        .join('')
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucketName}</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/xml' })
    res.end(xmlError('NotImplemented', 'This fake S3 double does not implement this operation'))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    reset: () => buckets.clear(),
    seedBucket: (bucket, keys = []) => buckets.set(bucket, { cors: null, keys }),
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    }),
  }
}
