import type { Peer } from 'crossws'

// Plain WebSocket peer registry (no DI container), backing the native
// `sendMessage`-style broadcast that replaces the former
// GatewayService#sendMessage (`this.server.emit(room, data)` — Socket.IO's
// `emit` broadcasts a named event to every connected socket; `room` there
// was really just an arbitrary event/message name, not an actual Socket.IO
// room). Nitro's WS layer (crossws) only exposes `peer.peers`/`peer.publish`
// from inside an already-open peer's own hooks, with no adapter-level API
// reachable from arbitrary server code (e.g. a future HTTP route reacting
// to a photo upload) — so open connections are tracked here instead.
const peers = new Set<Peer>()

export function registerPeer(peer: Peer) {
  peers.add(peer)
}

export function unregisterPeer(peer: Peer) {
  peers.delete(peer)
}

// Broadcasts { name, data } to every currently connected peer (including
// the sender, mirroring `server.emit`'s all-sockets behavior).
export function sendMessage(name: string, data: unknown) {
  const payload = JSON.stringify({ name, data })

  for (const peer of peers) peer.send(payload)
}
