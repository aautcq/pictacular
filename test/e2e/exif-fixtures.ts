import { Buffer } from 'node:buffer'

// Builds a minimal-but-valid JPEG buffer carrying a real EXIF
// `DateTimeOriginal` tag (issue #162), for black-box tests that need a
// genuine image file an EXIF parser will recognize — rather than mocking
// `exifr` itself, per this repo's "no mocking of internals" test
// philosophy. `paddingBytes` optionally inserts a large COM (comment)
// segment before the EXIF segment, letting tests push the real EXIF data
// past a ranged read's byte window to exercise the full-object-GetObject
// escalation path (see server/utils/storage.ts#fetchTakenAt).
export function buildJpegWithDateTimeOriginal(dateTaken: Date, paddingBytes = 0): Buffer {
  const soi = Buffer.from([0xFF, 0xD8])
  const eoi = Buffer.from([0xFF, 0xD9])

  const segments = [soi]

  if (paddingBytes > 0) {
    // JPEG segment lengths are 16-bit (max 65535 including the 2 length
    // bytes themselves), so large padding needs multiple COM (comment)
    // segments back to back — JPEG readers must skip markers they don't
    // recognize, so this is a legal (if unusual) way to push everything
    // after it further into the file.
    const maxPayload = 65_533
    let remaining = paddingBytes
    while (remaining > 0) {
      const payloadSize = Math.min(remaining, maxPayload)
      const comPayload = Buffer.alloc(payloadSize)
      const comLength = Buffer.alloc(2)
      comLength.writeUInt16BE(comPayload.length + 2, 0)
      segments.push(Buffer.from([0xFF, 0xFE]), comLength, comPayload)
      remaining -= payloadSize
    }
  }

  segments.push(buildExifApp1Segment(dateTaken), eoi)

  return Buffer.concat(segments)
}

// exifr (like every EXIF reader) interprets `DateTimeOriginal`'s plain
// "YYYY:MM:DD HH:MM:SS" string as wall-clock time in the *process's own
// local timezone* (EXIF carries no offset). Writing `dateTaken`'s own
// local components back out means exifr reconstructs the exact same
// instant regardless of which timezone the test happens to run in.
function buildExifApp1Segment(dateTaken: Date): Buffer {
  const dateString = `${dateTaken.getFullYear()}:${pad(dateTaken.getMonth() + 1)}:${pad(dateTaken.getDate())} ${pad(dateTaken.getHours())}:${pad(dateTaken.getMinutes())}:${pad(dateTaken.getSeconds())}`
  const asciiValue = Buffer.from(`${dateString}\0`, 'ascii')

  const tiffHeader = Buffer.alloc(8)
  tiffHeader.write('II', 0, 'ascii')
  tiffHeader.writeUInt16LE(42, 2)
  tiffHeader.writeUInt32LE(8, 4)

  const ifd0Size = 2 + 12 + 4
  const exifIfdOffset = 8 + ifd0Size

  const ifd0 = Buffer.alloc(ifd0Size)
  ifd0.writeUInt16LE(1, 0) // 1 entry
  ifd0.writeUInt16LE(0x8769, 2) // tag: ExifIFD pointer
  ifd0.writeUInt16LE(4, 4) // type: LONG
  ifd0.writeUInt32LE(1, 6) // count
  ifd0.writeUInt32LE(exifIfdOffset, 10) // value: offset to Exif sub-IFD
  ifd0.writeUInt32LE(0, 14) // next IFD offset

  const exifIfdSize = 2 + 12 + 4
  const dateValueOffset = exifIfdOffset + exifIfdSize

  const exifIfd = Buffer.alloc(exifIfdSize)
  exifIfd.writeUInt16LE(1, 0) // 1 entry
  exifIfd.writeUInt16LE(0x9003, 2) // tag: DateTimeOriginal
  exifIfd.writeUInt16LE(2, 4) // type: ASCII
  exifIfd.writeUInt32LE(asciiValue.length, 6) // count
  exifIfd.writeUInt32LE(dateValueOffset, 10) // offset to value
  exifIfd.writeUInt32LE(0, 14) // next IFD offset

  const tiff = Buffer.concat([tiffHeader, ifd0, exifIfd, asciiValue])
  const exifHeader = Buffer.from('Exif\0\0', 'ascii')
  const app1Payload = Buffer.concat([exifHeader, tiff])
  const app1Length = Buffer.alloc(2)
  app1Length.writeUInt16BE(app1Payload.length + 2, 0)

  return Buffer.concat([Buffer.from([0xFF, 0xE1]), app1Length, app1Payload])
}

// A minimal, real, browser-decodable 1x1 JPEG (JFIF, no EXIF of its own,
// generated with Pillow) — used as the base for
// `buildDecodableJpegWithDateTimeOriginal` below, since
// `buildJpegWithDateTimeOriginal`'s own bytes (headers/EXIF only, no
// image scan data) are sufficient for server-side EXIF-parsing tests but
// never render as an actual `<img>` in a real browser.
const minimalDecodableJpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivPPUP/9k='

// Splices a real EXIF `DateTimeOriginal` APP1 segment right after a known-
// good, minimal, browser-decodable JPEG's SOI marker (issue #164's
// gallery-grouping regression test needs an `<img>` a real browser will
// actually render, not just bytes an EXIF parser can read) — JPEG readers
// process markers sequentially and skip ones they don't need, so an extra
// APP1 ahead of the base image's own APP0/JFIF segment is legal and
// doesn't disturb its decodability.
export function buildDecodableJpegWithDateTimeOriginal(dateTaken: Date): Buffer {
  const baseJpeg = Buffer.from(minimalDecodableJpegBase64, 'base64')
  const soi = baseJpeg.subarray(0, 2)
  const rest = baseJpeg.subarray(2)

  return Buffer.concat([soi, buildExifApp1Segment(dateTaken), rest])
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}
