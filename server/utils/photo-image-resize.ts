import type { Readable } from 'node:stream'

// Resize/transcode query params @nuxt/image's `photo` provider (see
// app/providers/photo.ts) puts on a request to one of the Photo image
// routes (issue #168) — this is the only place any resizing actually
// happens now that IPX itself can't reach these authenticated routes
// (see nuxt.config.ts's `image` block for the full story). No params at
// all (e.g. a direct download) means the literal original bytes.
export interface PhotoImageResizeParams {
  width?: number
  height?: number
  fit?: string
  format?: string
  quality?: number
}

// `fit` values NuxtImg/@nuxt/image passes through, mapped to sharp's own
// `fit` enum (a subset of CSS `object-fit`-like keywords) — `inside`
// (used by PhotoDetails, preserves aspect ratio, never crops or
// upscales) and `cover` (galleries/thumbnails, crops to exactly fill the
// box) are the only two this app's components actually request.
const SHARP_FIT_VALUES = new Set(['cover', 'contain', 'fill', 'inside', 'outside'])

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value)
    return undefined

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

// Parses the query string a request to a Photo image route may carry
// into resize params, ignoring anything malformed rather than rejecting
// the request outright — an unrecognized/invalid modifier just falls
// back to "no resize for that dimension", same as it not being present.
export function parsePhotoImageResizeParams(query: Record<string, unknown>): PhotoImageResizeParams {
  const fit = typeof query.fit === 'string' && SHARP_FIT_VALUES.has(query.fit) ? query.fit : undefined
  const format = typeof query.format === 'string' ? query.format : undefined

  return {
    width: parsePositiveInt(typeof query.width === 'string' ? query.width : undefined),
    height: parsePositiveInt(typeof query.height === 'string' ? query.height : undefined),
    fit,
    format,
    quality: parsePositiveInt(typeof query.quality === 'string' ? query.quality : undefined),
  }
}

const FORMAT_CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
}

// Pipes a Photo's raw bytes through `sharp` when any resize/transcode
// param was actually requested — streamed, not buffered, so a several-MB
// original never has to sit fully in memory. Returns the original stream
// untouched (and its own content-type) whenever no params were given,
// e.g. a direct "Download" request bypassing every variant.
export async function resizePhotoImage(body: Readable, originalContentType: string, params: PhotoImageResizeParams): Promise<{ stream: Readable, contentType: string }> {
  const { width, height, fit, format, quality } = params
  if (!width && !height && !format)
    return { stream: body, contentType: originalContentType }

  const sharp = (await import('sharp')).default
  let pipeline = sharp()

  if (width || height)
    pipeline = pipeline.resize({ width, height, fit: fit as 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | undefined, withoutEnlargement: true })

  const outputFormat = format ?? 'webp'
  pipeline = pipeline.toFormat(outputFormat as 'webp' | 'jpeg' | 'png' | 'avif', quality ? { quality } : undefined)

  // Plain `.pipe()` doesn't forward the source's own `error` events (a
  // dropped S3 connection mid-download, say) to the pipeline it feeds —
  // with zero listeners left on `body`, that would otherwise crash the
  // process instead of surfacing as a normal stream/request error.
  body.on('error', error => pipeline.destroy(error))

  return {
    stream: body.pipe(pipeline),
    contentType: FORMAT_CONTENT_TYPES[outputFormat] ?? originalContentType,
  }
}
