const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Keyboard focus-trapping for the modal system (issue #48), ported from
// the legacy useFocusTrap composable: while active, Tab/Shift+Tab cycles
// only within the trapped element, and focus returns to whatever was
// focused before the trap activated once it's released.
export function useFocusTrap() {
  const trapRef = ref<HTMLElement | null>(null)
  let previouslyFocused: Element | null = null

  function keyHandler(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !trapRef.value)
      return

    const focusable = trapRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusable.length === 0)
      return

    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!

    if (event.shiftKey) {
      if (document.activeElement === first) {
        last.focus()
        event.preventDefault()
      }
    }
    else if (document.activeElement === last) {
      first.focus()
      event.preventDefault()
    }
  }

  function activate() {
    if (!trapRef.value)
      return

    previouslyFocused = document.activeElement
    const focusable = trapRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    document.addEventListener('keydown', keyHandler)

    if (focusable.length > 0 && !trapRef.value.contains(document.activeElement))
      focusable[0]!.focus()
  }

  function deactivate() {
    document.removeEventListener('keydown', keyHandler)
    if (previouslyFocused instanceof HTMLElement)
      previouslyFocused.focus()
  }

  return { trapRef, activate, deactivate }
}
