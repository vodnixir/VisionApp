/**
 * Online-battle wire protocol + the two shared primitives it rests on.
 *
 * The whole mode is "fair race on a shared seed": both phones run their OWN
 * local runner (src/runner/game.ts) seeded identically, so they face the exact
 * same obstacle stream and the winner is simply whoever scores more. Only two
 * things ever cross the wire besides the live camera track:
 *   1. the seed + a synchronized start (host → guest, once), and
 *   2. a light progress heartbeat (both ways, ~5/s) so each side can paint the
 *      opponent's score/lives next to their video.
 *
 * There is NO signaling server: the FIRST WebRTC handshake is exchanged as a
 * one-off text code the players paste to each other (see packSignal/unpackSignal
 * + net.ts). That first offer carries the data channel only — keeping its SDP
 * small enough to fit a scannable QR — so the camera is attached afterwards by
 * renegotiating over the channel itself ({ t: 'sdp' } below).
 */

/* ---------------- Seeded RNG (shared obstacle stream) ---------------- */

/**
 * mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Deterministic given
 * the seed, so `createRunnerState(mulberry32(seed))` on both phones draws the
 * same lane/type sequence in the same order: each spawn consumes exactly two rng
 * values and nothing about the spawn depends on per-frame positions. The spawn
 * CADENCE is time-based, so a large frame-rate gap between the two phones can
 * still nudge a spawn boundary and drift the streams by the odd obstacle over a
 * long run — acceptable, because the winner is decided by score on near-identical
 * courses, not by frame-perfect parity.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A fresh 31-bit seed for a match (host picks it, sends it to the guest). */
export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) >>> 0
}

/* ---------------- Data-channel messages ---------------- */

export type NetMessage =
  /** Sent once either side finishes calibrating and is standing ready. */
  | { t: 'ready' }
  /** Host → guest: the shared seed and a countdown delay both sides honor. */
  | { t: 'start'; seed: number; inMs: number }
  /** Live progress heartbeat (both ways, throttled). */
  | { t: 'state'; distance: number; coins: number; lives: number; over: boolean; score: number }
  /** Final result when a run ends. */
  | { t: 'over'; score: number; coins: number }
  /**
   * Renegotiation offer/answer, exchanged over the OPEN data channel when a side
   * attaches its camera after connecting. Handled inside net.ts — the game layer
   * never sees these.
   */
  | { t: 'sdp'; sdp: RTCSessionDescriptionInit }

/* ---------------- Signaling code (paste-to-a-friend) ---------------- */

/** What a signaling code carries: a WebRTC session description, role-tagged. */
export interface SignalPayload {
  kind: 'offer' | 'answer'
  sdp: RTCSessionDescriptionInit
}

const RAW = 'r.'
const GZIP = 'g.'

/**
 * Encode a signal into a compact, copy-pasteable code. Gzips when the platform
 * exposes CompressionStream (all modern WebViews) to keep the code short enough
 * to send over a chat app; falls back to plain base64 otherwise. The 2-char
 * prefix tells unpackSignal which path was taken.
 */
export async function packSignal(payload: SignalPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (typeof CompressionStream === 'function') {
    return GZIP + b64encode(await pipe(bytes, new CompressionStream('gzip')))
  }
  return RAW + b64encode(bytes)
}

/** Decode a signal produced by packSignal. Throws on a malformed code. */
export async function unpackSignal(code: string): Promise<SignalPayload> {
  const trimmed = code.trim()
  let bytes: Uint8Array
  if (trimmed.startsWith(GZIP)) {
    bytes = await pipe(b64decode(trimmed.slice(GZIP.length)), new DecompressionStream('gzip'))
  } else if (trimmed.startsWith(RAW)) {
    bytes = b64decode(trimmed.slice(RAW.length))
  } else {
    throw new Error('Не похоже на код подключения')
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as SignalPayload
  if (payload.kind !== 'offer' && payload.kind !== 'answer') {
    throw new Error('Неизвестный тип кода')
  }
  return payload
}

async function pipe(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function b64encode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64decode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
