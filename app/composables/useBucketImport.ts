export interface ImportProgress {
  imported: number
  total: number
}

export interface ImportSummary {
  imported: number
  albums: number
}

// No timing data travels over the wire (see import.post.ts) — the ETA is
// derived purely from wall-clock time between when the client kicked off
// the import and when it received each `import:progress` event.
const MIN_IMPORTED_FOR_ETA = 3

// Storage Connection onboarding's import step (issue #54): triggers the
// server-side walk of a newly connected bucket's pre-existing images
// (auto-creating Albums from folder prefixes, Photo rows for every image
// found), tracking live progress via the existing WS real-time layer (see
// useRealtime) so the onboarding screen can show a progress indicator
// instead of one opaque wait while the import request is in flight.
export function useBucketImport() {
  const importing = ref(false)
  const progress = ref<ImportProgress | null>(null)
  const result = ref<ImportSummary | null>(null)
  const startedAt = ref<number | null>(null)

  // Estimated seconds remaining, recomputed each time a progress event
  // arrives: (imported / elapsed) gives an average items/sec rate, applied
  // to the remaining item count. Withheld until a few photos have landed —
  // per-photo duration varies (duplicates skip the taken_at S3 lookup
  // entirely), so the first data points are too noisy to trust.
  const etaSeconds = computed(() => {
    if (!progress.value || !startedAt.value || progress.value.imported < MIN_IMPORTED_FOR_ETA)
      return null

    const elapsedSeconds = (Date.now() - startedAt.value) / 1000
    const rate = progress.value.imported / elapsedSeconds
    if (rate <= 0)
      return null

    return (progress.value.total - progress.value.imported) / rate
  })

  async function importPhotos() {
    const { on } = useRealtime()

    importing.value = true
    progress.value = null
    result.value = null
    startedAt.value = Date.now()

    const offProgress = on('import:progress', (data: ImportProgress) => {
      progress.value = data
    })

    try {
      result.value = await $fetch<ImportSummary>('/api/photos/import', { method: 'POST' })
      return result.value
    }
    finally {
      importing.value = false
      offProgress()
    }
  }

  return { importing, progress, result, etaSeconds, importPhotos }
}
