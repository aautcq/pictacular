// App-wide modal system (issue #48): tracks which named modal is open, so
// any component can open/close/toggle a modal by name without prop
// drilling. Reusable by later features (e.g. album sharing, photo
// details), same as the legacy modals store.
export function useModal(name: string) {
  const openModals = useState<Record<string, boolean>>('modals', () => ({}))

  const isOpen = computed(() => !!openModals.value[name])

  function open() {
    openModals.value = { ...openModals.value, [name]: true }
  }

  function close() {
    openModals.value = { ...openModals.value, [name]: false }
  }

  function toggle() {
    isOpen.value ? close() : open()
  }

  return { isOpen, open, close, toggle }
}
