import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
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
  objects: Map<string, { body: Buffer, contentType: string }>
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
      buckets.set(bucketName, bucket ?? { cors: null, keys: [], objects: new Map() })
      res.writeHead(200, { Location: `/${bucketName}` })
      res.end()
      return
    }

    if (req.method === 'PUT' && bucketName && url.searchParams.has('cors')) {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        buckets.set(bucketName, { cors: body, keys: bucket?.keys ?? [], objects: bucket?.objects ?? new Map() })
        res.writeHead(200)
        res.end()
      })
      return
    }

    // Object upload (PutObjectCommand): stores the body under its key and
    // records it in the bucket's `keys` listing (photos/avatars uploads).
    if (req.method === 'PUT' && bucketName && key) {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const target = bucket ?? { cors: null, keys: [], objects: new Map() }
        target.objects.set(key, { body: Buffer.concat(chunks), contentType: req.headers['content-type'] ?? 'application/octet-stream' })
        if (!target.keys.includes(key))
          target.keys = [...target.keys, key]
        buckets.set(bucketName, target)
        res.writeHead(200, { ETag: '"fake-etag"' })
        res.end()
      })
      return
    }

    // Object download (GetObjectCommand), used by the signed-URL flow. Real
    // presigned GetObject URLs always carry SigV4 auth query params (see
    // accessKeyIdFromAuthHeader's header-based counterpart for PUT/DELETE),
    // so this must not require an empty query string.
    if (req.method === 'GET' && bucketName && key) {
      const object = bucket?.objects.get(key)
      if (!object) {
        res.writeHead(404, { 'Content-Type': 'application/xml' })
        res.end(xmlError('NoSuchKey', 'The specified key does not exist.'))
        return
      }
      res.writeHead(200, { 'Content-Type': object.contentType })
      res.end(object.body)
      return
    }

    // Object delete (DeleteObjectCommand), used when a Photo is deleted.
    if (req.method === 'DELETE' && bucketName && key) {
      bucket?.objects.delete(key)
      if (bucket)
        bucket.keys = bucket.keys.filter(existingKey => existingKey !== key)
      res.writeHead(204)
      res.end()
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
    seedBucket: (bucket, keys = []) => buckets.set(bucket, { cors: null, keys, objects: new Map() }),
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    }),
  }
}
