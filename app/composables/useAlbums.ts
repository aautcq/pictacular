import type { Photo } from './usePhotoLibrary'

export interface AlbumMember {
  id: number
  first_name: string
  last_name: string
  avatar_url: string | null
}

export interface AlbumSummary {
  id: number
  title: string | null
  description: string | null
  created_at: string
  admin: AlbumMember
  cover: string | null
  photo_count: number
}

export interface AlbumFull extends AlbumSummary {
  collaborators: AlbumMember[]
  // Issue #53: only present (non-null) when the requesting User is the
  // Album's admin — a Collaborator's full show response always gets null.
  share_token: string | null
}
// Issue #170: an Album can hold thousands of Photos, so its own Photos
// are fetched separately, paginated (see useAlbumPhotos), rather than
// embedded in AlbumFull.

// Issue #53: a Public Share Link Photo omits `liked`/like-eligibility
// entirely — there's no signed-in User to like on behalf of on the public,
// unauthenticated view.
export interface PublicAlbumPhoto {
  id: number
  url: string
  mime_type: string
  size: number
  last_modified: string
  created_at: string
}

// Issue #53: the Public Share Link response — title/description/cover/
// admin only, deliberately narrower than AlbumFull (no Collaborators, no
// share_token itself), matching serializeAlbumPublic. Its Photos (issue
// #170) are fetched separately, paginated, via usePublicAlbumPhotos —
// same reasoning as AlbumFull above.
export type PublicAlbum = AlbumSummary

// Issue #52: the add-Collaborators endpoint's response, on top of the
// refreshed AlbumFull — which emails were linked to an existing User
// immediately vs. which were sent an Invitation instead, so the client can
// report an accurate outcome rather than a single generic message.
export interface AlbumCollaboratorsResult extends AlbumFull {
  linked: string[]
  invited: string[]
}

// Albums list/search/CRUD state (issue #51), ported from the legacy
// albums Pinia store as a Nuxt composable mirroring
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
      return null

    loading.value = true
    try {
      const response = await useRequestFetch()<{ albums: AlbumSummary[], next_cursor: number | null }>('/api/albums', {
        query: nextCursor.value === null ? undefined : { cursor: nextCursor.value },
      })
      albums.value = [...albums.value, ...response.albums]
      nextCursor.value = response.next_cursor
      loaded.value = true
      return albums.value
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
    // @ts-expect-error — $fetch does not forward the auth cookie.
    const requestFetch = import.meta.server ? useRequestFetch() : $fetch
    return await requestFetch<AlbumFull>(`/api/albums/${id}`)
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

  // Issue #170: returns just the added Photo (not the whole Album, which
  // can hold thousands) — callers merge it into their own already-loaded
  // photo list (see useAlbumPhotos.prependPhoto).
  async function addPhotoToAlbum(albumId: number, photoId: number) {
    return $fetch<Photo>(`/api/albums/${albumId}/photos/${photoId}`, { method: 'POST' })
  }

  // Issue #170: no response body (204) — callers already know which
  // Photo id they removed and splice it out of their own list themselves
  // (see useAlbumPhotos.removePhoto).
  async function removePhotoFromAlbum(albumId: number, photoId: number) {
    await $fetch(`/api/albums/${albumId}/photos/${photoId}`, { method: 'DELETE' })
  }

  // Issue #170: every Photo id currently assigned to an Album, with no
  // per-Photo join/URL cost — used by the photo picker
  // (AddPhotoPickerModal) to render its "already in this album"
  // checkmarks without paginating through the whole Album.
  async function fetchAlbumPhotoIds(albumId: number) {
    const requestFetch = import.meta.server ? useRequestFetch() : $fetch
    const response = await requestFetch<{ photo_ids: number[] }>(`/api/albums/${albumId}/photo-ids`)
    return response.photo_ids
  }

  // Issue #52: adds Collaborators by email — existing Users are linked
  // immediately, unknown emails get invited instead — returning the
  // refreshed full Album so the show page can update its Collaborators
  // list without a separate re-fetch.
  async function addCollaborators(albumId: number, emails: string[]) {
    return $fetch<AlbumCollaboratorsResult>(`/api/albums/${albumId}/collaborators`, { method: 'POST', body: { emails } })
  }

  async function removeCollaborator(albumId: number, userId: number) {
    return $fetch<AlbumFull>(`/api/albums/${albumId}/collaborators/${userId}`, { method: 'DELETE' })
  }

  // Issue #53: generates (or rotates) the admin's Public Share Link
  // token for an Album — calling this again simply replaces whatever
  // token was previously issued.
  async function generateShareLink(albumId: number) {
    const result = await $fetch<{ share_token: string }>(`/api/albums/${albumId}/share-link`, { method: 'POST' })
    return result.share_token
  }

  // Issue #53: fetches an Album's public, read-only view by its Public
  // Share Link token — unlike fetchAlbum, this hits a route that doesn't
  // require auth, since the whole point of the link is to be viewable by
  // anyone who has it, without an account.
  async function fetchPublicAlbum(token: string) {
    const requestFetch = import.meta.server ? useRequestFetch() : $fetch
    return await requestFetch<PublicAlbum>(`/api/albums/public/${token}`)
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
    fetchAlbumPhotoIds,
    addCollaborators,
    removeCollaborator,
    generateShareLink,
    fetchPublicAlbum,
  }
}
