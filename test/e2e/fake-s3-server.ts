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

// Per-object storage-class + Restore Request status (issue #145),
// separate from the actual uploaded bytes in `objects` below: a seeded
// object (photo-import/archived-photo tests) may have metadata without
// ever having gone through the PUT-object handler.
interface ObjectMetadata {
  storageClass: string
  restoreOngoing: boolean
  restoreExpiresAt: Date | null
}

interface Bucket {
  cors: string | null
  keys: string[]
  objects: Map<string, { body: Buffer, contentType: string }>
  metadata: Map<string, ObjectMetadata>
}

export interface SeedObject {
  key: string
  storageClass?: string
  restoreOngoing?: boolean
  restoreExpiresAt?: Date | null
  body?: Buffer
  contentType?: string
}

export interface GetRequestLogEntry {
  key: string
  range: string | undefined
}

export interface FakeS3Server {
  url: string
  reset: () => void
  seedBucket: (bucket: string, objects?: (string | SeedObject)[]) => void
  getRequestsFor: (key: string) => GetRequestLogEntry[]
  close: () => Promise<void>
}

function xmlError(code: string, message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message><RequestId>fake-s3</RequestId></Error>`
}

function accessKeyIdFromAuthHeader(authHeader: string | undefined) {
  return authHeader?.match(/Credential=([^/]+)\//)?.[1]
}

function defaultMetadata(): ObjectMetadata {
  return { storageClass: 'STANDARD', restoreOngoing: false, restoreExpiresAt: null }
}

function isArchivedStorageClass(storageClass: string) {
  return storageClass === 'GLACIER' || storageClass === 'DEEP_ARCHIVE'
}

// Builds the `Restore` header HeadObject reports once a Restore Request
// has ever been made for an Archived object — absent entirely otherwise,
// matching real AWS (see server/utils/storage.ts#parseRestoreHeader,
// which parses this same shape back out).
function restoreHeader(metadata: ObjectMetadata): string | undefined {
  if (!isArchivedStorageClass(metadata.storageClass) || (!metadata.restoreOngoing && !metadata.restoreExpiresAt))
    return undefined

  if (metadata.restoreOngoing)
    return 'ongoing-request="true"'

  return `ongoing-request="false", expiry-date="${metadata.restoreExpiresAt!.toUTCString()}"`
}

export async function startFakeS3Server(): Promise<FakeS3Server> {
  const buckets = new Map<string, Bucket>()
  // Every GetObject request received, keyed by object key (issue #162's
  // ranged-read-then-escalate strategy) — lets tests assert exactly how
  // many GETs (and with what Range) were made for a given key, e.g. that a
  // GIF whose ranged read misses never triggers a second, full-object GET.
  const getRequestLog: GetRequestLogEntry[] = []

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

    // HeadObject (issue #145): reports the object's current storage class
    // + Restore Request status, used both by the archived-photos scan
    // task and the restore endpoints' pre-flight check.
    if (req.method === 'HEAD' && bucketName && key) {
      const metadata = bucket?.metadata.get(key)
      if (!metadata) {
        res.writeHead(404)
        res.end()
        return
      }

      const headers: Record<string, string> = { 'x-amz-storage-class': metadata.storageClass }
      const restore = restoreHeader(metadata)
      if (restore)
        headers['x-amz-restore'] = restore

      res.writeHead(200, headers)
      res.end()
      return
    }

    if (req.method === 'PUT' && bucketName && !key && !url.search) {
      buckets.set(bucketName, bucket ?? { cors: null, keys: [], objects: new Map(), metadata: new Map() })
      res.writeHead(200, { Location: `/${bucketName}` })
      res.end()
      return
    }

    if (req.method === 'PUT' && bucketName && url.searchParams.has('cors')) {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        buckets.set(bucketName, { cors: body, keys: bucket?.keys ?? [], objects: bucket?.objects ?? new Map(), metadata: bucket?.metadata ?? new Map() })
        res.writeHead(200)
        res.end()
      })
      return
    }

    // RestoreObject (issue #145): starts (or, per a 409, rejects a second
    // concurrent) Restore Request for an Archived object.
    if (req.method === 'POST' && bucketName && key && url.searchParams.has('restore')) {
      const metadata = bucket?.metadata.get(key)
      if (!metadata) {
        res.writeHead(404, { 'Content-Type': 'application/xml' })
        res.end(xmlError('NoSuchKey', 'The specified key does not exist.'))
        return
      }

      if (metadata.restoreOngoing) {
        res.writeHead(409, { 'Content-Type': 'application/xml' })
        res.end(xmlError('RestoreAlreadyInProgress', 'Object restore is already in progress.'))
        return
      }

      metadata.restoreOngoing = true
      metadata.restoreExpiresAt = null
      res.writeHead(202)
      res.end()
      return
    }

    // Object upload (PutObjectCommand): stores the body under its key and
    // records it in the bucket's `keys` listing (photos/avatars uploads).
    if (req.method === 'PUT' && bucketName && key) {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const target = bucket ?? { cors: null, keys: [], objects: new Map(), metadata: new Map() }
        target.objects.set(key, { body: Buffer.concat(chunks), contentType: req.headers['content-type'] ?? 'application/octet-stream' })
        if (!target.metadata.has(key))
          target.metadata.set(key, defaultMetadata())
        if (!target.keys.includes(key))
          target.keys = [...target.keys, key]
        buckets.set(bucketName, target)
        res.writeHead(200, { ETag: '"fake-etag"' })
        res.end()
      })
      return
    }

    // Object download (GetObjectCommand), used by the signed-URL flow and
    // by fetchTakenAt's EXIF reads (issue #162, honoring `Range` so the
    // ranged-read-then-escalate strategy can actually be exercised).
    // Real presigned GetObject URLs always carry SigV4 auth query params
    // (see accessKeyIdFromAuthHeader's header-based counterpart for
    // PUT/DELETE), so this must not require an empty query string.
    if (req.method === 'GET' && bucketName && key) {
      getRequestLog.push({ key, range: req.headers.range })

      const metadata = bucket?.metadata.get(key)
      // An Archived object with no unexpired restore fails exactly like
      // real S3 does (issue #145): `GetObject` rejects with a 403
      // `InvalidObjectState` until a Restore Request completes.
      if (metadata && isArchivedStorageClass(metadata.storageClass) && !metadata.restoreOngoing
        && !(metadata.restoreExpiresAt && metadata.restoreExpiresAt.getTime() > Date.now())) {
        res.writeHead(403, { 'Content-Type': 'application/xml' })
        res.end(xmlError('InvalidObjectState', 'The operation is not valid for the object\'s storage class.'))
        return
      }

      const object = bucket?.objects.get(key)
      if (!object) {
        res.writeHead(404, { 'Content-Type': 'application/xml' })
        res.end(xmlError('NoSuchKey', 'The specified key does not exist.'))
        return
      }

      const rangeMatch = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/)
      if (rangeMatch) {
        const start = Number(rangeMatch[1])
        const end = Math.min(Number(rangeMatch[2]), object.body.length - 1)
        const slice = object.body.subarray(start, end + 1)
        res.writeHead(206, { 'Content-Type': object.contentType, 'Content-Range': `bytes ${start}-${end}/${object.body.length}` })
        res.end(slice)
        return
      }

      res.writeHead(200, { 'Content-Type': object.contentType })
      res.end(object.body)
      return
    }

    // Object delete (DeleteObjectCommand), used when a Photo is deleted.
    if (req.method === 'DELETE' && bucketName && key) {
      bucket?.objects.delete(key)
      bucket?.metadata.delete(key)
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
        .map((objectKey) => {
          const storageClass = bucket?.metadata.get(objectKey)?.storageClass ?? 'STANDARD'
          return `<Contents><Key>${objectKey}</Key><LastModified>2024-01-01T00:00:00.000Z</LastModified><Size>1</Size><StorageClass>${storageClass}</StorageClass></Contents>`
        })
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
    seedBucket: (bucket, objects = []) => {
      const keys: string[] = []
      const metadata = new Map<string, ObjectMetadata>()
      const objectsMap = new Map<string, { body: Buffer, contentType: string }>()

      for (const entry of objects) {
        const spec = typeof entry === 'string' ? { key: entry } : entry
        keys.push(spec.key)
        metadata.set(spec.key, {
          storageClass: spec.storageClass ?? 'STANDARD',
          restoreOngoing: spec.restoreOngoing ?? false,
          restoreExpiresAt: spec.restoreExpiresAt ?? null,
        })
        if (spec.body)
          objectsMap.set(spec.key, { body: spec.body, contentType: spec.contentType ?? 'application/octet-stream' })
      }

      buckets.set(bucket, { cors: null, keys, objects: objectsMap, metadata })
    },
    getRequestsFor: key => getRequestLog.filter(entry => entry.key === key),
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    }),
  }
}
