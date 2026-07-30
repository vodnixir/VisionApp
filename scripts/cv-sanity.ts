/**
 * Sanity tests for the pure CV math (run: npm run test:cv).
 * Covers the parts that a headless browser can't exercise: identity matching,
 * ROI geometry, motion-scoring fairness and the portrait clip layout.
 */
import assert from 'node:assert/strict'
import {
  BOSS_ATTACK_DAMAGE_GROWTH,
  BOSS_ATTACK_DAMAGE_START,
  BOSS_ATTACK_EVERY_MS,
  ENDURANCE_GRACE_MS,
  POSE_DEFINITIONS,
  POSE_IDS,
  POSE_PERIOD_MS,
  POSE_SCORE_MIN_SCORE,
  POSE_TIER2_UNLOCK_LEVEL,
  RHYTHM_PERIOD_MS,
  RHYTHM_WINDOW_MS,
  TRAFFIC_GREEN_MIN_MS,
  TRAFFIC_RED_MIN_MS,
  absoluteRad,
  bossCharge,
  createModeState,
  modeTick,
  nextInfinitePoseId,
  nextPoseIndex,
  poseArmScores,
  poseSimilarity,
  poseTargetFor,
  specDeg,
  type PoseId,
} from '../src/modes'
import type { ArmPose, Limb } from '../src/cv/tracking'
import {
  HIGHLIGHT_TARGET_MS,
  PORTRAIT_H,
  PORTRAIT_W,
  coverCrop,
  endingWindow,
  pickHighlights,
  portraitLayout,
  type ActivitySample,
} from '../src/recorder'
import {
  COMBO_TIERS,
  PAUSE_SPEED_FACTOR,
  comboMultiplier,
  isOvertimeTie,
  mirrorDefaultForLabel,
} from '../src/types'
import {
  AMPLITUDE_MAX_BONUS,
  AMPLITUDE_MICRO_FACTOR,
  IDENTITY_REBIND_HOLD_MS,
  REBIND_WINDOW_MS,
  amplitudeFactor,
  assignRolesN,
  blendSig,
  computeRoi,
  iou,
  matchLockedRoles,
  matchLockedRolesN,
  motionDelta,
  pickRoster,
  roiTouchesEdge,
  selectFighters,
  sigDistance,
  torsoAnchor,
  type BBox,
  type Candidate,
  type ColorSig,
  type KpMap,
  type RosterAnchor,
  type SlotAnchor,
} from '../src/cv/tracking'
import type { Pose } from '@tensorflow-models/pose-detection'
import {
  DEFAULT_GESTURE_CONFIG,
  averageNeutral,
  createGestureState,
  detectGesture,
  type Neutral,
  type PostureSample,
} from '../src/runner/gestures'
import {
  PLAYER_Z,
  createRunnerState,
  runnerScore,
  stepRunner,
  type Entity,
  type ObstacleType,
  type RunnerInput,
} from '../src/runner/game'
import { mulberry32, packSignal, unpackSignal } from '../src/online/protocol'

let passed = 0
function ok(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

async function okAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

function mkCand(x: number, y: number, w: number, h: number, sig?: ColorSig): Candidate {
  return {
    pose: { score: 1, keypoints: [] },
    bbox: { x, y, w, h },
    anchorX: x + w / 2,
    sig,
  }
}

function slot(
  bbox: BBox | null,
  lastBBox: BBox | null = bbox,
  lastSeenAgoMs = 0,
  sig: ColorSig | null = null,
): SlotAnchor {
  return { bbox, lastBBox, lastSeenAtMs: NOW - lastSeenAgoMs, sig }
}

/** Two maximally-different signatures for the colour-identity tests. */
const RED_SIG: ColorSig = [1, 0, 0, 0]
const BLUE_SIG: ColorSig = [0, 0, 0, 1]

const NOW = 100_000
const VW = 1280
const VH = 720

console.log('motionDelta')

ok('average is dropout-fair: 6 vs 3 keypoints, same per-point motion → same score', () => {
  const diag = 100
  const mk = (names: string[], dx: number): [KpMap, KpMap] => {
    const prev: KpMap = new Map()
    const curr: KpMap = new Map()
    for (const n of names) {
      prev.set(n, { x: 0, y: 0 })
      curr.set(n, { x: dx, y: 0 })
    }
    return [prev, curr]
  }
  const six = ['a', 'b', 'c', 'd', 'e', 'f']
  const three = ['a', 'b', 'c']
  const [p6, c6] = mk(six, 10)
  const [p3, c3] = mk(three, 10)
  assert.ok(Math.abs(motionDelta(p6, c6, diag) - motionDelta(p3, c3, diag)) < 1e-9)
  assert.ok(Math.abs(motionDelta(p6, c6, diag) - 0.1) < 1e-6)
})

ok('teleporting keypoint is excluded from the average', () => {
  const prev: KpMap = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 0, y: 0 }],
  ])
  const curr: KpMap = new Map([
    ['a', { x: 10, y: 0 }],
    ['b', { x: 90, y: 0 }], // 90% of diag → glitch
  ])
  assert.ok(Math.abs(motionDelta(prev, curr, 100) - 0.1) < 1e-9)
})

ok('no shared keypoints → 0', () => {
  const prev: KpMap = new Map([['a', { x: 0, y: 0 }]])
  const curr: KpMap = new Map([['b', { x: 5, y: 5 }]])
  assert.equal(motionDelta(prev, curr, 100), 0)
})

console.log('amplitude anti-cheat')

const H = 250 // body bbox height for the ratio

ok('fists tucked at the chest (tiny reach) are discounted hard', () => {
  // Right wrist ~10px from its shoulder → reach ratio 0.04, well under the floor.
  const kp: KpMap = new Map([
    ['right_wrist', { x: 0, y: 0 }],
    ['right_shoulder', { x: 0, y: 10 }],
  ])
  assert.equal(amplitudeFactor(kp, H), AMPLITUDE_MICRO_FACTOR)
})

ok('a full-extension reach earns the top bonus', () => {
  // Wrist 150px from the shoulder → ratio 0.6, past the max-reach threshold.
  const kp: KpMap = new Map([
    ['right_wrist', { x: 0, y: 0 }],
    ['right_shoulder', { x: 0, y: 150 }],
  ])
  assert.equal(amplitudeFactor(kp, H), AMPLITUDE_MAX_BONUS)
})

ok('the wider of the two arms sets the reach, and it ramps monotonically', () => {
  const micro: KpMap = new Map([
    ['left_wrist', { x: 0, y: 0 }],
    ['left_shoulder', { x: 0, y: 12 }],
  ])
  const mid: KpMap = new Map([
    ['left_wrist', { x: 0, y: 0 }],
    ['left_shoulder', { x: 0, y: 12 }],
    // A wide right arm should dominate the tucked left one.
    ['right_wrist', { x: 0, y: 0 }],
    ['right_shoulder', { x: 0, y: 100 }],
  ])
  assert.ok(amplitudeFactor(mid, H) > amplitudeFactor(micro, H))
})

ok('no wrist+shoulder pair visible → neutral (never zeroes a legit mover)', () => {
  const kp: KpMap = new Map([['right_wrist', { x: 0, y: 0 }]])
  assert.equal(amplitudeFactor(kp, H), 1)
})

console.log('assignRolesN (runner Duel / Squad)')

ok('N players get left-to-right slots regardless of detection order', () => {
  const left = mkCand(100, 100, 100, 250) // anchorX 150
  const mid = mkCand(400, 100, 100, 250) // anchorX 450
  const right = mkCand(800, 100, 100, 250) // anchorX 850
  const roles = assignRolesN([right, left, mid], 3, VW, false)
  assert.equal(roles.length, 3)
  assert.equal(roles[0], left, 'slot 0 = leftmost')
  assert.equal(roles[1], mid, 'slot 1 = middle')
  assert.equal(roles[2], right, 'slot 2 = rightmost')
})

ok('fewer people than slots leaves the extra slots empty', () => {
  const only = mkCand(400, 100, 100, 250)
  const roles = assignRolesN([only], 3, VW, false)
  assert.equal(roles[0], only)
  assert.equal(roles[1], null)
  assert.equal(roles[2], null)
})

console.log('matchLockedRoles')

ok('players who crossed sides keep their roles (no positional swap)', () => {
  // P1's body is now on the RIGHT (they crossed while tracked).
  const slots: [SlotAnchor, SlotAnchor] = [
    slot({ x: 380, y: 100, w: 100, h: 250 }), // P1 anchor, right side
    slot({ x: 130, y: 100, w: 100, h: 250 }), // P2 anchor, left side
  ]
  const nearP1 = mkCand(390, 105, 100, 250)
  const nearP2 = mkCand(120, 95, 100, 250)
  const [a, b] = matchLockedRoles(slots, [nearP2, nearP1], NOW, VW, false)
  assert.equal(a, nearP1, 'slot 0 keeps the right-side body')
  assert.equal(b, nearP2, 'slot 1 keeps the left-side body')
})

ok('candidate beyond the gate is not claimed', () => {
  const slots: [SlotAnchor, SlotAnchor] = [
    slot({ x: 0, y: 0, w: 80, h: 160 }),
    slot(null, null, Infinity),
  ]
  const far = mkCand(1100, 500, 80, 160)
  const [a] = matchLockedRoles(slots, [far], NOW, VW, false)
  assert.equal(a, null, 'far candidate must not snap to slot 0')
})

ok('re-bind by proximity within the window after a lost track', () => {
  const lastBBox = { x: 200, y: 150, w: 90, h: 220 }
  const slots: [SlotAnchor, SlotAnchor] = [
    slot(null, lastBBox, REBIND_WINDOW_MS - 500), // lost 2 s ago
    slot({ x: 700, y: 150, w: 90, h: 220 }),
  ]
  const returning = mkCand(210, 160, 90, 210)
  const [a] = matchLockedRoles(slots, [returning], NOW, VW, false)
  assert.equal(a, returning, 'returning player re-binds to their old slot')
})

ok('expired re-bind window + no anchors → positional fallback', () => {
  const slots: [SlotAnchor, SlotAnchor] = [
    slot(null, { x: 900, y: 100, w: 90, h: 220 }, REBIND_WINDOW_MS + 2000),
    slot(null, null, Infinity),
  ]
  const leftGuy = mkCand(100, 100, 90, 220)
  const [a, b] = matchLockedRoles(slots, [leftGuy], NOW, VW, false)
  assert.equal(a, leftGuy, 'left-side person becomes P1 positionally')
  assert.equal(b, null)
})

ok('single candidate with two anchors → nearest slot wins', () => {
  const slots: [SlotAnchor, SlotAnchor] = [
    slot({ x: 100, y: 100, w: 90, h: 220 }),
    slot({ x: 600, y: 100, w: 90, h: 220 }),
  ]
  const nearSecond = mkCand(590, 110, 90, 220)
  const [a, b] = matchLockedRoles(slots, [nearSecond], NOW, VW, false)
  assert.equal(a, null)
  assert.equal(b, nearSecond)
})

ok('unclaimed candidate fills a genuinely free slot, never steals an anchored one', () => {
  const slots: [SlotAnchor, SlotAnchor] = [
    slot({ x: 100, y: 100, w: 90, h: 220 }),
    slot(null, null, Infinity), // free seat
  ]
  const near = mkCand(105, 102, 90, 220)
  const stranger = mkCand(900, 120, 90, 220)
  const [a, b] = matchLockedRoles(slots, [near, stranger], NOW, VW, false)
  assert.equal(a, near)
  assert.equal(b, stranger, 'stranger takes the free seat, not the anchored one')
})

console.log('colour identity (anti-swap)')

ok('sigDistance: identical → 0, disjoint → 1, missing → 0 (neutral)', () => {
  assert.equal(sigDistance(RED_SIG, RED_SIG), 0)
  assert.equal(sigDistance(RED_SIG, BLUE_SIG), 1)
  assert.equal(sigDistance(null, RED_SIG), 0, 'unprofiled body is never penalized')
  const half: ColorSig = [0.5, 0, 0, 0.5]
  assert.ok(Math.abs(sigDistance(RED_SIG, half) - 0.5) < 1e-9, 'partial overlap is partial distance')
})

ok('blendSig seeds on the first sample, then eases toward new ones', () => {
  const seeded = blendSig(null, RED_SIG, 0.5)
  assert.deepEqual(seeded, RED_SIG, 'first sample is taken as-is')
  const eased = blendSig(RED_SIG, BLUE_SIG, 0.5)
  assert.deepEqual(eased, [0.5, 0, 0, 0.5], 'halfway between old and new')
})

ok('colour rescues identity when a cross makes position point the wrong way', () => {
  // Slot 0 = the RED player, slot 1 = the BLUE player, both anchored close
  // together. Mid-cross the bodies have nearly swapped X, so the nearest-anchor
  // pairing would hand each slot the WRONG body — colour must overrule it.
  const slots: [SlotAnchor, SlotAnchor] = [
    slot({ x: 300, y: 100, w: 100, h: 250 }, undefined, 0, RED_SIG), // red anchor, left-ish
    slot({ x: 360, y: 100, w: 100, h: 250 }, undefined, 0, BLUE_SIG), // blue anchor, right-ish
  ]
  // The red body is now on the right (near the blue anchor); blue on the left.
  const redBody = mkCand(355, 105, 100, 250, RED_SIG)
  const blueBody = mkCand(305, 105, 100, 250, BLUE_SIG)
  const [a, b] = matchLockedRoles(slots, [blueBody, redBody], NOW, VW, false)
  assert.equal(a, redBody, 'slot 0 keeps the RED body despite it being the far one')
  assert.equal(b, blueBody, 'slot 1 keeps the BLUE body')
})

ok('without signatures the matcher still falls back to nearest-anchor', () => {
  // Same geometry, no colours: position alone decides (the old behaviour).
  const slots: [SlotAnchor, SlotAnchor] = [
    slot({ x: 300, y: 100, w: 100, h: 250 }),
    slot({ x: 360, y: 100, w: 100, h: 250 }),
  ]
  const bodyNearSlot0 = mkCand(305, 105, 100, 250)
  const bodyNearSlot1 = mkCand(355, 105, 100, 250)
  const [a, b] = matchLockedRoles(slots, [bodyNearSlot1, bodyNearSlot0], NOW, VW, false)
  assert.equal(a, bodyNearSlot0, 'nearest body to slot 0 wins when no colour is known')
  assert.equal(b, bodyNearSlot1)
})

console.log('ROI')

ok('computeRoi pads the union and clamps to the frame', () => {
  const roi = computeRoi(
    [
      { x: 100, y: 100, w: 200, h: 400 },
      { x: 700, y: 120, w: 200, h: 380 },
    ],
    VW,
    VH,
  )
  assert.ok(roi)
  assert.ok(roi.x >= 0 && roi.y >= 0)
  assert.ok(roi.x + roi.w <= VW && roi.y + roi.h <= VH)
  assert.ok(roi.x < 100, 'left edge padded outward')
  assert.ok(roi.x + roi.w > 900, 'right edge padded outward')
})

ok('computeRoi of nothing → null', () => {
  assert.equal(computeRoi([], VW, VH), null)
})

ok('roiTouchesEdge: near an inner border → true, near the video border → false', () => {
  const roi = { x: 200, y: 100, w: 600, h: 500 }
  const nearInner = { x: 205, y: 300, w: 100, h: 200 } // 5px from roi left edge (inner)
  assert.equal(roiTouchesEdge(nearInner, roi, VW, VH), true)

  const fullWidthRoi = { x: 0, y: 100, w: VW, h: 500 }
  const nearVideoBorder = { x: 3, y: 300, w: 100, h: 200 }
  assert.equal(roiTouchesEdge(nearVideoBorder, fullWidthRoi, VW, VH), false)
})

console.log('iou')

ok('identical boxes → 1, disjoint → 0', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 }
  assert.ok(Math.abs(iou(a, { ...a }) - 1) < 1e-9)
  assert.equal(iou(a, { x: 500, y: 500, w: 50, h: 50 }), 0)
})

console.log('portrait clip layout')

ok('coverCrop of a 16:9 source to 9:16 crops a centered vertical slice', () => {
  const c = coverCrop(1280, 720, PORTRAIT_W / PORTRAIT_H)
  assert.equal(c.h, 720, 'full height kept')
  assert.ok(Math.abs(c.w - 405) < 1e-9, '720 * 9/16 = 405 wide')
  assert.ok(Math.abs(c.x - (1280 - 405) / 2) < 1e-9, 'horizontally centered')
  assert.equal(c.y, 0)
})

ok('portraitLayout letterboxes a 16:9 source with headroom above', () => {
  const l = portraitLayout(1280, 720)
  assert.equal(l.w, PORTRAIT_W, 'fits the full portrait width')
  assert.equal(l.h, Math.round((720 * PORTRAIT_W) / 1280))
  assert.equal(l.x, 0)
  assert.ok(l.y > 170, 'enough band above for the wordmark')
  assert.ok(PORTRAIT_H - (l.y + l.h) > 170, 'enough band below for the hashtag')
})

ok('portraitLayout of an already-portrait source fills the frame', () => {
  const l = portraitLayout(720, 1280)
  assert.equal(l.w, PORTRAIT_W)
  assert.equal(l.h, PORTRAIT_H)
  assert.equal(l.x, 0)
  assert.equal(l.y, 0)
})

console.log('highlight picking')

/** A calm timeline with a livelier burst over [hotFrom, hotTo). */
function timeline(durationMs: number, hotFrom: number, hotTo: number): ActivitySample[] {
  const out: ActivitySample[] = []
  for (let t = 0; t < durationMs; t += 100) out.push({ t, a: t >= hotFrom && t < hotTo ? 1 : 0.1 })
  return out
}

ok('a recording at or under the target needs no cutting', () => {
  const samples = timeline(15_000, 0, 5_000)
  assert.deepEqual(pickHighlights(samples, 15_000), [])
  assert.deepEqual(pickHighlights([], 60_000), [])
})

ok('highlights land on the liveliest stretch and hit the target length', () => {
  // 60s match, all the action between 30s and 50s.
  const picked = pickHighlights(timeline(60_000, 30_000, 50_000), 60_000)
  assert.ok(picked.length > 0, 'something was picked')
  const total = picked.reduce((s, w) => s + (w.end - w.start), 0)
  assert.ok(total >= HIGHLIGHT_TARGET_MS, `covers the target (got ${total})`)
  // Everything chosen sits inside the hot stretch.
  for (const w of picked) {
    assert.ok(w.start >= 30_000 && w.end <= 50_000, `window ${w.start}-${w.end} is in the action`)
  }
})

ok('highlight windows come back in order, merged, never overlapping', () => {
  const picked = pickHighlights(timeline(90_000, 20_000, 45_000), 90_000)
  for (let i = 1; i < picked.length; i++) {
    assert.ok(picked[i].start > picked[i - 1].end, 'ordered and merged')
  }
  for (const w of picked) assert.ok(w.end > w.start, 'window has length')
})

ok('the ending window is the tail, and vanishes on short clips', () => {
  assert.deepEqual(endingWindow(60_000, 15_000), [{ start: 45_000, end: 60_000 }])
  assert.deepEqual(endingWindow(10_000, 15_000), [])
})

console.log('combo multiplier')

ok('tiers kick in at their thresholds and never regress', () => {
  assert.equal(comboMultiplier(0), 1)
  assert.equal(comboMultiplier(2_999), 1)
  assert.equal(comboMultiplier(3_000), 1.25)
  assert.equal(comboMultiplier(6_000), 1.5)
  assert.equal(comboMultiplier(10_000), 2)
  assert.equal(comboMultiplier(120_000), 2, 'caps at the top tier')
  // Monotonic: a longer streak never yields a smaller multiplier.
  let prev = 0
  for (const tier of COMBO_TIERS) {
    assert.ok(tier.mult > prev)
    prev = tier.mult
  }
})

console.log('camera mirror default')

ok('front/unknown cameras mirror, rear/external ones do not', () => {
  assert.equal(mirrorDefaultForLabel('Front Camera'), true)
  assert.equal(mirrorDefaultForLabel(''), true, 'unlabeled (pre-permission) → mirror')
  assert.equal(mirrorDefaultForLabel('camera2 0, facing back'), false)
  assert.equal(mirrorDefaultForLabel('Rear Camera'), false)
  assert.equal(mirrorDefaultForLabel('Câmera traseira'), false)
  assert.equal(mirrorDefaultForLabel('Задняя камера'), false)
  assert.equal(mirrorDefaultForLabel('USB-камера (тыл)'), false)
  assert.equal(mirrorDefaultForLabel('Logitech HD Webcam C270'), true)
})

console.log('game modes')

ok('rhythm: on-beat movement lands ONE hit per beat, off-beat only trickles', () => {
  const s = createModeState('rhythm', () => 0.5)
  const input = (elapsedMs: number, speed: number) => ({
    dt: 0.03,
    elapsedMs,
    speeds: [speed, 0] as [number, number],
    rate: 6.5,
  })
  // Right on beat 1, fast → full hit payout.
  const onBeat = modeTick(s, input(RHYTHM_PERIOD_MS, 0.9))
  assert.ok(onBeat.events.hit?.[0], 'hit registered')
  assert.ok(onBeat.fill[0] > 3, 'hit pays roughly a beat worth of fill')
  // Same window again → no double dip.
  const again = modeTick(s, input(RHYTHM_PERIOD_MS + 40, 0.9))
  assert.equal(again.events.hit, undefined)
  assert.ok(again.fill[0] < 0.1, 'only the trickle remains')
  // Between beats, fast → trickle only.
  const off = modeTick(s, input(RHYTHM_PERIOD_MS * 1.5, 0.9))
  assert.equal(off.events.hit, undefined)
  assert.ok(off.fill[0] < 0.1)
  // The window opens EARLY (just before beat 2) too.
  const early = modeTick(s, input(RHYTHM_PERIOD_MS * 2 - RHYTHM_WINDOW_MS + 10, 0.9))
  assert.ok(early.events.hit?.[0], 'early hit inside the pre-beat window counts')
})

ok('endurance: pace is capped — sprinting earns no more than a steady pace', () => {
  const s = createModeState('endurance')
  // Two players moving well above the pace cap fill at the SAME rate: intensity
  // beyond the cap gives no edge (unlike classic, where fill scales with speed).
  const t = modeTick(s, { dt: 0.1, elapsedMs: 1000, speeds: [1.0, 2.5], rate: 6.5 })
  assert.equal(t.fill[0], t.fill[1], 'capped fill ignores extra speed')
  // A player below the cap still fills less than one at/above it.
  const t2 = modeTick(createModeState('endurance'), {
    dt: 0.1,
    elapsedMs: 1000,
    speeds: [0.6, 1.0],
    rate: 6.5,
  })
  assert.ok(t2.fill[0] < t2.fill[1], 'sub-cap pace fills slower')
})

ok('endurance: grace absorbs short dips, then the bar burns', () => {
  const s = createModeState('endurance')
  const tick = (elapsedMs: number, speed: number) =>
    modeTick(s, { dt: 0.1, elapsedMs, speeds: [speed, 0.8], rate: 6.5 })
  const moving = tick(1000, 0.8)
  assert.ok(moving.fill[0] > 0 && moving.burn[0] === 0)
  // 0.5 s below pace — inside the grace, no burn yet.
  for (let t = 0; t < 5; t++) assert.equal(tick(2000 + t * 100, 0.1).burn[0], 0)
  // Past the grace → burning.
  for (let t = 0; t < 5; t++) tick(2600 + t * 100, 0.1)
  assert.ok(tick(3200, 0.1).burn[0] > 0, 'burn after grace expires')
  assert.ok(s.dipMs[0] > ENDURANCE_GRACE_MS)
  // Player 1 never dipped.
  assert.equal(s.dipMs[1], 0)
})

ok('traffic: deterministic light schedule, red burns movement', () => {
  // rng()=0 → green lasts exactly TRAFFIC_GREEN_MIN_MS, red exactly TRAFFIC_RED_MIN_MS.
  const s = createModeState('traffic', () => 0)
  const tick = (elapsedMs: number) =>
    modeTick(s, { dt: 0.03, elapsedMs, speeds: [0.8, 0.8], rate: 6.5 }, () => 0)
  const green = tick(1000)
  assert.ok(green.fill[0] > 0 && green.burn[0] === 0, 'green fills')
  const flip = tick(TRAFFIC_GREEN_MIN_MS + 1)
  assert.equal(flip.events.trafficSwitch, 'red')
  assert.ok(flip.burn[0] > 0 && flip.fill[0] === 0, 'moving on red burns')
  const back = tick(TRAFFIC_GREEN_MIN_MS + TRAFFIC_RED_MIN_MS + 1)
  assert.equal(back.events.trafficSwitch, 'green')
})

ok('traffic: pause-speed factor scales both phase durations, and defaults to unscaled', () => {
  // No factor argument at all — existing callers/tests must see identical
  // timing to before this setting existed.
  const unscaled = createModeState('traffic', () => 0)
  assert.equal(unscaled.switchAtMs, TRAFFIC_GREEN_MIN_MS)

  // Explicit factor 1 (PAUSE_SPEED_FACTOR.normal) must match the default.
  const normal = createModeState('traffic', () => 0, PAUSE_SPEED_FACTOR.normal)
  assert.equal(normal.switchAtMs, TRAFFIC_GREEN_MIN_MS)

  // Slow (>1) stretches both the green and the following red window.
  const slow = createModeState('traffic', () => 0, PAUSE_SPEED_FACTOR.slow)
  assert.equal(slow.switchAtMs, TRAFFIC_GREEN_MIN_MS * PAUSE_SPEED_FACTOR.slow)
  const slowTick = (elapsedMs: number) =>
    modeTick(slow, { dt: 0.03, elapsedMs, speeds: [0.8, 0.8], rate: 6.5 }, () => 0)
  const slowFlipAt = TRAFFIC_GREEN_MIN_MS * PAUSE_SPEED_FACTOR.slow + 1
  const slowFlip = slowTick(slowFlipAt)
  assert.equal(slowFlip.events.trafficSwitch, 'red')
  assert.equal(slow.switchAtMs, slowFlipAt + TRAFFIC_RED_MIN_MS * PAUSE_SPEED_FACTOR.slow)

  // Fast (<1) compresses both windows the same way.
  const fast = createModeState('traffic', () => 0, PAUSE_SPEED_FACTOR.fast)
  assert.equal(fast.switchAtMs, TRAFFIC_GREEN_MIN_MS * PAUSE_SPEED_FACTOR.fast)
  assert.ok(fast.switchAtMs < unscaled.switchAtMs, 'fast switches sooner than normal')
  assert.ok(slow.switchAtMs > unscaled.switchAtMs, 'slow switches later than normal')
})

ok('boss: attacks land on schedule and grow; charge maps 0→100', () => {
  const s = createModeState('boss')
  const tick = (elapsedMs: number) =>
    modeTick(s, { dt: 0.03, elapsedMs, speeds: [0.5, 0.5], rate: 6.5 })
  assert.ok(tick(1000).events.bossAttack === undefined)
  const first = tick(BOSS_ATTACK_EVERY_MS + 1)
  assert.equal(first.events.bossAttack, BOSS_ATTACK_DAMAGE_START)
  const second = tick(BOSS_ATTACK_EVERY_MS * 2 + 1)
  assert.equal(second.events.bossAttack, BOSS_ATTACK_DAMAGE_START + BOSS_ATTACK_DAMAGE_GROWTH)
  assert.ok(bossCharge(s, BOSS_ATTACK_EVERY_MS * 2 + 1) < 5, 'charge resets after an attack')
  assert.ok(bossCharge(s, BOSS_ATTACK_EVERY_MS * 3) > 95, 'charge full right before the next')
  // Team fill combines both players.
  const fill = tick(BOSS_ATTACK_EVERY_MS * 2 + 500)
  assert.ok(fill.fill[0] > 0 && fill.fill[1] === 0)
})

ok('absoluteRad/specDeg: midline-relative degrees convert correctly at the 0/90/180 reference points', () => {
  // deg 0 -> straight down for both sides (y-down image space: angle = +π/2).
  assert.ok(Math.abs(absoluteRad(0, 1) - Math.PI / 2) < 1e-9, 'left, deg 0, straight down')
  assert.ok(Math.abs(absoluteRad(0, -1) - Math.PI / 2) < 1e-9, 'right, deg 0, straight down')
  // deg 90 -> +x for left (angle 0), -x for right (angle ±π).
  assert.ok(Math.abs(absoluteRad(90, 1)) < 1e-9, 'left, deg 90, +x')
  assert.ok(Math.abs(Math.abs(absoluteRad(90, -1)) - Math.PI) < 1e-9, 'right, deg 90, -x')
  // deg 180 -> straight up for both sides (angle -π/2).
  assert.ok(Math.abs(absoluteRad(180, 1) + Math.PI / 2) < 1e-9, 'left, deg 180, straight up')
  assert.ok(Math.abs(absoluteRad(180, -1) + Math.PI / 2) < 1e-9, 'right, deg 180, straight up')
  // specDeg is the true inverse of absoluteRad across both sides, away from the ±180° seam.
  for (const side of [1, -1] as const) {
    for (const deg of [0, 45, 90, 135, 179, -60]) {
      const roundTrip = specDeg(absoluteRad(deg, side), side)
      assert.ok(Math.abs(roundTrip - deg) < 1e-6, `round-trip ${deg}° side ${side} -> ${roundTrip}`)
    }
  }
})

ok('poseSimilarity: exact copy scores ~1, a wrong pose scores 0, confidence gates scoring', () => {
  const confident = { left: 1, right: 1 }
  const target = poseTargetFor('t_pose') // arms out to the sides
  const exact: ArmPose = { left: { ...target.arms[0] }, right: { ...target.arms[1] } }
  assert.ok(poseSimilarity(exact, confident, 't_pose', 32) > 0.99, 'a dead-on copy maxes out')

  const down = poseTargetFor('arms_down')
  const wrong: ArmPose = { left: { ...down.arms[0] }, right: { ...down.arms[1] } }
  assert.equal(poseSimilarity(wrong, confident, 't_pose', 32), 0, 'a wrong pose earns nothing')
  assert.equal(poseSimilarity(null, confident, 't_pose', 32), 0, 'no tracking → 0')

  // POSE_SCORE_MIN_SCORE is a stricter, separate gate from the 0.3 existence gate baked into `exact`/`wrong`.
  assert.equal(poseSimilarity(exact, null, 't_pose', 32), 0, 'no confidence data → 0 even for a perfect angle match')
  const lowConfidence = { left: POSE_SCORE_MIN_SCORE - 0.1, right: POSE_SCORE_MIN_SCORE - 0.1 }
  assert.equal(poseSimilarity(exact, lowConfidence, 't_pose', 32), 0, 'confidence below the pose-scoring gate → 0')
})

ok('poseSimilarity: Tier 2 poses match either arm (side-agnostic by design)', () => {
  const confident = { left: 1, right: 1 }
  const target = poseTargetFor('one_arm_up') // authored: left arm up, right arm down
  // A performer who raises their RIGHT arm instead should score just as well —
  // poseSimilarity tries both pairings and keeps the better one. Swapping which
  // spec values go on which side needs re-converting through absoluteRad (side-
  // dependent), not just swapping the two absolute Limb values between slots.
  const limbAt = (upper: number, fore: number, side: 1 | -1): Limb => ({
    upper: absoluteRad(upper, side),
    fore: absoluteRad(fore, side),
  })
  const mirrored: ArmPose = { left: limbAt(0, 0, 1), right: limbAt(170, 170, -1) }
  assert.ok(poseSimilarity(mirrored, confident, 'one_arm_up', 32) > 0.99, 'raising the other arm still counts')
  // A single visible arm that matches one target arm still gets full single credit.
  const oneArm: ArmPose = { left: { ...target.arms[0] }, right: null }
  assert.ok(poseSimilarity(oneArm, confident, 'one_arm_up', 32) > 0.99, 'an occluded arm never zeroes an honest try')
})

ok('poseArmScores: per-arm breakdown for the live skeleton colors', () => {
  const confident = { left: 1, right: 1 }
  const target = poseTargetFor('t_pose')
  const exact: ArmPose = { left: { ...target.arms[0] }, right: { ...target.arms[1] } }

  const bothGood = poseArmScores(exact, confident, 't_pose', 32)
  assert.ok((bothGood.left ?? 0) > 0.99, 'a correctly held left arm scores high (green)')
  assert.ok((bothGood.right ?? 0) > 0.99, 'a correctly held right arm scores high (green)')

  const down = poseTargetFor('arms_down')
  const bothWrong: ArmPose = { left: { ...down.arms[0] }, right: { ...down.arms[1] } }
  const wrongScores = poseArmScores(bothWrong, confident, 't_pose', 32)
  assert.equal(wrongScores.left, 0, 'a wrong left arm scores 0 (red)')
  assert.equal(wrongScores.right, 0, 'a wrong right arm scores 0 (red)')

  // One confident arm, one below the pose-scoring gate — the low-confidence
  // arm reads as "can't tell" (null/grey), never as red, even though its
  // Limb exists (cleared the looser 0.3 existence gate). This is the whole
  // point of poseArmScores existing separately from poseSimilarity, which
  // only gates confidence once, globally, for the pass/fail decision.
  const mixedConfidence = { left: 1, right: POSE_SCORE_MIN_SCORE - 0.1 }
  const mixed = poseArmScores(exact, mixedConfidence, 't_pose', 32)
  assert.ok((mixed.left ?? 0) > 0.99, 'the confident arm still scores normally')
  assert.equal(mixed.right, null, 'the low-confidence arm is null (grey), not scored as wrong')

  // A relation failure (reach_up needs wrists together) fails BOTH arms, even
  // though the LEFT arm's angles alone are a perfect match: left reaches up
  // as required, right is deliberately sent all the way down instead, so the
  // wrists end up nowhere near each other.
  const reachTarget = poseTargetFor('reach_up')
  const wristsApart: ArmPose = {
    left: { ...reachTarget.arms[0] },
    right: { upper: absoluteRad(0, -1), fore: absoluteRad(0, -1) },
  }
  const relationBroken = poseArmScores(wristsApart, confident, 'reach_up', 32)
  assert.equal(relationBroken.left, 0, 'a broken relation fails the left arm too, even though ITS angles are perfect')
  assert.equal(relationBroken.right, 0, 'a broken relation fails the arm that actually moved')

  assert.deepEqual(poseArmScores(null, confident, 't_pose', 32), { left: null, right: null }, 'no tracking → both null')
})

ok('pose library: every pair is separated by >=35° on some spec angle under the matcher\'s pairing, except the one documented exception', () => {
  const specDelta = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 360
    return d > 180 ? 360 - d : d
  }
  // The smaller of the two pairings poseSimilarity could pick — if THIS is still
  // >=35° apart, no pairing can confuse the two poses.
  const pairSpread = (aId: (typeof POSE_IDS)[number], bId: (typeof POSE_IDS)[number]): number => {
    const a = POSE_DEFINITIONS[aId]
    const b = POSE_DEFINITIONS[bId]
    const straight = Math.max(
      specDelta(a.left.upper, b.left.upper),
      specDelta(a.left.fore, b.left.fore),
      specDelta(a.right.upper, b.right.upper),
      specDelta(a.right.fore, b.right.fore),
    )
    const swapped = Math.max(
      specDelta(a.left.upper, b.right.upper),
      specDelta(a.left.fore, b.right.fore),
      specDelta(a.right.upper, b.left.upper),
      specDelta(a.right.fore, b.left.fore),
    )
    return Math.min(straight, swapped)
  }

  for (let i = 0; i < POSE_IDS.length; i++) {
    for (let j = i + 1; j < POSE_IDS.length; j++) {
      const a = POSE_IDS[i]
      const b = POSE_IDS[j]
      const spread = pairSpread(a, b)
      const isKnownException = (a === 'goalpost' && b === 'hands_on_head') || (a === 'hands_on_head' && b === 'goalpost')
      if (isKnownException) {
        assert.ok(spread < 35, 'goalpost vs hands_on_head is expected to be close on angles alone — rescued by wristsTogether')
      } else {
        assert.ok(spread >= 35, `${a} vs ${b} are only ${spread.toFixed(1)}° apart under any pairing — not separated`)
      }
    }
  }
})

// These two tests call the exact selector functions the running game calls
// (nextInfinitePoseId / nextPoseIndex) — not POSE_DEFINITIONS or POSE_LIBRARY
// directly. A pool that's correct in the data but never actually reached at
// runtime (a truncated slice, a stuck level, a selector that got swapped for
// an old one) would pass every test that imports the definitions directly
// while still shipping "nothing changed" — this is the failure mode that
// slipped through before, so it gets its own dedicated coverage.
ok('nextInfinitePoseId (the real Infinite Pose selector) reaches every pose, tier-gated by level', () => {
  const rng = mulberry32(12345)
  const tier1Ids = POSE_IDS.filter((id) => POSE_DEFINITIONS[id].tier === 1)

  // Below the unlock level, only Tier 1 ids may ever appear.
  const belowUnlock = new Set<PoseId>()
  let prev: PoseId | null = null
  for (let i = 0; i < 500; i++) {
    prev = nextInfinitePoseId(prev, 1, rng)
    belowUnlock.add(prev)
  }
  for (const id of belowUnlock) {
    assert.equal(POSE_DEFINITIONS[id].tier, 1, `${id} is Tier 2 but appeared before level ${POSE_TIER2_UNLOCK_LEVEL}`)
  }
  assert.equal(belowUnlock.size, tier1Ids.length, 'every Tier 1 pose is reachable before the unlock level')

  // At/above the unlock level, every one of the 13 poses must eventually turn up.
  const seen = new Set<PoseId>()
  prev = null
  for (let i = 0; i < 3000; i++) {
    prev = nextInfinitePoseId(prev, POSE_TIER2_UNLOCK_LEVEL + 20, rng)
    seen.add(prev)
  }
  for (const id of POSE_IDS) {
    assert.ok(seen.has(id), `${id} was never selected by nextInfinitePoseId — the pool is truncated at runtime`)
  }
})

ok('nextPoseIndex (the real 2P duel selector) reaches every pose', () => {
  const rng = mulberry32(777)
  const seen = new Set<PoseId>()
  let idx = 0
  for (let i = 0; i < 3000; i++) {
    idx = nextPoseIndex(idx, rng)
    seen.add(POSE_IDS[idx])
  }
  assert.equal(seen.size, POSE_IDS.length, `the 2P duel only ever reached ${seen.size}/${POSE_IDS.length} poses`)
})

ok('pose mode: only a good, confident copy fills, and the target rotates on schedule', () => {
  const s = createModeState('pose', () => 0) // deterministic: starts on POSE_IDS[0] = arms_down
  const target = poseTargetFor(POSE_IDS[0])
  const goodArms: [ArmPose, ArmPose] = [
    { left: { ...target.arms[0] }, right: { ...target.arms[1] } },
    { left: { upper: 0, fore: 0 }, right: { upper: 0, fore: 0 } }, // angle-identical, but see below: no confidence
  ]
  const poseConfidence: [{ left: number; right: number }, { left: number; right: number }] = [
    { left: 1, right: 1 },
    { left: 0, right: 0 },
  ]
  const early = modeTick(s, {
    dt: 0.1,
    elapsedMs: 100,
    speeds: [0, 0],
    rate: 6.5,
    poses: goodArms,
    poseConfidence,
  })
  assert.equal(early.pose?.index, 0, 'shows the first pose')
  assert.ok(early.fill[0] > 0, 'the confident, matching player fills')
  assert.equal(early.fill[1], 0, 'no confidence data — earns nothing despite matching angles')
  assert.ok((early.pose?.match[0] ?? 0) > 0.99, 'player 1 is a dead-on copy')
  assert.equal(early.pose?.match[1] ?? -1, 0, 'player 2 has no confidence data — scored 0, not a false match')
  // Past the period the target flips to a different pose with a change event.
  const flip = modeTick(s, {
    dt: 0.1,
    elapsedMs: POSE_PERIOD_MS + 1,
    speeds: [0, 0],
    rate: 6.5,
    poses: goodArms,
    poseConfidence,
  })
  assert.ok(flip.events.poseChange, 'a new pose is announced')
  assert.notEqual(flip.pose?.index, 0, 'and it is a different pose')
})

ok('overtime tie detection honors the epsilon', () => {
  assert.equal(isOvertimeTie(70, 70), true)
  assert.equal(isOvertimeTie(70, 71.4), true)
  assert.equal(isOvertimeTie(70, 71.6), false)
})

console.log('runner gestures')

const NEUTRAL: Neutral = { centerX: 640, hipY: 400, reach: 200, scale: 100 }
const mkSample = (over: Partial<PostureSample>): PostureSample => ({
  centerX: 640,
  hipY: 400,
  topY: 200,
  scale: 100,
  t: 0,
  ...over,
})

ok('averageNeutral means the samples; empty → null', () => {
  assert.equal(averageNeutral([]), null)
  const n = averageNeutral([
    mkSample({ centerX: 600, hipY: 390, topY: 190 }),
    mkSample({ centerX: 620, hipY: 410, topY: 210 }),
  ])
  assert.ok(n)
  assert.equal(n.centerX, 610)
  assert.equal(n.hipY, 400)
  assert.equal(n.reach, 200)
})

ok('lane: crosses on the enter threshold, holds through the hysteresis gap', () => {
  const s = createGestureState()
  assert.equal(detectGesture(s, mkSample({ t: 0 }), NEUTRAL, DEFAULT_GESTURE_CONFIG).lane, 0)
  // Step right past enter (0.6 × 100 = 60 px) → lane 1, a change event.
  const r1 = detectGesture(s, mkSample({ centerX: 720, t: 33 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.equal(r1.lane, 1)
  assert.ok(r1.laneChanged)
  // Drift back into the gap (offset 0.5, between exit 0.35 and enter 0.6) → holds.
  const r2 = detectGesture(s, mkSample({ centerX: 690, t: 66 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.equal(r2.lane, 1)
  assert.equal(r2.laneChanged, false)
  // Back near center (offset 0.2 < exit) → center again.
  const r3 = detectGesture(s, mkSample({ centerX: 660, t: 99 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.equal(r3.lane, 0)
  assert.ok(r3.laneChanged)
})

ok('crouch: fires when the body shortens top-to-hip past the ratio', () => {
  const s = createGestureState()
  const standing = detectGesture(s, mkSample({ t: 0 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.equal(standing.crouch, false)
  assert.ok(Math.abs(standing.reachRatio - 1) < 1e-9)
  // Head drops toward the hips: reach 140 / 200 = 0.7 < 0.78.
  const crouch = detectGesture(s, mkSample({ topY: 260, t: 33 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.ok(crouch.crouch)
  assert.ok(crouch.crouchAmount > 0)
})

ok('jump: a fast hip rise fires once (cooldown blocks repeats); a slow rise does not', () => {
  const s = createGestureState()
  detectGesture(s, mkSample({ hipY: 400, t: 0 }), NEUTRAL, DEFAULT_GESTURE_CONFIG) // seed prev
  const up = detectGesture(s, mkSample({ hipY: 340, t: 33 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.ok(up.jump, 'sharp upward hip motion = jump')
  const again = detectGesture(s, mkSample({ hipY: 280, t: 66 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.equal(again.jump, false, 'no second jump inside the cooldown')

  const slow = createGestureState()
  detectGesture(slow, mkSample({ hipY: 400, t: 0 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  const drift = detectGesture(slow, mkSample({ hipY: 397, t: 33 }), NEUTRAL, DEFAULT_GESTURE_CONFIG)
  assert.equal(drift.jump, false, 'gentle sway is not a jump')
})

ok('no jump on the very first frame (no previous sample)', () => {
  const s = createGestureState()
  assert.equal(detectGesture(s, mkSample({ hipY: 100 }), NEUTRAL, DEFAULT_GESTURE_CONFIG).jump, false)
})

console.log('runner game')

// Place an entity right before the player plane and disable spawns, so one step
// pushes it across and resolves exactly that collision.
const atPlayer = (type: ObstacleType, lane: -1 | 0 | 1): Entity => ({
  id: 1,
  lane,
  z: PLAYER_Z - 0.01,
  type,
  resolved: false,
})
const runInput = (over: Partial<RunnerInput>): RunnerInput => ({
  dt: 0.1,
  lane: 0,
  airborne: false,
  crouching: false,
  nowMs: 10_000,
  ...over,
})

ok('coin in the player lane is collected; a miss costs nothing', () => {
  const s = createRunnerState(() => 0)
  s.spawnCooldownMs = 1e9
  s.entities = [atPlayer('coin', 0)]
  const ev = stepRunner(s, runInput({ lane: 0 }))
  assert.ok(ev.coin)
  assert.equal(s.coins, 1)
  assert.equal(s.lives, 3)

  const s2 = createRunnerState(() => 0)
  s2.spawnCooldownMs = 1e9
  s2.entities = [atPlayer('coin', 1)]
  stepRunner(s2, runInput({ lane: 0 }))
  assert.equal(s2.coins, 0, 'coin in another lane is simply missed')
})

ok('jump barrier: airborne clears it, grounded takes a hit', () => {
  const air = createRunnerState(() => 0)
  air.spawnCooldownMs = 1e9
  air.entities = [atPlayer('jump', 0)]
  const ev = stepRunner(air, runInput({ lane: 0, airborne: true }))
  assert.ok(ev.dodge)
  assert.equal(air.lives, 3)

  const grounded = createRunnerState(() => 0)
  grounded.spawnCooldownMs = 1e9
  grounded.entities = [atPlayer('jump', 0)]
  const ev2 = stepRunner(grounded, runInput({ lane: 0, airborne: false }))
  assert.ok(ev2.hit)
  assert.equal(grounded.lives, 2)
})

ok('solid block hits even if airborne — only a lane change is safe', () => {
  const s = createRunnerState(() => 0)
  s.spawnCooldownMs = 1e9
  s.entities = [atPlayer('block', 0)]
  assert.ok(stepRunner(s, runInput({ lane: 0, airborne: true, crouching: true })).hit)
  assert.equal(s.lives, 2)

  const dodged = createRunnerState(() => 0)
  dodged.spawnCooldownMs = 1e9
  dodged.entities = [atPlayer('block', 0)]
  assert.equal(stepRunner(dodged, runInput({ lane: 1 })).hit, false, 'a different lane is safe')
  assert.equal(dodged.lives, 3)
})

ok('losing the last life ends the run', () => {
  const s = createRunnerState(() => 0)
  s.spawnCooldownMs = 1e9
  s.lives = 1
  s.entities = [atPlayer('block', 0)]
  const ev = stepRunner(s, runInput({ lane: 0 }))
  assert.ok(ev.gameOver)
  assert.ok(s.over)
  assert.equal(s.lives, 0)
})

ok('mercy window absorbs a second hit right after the first', () => {
  const s = createRunnerState(() => 0)
  s.spawnCooldownMs = 1e9
  s.invincibleUntil = 10_500 // still invincible at nowMs 10_000
  s.entities = [atPlayer('jump', 0)]
  const ev = stepRunner(s, runInput({ lane: 0, nowMs: 10_000 }))
  assert.equal(ev.hit, false)
  assert.equal(s.lives, 3)
})

ok('spawns fire after the cooldown; score floors distance + coin bonus', () => {
  const s = createRunnerState(() => 0) // rng 0 → lane -1, type coin
  const before = s.entities.length
  stepRunner(s, runInput({ dt: 0.8 })) // 800ms > 700ms initial cooldown
  assert.equal(s.entities.length, before + 1)
  assert.equal(s.entities[0].type, 'coin')
  assert.equal(s.entities[0].lane, -1)

  const scored = createRunnerState(() => 0)
  scored.distance = 123.9
  scored.coins = 2
  assert.equal(runnerScore(scored), Math.floor(123.9 + 2 * 5))
})

console.log('online determinism')

ok('mulberry32 is deterministic, seed-sensitive, and stays in [0,1)', () => {
  const draw = (seed: number, n: number) => {
    const rng = mulberry32(seed)
    return Array.from({ length: n }, () => rng())
  }
  const a = draw(42, 8)
  assert.deepEqual(a, draw(42, 8), 'same seed → identical sequence')
  assert.notDeepEqual(a, draw(43, 8), 'a different seed diverges')
  for (const v of a) assert.ok(v >= 0 && v < 1, 'each value is a unit float')
})

ok('spawn stream ignores entity z — two phones on one seed match despite frame skew', () => {
  // Both "phones" share the seed and the dt cadence; only phone B's world is
  // nudged in z each frame (as a different frame rate would). The obstacle
  // sequence must stay identical — spawning must never peek at positions.
  const dt = 0.05
  const runA = createRunnerState(mulberry32(0xc0ffee))
  const runB = createRunnerState(mulberry32(0xc0ffee))
  // Endless lives: B's nudged obstacles would otherwise cause more collisions
  // and an earlier game over, which is a gameplay confound, not a spawn one.
  runA.lives = Infinity
  runB.lives = Infinity
  const seqA: string[] = []
  const seqB: string[] = []
  const record = (before: number, run: typeof runA, into: string[]) => {
    if (run.entities.length > before) {
      const e = run.entities[run.entities.length - 1]
      into.push(`${e.lane}:${e.type}`)
    }
  }
  let now = 0
  for (let i = 0; i < 500; i++) {
    now += dt * 1000
    const step = { dt, lane: 0 as const, airborne: false, crouching: false, nowMs: now }
    const beforeA = runA.entities.length
    stepRunner(runA, step)
    record(beforeA, runA, seqA)

    const beforeB = runB.entities.length
    stepRunner(runB, step)
    record(beforeB, runB, seqB)
    for (const e of runB.entities) e.z += 0.017 // perturb B's world only
  }
  assert.ok(seqA.length > 8, 'several obstacles spawned over the run')
  assert.deepEqual(seqA, seqB, 'identical obstacle sequence despite different z')
})

await okAsync('packSignal/unpackSignal round-trips offers and answers; junk is rejected', async () => {
  for (const kind of ['offer', 'answer'] as const) {
    const payload = {
      kind,
      sdp: { type: kind, sdp: `v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n` },
    }
    const code = await packSignal(payload)
    assert.ok(code.startsWith('g.') || code.startsWith('r.'), 'code carries its encoding prefix')
    const back = await unpackSignal(code)
    assert.equal(back.kind, kind)
    assert.deepEqual(back.sdp, payload.sdp, 'the SDP survives the round-trip byte-for-byte')
  }
  await assert.rejects(() => unpackSignal('definitely-not-a-connection-code'))
})

console.log('player identity (2p/3p/4p sticky tracking)')

const MOVENET_KEYPOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const

/** A fabricated MoveNet-shaped Pose (real keypoint names, all confident) for a body centered at (cx, cy) — shoulder-to-shoulder width ≈ `scale` px. */
function fakePose(cx: number, cy: number, scale = 60): Pose {
  const half = scale / 2
  const positions: Record<string, [number, number]> = {
    nose: [cx, cy - scale * 1.2],
    left_eye: [cx + 6, cy - scale * 1.25],
    right_eye: [cx - 6, cy - scale * 1.25],
    left_ear: [cx + 12, cy - scale * 1.2],
    right_ear: [cx - 12, cy - scale * 1.2],
    left_shoulder: [cx + half, cy - scale * 0.7],
    right_shoulder: [cx - half, cy - scale * 0.7],
    left_elbow: [cx + half, cy - scale * 0.3],
    right_elbow: [cx - half, cy - scale * 0.3],
    left_wrist: [cx + half, cy],
    right_wrist: [cx - half, cy],
    left_hip: [cx + half * 0.8, cy + scale * 0.1],
    right_hip: [cx - half * 0.8, cy + scale * 0.1],
    left_knee: [cx + half * 0.8, cy + scale * 0.6],
    right_knee: [cx - half * 0.8, cy + scale * 0.6],
    left_ankle: [cx + half * 0.8, cy + scale * 1.1],
    right_ankle: [cx - half * 0.8, cy + scale * 1.1],
  }
  const keypoints = MOVENET_KEYPOINT_NAMES.map((name) => {
    const [x, y] = positions[name]
    return { x, y, score: 0.9, name }
  })
  return { score: 0.9, keypoints }
}

/** poses -> real Candidate[] via the actual selectFighters the engine calls, not a hand-built Candidate. */
function fakeCandidates(bodies: Array<{ x: number; y: number; scale?: number }>): Candidate[] {
  const poses = bodies.map((b) => fakePose(b.x, b.y, b.scale ?? 60))
  return selectFighters(poses, bodies.length)
}

function emptyRoster(): RosterAnchor {
  return { bbox: null, lastBBox: null, lastSeenAtMs: -Infinity, sig: null, torso: null, lastTorso: null, boundSize: null }
}

/** Mimics what PlayerTracker.observe() records, for the one slot fields matchLockedRolesN actually reads. */
function bindSlot(slot: RosterAnchor, cand: Candidate, nowMs: number, lockSize = false): void {
  const t = torsoAnchor(cand.pose, cand.bbox)
  if (!t) throw new Error('test fixture: candidate has no usable torso')
  slot.bbox = cand.bbox
  slot.lastBBox = cand.bbox
  slot.torso = { x: t.x, y: t.y }
  slot.lastTorso = slot.torso
  slot.lastSeenAtMs = nowMs
  if (lockSize) slot.boundSize = t.size
}

/** Drive N frames of matchLockedRolesN — the actual function cv/engine.ts calls once roles lock — updating slots exactly like the engine would between calls. Returns the LAST frame's result. */
function runFrames(
  slots: RosterAnchor[],
  frames: Candidate[][],
  videoWidth: number,
  mirror: boolean,
  strictSideLock = false,
): (Candidate | null)[] {
  let last: (Candidate | null)[] = []
  let t = 0
  for (const cands of frames) {
    t += 33 // ~30fps
    last = matchLockedRolesN(slots, cands, t, videoWidth, mirror, strictSideLock)
    last.forEach((c, i) => {
      if (c) bindSlot(slots[i], c, t)
    })
  }
  return last
}

ok('identity: two players who cross over keep their original slot (colour), not their side', () => {
  const left0 = emptyRoster()
  const right0 = emptyRoster()
  const initial = fakeCandidates([
    { x: 100, y: 300 },
    { x: 700, y: 300 },
  ])
  bindSlot(left0, initial[0], 0, true) // slot 0 bound to the body starting on the left
  bindSlot(right0, initial[1], 0, true) // slot 1 bound to the body starting on the right
  const slots = [left0, right0]

  // Walk them past each other over many small steps — real motion, not a
  // teleport — left body's x rises from 100 to 700, right body's falls from
  // 700 to 100.
  const frames: Candidate[][] = []
  const steps = 20
  for (let i = 1; i <= steps; i++) {
    const leftX = 100 + ((700 - 100) * i) / steps
    const rightX = 700 - ((700 - 100) * i) / steps
    frames.push(fakeCandidates([{ x: leftX, y: 300 }, { x: rightX, y: 300 }]))
  }
  const result = runFrames(slots, frames, VW, true)

  assert.ok(result[0] !== null && result[1] !== null, 'both slots still bound after crossing')
  // Slot 0 (originally the left body) must have followed that BODY, so it is
  // now on the right of the screen — not "whichever body is currently on
  // the left", which is what a purely-positional assignment would return.
  const slot0X = torsoAnchor(result[0]!.pose, result[0]!.bbox)!.x
  const slot1X = torsoAnchor(result[1]!.pose, result[1]!.bbox)!.x
  assert.ok(slot0X > 600, 'slot 0 (originally left) followed its body to the right')
  assert.ok(slot1X < 200, 'slot 1 (originally right) followed its body to the left')
})

ok('identity: a smaller background bystander never claims a slot', () => {
  const s0 = emptyRoster()
  const s1 = emptyRoster()
  const initial = fakeCandidates([
    { x: 200, y: 300, scale: 60 },
    { x: 600, y: 300, scale: 60 },
  ])
  bindSlot(s0, initial[0], 0, true)
  bindSlot(s1, initial[1], 0, true)
  const slots = [s0, s1]

  // A bystander appears between them, clearly smaller (further away) than
  // the 60px reference the roster locked at round start.
  const bystanderScale = 30 // 50% of 60 — below the 60% floor
  const frame = fakeCandidates([
    { x: 200, y: 300, scale: 60 },
    { x: 400, y: 300, scale: bystanderScale },
    { x: 600, y: 300, scale: 60 },
  ])
  const result = matchLockedRolesN(slots, frame, 1000, VW, true)
  assert.ok(result[0] !== null && result[1] !== null, 'both real players still matched')
  for (const r of result) {
    const size = torsoAnchor(r!.pose, r!.bbox)!.size
    assert.ok(size > 45, `slot bound to a real player (size ${size.toFixed(1)}), not the ${bystanderScale}px bystander`)
  }
})

ok('identity: a player who briefly disappears regains the same slot', () => {
  const s0 = emptyRoster()
  const s1 = emptyRoster()
  const initial = fakeCandidates([
    { x: 200, y: 300 },
    { x: 600, y: 300 },
  ])
  bindSlot(s0, initial[0], 0, true)
  bindSlot(s1, initial[1], 0, true)
  const slots = [s0, s1]

  // Player 2 vanishes for a couple of frames (dropped detection).
  const gone = matchLockedRolesN(slots, fakeCandidates([{ x: 205, y: 300 }]), 100, VW, true)
  assert.ok(gone[0] !== null, 'player 1 keeps tracking through the gap')
  assert.equal(gone[1], null, 'player 2 reads absent, not reassigned to someone else')
  gone.forEach((c, i) => {
    if (c) bindSlot(slots[i], c, 100)
  })

  // Player 2 reappears nearby, well within the rebind hold window.
  assert.ok(IDENTITY_REBIND_HOLD_MS >= 500, 'hold window is long enough for this fixture to be meaningful')
  const back = matchLockedRolesN(
    slots,
    fakeCandidates([
      { x: 210, y: 300 },
      { x: 610, y: 300 },
    ]),
    100 + IDENTITY_REBIND_HOLD_MS - 100,
    VW,
    true,
  )
  assert.ok(back[1] !== null, 'player 2 is rebound')
  const x = torsoAnchor(back[1]!.pose, back[1]!.bbox)!.x
  assert.ok(x > 500, 'rebound to slot 1 (their own slot), not slot 0')
})

ok('identity: two bound slots are never swapped with each other in one frame', () => {
  // Pure position can't construct a genuine swap for 2 fixed anchors: with a
  // symmetric distance metric, "both slots prefer the OTHER's candidate"
  // never happens from position alone (the nearer candidate is always
  // nearer, full stop) — that's WHY nearest-neighbour matching is swap-
  // resistant by construction. The real trigger is the colour-signature
  // term tipping an otherwise-close positional call: two candidates
  // sitting between two close-together anchors, wearing each OTHER's
  // remembered clothing colour.
  const s0 = emptyRoster()
  const s1 = emptyRoster()
  s0.torso = { x: 100, y: 300 }
  s0.lastTorso = s0.torso
  s0.lastSeenAtMs = 0
  s0.boundSize = 60
  s0.sig = [1, 0]
  s1.torso = { x: 300, y: 300 }
  s1.lastTorso = s1.torso
  s1.lastSeenAtMs = 0
  s1.boundSize = 60
  s1.sig = [0, 1]
  const slots = [s0, s1]

  const [candP, candQ] = fakeCandidates([
    { x: 190, y: 300 }, // slightly closer to slot 0's anchor (100) than slot 1's (300)
    { x: 210, y: 300 }, // slightly closer to slot 1's anchor (300) than slot 0's (100)
  ])
  // Colours crossed: P (near slot 0) is wearing slot 1's colour and vice
  // versa — strong enough evidence for the cost function to prefer the
  // cross pairing over the barely-better positional match.
  candP.sig = [0, 1]
  candQ.sig = [1, 0]

  const result = matchLockedRolesN(slots, [candP, candQ], 33, VW, true)
  assert.equal(result[0], null, 'slot 0 rejects the swap rather than confidently binding the wrong body')
  assert.equal(result[1], null, 'slot 1 rejects the swap rather than confidently binding the wrong body')
})

ok('identity: crossing is preserved identically with mirror on and off', () => {
  for (const mirror of [true, false]) {
    const s0 = emptyRoster()
    const s1 = emptyRoster()
    const initial = fakeCandidates([
      { x: 100, y: 300 },
      { x: 700, y: 300 },
    ])
    bindSlot(s0, initial[0], 0, true)
    bindSlot(s1, initial[1], 0, true)
    const slots = [s0, s1]
    const frames: Candidate[][] = []
    for (let i = 1; i <= 20; i++) {
      const leftX = 100 + ((700 - 100) * i) / 20
      const rightX = 700 - ((700 - 100) * i) / 20
      frames.push(fakeCandidates([{ x: leftX, y: 300 }, { x: rightX, y: 300 }]))
    }
    const result = runFrames(slots, frames, VW, mirror)
    const slot0X = torsoAnchor(result[0]!.pose, result[0]!.bbox)!.x
    // Raw camera-space matching (torso proximity) never reads config.mirror
    // at all — it's a display-only concern applied elsewhere — so the same
    // raw motion produces the same identity outcome either way.
    assert.ok(slot0X > 600, `slot 0 followed its body regardless of mirror=${mirror}`)
  }
})

for (const n of [2, 3, 4] as const) {
  ok(`identity: ${n}p crossing behaves the same as 2p`, () => {
    // n well-separated bodies; only the leftmost two (slot 0 and slot 1)
    // cross paths, exactly like the 2p test, while any other slots (3p/4p)
    // stay put at their own distinct spot — a realistic "two of the group
    // swap places" moment, not every body converging on the same point at
    // once (which is a much harder, separate collision scenario).
    const slots = Array.from({ length: n }, () => emptyRoster())
    const startX = Array.from({ length: n }, (_, i) => 120 + i * 220)
    const initial = fakeCandidates(startX.map((x) => ({ x, y: 300 })))
    initial.forEach((c, i) => bindSlot(slots[i], c, 0, true))

    const frames: Candidate[][] = []
    const steps = 20
    for (let i = 1; i <= steps; i++) {
      const xs = [...startX]
      xs[0] = startX[0] + ((startX[1] - startX[0]) * i) / steps
      xs[1] = startX[1] - ((startX[1] - startX[0]) * i) / steps
      frames.push(fakeCandidates(xs.map((x) => ({ x, y: 300 }))))
    }
    const result = runFrames(slots, frames, VW, true)
    result.forEach((c, i) => assert.ok(c !== null, `${n}p: slot ${i} still bound after the reshuffle`))
    const slot0X = torsoAnchor(result[0]!.pose, result[0]!.bbox)!.x
    const slot1X = torsoAnchor(result[1]!.pose, result[1]!.bbox)!.x
    assert.ok(slot0X > startX[1] - 30, `${n}p: slot 0 followed its own body across`)
    assert.ok(slot1X < startX[0] + 30, `${n}p: slot 1 followed its own body across`)
    for (let i = 2; i < n; i++) {
      const x = torsoAnchor(result[i]!.pose, result[i]!.bbox)!.x
      assert.ok(Math.abs(x - startX[i]) < 30, `${n}p: uninvolved slot ${i} stayed on its own body`)
    }
  })
}

ok('identity: strictSideLock rejects a body that crossed into another slot\'s zone', () => {
  const s0 = emptyRoster()
  const s1 = emptyRoster()
  const initial = fakeCandidates([
    { x: 150, y: 300 },
    { x: 650, y: 300 },
  ])
  bindSlot(s0, initial[0], 0, true)
  bindSlot(s1, initial[1], 0, true)
  const slots = [s0, s1]
  // With strictSideLock on, a body that fully crosses into the OTHER half of
  // the frame can never be matched to its original slot, by design.
  const result = matchLockedRolesN(
    slots,
    fakeCandidates([
      { x: 650, y: 300 },
      { x: 150, y: 300 },
    ]),
    33,
    VW,
    true,
    true, // strictSideLock
  )
  assert.equal(result[0], null, 'slot 0 (left zone) does not follow its body across the midline')
  assert.equal(result[1], null, 'slot 1 (right zone) does not follow its body across the midline')
})

ok('pickRoster: largest, non-overlapping bodies, left-to-right', () => {
  const bodies = fakeCandidates([
    { x: 400, y: 300, scale: 40 }, // smallest — a bystander
    { x: 600, y: 300, scale: 70 },
    { x: 200, y: 300, scale: 70 },
  ])
  const roster = pickRoster(bodies, 2, VW, false) // mirror=false: raw x already IS display left-to-right
  assert.equal(roster.length, 2, 'picks exactly the requested count')
  const xs = roster.map((c) => c.anchorX)
  assert.ok(xs[0] < xs[1], 'returned left-to-right')
  for (const c of roster) {
    const size = torsoAnchor(c.pose, c.bbox)!.size
    assert.ok(size > 50, 'never picks the smaller bystander over a real player')
  }
})

console.log(`\n${passed} checks passed`)
