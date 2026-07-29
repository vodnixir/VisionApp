/**
 * Game-mode layer: pure math turning per-frame activity into bar progress.
 * The App loop owns accumulators/HUD/sfx; this module only answers "how much
 * fill and burn does each player get this frame, and what just happened".
 * Everything is deterministic given the injected rng — covered by sanity tests.
 */
import type { MatchMode, Sensitivity } from './types'
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

/* ---------------- Pose copy (repeat-the-pose duel + Infinite Pose) ---------------- */

/** How long each target pose stays on screen before the next one appears (2P duel's fixed cadence — Infinite Pose escalates its own window instead). */
export const POSE_PERIOD_MS = 5000
/** A clean hold out-earns a strong classic mover, offsetting the switch downtime. */
export const POSE_FILL_BOOST = 1.35
/**
 * Stricter, player-facing confidence gate for pose SCORING — distinct from
 * the pipeline-wide KEYPOINT_MIN_SCORE=0.3 existence gate armPose() already
 * applies (a Limb existing only proves it cleared 0.3). 0.5, not 0.6: MoveNet
 * Lightning wrists routinely sit in the 0.4-0.6 band under motion or poor
 * light, and 0.6 spams the "show your arms" hint instead of actually scoring
 * a genuine attempt.
 */
export const POSE_SCORE_MIN_SCORE = 0.5

/** A target pose = the two arms' segment directions (radians, atan2 in +x/+y). Unchanged shape — cv/draw.ts's drawPoseTarget consumes this directly, untouched. */
export interface PoseTarget {
  id: PoseId
  arms: [Limb, Limb]
}

const D = Math.PI / 180

/**
 * Midline-relative authoring/scoring angle, degrees: 0 = straight down along
 * the body, 90 = outward horizontal (away from the midline), 180 = straight
 * up, negative = inward (crosses the midline). Left/right are symmetric by
 * construction — an author never has to think about which raw image-space
 * direction "outward" points for a given side. This is a PROJECTION used only
 * for authoring PoseDefinitions and scoring a live ArmPose against them —
 * Limb (absolute atan2 image-plane direction) stays exactly as it was, since
 * cv/draw.ts's renderer depends on that exact shape.
 */
export type Deg = number
export interface ArmSpec {
  upper: Deg
  fore: Deg
}

/** left = +1, right = -1 — MoveNet's left_* keypoints sit at larger x than right_* (person facing the camera). */
export type SideSign = 1 | -1

/** Midline-relative degrees -> absolute atan2 radians (image space, y down). Exported for cv-sanity.ts's conversion checks. */
export function absoluteRad(deg: Deg, side: SideSign): number {
  const r = deg * D
  return Math.atan2(Math.cos(r), side * Math.sin(r))
}

/** Absolute atan2 radians -> midline-relative degrees. Inverse of absoluteRad. Exported for cv-sanity.ts's conversion checks. */
export function specDeg(absRad: number, side: SideSign): Deg {
  return Math.atan2(side * Math.cos(absRad), Math.sin(absRad)) / D
}

function limbFromSpec(a: ArmSpec, side: SideSign): Limb {
  return { upper: absoluteRad(a.upper, side), fore: absoluteRad(a.fore, side) }
}

/** A live arm's angles projected into spec-degree space, or null if untracked. */
function armToSpec(limb: Limb | null, side: SideSign): ArmSpec | null {
  return limb ? { upper: specDeg(limb.upper, side), fore: specDeg(limb.fore, side) } : null
}

export type PoseId =
  | 'arms_down'
  | 't_pose'
  | 'reach_up'
  | 'y_pose'
  | 'goalpost'
  | 'hands_on_hips'
  | 'hands_on_head'
  | 'arms_crossed'
  | 'one_arm_up'
  | 'one_arm_out'
  | 'teapot'
  | 'diagonal'
  | 'salute'

/** Ordered Tier 1 (symmetric) then Tier 2 (asymmetric) — the only place pose order is defined; everything else derives from POSE_DEFINITIONS via this. */
export const POSE_IDS: PoseId[] = [
  'arms_down',
  't_pose',
  'reach_up',
  'y_pose',
  'goalpost',
  'hands_on_hips',
  'hands_on_head',
  'arms_crossed',
  'one_arm_up',
  'one_arm_out',
  'teapot',
  'diagonal',
  'salute',
]

/** Extra landmark relationships, evaluated via forward kinematics off the arm angles alone (see wristPosition) — no raw keypoint positions needed. */
export type Relation =
  | { kind: 'wristsTogether'; maxDistance: number } // units: shoulder widths
  | { kind: 'wristCrossesMidline' } // both wrists cross to the opposite half

export interface PoseDefinition {
  id: PoseId
  tier: 1 | 2
  nameKey: `pose.${PoseId}`
  left: ArmSpec
  right: ArmSpec
  relations?: Relation[]
}

const spec = (upper: Deg, fore: Deg): ArmSpec => ({ upper, fore })

/**
 * Upper-body only — nothing below the hips is read anywhere in this table or
 * the scoring path. Tier 2 poses are authored on ONE arm; poseSimilarity
 * already tries both straight and swapped pairing and takes the better, so
 * `one_arm_up` matches raising EITHER arm — that's the intended semantics
 * ("raise one arm", not "raise your left arm"), not a bug. See the
 * pair-separation test in cv-sanity.ts.
 */
export const POSE_DEFINITIONS: Record<PoseId, PoseDefinition> = {
  arms_down: { id: 'arms_down', tier: 1, nameKey: 'pose.arms_down', left: spec(0, 0), right: spec(0, 0) },
  t_pose: { id: 't_pose', tier: 1, nameKey: 'pose.t_pose', left: spec(90, 90), right: spec(90, 90) },
  reach_up: {
    id: 'reach_up',
    tier: 1,
    nameKey: 'pose.reach_up',
    left: spec(170, 170),
    right: spec(170, 170),
    relations: [{ kind: 'wristsTogether', maxDistance: 1.2 }],
  },
  y_pose: { id: 'y_pose', tier: 1, nameKey: 'pose.y_pose', left: spec(135, 135), right: spec(135, 135) },
  goalpost: { id: 'goalpost', tier: 1, nameKey: 'pose.goalpost', left: spec(90, 175), right: spec(90, 175) },
  hands_on_hips: {
    id: 'hands_on_hips',
    tier: 1,
    nameKey: 'pose.hands_on_hips',
    left: spec(35, -40),
    right: spec(35, -40),
  },
  hands_on_head: {
    id: 'hands_on_head',
    tier: 1,
    nameKey: 'pose.hands_on_head',
    left: spec(75, 150),
    right: spec(75, 150),
    relations: [{ kind: 'wristsTogether', maxDistance: 0.7 }],
  },
  arms_crossed: {
    id: 'arms_crossed',
    tier: 1,
    nameKey: 'pose.arms_crossed',
    left: spec(30, -110),
    right: spec(30, -110),
    relations: [{ kind: 'wristCrossesMidline' }],
  },
  one_arm_up: { id: 'one_arm_up', tier: 2, nameKey: 'pose.one_arm_up', left: spec(170, 170), right: spec(0, 0) },
  one_arm_out: { id: 'one_arm_out', tier: 2, nameKey: 'pose.one_arm_out', left: spec(90, 90), right: spec(0, 0) },
  teapot: { id: 'teapot', tier: 2, nameKey: 'pose.teapot', left: spec(160, 140), right: spec(35, -40) },
  diagonal: { id: 'diagonal', tier: 2, nameKey: 'pose.diagonal', left: spec(130, 130), right: spec(45, 45) },
  salute: { id: 'salute', tier: 2, nameKey: 'pose.salute', left: spec(70, 140), right: spec(0, 0) },
}

/** PoseTarget[] (Limb pairs) for drawPoseTarget/the HUD — unchanged consumer contract, now built from POSE_DEFINITIONS via the authoring conversion. */
export const POSE_LIBRARY: PoseTarget[] = POSE_IDS.map((id) => {
  const def = POSE_DEFINITIONS[id]
  return { id, arms: [limbFromSpec(def.left, 1), limbFromSpec(def.right, -1)] } as PoseTarget
})

const POSE_LIBRARY_BY_ID: Record<PoseId, PoseTarget> = Object.fromEntries(
  POSE_LIBRARY.map((t) => [t.id, t]),
) as Record<PoseId, PoseTarget>

/** O(1) PoseTarget lookup by id — for renderers (InfinitePoseScreen's overlay, the SVG preview). */
export function poseTargetFor(id: PoseId): PoseTarget {
  return POSE_LIBRARY_BY_ID[id]
}

/* ---- Forward kinematics for relation checks (arm angles only, no raw keypoints) ---- */

/**
 * Nominal, fixed proportions in shoulder-width units — approximate human
 * arm/forearm length. Only used for the RELATIVE "are these wrists close /
 * crossed" check, so a systematic bias cancels out: both the live pose and
 * the target project through the same assumed lengths.
 */
const UPPER_ARM_LEN = 0.9
const FOREARM_LEN = 0.85

interface Vec2 {
  x: number
  y: number
}

function wristPosition(a: ArmSpec, side: SideSign): Vec2 {
  const shoulder: Vec2 = { x: side * 0.5, y: 0 }
  const upperRad = absoluteRad(a.upper, side)
  const elbow: Vec2 = {
    x: shoulder.x + UPPER_ARM_LEN * Math.cos(upperRad),
    y: shoulder.y + UPPER_ARM_LEN * Math.sin(upperRad),
  }
  const foreRad = absoluteRad(a.fore, side)
  return { x: elbow.x + FOREARM_LEN * Math.cos(foreRad), y: elbow.y + FOREARM_LEN * Math.sin(foreRad) }
}

/** Relations are hard gates: any failure fails the whole pairing, regardless of angle score. */
function relationsHold(left: ArmSpec, right: ArmSpec, relations: Relation[] | undefined): boolean {
  if (!relations) return true
  const lw = wristPosition(left, 1)
  const rw = wristPosition(right, -1)
  for (const rel of relations) {
    if (rel.kind === 'wristsTogether') {
      if (Math.hypot(lw.x - rw.x, lw.y - rw.y) > rel.maxDistance) return false
    } else if (rel.kind === 'wristCrossesMidline') {
      if (!(lw.x < 0 && rw.x > 0)) return false
    }
  }
  return true
}

/** Smallest absolute circular gap between two angles, degrees, 0..180. */
function degDelta(a: Deg, b: Deg): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** 1 - error/tolerance, floored at 0, for one constrained angle. */
function constraintScore(actual: Deg, target: Deg, toleranceDeg: number): number {
  return Math.max(0, 1 - degDelta(actual, target) / toleranceDeg)
}

/** True once either side clears the stricter pose-scoring confidence gate (POSE_SCORE_MIN_SCORE). */
export function poseConfidenceOk(confidence: { left: number; right: number } | null): boolean {
  if (!confidence) return false
  return confidence.left >= POSE_SCORE_MIN_SCORE || confidence.right >= POSE_SCORE_MIN_SCORE
}

/**
 * How well a player's arms match a target pose, 0..1 — the MINIMUM across
 * every constrained angle actually being scored (not a mean: a mean lets a
 * player pass with one arm completely wrong, which was the old scorer's core
 * bug), hard-gated by any relation, and gated by confidence. Tries both
 * straight and swapped arm pairing and takes the better — this is what
 * already made the old scorer side-agnostic, and for Tier 2 poses it IS the
 * desired semantics ("raise one arm", not "raise your left arm").
 */
export function poseSimilarity(
  pose: ArmPose | null,
  confidence: { left: number; right: number } | null,
  poseId: PoseId,
  toleranceDeg: number,
): number {
  if (!pose || !poseConfidenceOk(confidence)) return 0
  const def = POSE_DEFINITIONS[poseId]
  const liveLeft = armToSpec(pose.left, 1)
  const liveRight = armToSpec(pose.right, -1)
  if (!liveLeft && !liveRight) return 0

  const attempt = (targetLeft: ArmSpec, targetRight: ArmSpec): number | null => {
    if (!relationsHold(liveLeft ?? targetLeft, liveRight ?? targetRight, def.relations)) return null
    const scores: number[] = []
    if (liveLeft) {
      scores.push(constraintScore(liveLeft.upper, targetLeft.upper, toleranceDeg))
      scores.push(constraintScore(liveLeft.fore, targetLeft.fore, toleranceDeg))
    }
    if (liveRight) {
      scores.push(constraintScore(liveRight.upper, targetRight.upper, toleranceDeg))
      scores.push(constraintScore(liveRight.fore, targetRight.fore, toleranceDeg))
    }
    return scores.length > 0 ? Math.min(...scores) : null
  }

  const straight = attempt(def.left, def.right)
  const swapped = attempt(def.right, def.left)
  if (straight === null && swapped === null) return 0
  return Math.max(straight ?? 0, swapped ?? 0)
}

/** Largest single spec-angle gap between two poses (all 4 constraints) — keeps Infinite Pose from serving two poses that look nearly identical back to back. */
function poseAngleSpread(a: PoseId, b: PoseId): number {
  const da = POSE_DEFINITIONS[a]
  const db = POSE_DEFINITIONS[b]
  return Math.max(
    degDelta(da.left.upper, db.left.upper),
    degDelta(da.left.fore, db.left.fore),
    degDelta(da.right.upper, db.right.upper),
    degDelta(da.right.fore, db.right.fore),
  )
}

/** Below this level Infinite Pose draws from Tier 1 only. */
export const POSE_TIER2_UNLOCK_LEVEL = 6
/** Prefer a next pose whose angles differ from the current one by at least this much, so the player actually has to move. */
const POSE_MOVE_MIN_DEG = 60

/** Infinite Pose's next-target pick: never repeats the current pose, prefers one requiring real movement, and only draws from Tier 2 once the level unlocks it. */
export function nextInfinitePoseId(prevId: PoseId | null, level: number, rng: () => number): PoseId {
  const pool = POSE_IDS.filter((id) => level >= POSE_TIER2_UNLOCK_LEVEL || POSE_DEFINITIONS[id].tier === 1)
  const notPrev = prevId ? pool.filter((id) => id !== prevId) : pool
  const farEnough = prevId ? notPrev.filter((id) => poseAngleSpread(id, prevId) >= POSE_MOVE_MIN_DEG) : notPrev
  const choices = farEnough.length > 0 ? farEnough : notPrev.length > 0 ? notPrev : pool
  return choices[Math.floor(rng() * choices.length)]
}

/** Pick a library INDEX different from the current one, uniform over the rest — the 2P duel's fixed-cadence rotation (Infinite Pose uses nextInfinitePoseId, which is level/pool-aware, instead). */
export function nextPoseIndex(prev: number, rng: () => number): number {
  if (POSE_LIBRARY.length <= 1) return 0
  let i = Math.floor(rng() * (POSE_LIBRARY.length - 1))
  if (i >= prev) i++
  return i
}

/** The 2P duel's fixed pose difficulty, driven by the existing low/medium/high sensitivity dial (MatchSetupScreen). Infinite Pose uses its own escalating table instead — see InfinitePoseScreen.tsx. */
export const SENSITIVITY_POSE_DIFFICULTY: Record<Sensitivity, { toleranceDeg: number; passThreshold: number }> = {
  low: { toleranceDeg: 40, passThreshold: 0.5 },
  medium: { toleranceDeg: 32, passThreshold: 0.58 },
  high: { toleranceDeg: 24, passThreshold: 0.68 },
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
  /** traffic: multiplier on every phase duration (the pause-speed setting). */
  trafficFactor: number
  /** boss: next attack time and how many landed already. */
  attackAtMs: number
  attackNumber: number
  /** pose: current target index and when it flips to the next (elapsed ms). */
  poseIndex: number
  poseSwitchAtMs: number
}

/**
 * @param trafficFactor Multiplier on traffic-light phase durations — the
 *   host's Fast/Normal/Slow pause-speed setting (PAUSE_SPEED_FACTOR in
 *   types.ts). Defaults to 1 (unscaled) so every existing caller/test that
 *   doesn't pass it keeps behaving exactly as before.
 */
export function createModeState(
  mode: MatchMode,
  rng: () => number = Math.random,
  trafficFactor = 1,
): ModeState {
  return {
    mode,
    beatIndex: -1,
    hit: [false, false],
    lastElapsedMs: 0,
    dipMs: [0, 0],
    red: false,
    switchAtMs: (TRAFFIC_GREEN_MIN_MS + rng() * TRAFFIC_GREEN_VAR_MS) * trafficFactor,
    trafficFactor,
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
  /** pose mode: each player's raw confidence backing `poses`, parallel array. */
  poseConfidence?: [{ left: number; right: number } | null, { left: number; right: number } | null]
  /** pose mode: this round's tolerance/threshold (from the sensitivity setting). Defaults to medium if omitted. */
  poseDifficulty?: { toleranceDeg: number; passThreshold: number }
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
            ? (TRAFFIC_RED_MIN_MS + rng() * TRAFFIC_RED_VAR_MS) * state.trafficFactor
            : (TRAFFIC_GREEN_MIN_MS + rng() * TRAFFIC_GREEN_VAR_MS) * state.trafficFactor)
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
      const { toleranceDeg, passThreshold } = input.poseDifficulty ?? SENSITIVITY_POSE_DIFFICULTY.medium
      const match: [number, number] = [0, 0]
      for (const i of [0, 1] as const) {
        const sim = poseSimilarity(
          input.poses?.[i] ?? null,
          input.poseConfidence?.[i] ?? null,
          target.id,
          toleranceDeg,
        )
        match[i] = sim
        // Only credit the part of the match above the threshold, so a lazy
        // half-pose barely scores while a clean copy fills fast.
        const quality = Math.max(0, (sim - passThreshold) / (1 - passThreshold))
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
