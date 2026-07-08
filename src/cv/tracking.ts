import type { Pose } from '@tensorflow-models/pose-detection'

/* ---------------- Tuning constants ---------------- */

/** Keypoints below this confidence are ignored everywhere. */
export const KEYPOINT_MIN_SCORE = 0.3
/** Poses below this overall confidence are discarded. */
export const POSE_MIN_SCORE = 0.3
/** How many inference frames a lost player stays "alive" before the track expires. */
export const PERSISTENCE_FRAMES = 12
/** EMA factor applied to NEW bounding-box samples (higher = snappier, lower = smoother). */
export const BBOX_EMA_ALPHA = 0.35
/** EMA factor applied to NEW speed samples. */
export const SPEED_EMA_ALPHA = 0.25

/**
 * Motion is measured in "body units per second": the summed distance traveled by
 * wrists + shoulders between consecutive frames, normalized by the player's
 * bounding-box diagonal (so distance from the camera doesn't matter).
 */
/** Below this, movement is treated as sensor jitter / idle sway and scores 0. */
export const MOTION_DEADZONE = 0.8
/** At (or above) this, movement scores the maximum of 1.0. */
export const MOTION_VMAX = 6.0
/**
 * A single keypoint jumping more than this fraction of the body diagonal in ONE
 * frame is a tracking glitch (identity swap / re-detection), not motion — ignore it.
 */
export const TELEPORT_GUARD = 0.45

/** Keypoints used for activity scoring: punches, guards, shoulder rolls. */
export const MOTION_KEYPOINTS = ['left_wrist', 'right_wrist', 'left_shoulder', 'right_shoulder'] as const

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
 * ROLE ASSIGNMENT: sort the (max two) fighters by on-screen X of the nose.
 * Index 0 = left on screen = Player 1 (blue), index 1 = Player 2 (red).
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

export function emaBBox(prev: BBox, next: BBox, alpha: number): BBox {
  return {
    x: ema(prev.x, next.x, alpha),
    y: ema(prev.y, next.y, alpha),
    w: ema(prev.w, next.w, alpha),
    h: ema(prev.h, next.h, alpha),
  }
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
 * Summed Pythagorean distance traveled by motion keypoints between two frames,
 * normalized by the body diagonal ("body units"). No pixel scanning involved.
 */
export function motionDelta(prev: KpMap, curr: KpMap, bboxDiag: number): number {
  if (bboxDiag <= 0) return 0
  let sum = 0
  for (const [name, p] of curr) {
    const q = prev.get(name)
    if (!q) continue
    const d = Math.hypot(p.x - q.x, p.y - q.y) / bboxDiag
    if (d > TELEPORT_GUARD) continue
    sum += d
  }
  return sum
}

/* ---------------- Per-player tracker ---------------- */

/**
 * Keeps one fighter's smoothed state across frames: EMA bounding box, EMA speed,
 * previous keypoints for motion deltas, and a persistence counter so a missed
 * detection doesn't make the box flicker.
 */
export class PlayerTracker {
  bbox: BBox | null = null
  /** Smoothed activity, 0..1. */
  speed = 0
  framesSinceSeen = Infinity
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
  age(): void {
    this.framesSinceSeen++
    if (this.framesSinceSeen > PERSISTENCE_FRAMES) this.reset()
  }

  /** Feed a fresh detection assigned to this player. */
  observe(candidate: Candidate, dt: number, scoring: boolean): void {
    // framesSinceSeen === 1 here means "was also seen in the previous frame",
    // because age() has already run for this frame.
    const consecutive = this.framesSinceSeen === 1

    this.bbox = this.bbox ? emaBBox(this.bbox, candidate.bbox, BBOX_EMA_ALPHA) : candidate.bbox

    const kp = extractMotionKeypoints(candidate.pose)
    if (scoring && this.prevKp && consecutive && dt > 0) {
      const diag = Math.hypot(this.bbox.w, this.bbox.h)
      const perSecond = motionDelta(this.prevKp, kp, diag) / dt
      const overDeadzone = Math.max(0, perSecond - MOTION_DEADZONE)
      const normalized = Math.min(overDeadzone / (MOTION_VMAX - MOTION_DEADZONE), 1)
      this.speed = ema(this.speed, normalized, SPEED_EMA_ALPHA)
    } else if (!scoring) {
      this.speed = 0
    }

    this.prevKp = kp
    this.framesSinceSeen = 0
  }

  /** Called when the player was NOT seen this frame but the track persists. */
  decay(): void {
    this.speed = ema(this.speed, 0, SPEED_EMA_ALPHA)
  }

  reset(): void {
    this.bbox = null
    this.prevKp = null
    this.speed = 0
    this.framesSinceSeen = Infinity
  }
}
