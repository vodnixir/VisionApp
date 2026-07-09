/**
 * Sanity tests for the pure CV math (run: npm run test:cv).
 * Covers the parts that a headless browser can't exercise: identity matching,
 * ROI geometry, motion-scoring fairness and the portrait clip layout.
 */
import assert from 'node:assert/strict'
import { PORTRAIT_H, PORTRAIT_W, coverCrop, portraitLayout } from '../src/recorder'
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

let passed = 0
function ok(name: string, fn: () => void): void {
  fn()
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

console.log(`\n${passed} checks passed`)
