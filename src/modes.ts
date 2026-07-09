/**
 * Game-mode layer: pure math turning per-frame activity into bar progress.
 * The App loop owns accumulators/HUD/sfx; this module only answers "how much
 * fill and burn does each player get this frame, and what just happened".
 * Everything is deterministic given the injected rng — covered by sanity tests.
 */
import type { MatchMode } from './types'

/* ---------------- Rhythm ---------------- */

export const RHYTHM_BPM = 105
export const RHYTHM_PERIOD_MS = 60_000 / RHYTHM_BPM
/** Half-width of the "on beat" window around each beat. */
export const RHYTHM_WINDOW_MS = 170
/** Moving at least this fast inside the window counts as landing the beat. */
export const RHYTHM_SPEED_MIN = 0.5
/** Landed beats slightly out-earn max classic speed — mastery pays. */
export const RHYTHM_HIT_BONUS = 1.15
/** Off-beat flailing still trickles a little so nobody stalls to zero. */
export const RHYTHM_TRICKLE = 0.15

/* ---------------- Endurance ---------------- */

export const ENDURANCE_SPEED_MIN = 0.5
export const ENDURANCE_GRACE_MS = 800
export const ENDURANCE_BURN_PER_S = 3

/* ---------------- Traffic light ---------------- */

export const TRAFFIC_GREEN_MIN_MS = 3000
export const TRAFFIC_GREEN_VAR_MS = 2500
export const TRAFFIC_RED_MIN_MS = 1800
export const TRAFFIC_RED_VAR_MS = 1700
/** Green fill is boosted to make up for the red downtime. */
export const TRAFFIC_GREEN_BOOST = 1.25
/** Moving on red burns harder than green earns. */
export const TRAFFIC_RED_BURN = 1.5

/* ---------------- Boss (co-op) ---------------- */

/** Both kids fill ONE bar; scaled down so two players ≈ one classic bar. */
export const BOSS_FILL_FACTOR = 0.62
export const BOSS_ATTACK_EVERY_MS = 8000
export const BOSS_ATTACK_DAMAGE_START = 6
export const BOSS_ATTACK_DAMAGE_GROWTH = 1.5

export interface ModeState {
  mode: MatchMode
  /** rhythm: last beat index whose window was entered + per-player hit latch. */
  beatIndex: number
  hit: [boolean, boolean]
  lastElapsedMs: number
  /** endurance: how long each player has been below the pace, ms. */
  dipMs: [number, number]
  /** traffic: current light and when it flips (elapsed ms). */
  red: boolean
  switchAtMs: number
  /** boss: next attack time and how many landed already. */
  attackAtMs: number
  attackNumber: number
}

export function createModeState(mode: MatchMode, rng: () => number = Math.random): ModeState {
  return {
    mode,
    beatIndex: -1,
    hit: [false, false],
    lastElapsedMs: 0,
    dipMs: [0, 0],
    red: false,
    switchAtMs: TRAFFIC_GREEN_MIN_MS + rng() * TRAFFIC_GREEN_VAR_MS,
    attackAtMs: BOSS_ATTACK_EVERY_MS,
    attackNumber: 0,
  }
}

export interface ModeTickInput {
  /** Seconds since the previous frame (clamped by the engine). */
  dt: number
  elapsedMs: number
  speeds: [number, number]
  /** FILL_RATE %/s of the chosen round length. */
  rate: number
}

export interface ModeEvents {
  /** Metronome crossed a beat this frame (play the tick). */
  beat?: boolean
  /** Player i landed the current beat this frame. */
  hit?: [boolean, boolean]
  trafficSwitch?: 'red' | 'green'
  /** Boss attack landed this frame — damage in bar percent. */
  bossAttack?: number
}

export interface ModeTick {
  /** Progress to add per player (before the combo multiplier). */
  fill: [number, number]
  /** Progress to subtract per player (penalties; never combo-amplified). */
  burn: [number, number]
  /** This mode plays fair with the combo-streak multiplier. */
  comboEligible: boolean
  events: ModeEvents
}

export function modeTick(
  state: ModeState,
  input: ModeTickInput,
  rng: () => number = Math.random,
): ModeTick {
  const { dt, elapsedMs, speeds, rate } = input
  const fill: [number, number] = [0, 0]
  const burn: [number, number] = [0, 0]
  const events: ModeEvents = {}
  let comboEligible = false

  switch (state.mode) {
    case 'classic':
      comboEligible = true
      for (const i of [0, 1] as const) fill[i] = speeds[i] * rate * dt
      break

    case 'rhythm': {
      // The beat audio fires when we cross the exact beat time…
      const prevBeat = Math.floor(state.lastElapsedMs / RHYTHM_PERIOD_MS)
      const currBeat = Math.floor(elapsedMs / RHYTHM_PERIOD_MS)
      if (currBeat > prevBeat) events.beat = true
      // …while the scoring window straddles the NEAREST beat (early hits count).
      const nearest = Math.round(elapsedMs / RHYTHM_PERIOD_MS)
      const inWindow = Math.abs(elapsedMs - nearest * RHYTHM_PERIOD_MS) <= RHYTHM_WINDOW_MS
      if (nearest > state.beatIndex) {
        state.beatIndex = nearest
        state.hit = [false, false]
      }
      const hitNow: [boolean, boolean] = [false, false]
      for (const i of [0, 1] as const) {
        if (inWindow && !state.hit[i] && speeds[i] >= RHYTHM_SPEED_MIN) {
          state.hit[i] = true
          hitNow[i] = true
          fill[i] = rate * (RHYTHM_PERIOD_MS / 1000) * RHYTHM_HIT_BONUS
        } else {
          fill[i] = speeds[i] * rate * dt * RHYTHM_TRICKLE
        }
      }
      if (hitNow[0] || hitNow[1]) events.hit = hitNow
      break
    }

    case 'endurance':
      for (const i of [0, 1] as const) {
        if (speeds[i] >= ENDURANCE_SPEED_MIN) {
          state.dipMs[i] = 0
          fill[i] = speeds[i] * rate * dt
        } else {
          state.dipMs[i] += dt * 1000
          if (state.dipMs[i] > ENDURANCE_GRACE_MS) burn[i] = ENDURANCE_BURN_PER_S * dt
        }
      }
      break

    case 'traffic': {
      if (elapsedMs >= state.switchAtMs) {
        state.red = !state.red
        events.trafficSwitch = state.red ? 'red' : 'green'
        state.switchAtMs =
          elapsedMs +
          (state.red
            ? TRAFFIC_RED_MIN_MS + rng() * TRAFFIC_RED_VAR_MS
            : TRAFFIC_GREEN_MIN_MS + rng() * TRAFFIC_GREEN_VAR_MS)
      }
      for (const i of [0, 1] as const) {
        if (state.red) burn[i] = speeds[i] * rate * dt * TRAFFIC_RED_BURN
        else fill[i] = speeds[i] * rate * dt * TRAFFIC_GREEN_BOOST
      }
      break
    }

    case 'boss': {
      // One shared bar: player 0's slot carries the TEAM progress.
      fill[0] = (speeds[0] + speeds[1]) * rate * dt * BOSS_FILL_FACTOR
      if (elapsedMs >= state.attackAtMs) {
        const damage = BOSS_ATTACK_DAMAGE_START + BOSS_ATTACK_DAMAGE_GROWTH * state.attackNumber
        state.attackNumber++
        state.attackAtMs += BOSS_ATTACK_EVERY_MS
        burn[0] = damage
        events.bossAttack = damage
      }
      break
    }
  }

  state.lastElapsedMs = elapsedMs
  return { fill, burn, comboEligible, events }
}

/** Boss attack charge for the HUD: 0 right after an attack → 100 at the next. */
export function bossCharge(state: ModeState, elapsedMs: number): number {
  const remaining = state.attackAtMs - elapsedMs
  return Math.min(100, Math.max(0, (1 - remaining / BOSS_ATTACK_EVERY_MS) * 100))
}
