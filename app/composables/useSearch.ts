// Shared search-box state (issue #190), generalizing the debounced-query
// + result-set + loading/error handling first written inline in
// albums/index.vue: 300ms debounce before firing `searchFn`, `results`
// reset to `null` (not `[]`) on an empty query so callers can tell "no
// search active" apart from "search found nothing", and toast-reported
// errors like every other async action in this app. `searchFn` is
// whatever endpoint call a given page needs (e.g. useAlbums#searchAlbums,
// usePhotoLibrary#searchPhotos) — this composable owns none of the
// result shape.
export function useSearch<T>(key: string, searchFn: (keyword: string) => Promise<T[]>) {
  const query = useState(`${key}-search-query`, () => '')
  const debouncedQuery = refDebounced(query, 300)
  const results = useState<T[] | null>(`${key}-search-results`, () => null)
  const searching = useState(`${key}-search-searching`, () => false)

  const toast = useToast()
  const { translateError } = useErrorMessage()

  async function runSearch(keyword: string) {
    searching.value = true
    try {
      results.value = await searchFn(keyword)
    }
    catch (error) {
      toast.add({ title: translateError(error), color: 'error' })
    }
    finally {
      searching.value = false
    }
  }

  watch(debouncedQuery, (value) => {
    const trimmed = value.trim()
    if (!trimmed) {
      results.value = null
      return
    }

    runSearch(trimmed)
  })

  // Clears both the query and any active result set in one go — used by
  // BaseSearchToggle when it collapses back to its icon (issue #190),
  // so closing the search box always reverts to the un-filtered view
  // rather than leaving a stale filter silently applied.
  function clear() {
    query.value = ''
    results.value = null
  }

  return { query, results, searching, clear }
}
