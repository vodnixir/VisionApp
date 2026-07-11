/**
 * Runner gesture detection — the "Subway Surfers in reality" control layer.
 *
 * The duel scorer answers "how MUCH did you move" (a magnitude). A runner needs
 * "WHAT did you do": which lane are you in, did you jump, did you crouch. That's
 * classification of discrete states/events, not a magnitude — so this is its own
 * pure module, deterministic and unit-testable exactly like src/modes.ts.
 *
 * Everything is normalized against a calibrated NEUTRAL stance (captured once,
 * standing still in frame) and divided by a body scale, so the thresholds are
 * invariant to how far the player stands from the camera.
 *
 * SPIKE NOTE: this deliberately exposes several raw signals (laneOffset,
 * reachRatio, hipDrop, jumpVel) alongside the derived events. The point of the
 * first pass is to watch these on a real body and pick the thresholds that feel
 * right — the debug overlay renders them all live with adjustable sliders.
 */

/** One frame of torso geometry, already lane-corrected (mirror applied upstream). */
export interface PostureSample {
  /** Body center X in video px. */
  centerX: number
  /** Hip line Y in video px (grows downward). */
  hipY: number
  /** Top-of-body Y in video px (head/shoulders, smallest value). */
  topY: number
  /** Normalization unit in px — shoulder width, or torso length as fallback. */
  scale: number
  /** performance.now() timestamp, ms. */
  t: number
}

/** The still-standing baseline captured during calibration. */
export interface Neutral {
  centerX: number
  hipY: number
  /** hipY − topY at rest: how "tall" the standing body reads. */
  reach: number
  scale: number
}

/** Tunable thresholds. Defaults are a starting guess to be dialed in on-device. */
export interface GestureConfig {
  /** |laneOffset| beyond this enters a side lane. */
  laneEnter: number
  /** |laneOffset| back below this returns to center (hysteresis gap). */
  laneExit: number
  /** reachRatio below this = crouching (body got shorter top-to-hip). */
  crouchRatio: number
  /** Upward hip velocity (scales/sec) above this fires a jump. */
  jumpVel: number
  /** Ignore jumps for this long after one fires (ms) — one jump per hop. */
  jumpCooldownMs: number
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  laneEnter: 0.6,
  laneExit: 0.35,
  crouchRatio: 0.78,
  jumpVel: 2.2,
  jumpCooldownMs: 550,
}

/** How long the "airborne" flag stays lit after a jump fires, for display. */
const AIRBORNE_MS = 420
/** Velocity EMA smoothing (0..1 per frame) — tames single-frame keypoint noise. */
const VEL_EMA = 0.5

export type Lane = -1 | 0 | 1

/** Mutable per-session detector memory (previous sample, lane zone, cooldowns). */
export interface GestureState {
  prev: PostureSample | null
  lane: Lane
  velEma: number
  lastJumpAt: number
  airborneUntil: number
}

export function createGestureState(): GestureState {
  return { prev: null, lane: 0, velEma: 0, lastJumpAt: -Infinity, airborneUntil: 0 }
}

/** Everything one frame yields: raw signals for tuning + the derived events. */
export interface GestureReading {
  /** Signed lateral offset from neutral, in scale units. */
  laneOffset: number
  lane: Lane
  /** True on the frame the lane zone changed (the discrete "swipe" event). */
  laneChanged: boolean
  /** Current top-to-hip height ÷ neutral height. <1 = shorter (crouching). */
  reachRatio: number
  /** Hip drop below neutral, in scale units (alt crouch/squat signal). */
  hipDrop: number
  crouch: boolean
  /** 0..1 crouch depth for the meter. */
  crouchAmount: number
  /** Smoothed upward hip velocity, scale units/sec (the jump signal). */
  jumpVel: number
  /** True only on the frame a jump fires. */
  jump: boolean
  /** True for a short window after a jump (avatar is "in the air"). */
  airborne: boolean
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function averageNeutral(samples: PostureSample[]): Neutral | null {
  if (samples.length === 0) return null
  const mean = (pick: (s: PostureSample) => number) =>
    samples.reduce((sum, s) => sum + pick(s), 0) / samples.length
  return {
    centerX: mean((s) => s.centerX),
    hipY: mean((s) => s.hipY),
    reach: Math.max(1, mean((s) => s.hipY - s.topY)),
    scale: Math.max(1, mean((s) => s.scale)),
  }
}

/**
 * Advance the detector by one frame. Mutates `state` (prev sample, lane zone,
 * cooldown timers) and returns the reading. Pure w.r.t. its inputs otherwise —
 * same (state, sample, neutral, config) always yields the same reading.
 */
export function detectGesture(
  state: GestureState,
  sample: PostureSample,
  neutral: Neutral,
  config: GestureConfig,
): GestureReading {
  const scale = Math.max(1, sample.scale)

  // --- Lane: lateral body center, with hysteresis so a wobble at the boundary
  // doesn't flicker the lane back and forth.
  const laneOffset = (sample.centerX - neutral.centerX) / scale
  let lane = state.lane
  if (laneOffset > config.laneEnter) lane = 1
  else if (laneOffset < -config.laneEnter) lane = -1
  else if (Math.abs(laneOffset) < config.laneExit) lane = 0
  const laneChanged = lane !== state.lane

  // --- Crouch: the body gets shorter top-to-hip when you bend/squat.
  const reach = sample.hipY - sample.topY
  const reachRatio = reach / neutral.reach
  const hipDrop = (sample.hipY - neutral.hipY) / scale
  const crouch = reachRatio < config.crouchRatio
  const crouchAmount = clamp((config.crouchRatio - reachRatio) / config.crouchRatio, 0, 1)

  // --- Jump: fast upward motion of the hip line (Y decreasing), scale-normalized
  // and EMA-smoothed so one noisy keypoint frame can't fake a hop.
  let vel = 0
  if (state.prev) {
    const dt = (sample.t - state.prev.t) / 1000
    if (dt > 0) vel = -((sample.hipY - state.prev.hipY) / scale) / dt
  }
  const velEma = state.velEma + (vel - state.velEma) * VEL_EMA
  let jump = false
  if (velEma > config.jumpVel && sample.t - state.lastJumpAt > config.jumpCooldownMs) {
    jump = true
    state.lastJumpAt = sample.t
    state.airborneUntil = sample.t + AIRBORNE_MS
  }
  const airborne = sample.t < state.airborneUntil

  state.prev = sample
  state.velEma = velEma
  state.lane = lane

  return {
    laneOffset,
    lane,
    laneChanged,
    reachRatio,
    hipDrop,
    crouch,
    crouchAmount,
    jumpVel: velEma,
    jump,
    airborne,
  }
}
