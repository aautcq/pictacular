// Minimal client-only WS pub/sub (issue #50), backing real-time
// notifications like "photo uploaded". A plain module-level singleton
// (not `useState`, which requires SSR-serializable state) since a
// WebSocket only ever exists client-side and needs to survive across
// every component that calls this composable, not just one.
let socket: WebSocket | null = null
const listeners = new Map<string, Set<(data: any) => void>>()

function dispatch(name: string, data: unknown) {
  listeners.get(name)?.forEach(callback => callback(data))
}

function ensureConnected() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))
    return

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  socket = new WebSocket(`${protocol}://${window.location.host}/ws`)

  socket.addEventListener('message', (event) => {
    try {
      const { name, data } = JSON.parse(event.data)
      dispatch(name, data)
    }
    catch {
      // Ignore malformed/non-JSON messages.
    }
  })
}

// Subscribes to a named real-time event (e.g. `photo:uploaded`), lazily
// opening the shared WS connection on first use. Returns an unsubscribe
// function, meant to be called from a component's `onUnmounted` hook.
export function useRealtime() {
  function on(name: string, callback: (data: any) => void) {
    if (import.meta.server)
      return () => {}

    ensureConnected()

    if (!listeners.has(name))
      listeners.set(name, new Set())
    listeners.get(name)!.add(callback)

    return () => listeners.get(name)?.delete(callback)
  }

  return { on }
}
