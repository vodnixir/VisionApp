import type { ArmSpec } from '../modes'

interface Props {
  left: ArmSpec
  right: ArmSpec
  className?: string
}

const D = Math.PI / 180
const CX = 100
const HEAD_Y = 58
const HEAD_R = 18
const SHOULDER_Y = 100
const SHOULDER_HALF_W = 26
const HIP_Y = 155
const UPPER_LEN = 48
const FORE_LEN = 44

interface Vec2 {
  x: number
  y: number
}

/**
 * Same midline-relative angle convention as modes.ts's absoluteRad (0=down,
 * 90=outward, 180=up), rendered directly in SVG's y-down coordinate space —
 * no conversion needed. side +1/-1 matches PoseDefinition.left/right, so a
 * pose here lines up with the identical pose drawn by cv/draw.ts's
 * drawPoseTarget on the mirrored live HUD (anatomical left rendered on the
 * viewer's left, as it appears in a mirrored selfie view).
 */
function armPoints(shoulder: Vec2, arm: ArmSpec, side: 1 | -1): { elbow: Vec2; wrist: Vec2 } {
  const upperRad = arm.upper * D
  const foreRad = arm.fore * D
  const elbow: Vec2 = {
    x: shoulder.x + side * Math.sin(upperRad) * UPPER_LEN,
    y: shoulder.y + Math.cos(upperRad) * UPPER_LEN,
  }
  const wrist: Vec2 = {
    x: elbow.x + side * Math.sin(foreRad) * FORE_LEN,
    y: elbow.y + Math.cos(foreRad) * FORE_LEN,
  }
  return { elbow, wrist }
}

/** Static SVG stick figure for a pose's upper-body angles — preview-only illustration, generated from angles so a new pose needs zero assets. Live in-match rendering stays on cv/draw.ts's canvas renderer. */
export function PoseStickFigure({ left, right, className }: Props) {
  const lShoulder: Vec2 = { x: CX - SHOULDER_HALF_W, y: SHOULDER_Y }
  const rShoulder: Vec2 = { x: CX + SHOULDER_HALF_W, y: SHOULDER_Y }
  const l = armPoints(lShoulder, left, 1)
  const r = armPoints(rShoulder, right, -1)

  return (
    <svg
      viewBox="0 0 200 200"
      className={className ?? 'text-accent'}
      fill="none"
      stroke="currentColor"
      strokeWidth={10}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1={CX} y1={SHOULDER_Y - 4} x2={CX} y2={HIP_Y} />
      <line x1={lShoulder.x} y1={lShoulder.y} x2={rShoulder.x} y2={rShoulder.y} />
      <polyline points={`${lShoulder.x},${lShoulder.y} ${l.elbow.x},${l.elbow.y} ${l.wrist.x},${l.wrist.y}`} />
      <polyline points={`${rShoulder.x},${rShoulder.y} ${r.elbow.x},${r.elbow.y} ${r.wrist.x},${r.wrist.y}`} />
      <circle cx={l.wrist.x} cy={l.wrist.y} r={7} fill="currentColor" stroke="none" />
      <circle cx={r.wrist.x} cy={r.wrist.y} r={7} fill="currentColor" stroke="none" />
      <circle cx={CX} cy={HEAD_Y} r={HEAD_R} fill="currentColor" stroke="none" />
    </svg>
  )
}
