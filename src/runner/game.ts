/**
 * Runner game simulation — the "Subway Surfers in reality" solo mode.
 *
 * Pure, deterministic (rng injected), and rendering-free — exactly like
 * src/modes.ts. The screen reads gesture control (lane / airborne / crouch from
 * src/runner/gestures.ts) and feeds it here each frame; this advances entities,
 * spawns new ones, and resolves collisions at the player plane. Rendering lives
 * in the component so this stays unit-testable.
 *
 * World model: entities approach on a z axis, 0 = far (spawn), 1 = near. They're
 * "at the player" when z crosses PLAYER_Z. Three lanes (-1/0/1). The live camera
 * is the backdrop; the player's body IS the runner, their lane/jump/crouch the
 * controls.
 */
import type { Lane } from './gestures'

export type ObstacleType =
  | 'jump' // low barrier — clear it by being airborne
  | 'duck' // high barrier — clear it by crouching
  | 'block' // solid lane block — only dodging to another lane is safe
  | 'coin' // collectible — no penalty, ever

export interface Entity {
  id: number
  lane: Lane
  /** 0 = far horizon, 1 = at/past the player. */
  z: number
  type: ObstacleType
  /** Resolved once it crosses the player plane (scored/hit exactly once). */
  resolved: boolean
}

export interface RunnerState {
  lives: number
  /** Distance "run" so far (score units). */
  distance: number
  coins: number
  entities: Entity[]
  spawnCooldownMs: number
  nextId: number
  /** No further hits register before this timestamp (post-hit mercy). */
  invincibleUntil: number
  over: boolean
  elapsedMs: number
  rng: () => number
}

export interface RunnerInput {
  dt: number
  lane: Lane
  /** True while the runner is airborne (clears 'jump' barriers). */
  airborne: boolean
  /** True while crouching (clears 'duck' barriers). */
  crouching: boolean
  nowMs: number
}

export interface RunnerEvents {
  hit: boolean
  coin: boolean
  dodge: boolean
  gameOver: boolean
}

/* ---------------- Tuning ---------------- */

export const START_LIVES = 3
/** Entity z at which it lines up with the player and gets resolved. */
export const PLAYER_Z = 0.88
/** Past this z the entity is behind the player — despawn. */
const REMOVE_Z = 1.15
/** Base approach speed, z-units/sec — gentle, so obstacles are easy to read. */
const BASE_APPROACH = 0.32
/** Difficulty ramp: a slow climb so early play stays relaxed. */
const RAMP_MS = 80_000
const MAX_FACTOR = 1.8
/** Distance score accrued per second at 1× speed. */
const DIST_RATE = 10
export const COIN_BONUS = 5
const SPAWN_BASE_MS = 1600
const SPAWN_MIN_MS = 850
const INVINCIBLE_MS = 1300

const NO_EVENTS: RunnerEvents = { hit: false, coin: false, dodge: false, gameOver: false }

const LANES: Lane[] = [-1, 0, 1]

export function createRunnerState(rng: () => number = Math.random): RunnerState {
  return {
    lives: START_LIVES,
    distance: 0,
    coins: 0,
    entities: [],
    spawnCooldownMs: 700,
    nextId: 1,
    invincibleUntil: 0,
    over: false,
    elapsedMs: 0,
    rng,
  }
}

/** Difficulty multiplier — climbs with elapsed time, capped. */
export function speedFactor(elapsedMs: number): number {
  return Math.min(MAX_FACTOR, 1 + elapsedMs / RAMP_MS)
}

/** Total score = distance + a flat bonus per coin. */
export function runnerScore(state: RunnerState): number {
  return Math.floor(state.distance + state.coins * COIN_BONUS)
}

function pickType(r: number): ObstacleType {
  // Coin-heavy, obstacles sparser — calmer, more forgiving than before.
  if (r < 0.46) return 'coin'
  if (r < 0.7) return 'jump'
  if (r < 0.84) return 'duck'
  return 'block'
}

/** Whether the given evasion state clears an obstacle of this type. */
function evades(type: ObstacleType, input: RunnerInput): boolean {
  if (type === 'jump') return input.airborne
  if (type === 'duck') return input.crouching
  return false // 'block' can only be dodged by not being in its lane
}

/**
 * Advance one frame. Mutates `state`, returns what happened this frame (for
 * sound/flash). A frame with no dt (dt<=0) or after game over is a no-op.
 */
export function stepRunner(state: RunnerState, input: RunnerInput): RunnerEvents {
  if (state.over || input.dt <= 0) return NO_EVENTS

  const events: RunnerEvents = { hit: false, coin: false, dodge: false, gameOver: false }
  state.elapsedMs += input.dt * 1000
  const factor = speedFactor(state.elapsedMs)

  // Approach + distance.
  const dz = BASE_APPROACH * factor * input.dt
  for (const e of state.entities) e.z += dz
  state.distance += DIST_RATE * factor * input.dt

  // Resolve everything that reached the player plane this frame.
  for (const e of state.entities) {
    if (e.resolved || e.z < PLAYER_Z) continue
    e.resolved = true
    const inLane = e.lane === input.lane
    if (e.type === 'coin') {
      if (inLane) {
        state.coins++
        events.coin = true
      }
      continue
    }
    if (!inLane) continue // dodged sideways / never in danger
    if (evades(e.type, input)) {
      events.dodge = true
      continue
    }
    if (input.nowMs < state.invincibleUntil) continue // mercy window
    state.lives--
    state.invincibleUntil = input.nowMs + INVINCIBLE_MS
    events.hit = true
    if (state.lives <= 0) {
      state.over = true
      events.gameOver = true
    }
  }

  // Despawn what's behind the player.
  state.entities = state.entities.filter((e) => e.z <= REMOVE_Z)

  // Spawn on a cadence that tightens as the run speeds up. The spawn stream is a
  // pure function of the seeded rng + the elapsed-time gate: each spawn consumes
  // exactly two rng values (lane, then type) and the push never depends on the
  // current entities' z positions — so two phones on the same seed draw the same
  // obstacle sequence. (An earlier z-based "don't stack" guard was removed: it
  // could push on one device and skip on the other, splitting the streams. The
  // ≥SPAWN_MIN_MS cadence already keeps obstacles comfortably apart.)
  state.spawnCooldownMs -= input.dt * 1000
  if (!state.over && state.spawnCooldownMs <= 0) {
    state.spawnCooldownMs = Math.max(SPAWN_MIN_MS, SPAWN_BASE_MS / factor)
    const lane = LANES[Math.min(2, Math.floor(state.rng() * 3))]
    const type = pickType(state.rng())
    state.entities.push({ id: state.nextId++, lane, z: 0, type, resolved: false })
  }

  return events
}

/* ---------------- Solo best (local) ---------------- */

const BEST_KEY = 'sb.runner.best.v1'

export function loadRunnerBest(): number {
  try {
    const v = Number(localStorage.getItem(BEST_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

/** Persist a new best if it beats the stored one; returns true when it did. */
export function saveRunnerBest(score: number): boolean {
  if (score <= loadRunnerBest()) return false
  try {
    localStorage.setItem(BEST_KEY, String(Math.floor(score)))
  } catch {
    /* storage unavailable */
  }
  return true
}
