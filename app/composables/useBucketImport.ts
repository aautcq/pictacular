export interface ImportProgress {
  imported: number
  total: number
}

export interface ImportSummary {
  imported: number
  albums: number
}

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

  async function importPhotos() {
    const { on } = useRealtime()

    importing.value = true
    progress.value = null
    result.value = null

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

  return { importing, progress, result, importPhotos }
}
