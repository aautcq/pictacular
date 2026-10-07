// Shared search-box state (issue #190), generalizing the debounced-query
// + result-set + loading/error handling first written inline in
// albums/index.vue: 300ms debounce before firing `searchFn`, `results`
// reset to `null` (not `[]`) on an empty query so callers can tell "no
// search active" apart from "search found nothing", and toast-reported
// errors like every other async action in this app. `searchFn` is
// whatever endpoint call a given page needs (e.g. useAlbums#searchAlbums,
// usePhotoLibrary#searchPhotos) — this composable owns none of the
// result shape.
//
// `key` scopes the underlying `useState` so a page and its own
// `*@header.vue` named-view (see app.vue's `#header-actions` slot) — two
// separate component instances for the same route, both calling
// useSearch with the same key — share one query/result set instead of
// each typing into its own invisible copy. Each page passes its own
// distinct key (e.g. `'library'`, `'albums'`) so unrelated pages never
// bleed search state into one another.
export function useSearch<T>(key: string, searchFn: (keyword: string) => Promise<T[]>) {
  const query = useState(`${key}-search-query`, () => '')
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

  // The page and its `*@header.vue` counterpart both call useSearch with
  // the same key (issue #215's named-view split), so the debounce/search
  // effect below must only ever be wired up once per key — otherwise
  // every keystroke would fire `searchFn` (and any error toast) twice.
  // `watching` is itself a `useState` flag (not a module-level variable)
  // so it stays correctly scoped per request during SSR; whichever of
  // the two instances reaches this check first claims the effect, and
  // releases it on unmount so the next visit to this page can reclaim it.
  const watching = useState(`${key}-search-watching`, () => false)
  if (!watching.value) {
    watching.value = true

    const debouncedQuery = refDebounced(query, 300)
    watch(debouncedQuery, (value) => {
      const trimmed = value.trim()
      if (!trimmed) {
        results.value = null
        return
      }

      runSearch(trimmed)
    })

    onScopeDispose(() => {
      watching.value = false
    })
  }

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
