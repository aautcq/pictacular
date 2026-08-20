import type { Photo } from './usePhotoLibrary'

export interface AlbumMember {
  id: number
  first_name: string
  last_name: string
}

export interface AlbumSummary {
  id: number
  title: string | null
  description: string | null
  created_at: string
  admin: AlbumMember
  cover: string | null
}

export interface AlbumFull extends AlbumSummary {
  collaborators: AlbumMember[]
  photos: Photo[]
}

// Albums list/search/CRUD state (issue #51), ported from the legacy
// albums Pinia store as a Nuxt composable backed by useState, mirroring
// usePhotoLibrary.ts's shape: paginated listing (keyset cursor, newest
// first) for the albums list page, plus create/update/delete and
// add/remove-Photo actions shared with the Album show page. Search is
// stateless (each call returns its own result set) since it's a one-off
// lookup, not part of the persisted list.
export function useAlbums() {
  const albums = useState<AlbumSummary[]>('albums-list', () => [])
  const nextCursor = useState<number | null>('albums-list-cursor', () => null)
  const loaded = useState<boolean>('albums-list-loaded', () => false)
  const loading = useState<boolean>('albums-list-loading', () => false)

  const hasMore = computed(() => !loaded.value || nextCursor.value !== null)

  async function fetchNextPage() {
    if (loading.value || (loaded.value && nextCursor.value === null))
      return

    loading.value = true
    try {
      const query = nextCursor.value ? `?cursor=${nextCursor.value}` : ''
      const response = await $fetch<{ albums: AlbumSummary[], next_cursor: number | null }>(`/api/albums${query}`)
      albums.value = [...albums.value, ...response.albums]
      nextCursor.value = response.next_cursor
      loaded.value = true
    }
    finally {
      loading.value = false
    }
  }

  async function searchAlbums(keyword: string) {
    const response = await $fetch<{ albums: AlbumSummary[] }>(`/api/albums/search?q=${encodeURIComponent(keyword)}`)
    return response.albums
  }

  async function createAlbum(payload: { title: string, description?: string }) {
    const album = await $fetch<AlbumSummary>('/api/albums', { method: 'POST', body: payload })
    albums.value = [album, ...albums.value]
    return album
  }

  async function fetchAlbum(id: number) {
    return $fetch<AlbumFull>(`/api/albums/${id}`)
  }

  async function updateAlbum(id: number, payload: { title?: string, description?: string }) {
    const updated = await $fetch<AlbumSummary>(`/api/albums/${id}`, { method: 'PATCH', body: payload })
    albums.value = albums.value.map(album => album.id === updated.id ? { ...album, ...updated } : album)
    return updated
  }

  async function deleteAlbum(id: number) {
    await $fetch(`/api/albums/${id}`, { method: 'DELETE' })
    albums.value = albums.value.filter(album => album.id !== id)
  }

  async function addPhotoToAlbum(albumId: number, photoId: number) {
    return $fetch<AlbumFull>(`/api/albums/${albumId}/photos/${photoId}`, { method: 'POST' })
  }

  async function removePhotoFromAlbum(albumId: number, photoId: number) {
    return $fetch<AlbumFull>(`/api/albums/${albumId}/photos/${photoId}`, { method: 'DELETE' })
  }

  return {
    albums,
    hasMore,
    loaded,
    loading,
    fetchNextPage,
    searchAlbums,
    createAlbum,
    fetchAlbum,
    updateAlbum,
    deleteAlbum,
    addPhotoToAlbum,
    removePhotoFromAlbum,
  }
}
