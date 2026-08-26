export interface Photo {
  id: number
  url: string
  mime_type: string
  size: number
  last_modified: string
  created_at: string
  liked: boolean
}

// Personal photo library state (issue #50), ported from the legacy
// photos/List.vue Pinia store as a Nuxt composable backed by useState:
// paginated listing (keyset cursor, newest first), upload (with
// XHR-driven progress, since `$fetch`/`ofetch` exposes no upload-progress
// event), delete, and like/unlike, shared across the library page and its
// details modal.
export function usePhotoLibrary() {
  const photos = useState<Photo[]>('photo-library', () => [])
  const nextCursor = useState<number | null>('photo-library-cursor', () => null)
  const loaded = useState<boolean>('photo-library-loaded', () => false)
  const loading = useState<boolean>('photo-library-loading', () => false)

  const hasMore = computed(() => !loaded.value || nextCursor.value !== null)

  // Turns an ISO timestamp into a `YYYY-MM-DD` key in the User's local
  // timezone (never the UTC date embedded in the ISO string), so a photo
  // taken late at night still lands in the day the User experienced it.
  function localDateKey(iso: string) {
    const date = new Date(iso)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Groups the flat, newest-first list into date-keyed sections (`YYYY-MM-DD`,
  // in the User's local timezone) while preserving overall order, for the
  // date-grouped timeline.
  const groupedByDate = computed(() => {
    const groups: { date: string, photos: Photo[] }[] = []
    for (const photo of photos.value) {
      const date = localDateKey(photo.last_modified)
      const lastGroup = groups[groups.length - 1]
      if (lastGroup?.date === date)
        lastGroup.photos.push(photo)
      else
        groups.push({ date, photos: [photo] })
    }
    return groups
  })

  async function fetchNextPage() {
    if (loading.value || (loaded.value && nextCursor.value === null))
      return null

    loading.value = true
    try {
      const response = await useRequestFetch()<{ photos: Photo[], next_cursor: number | null }>('/api/photos', {
        query: nextCursor.value === null ? undefined : { cursor: nextCursor.value },
      })
      photos.value = [...photos.value, ...response.photos]
      nextCursor.value = response.next_cursor
      loaded.value = true
      return photos.value
    }
    finally {
      loading.value = false
    }
  }

  function addUploadedPhoto(photo: Photo) {
    if (photos.value.some(existing => existing.id === photo.id))
      return
    photos.value = [photo, ...photos.value]
  }

  async function deletePhoto(id: number) {
    await $fetch(`/api/photos/${id}`, { method: 'DELETE' })
    photos.value = photos.value.filter(photo => photo.id !== id)
  }

  async function deletePhotos(ids: number[]) {
    await Promise.all(ids.map(id => deletePhoto(id)))
  }

  async function toggleLike(photo: Photo) {
    const updated = await $fetch<Photo>(`/api/photos/${photo.id}/like`, {
      method: photo.liked ? 'DELETE' : 'POST',
    })
    photos.value = photos.value.map(existing => existing.id === updated.id ? updated : existing)
    return updated
  }

  return {
    photos,
    groupedByDate,
    hasMore,
    loaded,
    loading,
    fetchNextPage,
    addUploadedPhoto,
    deletePhoto,
    deletePhotos,
    toggleLike,
  }
}
