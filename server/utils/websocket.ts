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
// the sender, mirroring `server.emit`'s all-sockets behavior). Intended for
// server-side code reacting to other events (e.g. a future HTTP route
// reacting to a photo upload) — not for direct client-message triggering:
// a client-supplied `{ type: 'broadcast', name, data }` WS message used to
// call this verbatim with no authorization/schema check, letting any
// connected peer spoof arbitrary events to every other peer, so that path
// was removed from server/routes/ws.ts entirely (#43).
export function sendMessage(name: string, data: unknown) {
  const payload = JSON.stringify({ name, data })

  for (const peer of peers) peer.send(payload)
}

// Sends { name, data } only to the peer(s) belonging to a single User
// (issue #50's "photo uploaded" notification, scoped so only the
// uploading User's own connections update — not every connected peer).
// `peer.context.user` is populated during the WS upgrade in
// server/routes/ws.ts, the same way `event.context.user` is for HTTP
// requests, and a User may hold several open connections (e.g. multiple
// tabs/devices), so every matching peer is sent the message.
export function sendMessageToUser(userId: number, name: string, data: unknown) {
  const payload = JSON.stringify({ name, data })

  for (const peer of peers) {
    const user = peer.context.user as { id: number } | undefined
    if (user?.id === userId)
      peer.send(payload)
  }
}
