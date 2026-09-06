# Workbox runtime cache for photo images, larger virtualizer overscan

ADR-0009's virtualization unmounts/remounts `<img>` DOM nodes outside a small `overscan`
buffer as the user scrolls; each remount re-requests the same stable `/api/photos/[id]/image`
URL. That route already sets `cache-control: private, max-age=3600`, but plain browser HTTP
cache offers no guarantee of survival under storage pressure in a photo-heavy PWA, so repeat
scrolling was producing real network refetches and tripping nuxt-security's rate limiter
(429s) soon after normal use.

We picked a PWA-owned cache over just tuning the HTTP header or loosening the rate limit:
`@vite-pwa/nuxt`'s Workbox `runtimeCaching` gets a `CacheFirst` rule for both
`/api/photos/**/image` and `/api/albums/public/**/photos/**/image`, with an `expiration`
policy (`maxEntries: 1000`, `maxAgeSeconds: 604800`). This is safe because a Photo's bytes
never change in place for a given id — there's no edit-in-place feature, and `last_modified`
tracks the underlying S3 object, not a mutable edit. We also increased `useVirtualGrid`'s
`overscan` from a fixed row count to roughly one viewport height of rows on each side, so
ordinary "scroll one screen and back" never unmounts images at all, across all 6 grids that
share `useVirtualGrid`/`BaseVirtualGrid`.

The existing nuxt-security rate limit on `/api/photos/**` (2000 requests/5min) is left
unchanged as a defensive backstop, not the primary fix — if a Photo ever gains an edit-in-place
feature, this cache policy must be revisited (e.g. embedding `last_modified` in the cache key)
since `CacheFirst` would otherwise serve stale bytes indefinitely.
