import type { Pose } from '@tensorflow-models/pose-detection'

/* ---------------- Tuning constants ---------------- */

/** Keypoints below this confidence are ignored everywhere. */
export const KEYPOINT_MIN_SCORE = 0.3
/** Poses below this overall confidence are discarded. */
export const POSE_MIN_SCORE = 0.3
/**
 * How long a lost player stays "alive" before the track expires. Time-based so
 * the game behaves identically on a 15 fps budget phone and a 60 fps flagship.
 */
export const PERSISTENCE_MS = 600
/** Smoothing time-constant for the bounding box (seconds to ~63% of a step). */
export const BBOX_TAU_S = 0.1
/** Smoothing time-constant for the activity speed. */
export const SPEED_TAU_S = 0.25

/**
 * Frame-rate-independent EMA factor: integrating a first-order low-pass over a
 * variable dt. Two devices with different inference rates smooth identically.
 */
export function alphaFromTau(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau)
}

/**
 * Motion is measured in "body units per second": the AVERAGE distance traveled
 * per tracked keypoint between consecutive frames, normalized by the player's
 * bounding-box diagonal. Averaging (not summing) makes the score fair when a
 * keypoint drops out for a few frames — a hidden wrist no longer costs points.
 */
/** Below this, movement is treated as sensor jitter / idle sway and scores 0. */
export const MOTION_DEADZONE = 0.25
/** At (or above) this, movement scores the maximum of 1.0. */
export const MOTION_VMAX = 1.6
/**
 * A single keypoint jumping more than this fraction of the body diagonal in ONE
 * frame is a tracking glitch (identity swap / re-detection), not motion — ignore it.
 */
export const TELEPORT_GUARD = 0.45

/** Keypoints used for activity scoring: punches, guards, elbow drive, shoulder rolls. */
export const MOTION_KEYPOINTS = [
  'left_wrist',
  'right_wrist',
  'left_elbow',
  'right_elbow',
  'left_shoulder',
  'right_shoulder',
] as const

/**
 * Scoring weights: hands carry the action. Rewards actual punching/waving over
 * torso sway, while the weighted average stays dropout-fair (a missing point
 * changes the denominator too).
 */
const MOTION_WEIGHTS: Record<string, number> = {
  left_wrist: 1,
  right_wrist: 1,
  left_elbow: 0.75,
  right_elbow: 0.75,
  left_shoulder: 0.5,
  right_shoulder: 0.5,
}

/* ------- Identity matching (locked roles) ------- */

/** After a track dies, a re-appearing person re-binds to it by proximity for this long. */
export const REBIND_WINDOW_MS = 2500
/** Max match distance as a multiple of the larger of the two bbox diagonals. */
export const MATCH_GATE_FACTOR = 1.25

/* ------- ROI (zoom-in inference crop) ------- */

/** Padding around the players' union box, as a fraction of its larger side. */
export const ROI_PAD = 0.35
/** A tracked box this close to the ROI border (fraction of ROI size) forces a full scan. */
export const ROI_EDGE_EPS = 0.05
/** Every N-th inference frame scans the full video even when the ROI is active. */
export const FULL_SCAN_EVERY = 10
/** The ROI must be stable for this many frames before cropping kicks in. */
export const ROI_WARMUP_FRAMES = 3

/* ---------------- Types ---------------- */

export interface Point {
  x: number
  y: number
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export type KpMap = Map<string, Point>

/** A detected pose that survived filtering, ready for role assignment. */
export interface Candidate {
  pose: Pose
  bbox: BBox
  /** X used to decide who is left / right (nose if visible, bbox center otherwise). */
  anchorX: number
}

/* ---------------- Pure helpers ---------------- */

export function ema(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha
}

function poseScore(pose: Pose): number {
  if (typeof pose.score === 'number') return pose.score
  if (pose.keypoints.length === 0) return 0
  return pose.keypoints.reduce((s, k) => s + (k.score ?? 0), 0) / pose.keypoints.length
}

/** Tight bounding box around confident keypoints, padded 10% per side. */
export function poseBBox(pose: Pose): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0
  for (const k of pose.keypoints) {
    if ((k.score ?? 0) < KEYPOINT_MIN_SCORE) continue
    count++
    if (k.x < minX) minX = k.x
    if (k.y < minY) minY = k.y
    if (k.x > maxX) maxX = k.x
    if (k.y > maxY) maxY = k.y
  }
  // Require a reasonably visible person, not a stray hand in the corner.
  if (count < 5) return null
  const w = maxX - minX
  const h = maxY - minY
  if (w < 16 || h < 16) return null
  const padX = w * 0.1
  const padY = h * 0.1
  return { x: minX - padX, y: minY - padY, w: w + padX * 2, h: h + padY * 2 }
}

export function bboxArea(b: BBox): number {
  return b.w * b.h
}

export function bboxDiag(b: BBox): number {
  return Math.hypot(b.w, b.h)
}

export function bboxCenter(b: BBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

export function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (inter <= 0) return 0
  return inter / (bboxArea(a) + bboxArea(b) - inter)
}

/**
 * STRICT FILTERING: drop low-confidence poses, then keep only the two largest
 * people by bounding-box area — background bystanders are ignored.
 */
export function selectFighters(poses: Pose[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const pose of poses) {
    if (poseScore(pose) < POSE_MIN_SCORE) continue
    const bbox = poseBBox(pose)
    if (!bbox) continue
    const nose = pose.keypoints.find((k) => k.name === 'nose')
    const anchorX = nose && (nose.score ?? 0) >= KEYPOINT_MIN_SCORE ? nose.x : bbox.x + bbox.w / 2
    candidates.push({ pose, bbox, anchorX })
  }
  candidates.sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox))
  return candidates.slice(0, 2)
}

/**
 * POSITIONAL ROLE ASSIGNMENT (roles unlocked, i.e. calibration): sort the (max
 * two) fighters by on-screen X. Index 0 = left on screen = Player 1 (blue).
 * In mirror mode "left on screen" is the flipped coordinate, so players get the
 * role matching what they see on the TV.
 */
export function assignRoles(
  candidates: Candidate[],
  videoWidth: number,
  mirror: boolean,
): [Candidate | null, Candidate | null] {
  const displayX = (c: Candidate) => (mirror ? videoWidth - c.anchorX : c.anchorX)
  if (candidates.length === 0) return [null, null]
  if (candidates.length === 1) {
    const only = candidates[0]
    return displayX(only) < videoWidth / 2 ? [only, null] : [null, only]
  }
  const sorted = [...candidates].sort((a, b) => displayX(a) - displayX(b))
  return [sorted[0], sorted[1]]
}

/** What the identity matcher needs to know about a player slot. */
export interface SlotAnchor {
  /** Live bbox when the track is alive, else null. */
  bbox: BBox | null
  /** Last bbox ever seen (survives track expiry) for re-binding. */
  lastBBox: BBox | null
  /** performance.now() of the last observation. */
  lastSeenAtMs: number
}

function anchorFor(slot: SlotAnchor, nowMs: number): BBox | null {
  if (slot.bbox) return slot.bbox
  if (slot.lastBBox && nowMs - slot.lastSeenAtMs <= REBIND_WINDOW_MS) return slot.lastBBox
  return null
}

function gatedDist(anchor: BBox, candidate: BBox): number | null {
  const a = bboxCenter(anchor)
  const c = bboxCenter(candidate)
  const dist = Math.hypot(a.x - c.x, a.y - c.y)
  const gate = MATCH_GATE_FACTOR * Math.max(bboxDiag(anchor), bboxDiag(candidate))
  return dist <= gate ? dist : null
}

/**
 * STICKY ROLE ASSIGNMENT (roles locked, i.e. the match is running): candidates
 * are matched to the player slots by proximity, NOT by screen position — the
 * blue player stays blue even when the kids cross or swap sides. A slot that
 * lost its track re-captures a nearby person for REBIND_WINDOW_MS; after that
 * (or with no anchors at all) we fall back to positional assignment.
 */
export function matchLockedRoles(
  slots: [SlotAnchor, SlotAnchor],
  candidates: Candidate[],
  nowMs: number,
  videoWidth: number,
  mirror: boolean,
): [Candidate | null, Candidate | null] {
  if (candidates.length === 0) return [null, null]

  const anchors: [BBox | null, BBox | null] = [
    anchorFor(slots[0], nowMs),
    anchorFor(slots[1], nowMs),
  ]

  // Cold start / both anchors expired → positional rules.
  if (!anchors[0] && !anchors[1]) return assignRoles(candidates, videoWidth, mirror)

  // Try both pairings; a pair is valid only when the slot has an anchor and
  // the candidate is within the distance gate. Rank: most players placed
  // first, then the smaller total distance.
  const [c0, c1] = [candidates[0], candidates[1]]
  let best: [Candidate | null, Candidate | null] = [null, null]
  let bestPlaced = -1
  let bestDist = Infinity
  const permutations: Array<[Candidate | undefined, Candidate | undefined]> = [
    [c0, c1],
    [c1, c0],
  ]
  for (const [toSlot0, toSlot1] of permutations) {
    const assigned: [Candidate | null, Candidate | null] = [null, null]
    let dist = 0
    for (const slot of [0, 1] as const) {
      const cand = slot === 0 ? toSlot0 : toSlot1
      const anchor = anchors[slot]
      if (!cand || !anchor) continue
      const d = gatedDist(anchor, cand.bbox)
      if (d === null) continue
      assigned[slot] = cand
      dist += d
    }
    const placed = (assigned[0] ? 1 : 0) + (assigned[1] ? 1 : 0)
    if (placed > bestPlaced || (placed === bestPlaced && dist < bestDist)) {
      best = assigned
      bestPlaced = placed
      bestDist = dist
    }
  }

  // A candidate that no slot could claim: give it to a slot with NO anchor at
  // all (a genuinely free seat) by position; never steal an anchored slot.
  const placedSet = new Set([best[0], best[1]].filter(Boolean))
  const leftover = candidates.find((c) => !placedSet.has(c))
  if (leftover) {
    for (const i of [0, 1] as const) {
      if (best[i] === null && anchors[i] === null) {
        best[i] = leftover
        break
      }
    }
  }
  return best
}

/* ---------------- ROI (inference crop) ---------------- */

/**
 * Union of the tracked players' boxes, generously padded and clamped to the
 * frame. Cropping the inference input to this region makes each player 3–4×
 * larger for the pose model — dramatically better keypoints at living-room
 * distances.
 */
export function computeRoi(boxes: BBox[], videoW: number, videoH: number): BBox | null {
  if (boxes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  const pad = ROI_PAD * Math.max(maxX - minX, maxY - minY)
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad
  const x = Math.max(0, Math.floor(minX))
  const y = Math.max(0, Math.floor(minY))
  const w = Math.min(videoW, Math.ceil(maxX)) - x
  const h = Math.min(videoH, Math.ceil(maxY)) - y
  if (w < 64 || h < 64) return null
  return { x, y, w, h }
}

/**
 * True when a tracked box sits too close to a ROI border that is NOT the video
 * border — the player is about to leave the crop, re-scan the full frame.
 */
export function roiTouchesEdge(box: BBox, roi: BBox, videoW: number, videoH: number): boolean {
  const epsX = roi.w * ROI_EDGE_EPS
  const epsY = roi.h * ROI_EDGE_EPS
  if (roi.x > 0 && box.x - roi.x < epsX) return true
  if (roi.y > 0 && box.y - roi.y < epsY) return true
  if (roi.x + roi.w < videoW && roi.x + roi.w - (box.x + box.w) < epsX) return true
  if (roi.y + roi.h < videoH && roi.y + roi.h - (box.y + box.h) < epsY) return true
  return false
}

/* ---------------- Motion ---------------- */

export function emaBBox(prev: BBox, next: BBox, alpha: number): BBox {
  return {
    x: ema(prev.x, next.x, alpha),
    y: ema(prev.y, next.y, alpha),
    w: ema(prev.w, next.w, alpha),
    h: ema(prev.h, next.h, alpha),
  }
}

/* ---------------- Face anchor (for the privacy mask) ---------------- */

export interface FaceAnchor {
  x: number
  y: number
  r: number
}

const FACE_KEYPOINTS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'] as const

/**
 * Face center + radius from the confident head keypoints. Radius covers the
 * whole head (spread of the points, but never less than a bbox fraction so a
 * lone nose detection still masks properly).
 */
export function faceAnchor(pose: Pose, bbox: BBox): FaceAnchor | null {
  const pts: Array<{ x: number; y: number }> = []
  for (const k of pose.keypoints) {
    if (!k.name || !(FACE_KEYPOINTS as readonly string[]).includes(k.name)) continue
    if ((k.score ?? 0) < KEYPOINT_MIN_SCORE) continue
    pts.push({ x: k.x, y: k.y })
  }
  if (pts.length === 0) return null
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  let spread = 0
  for (const p of pts) spread = Math.max(spread, Math.hypot(p.x - cx, p.y - cy))
  return { x: cx, y: cy, r: Math.max(spread * 1.8, bbox.w * 0.16) }
}

/* ---------------- Body posture (single-player runner controls) ---------------- */

/**
 * Raw body geometry for gesture control, in full-frame video pixels. The runner
 * mode needs to know WHAT the body did (which lane, jump, crouch), not just how
 * much it moved — so this exposes the torso landmarks the duel scorer discards.
 * The gesture layer (src/runner/gestures.ts) normalizes these against a
 * calibrated neutral stance, so absolute pixel scale / camera distance drop out.
 */
export interface RawPosture {
  /** Mean X of the confident shoulders + hips — the lane (left/right) signal. */
  centerX: number
  /** Mean Y of the confident hips — the vertical (jump) signal. */
  hipY: number
  /** Highest confident head/shoulder Y (smallest value) — top of the body. */
  topY: number
  /** Shoulder span in px, or 0 when both shoulders aren't visible. */
  shoulderWidth: number
  /** Torso length shoulders→hips in px — the fallback normalization scale. */
  torsoHeight: number
}

function confidentPoint(pose: Pose, name: string): Point | null {
  const k = pose.keypoints.find((p) => p.name === name)
  if (!k || (k.score ?? 0) < KEYPOINT_MIN_SCORE) return null
  return { x: k.x, y: k.y }
}

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length

/** Head/shoulder points that can mark the top of the body (min Y). */
const TOP_KEYPOINTS = ['nose', 'left_eye', 'right_eye', 'left_shoulder', 'right_shoulder'] as const

/**
 * Torso landmarks for a single tracked player. Returns null unless the core is
 * visible (≥1 shoulder AND ≥1 hip) — a half-detected body would give garbage
 * lane/jump signals, better to report "not reliable" than to fire false events.
 */
export function bodyPosture(pose: Pose): RawPosture | null {
  const ls = confidentPoint(pose, 'left_shoulder')
  const rs = confidentPoint(pose, 'right_shoulder')
  const lh = confidentPoint(pose, 'left_hip')
  const rh = confidentPoint(pose, 'right_hip')
  const shoulders = [ls, rs].filter((p): p is Point => p !== null)
  const hips = [lh, rh].filter((p): p is Point => p !== null)
  if (shoulders.length === 0 || hips.length === 0) return null

  const shoulderY = mean(shoulders.map((p) => p.y))
  const hipY = mean(hips.map((p) => p.y))
  const centerX = mean([...shoulders, ...hips].map((p) => p.x))
  const shoulderWidth = ls && rs ? Math.abs(ls.x - rs.x) : 0

  let topY = shoulderY
  for (const name of TOP_KEYPOINTS) {
    const p = confidentPoint(pose, name)
    if (p && p.y < topY) topY = p.y
  }
  return { centerX, hipY, topY, shoulderWidth, torsoHeight: Math.max(1, hipY - shoulderY) }
}

export function extractMotionKeypoints(pose: Pose): KpMap {
  const map: KpMap = new Map()
  for (const k of pose.keypoints) {
    if (!k.name) continue
    if (!(MOTION_KEYPOINTS as readonly string[]).includes(k.name)) continue
    if ((k.score ?? 0) < KEYPOINT_MIN_SCORE) continue
    map.set(k.name, { x: k.x, y: k.y })
  }
  return map
}

/**
 * WEIGHTED AVERAGE Pythagorean distance traveled per motion keypoint between
 * two frames, normalized by the body diagonal ("body units"). Averaging keeps
 * the score fair when keypoints drop in and out of detection; the weights make
 * hand action count more than torso sway.
 */
export function motionDelta(prev: KpMap, curr: KpMap, bboxDiagonal: number): number {
  if (bboxDiagonal <= 0) return 0
  let sum = 0
  let weightSum = 0
  for (const [name, p] of curr) {
    const q = prev.get(name)
    if (!q) continue
    const d = Math.hypot(p.x - q.x, p.y - q.y) / bboxDiagonal
    if (d > TELEPORT_GUARD) continue
    const w = MOTION_WEIGHTS[name] ?? 1
    sum += d * w
    weightSum += w
  }
  return weightSum > 0 ? sum / weightSum : 0
}

/* ---------------- Per-player tracker ---------------- */

/**
 * Keeps one fighter's smoothed state across frames: EMA bounding box, EMA speed,
 * previous keypoints for motion deltas, and a persistence counter so a missed
 * detection doesn't make the box flicker. Also remembers the LAST place it saw
 * its player (lastBBox / lastSeenAtMs) so the identity matcher can re-bind a
 * re-appearing person to the same role.
 */
export class PlayerTracker implements SlotAnchor {
  bbox: BBox | null = null
  /** Smoothed activity, 0..1. */
  speed = 0
  /** Smoothed head position for the privacy mask (null when no head points). */
  face: FaceAnchor | null = null
  /** Raw torso geometry for runner gesture control (null when core not visible). */
  posture: RawPosture | null = null
  framesSinceSeen = Infinity
  lastBBox: BBox | null = null
  lastSeenAtMs = -Infinity
  private prevKp: KpMap | null = null

  /** Track is alive (either seen this frame or within the persistence window). */
  get present(): boolean {
    return this.bbox !== null
  }

  /** Seen in the latest inference frame. */
  get visible(): boolean {
    return this.framesSinceSeen === 0
  }

  /** Call once per inference frame, before observe(). Ages and possibly expires the track. */
  age(nowMs: number): void {
    this.framesSinceSeen++
    if (this.bbox !== null && nowMs - this.lastSeenAtMs > PERSISTENCE_MS) this.expire()
  }

  /** Feed a fresh detection assigned to this player. */
  observe(candidate: Candidate, dt: number, scoring: boolean, nowMs: number): void {
    // framesSinceSeen === 1 here means "was also seen in the previous frame",
    // because age() has already run for this frame.
    const consecutive = this.framesSinceSeen === 1
    const safeDt = Math.max(dt, 1 / 120)

    this.bbox = this.bbox
      ? emaBBox(this.bbox, candidate.bbox, alphaFromTau(safeDt, BBOX_TAU_S))
      : candidate.bbox
    this.lastBBox = this.bbox
    this.lastSeenAtMs = nowMs

    const freshFace = faceAnchor(candidate.pose, this.bbox)
    if (freshFace) {
      const a = alphaFromTau(safeDt, BBOX_TAU_S)
      this.face = this.face
        ? {
            x: ema(this.face.x, freshFace.x, a),
            y: ema(this.face.y, freshFace.y, a),
            r: ema(this.face.r, freshFace.r, a),
          }
        : freshFace
    }

    // Torso geometry for the runner mode — computed every frame it's visible,
    // independent of scoring (calibration reads it while the bar isn't filling).
    this.posture = bodyPosture(candidate.pose)

    const kp = extractMotionKeypoints(candidate.pose)
    if (scoring && this.prevKp && consecutive && dt > 0) {
      const diag = Math.hypot(this.bbox.w, this.bbox.h)
      const perSecond = motionDelta(this.prevKp, kp, diag) / dt
      const overDeadzone = Math.max(0, perSecond - MOTION_DEADZONE)
      const normalized = Math.min(overDeadzone / (MOTION_VMAX - MOTION_DEADZONE), 1)
      this.speed = ema(this.speed, normalized, alphaFromTau(safeDt, SPEED_TAU_S))
    } else if (!scoring) {
      this.speed = 0
    }

    this.prevKp = kp
    this.framesSinceSeen = 0
  }

  /** Called when the player was NOT seen this frame but the track persists. */
  decay(dt: number): void {
    this.speed = ema(this.speed, 0, alphaFromTau(Math.max(dt, 1 / 120), SPEED_TAU_S))
  }

  /** Track expiry: live state goes, re-bind memory (lastBBox) stays. */
  private expire(): void {
    this.bbox = null
    this.prevKp = null
    this.face = null
    this.posture = null
    this.speed = 0
    this.framesSinceSeen = Infinity
  }

  /** Full reset (new calibration): forget everything including re-bind memory. */
  reset(): void {
    this.expire()
    this.lastBBox = null
    this.lastSeenAtMs = -Infinity
  }
}
