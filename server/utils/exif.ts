import type { Buffer } from 'node:buffer'
import exifr from 'exifr'

// Extracts a Photo's Taken At moment (issue #162) from its image bytes'
// own EXIF metadata: prefers `DateTimeOriginal` (the moment the shutter
// fired) and falls back to `CreateDate` when only that's present. Returns
// null for anything that isn't a real, sane date — a format with no EXIF
// container, a file with no date tag, corrupt/partial bytes (e.g. a
// truncated ranged read — see server/utils/storage.ts#fetchTakenAt), or
// any other parse failure — so callers can safely fall back to
// `last_modified` themselves rather than needing to handle exceptions.
export async function extractTakenAt(buffer: Buffer): Promise<Date | null> {
  try {
    const exif = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate'])
    const takenAt = exif?.DateTimeOriginal ?? exif?.CreateDate

    return takenAt instanceof Date && !Number.isNaN(takenAt.getTime()) ? takenAt : null
  }
  catch {
    return null
  }
}
