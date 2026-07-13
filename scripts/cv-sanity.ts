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
  RHYTHM_PERIOD_MS,
  RHYTHM_WINDOW_MS,
  TRAFFIC_GREEN_MIN_MS,
  bossCharge,
  createModeState,
  modeTick,
} from '../src/modes'
import { PORTRAIT_H, PORTRAIT_W, coverCrop, portraitLayout } from '../src/recorder'
import {
  COMBO_TIERS,
  comboMultiplier,
  isOvertimeTie,
  mirrorDefaultForLabel,
} from '../src/types'
import {
  REBIND_WINDOW_MS,
  computeRoi,
  iou,
  matchLockedRoles,
  motionDelta,
  roiTouchesEdge,
  type BBox,
  type Candidate,
  type KpMap,
  type SlotAnchor,
} from '../src/cv/tracking'
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

function mkCand(x: number, y: number, w: number, h: number): Candidate {
  return {
    pose: { score: 1, keypoints: [] },
    bbox: { x, y, w, h },
    anchorX: x + w / 2,
  }
}

function slot(bbox: BBox | null, lastBBox: BBox | null = bbox, lastSeenAgoMs = 0): SlotAnchor {
  return { bbox, lastBBox, lastSeenAtMs: NOW - lastSeenAgoMs }
}

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
  const s = createModeState('traffic', () => 0) // greens = 3000ms, reds = 1800ms
  const tick = (elapsedMs: number) =>
    modeTick(s, { dt: 0.03, elapsedMs, speeds: [0.8, 0.8], rate: 6.5 }, () => 0)
  const green = tick(1000)
  assert.ok(green.fill[0] > 0 && green.burn[0] === 0, 'green fills')
  const flip = tick(TRAFFIC_GREEN_MIN_MS + 1)
  assert.equal(flip.events.trafficSwitch, 'red')
  assert.ok(flip.burn[0] > 0 && flip.fill[0] === 0, 'moving on red burns')
  const back = tick(TRAFFIC_GREEN_MIN_MS + 1801)
  assert.equal(back.events.trafficSwitch, 'green')
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

console.log(`\n${passed} checks passed`)
