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
  // exifr (like every EXIF reader) interprets the tag's plain
  // "YYYY:MM:DD HH:MM:SS" string as wall-clock time in the *process's own
  // local timezone* (EXIF carries no offset). Writing `dateTaken`'s own
  // local components back out means exifr reconstructs the exact same
  // instant regardless of which timezone the test happens to run in.
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

  const soi = Buffer.from([0xFF, 0xD8])
  const app1Marker = Buffer.from([0xFF, 0xE1])
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

  segments.push(app1Marker, app1Length, app1Payload, eoi)

  return Buffer.concat(segments)
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}
