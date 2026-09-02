export interface Photo {
  id: number
  url: string
  mime_type: string
  size: number
  last_modified: string
  taken_at: string | null
  created_at: string
  liked: boolean
  archived_state: 'archived' | 'restoring' | 'restored' | null
  restore_expires_at: string | null
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

  // The single sortable instant that backs both `groupedByDate`'s grouping
  // key and the list's own ordering — must mirror the backend's
  // `ORDER BY COALESCE(taken_at, last_modified) DESC, id DESC`
  // (see server/api/photos/index.get.ts) so a freshly-uploaded photo with
  // an old EXIF `taken_at` (e.g. importing old photos) lands in its
  // correct chronological position instead of always at the front.
  function sortInstant(photo: Photo) {
    return photo.taken_at ?? photo.last_modified
  }

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
  // date-grouped timeline. Prefers the EXIF-derived `taken_at` (issue #162)
  // over `last_modified` so re-imported/re-uploaded photos still group by
  // the day they were actually taken rather than the day they landed in S3.
  const groupedByDate = computed(() => {
    const groups: { date: string, photos: Photo[] }[] = []
    for (const photo of photos.value) {
      const date = localDateKey(sortInstant(photo))
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
    // Insert at the correct chronological position rather than always
    // unshifting: an upload's own `taken_at` can be older than photos
    // already in the list (e.g. importing old photos, or a slower
    // real-time WS notification racing a newer upload), and always
    // prepending would break the newest-first order `groupedByDate`
    // relies on for its adjacency-based grouping.
    const newInstant = sortInstant(photo)
    const insertAt = photos.value.findIndex(existing => sortInstant(existing) < newInstant
      || (sortInstant(existing) === newInstant && existing.id < photo.id))
    const photosCopy = [...photos.value]
    if (insertAt === -1)
      photosCopy.push(photo)
    else
      photosCopy.splice(insertAt, 0, photo)
    photos.value = photosCopy
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

  // Merges a single, server-updated Photo back into the list in place —
  // shared by both the "restored one Photo" HTTP response and the
  // `photo:restored` WS notification (issue #145), which carry the exact
  // same serialized shape.
  function updatePhoto(updated: Photo) {
    photos.value = photos.value.map(existing => existing.id === updated.id ? updated : existing)
  }

  async function restorePhoto(id: number) {
    const updated = await $fetch<Photo>(`/api/photos/${id}/restore`, { method: 'POST' })
    updatePhoto(updated)
    return updated
  }

  async function restoreArchivedPhotos() {
    const response = await $fetch<{ restored: number, failed: number, photos: Photo[] }>('/api/photos/restore', { method: 'POST' })
    response.photos.forEach(updatePhoto)
    return response
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
    updatePhoto,
    restorePhoto,
    restoreArchivedPhotos,
  }
}
