/**
 * Game-mode layer: pure math turning per-frame activity into bar progress.
 * The App loop owns accumulators/HUD/sfx; this module only answers "how much
 * fill and burn does each player get this frame, and what just happened".
 * Everything is deterministic given the injected rng — covered by sanity tests.
 */
import type { MatchMode } from './types'
import type { ArmPose, Limb } from './cv/tracking'

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

/** Below this you count as stopped — the dip timer starts running. */
export const ENDURANCE_SPEED_MIN = 0.5
/**
 * Endurance rewards a STEADY pace, not raw intensity: any movement at or above
 * this speed fills at the full base rate, and going faster earns nothing extra.
 * That's what sets it apart from classic (where fill scales with speed) — here
 * the winner is whoever never stops, not whoever sprints hardest.
 */
export const ENDURANCE_PACE_CAP = 0.9
/** Short grace before a stall starts draining (shorter than before — stopping bites sooner). */
export const ENDURANCE_GRACE_MS = 600
/** Stalling past the grace drains the bar hard — the core endurance pressure. */
export const ENDURANCE_BURN_PER_S = 8

/* ---------------- Traffic light ---------------- */

// Phases run longer than the first cut: a green worth sprinting into and a red
// long enough to actually hold still, so the light stops feeling twitchy.
export const TRAFFIC_GREEN_MIN_MS = 5000
export const TRAFFIC_GREEN_VAR_MS = 4000
export const TRAFFIC_RED_MIN_MS = 3000
export const TRAFFIC_RED_VAR_MS = 2500
/** Green fill is boosted to make up for the red downtime. */
export const TRAFFIC_GREEN_BOOST = 1.25
/** Moving on red burns harder than green earns. */
export const TRAFFIC_RED_BURN = 1.5

/* ---------------- Pose copy (repeat-the-pose duel) ---------------- */

/** How long each target pose stays on screen before the next one appears. */
export const POSE_PERIOD_MS = 5000
/**
 * Per-segment angular tolerance (radians): an arm segment this far off the
 * target scores 0, dead-on scores 1, linear in between. ~63° — generous enough
 * for living-room tracking and little arms, tight enough that a real copy wins.
 */
export const POSE_ANGLE_TOL = 1.1
/** Below this pose similarity a player earns nothing — you must actually hit it. */
export const POSE_MATCH_MIN = 0.55
/** A clean hold out-earns a strong classic mover, offsetting the switch downtime. */
export const POSE_FILL_BOOST = 1.35

/** A target pose = the two arms' segment directions (radians, atan2 in +x/+y). */
export interface PoseTarget {
  id: string
  arms: [Limb, Limb]
}

const D = Math.PI / 180
const limb = (upperDeg: number, foreDeg: number): Limb => ({
  upper: upperDeg * D,
  fore: foreDeg * D,
})

/**
 * The pose deck. Angles are display-intuitive: 0° points right, 90° down, 180°
 * left, -90° up. Every pose is left/right symmetric, so mirrored TV footage and
 * either-handed kids score identically (the scorer matches arms by best pairing,
 * never by which side they're on).
 */
export const POSE_LIBRARY: PoseTarget[] = [
  // T-pose: both arms straight out to the sides.
  { id: 'tpose', arms: [limb(180, 180), limb(0, 0)] },
  // Hands straight overhead.
  { id: 'armsUp', arms: [limb(-90, -90), limb(-90, -90)] },
  // Y / victory: arms up and out in a wide V.
  { id: 'yShape', arms: [limb(-135, -135), limb(-45, -45)] },
  // Cactus / goalpost: upper arms out level, forearms straight up.
  { id: 'cactus', arms: [limb(180, -90), limb(0, -90)] },
  // Arms down and a little out (an A-shape at the sides).
  { id: 'armsDown', arms: [limb(113, 113), limb(67, 67)] },
  // Hands to the head: upper arms out level, forearms angled up and inward.
  { id: 'handsHead', arms: [limb(180, -60), limb(0, -120)] },
]

/** Smallest absolute circular gap between two angles, 0..π. */
export function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}

/** One arm's match, 0..1. Upper arm weighs more — it sets the silhouette. */
function limbScore(m: Limb, target: Limb): number {
  const su = Math.max(0, 1 - angleDelta(m.upper, target.upper) / POSE_ANGLE_TOL)
  const sf = Math.max(0, 1 - angleDelta(m.fore, target.fore) / POSE_ANGLE_TOL)
  return su * 0.6 + sf * 0.4
}

/**
 * How well a player's arms match a target pose, 0..1. Both arms present → the
 * average of the best arm-to-target pairing (you must hit BOTH). One arm (the
 * other dropped out of tracking) → its best single match, so an occluded wrist
 * never zeroes an honest attempt.
 */
export function poseSimilarity(pose: ArmPose | null, target: PoseTarget): number {
  if (!pose) return 0
  const [tL, tR] = target.arms
  const arms = [pose.left, pose.right].filter((a): a is Limb => a !== null)
  if (arms.length === 0) return 0
  if (arms.length === 1) return Math.max(limbScore(arms[0], tL), limbScore(arms[0], tR))
  const straight = (limbScore(arms[0], tL) + limbScore(arms[1], tR)) / 2
  const swapped = (limbScore(arms[0], tR) + limbScore(arms[1], tL)) / 2
  return Math.max(straight, swapped)
}

/** Pick a target different from the current one, uniform over the rest. */
function nextPoseIndex(prev: number, rng: () => number): number {
  if (POSE_LIBRARY.length <= 1) return 0
  let i = Math.floor(rng() * (POSE_LIBRARY.length - 1))
  if (i >= prev) i++
  return i
}

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
  /** pose: current target index and when it flips to the next (elapsed ms). */
  poseIndex: number
  poseSwitchAtMs: number
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
    poseIndex: Math.min(POSE_LIBRARY.length - 1, Math.floor(rng() * POSE_LIBRARY.length)),
    poseSwitchAtMs: POSE_PERIOD_MS,
  }
}

export interface ModeTickInput {
  /** Seconds since the previous frame (clamped by the engine). */
  dt: number
  elapsedMs: number
  speeds: [number, number]
  /** FILL_RATE %/s of the chosen round length. */
  rate: number
  /** pose mode: each player's live arm directions (null when not tracked). */
  poses?: [ArmPose | null, ArmPose | null]
}

export interface ModeEvents {
  /** Metronome crossed a beat this frame (play the tick). */
  beat?: boolean
  /** Player i landed the current beat this frame. */
  hit?: [boolean, boolean]
  trafficSwitch?: 'red' | 'green'
  /** Boss attack landed this frame — damage in bar percent. */
  bossAttack?: number
  /** Pose mode: a new target pose just appeared this frame. */
  poseChange?: boolean
}

export interface ModeTick {
  /** Progress to add per player (before the combo multiplier). */
  fill: [number, number]
  /** Progress to subtract per player (penalties; never combo-amplified). */
  burn: [number, number]
  /** This mode plays fair with the combo-streak multiplier. */
  comboEligible: boolean
  events: ModeEvents
  /** Pose mode: the current target and each player's live match (0..1), for the HUD. */
  pose?: { target: PoseTarget; index: number; match: [number, number] }
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
  let pose: ModeTick['pose']

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
          // Pace-capped fill: steady movement fills at the full base rate;
          // sprinting past the cap gives no edge. Consistency wins, not bursts.
          const paced = Math.min(speeds[i], ENDURANCE_PACE_CAP) / ENDURANCE_PACE_CAP
          fill[i] = paced * rate * dt
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

    case 'pose': {
      // Rotate the target pose on a fixed cadence; everyone copies the SAME one.
      if (elapsedMs >= state.poseSwitchAtMs) {
        state.poseIndex = nextPoseIndex(state.poseIndex, rng)
        state.poseSwitchAtMs = elapsedMs + POSE_PERIOD_MS
        events.poseChange = true
      }
      const target = POSE_LIBRARY[state.poseIndex]
      const match: [number, number] = [0, 0]
      for (const i of [0, 1] as const) {
        const sim = poseSimilarity(input.poses?.[i] ?? null, target)
        match[i] = sim
        // Only credit the part of the match above the threshold, so a lazy
        // half-pose barely scores while a clean copy fills fast.
        const quality = Math.max(0, (sim - POSE_MATCH_MIN) / (1 - POSE_MATCH_MIN))
        fill[i] = quality * rate * dt * POSE_FILL_BOOST
      }
      pose = { target, index: state.poseIndex, match }
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
  return { fill, burn, comboEligible, events, pose }
}

/** Boss attack charge for the HUD: 0 right after an attack → 100 at the next. */
export function bossCharge(state: ModeState, elapsedMs: number): number {
  const remaining = state.attackAtMs - elapsedMs
  return Math.min(100, Math.max(0, (1 - remaining / BOSS_ATTACK_EVERY_MS) * 100))
}
