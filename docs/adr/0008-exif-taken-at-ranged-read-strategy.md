# EXIF Taken At: ranged-read-then-escalate S3 fetch, format-scoped

Fixing Photo ordering to reflect when a photo was actually taken (issue #162) requires reading
EXIF metadata (`DateTimeOriginal`) out of each image, but the import flow (`POST
/api/photos/import`) previously never downloaded object bytes at all — only `ListObjectsV2`
metadata. We chose `exifr` (pure JS, no native binary, supports JPEG/TIFF/HEIC/HEIF) over
`exiftool-vendored` (broader format coverage, but bundles a native Perl `exiftool` binary this
project otherwise has zero of) and over `exif-parser`/`piexifjs` (JPEG/TIFF-only, unmaintained
since 2022).

For fetching bytes from S3, we deliberately read only a small byte range (~128KB,
`GetObject` + `Range`) first rather than always downloading the full original — cheap for
JPEG and most real-world HEIC files, whose EXIF/`meta` box sits near the start. We escalate to
a full-object `GetObject` only on a miss, and only for formats whose container can legally
place that metadata anywhere in the file (TIFF's IFD chain, some HEIC/HEIF `meta` boxes) —
GIF and BMP have no EXIF-equivalent container at any byte offset, so a miss there goes
straight to the `last_modified` fallback rather than paying for a wasted full download. Any
AWS-level failure during either read is swallowed to "no Taken At found", never surfaced as
an import/upload failure — a Photo's date is a nice-to-have, not something worth failing the
whole operation over.

Gallery ordering needed a genuinely merged timeline (Photos with and without a `taken_at`,
correctly interleaved by whichever date each one has), which Prisma's query builder can't
express as an `orderBy`. Rather than adding a denormalized sort column (which would need a
one-off data migration to backfill for every pre-existing Photo, in tension with this repo's
"schema changes only via `prisma db push`, no migration files" convention), `GET /api/photos`
computes `COALESCE(taken_at, last_modified)` live via a small raw SQL query, then hydrates
the resulting Photo ids through Prisma as usual.
