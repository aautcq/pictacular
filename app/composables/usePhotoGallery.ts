import type { Photo } from '~/composables/usePhotoLibrary'

export function usePhotoGallery(key: string, photos: Ref<Photo[]>) {
  const toast = useToast()
  const { translateError } = useErrorMessage()

  const selectedIds = useState<Set<number>>(`${key}-gallery-selected-ids`, () => new Set())
  const selectedCount = computed(() => selectedIds.value.size)
  const selectionMode = computed(() => selectedCount.value > 0)
  const lastSelectedId = useState<number | null>(`${key}-gallery-last-selected-id`, () => null)
  const detailsPhotoId = useState<number | null>(`${key}-gallery-details-photo-id`, () => null)

  const detailsIndex = computed(() => photos.value.findIndex(photo => photo.id === detailsPhotoId.value))
  const detailsPhoto = computed(() => detailsIndex.value === -1 ? null : photos.value[detailsIndex.value]!)
  const hasPrevious = computed(() => detailsIndex.value > 0)
  const hasNext = computed(() => detailsIndex.value !== -1 && detailsIndex.value < photos.value.length - 1)

  function isSelected(id: number) {
    return selectedIds.value.has(id)
  }

  function toggleSelection(photo: Photo, event: MouseEvent) {
    const ids = photos.value.map(item => item.id)
    const clickedIndex = ids.indexOf(photo.id)

    if (event.shiftKey && lastSelectedId.value !== null) {
      const anchorIndex = ids.indexOf(lastSelectedId.value)
      if (anchorIndex !== -1) {
        const [start, end] = anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
        const next = new Set(selectedIds.value)
        for (const id of ids.slice(start, end + 1)) next.add(id)
        selectedIds.value = next
        return
      }
    }

    const next = new Set(selectedIds.value)
    if (next.has(photo.id))
      next.delete(photo.id)
    else
      next.add(photo.id)
    selectedIds.value = next
    lastSelectedId.value = photo.id
  }

  function clearSelection() {
    selectedIds.value = new Set()
    lastSelectedId.value = null
  }

  function showPrevious() {
    detailsPhotoId.value = photos.value[detailsIndex.value - 1]!.id
  }

  function showNext() {
    detailsPhotoId.value = photos.value[detailsIndex.value + 1]!.id
  }

  function closeDetails() {
    detailsPhotoId.value = null
  }

  async function downloadSelected() {
    try {
      for (const photo of photos.value.filter(photo => selectedIds.value.has(photo.id))) {
        await downloadFile(
          photo.url,
          getPhotoFileName(photo),
        )
      }
    }
    catch (error) {
      toast.add({ title: translateError(error), color: 'error' })
    }
  }

  return {
    selectedIds,
    selectedCount,
    selectionMode,
    detailsPhotoId,
    detailsPhoto,
    hasPrevious,
    hasNext,
    isSelected,
    toggleSelection,
    clearSelection,
    showPrevious,
    showNext,
    closeDetails,
    downloadSelected,
  }
}
