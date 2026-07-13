/**
 * Metro-runner scene rendering — the transparent-canvas world for both the solo
 * runner (src/components/RunnerGameScreen.tsx) and the online battle
 * (src/components/OnlineBattleScreen.tsx). Kept apart from the simulation
 * (src/runner/game.ts) so the sim stays render-free and unit-testable, and apart
 * from any one screen so both modes draw an identical world.
 */
import { START_LIVES, runnerScore, type RunnerState } from './game'
import type { Lane } from './gestures'

/** The player's live control state, as the render needs it. */
export interface Control {
  lane: Lane
  airborne: boolean
  crouching: boolean
}

/** Perspective easing: things near the viewer move fast, far ones crawl. */
function scr(z: number): number {
  return z * 0.5 + z * z * 0.5
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  state: RunnerState,
  control: Control,
  flashing: boolean,
  now: number,
): void {
  const vx = w / 2
  const vy = h * 0.16
  const nearY = h * 0.9
  const nearSpread = w * 0.22 // half-distance between adjacent lane centers, near
  const nearHalf = w * 0.52 // half floor width, near
  const laneX = (lane: number, z: number) => vx + lane * nearSpread * scr(z)
  const yAt = (z: number) => vy + (nearY - vy) * scr(z)
  const sizeAt = (z: number) => w * 0.022 + w * 0.12 * scr(z)

  // Tunnel backdrop.
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#0a1120')
  bg.addColorStop(0.55, '#0f1b33')
  bg.addColorStop(1, '#0a0f1c')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Vanishing glow.
  const glow = ctx.createRadialGradient(vx, vy, 2, vx, vy, h * 0.5)
  glow.addColorStop(0, 'rgba(80,140,220,0.28)')
  glow.addColorStop(1, 'rgba(80,140,220,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // Floor trapezoid.
  ctx.beginPath()
  ctx.moveTo(vx, vy)
  ctx.lineTo(vx - nearHalf, nearY)
  ctx.lineTo(vx + nearHalf, nearY)
  ctx.closePath()
  const floor = ctx.createLinearGradient(0, vy, 0, nearY)
  floor.addColorStop(0, '#101d38')
  floor.addColorStop(1, '#1c2f57')
  ctx.fillStyle = floor
  ctx.fill()

  // Sleepers scrolling toward the viewer (motion).
  const scroll = (state.distance * 0.06) % 1
  ctx.strokeStyle = 'rgba(130,165,220,0.22)'
  ctx.lineWidth = 2
  for (let i = 0; i < 18; i++) {
    const z = ((i / 18 + scroll) % 1) * 0.999 + 0.001
    const y = yAt(z)
    const half = nearHalf * scr(z)
    ctx.globalAlpha = Math.min(1, scr(z) * 1.3)
    ctx.beginPath()
    ctx.moveTo(vx - half, y)
    ctx.lineTo(vx + half, y)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Lane rails (the three lanes = the gaps between four glowing rails).
  for (const d of [-1.5, -0.5, 0.5, 1.5]) {
    const outer = d === -1.5 || d === 1.5
    ctx.beginPath()
    ctx.moveTo(laneX(d, 0), yAt(0))
    ctx.lineTo(laneX(d, 1), yAt(1))
    ctx.strokeStyle = outer ? 'rgba(90,200,255,0.4)' : 'rgba(160,190,230,0.32)'
    ctx.lineWidth = outer ? 2 : 3
    ctx.stroke()
  }

  // Entities, far first so nearer ones overlap.
  for (const e of [...state.entities].sort((a, b) => a.z - b.z)) {
    const x = laneX(e.lane, e.z)
    const y = yAt(e.z)
    const s = sizeAt(e.z)
    ctx.globalAlpha = Math.min(1, 0.45 + scr(e.z))
    if (e.type === 'coin') drawCoin(ctx, x, y - s * 0.5, s, now)
    else if (e.type === 'block') drawTrain(ctx, x, y, s)
    else if (e.type === 'jump') drawHurdle(ctx, x, y, s)
    else drawOverhead(ctx, x, y, s)
    ctx.globalAlpha = 1
  }

  // Avatar in the current lane.
  drawAvatar(ctx, laneX(control.lane, 1), nearY, sizeAt(1), control, now, now < state.invincibleUntil)

  // HUD.
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.font = `${Math.round(Math.min(w, h) * 0.06)}px system-ui, sans-serif`
  let hearts = ''
  for (let i = 0; i < START_LIVES; i++) hearts += i < state.lives ? '❤️' : '🖤'
  ctx.fillText(hearts, w * 0.04, h * 0.04)

  ctx.textAlign = 'right'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.75)'
  ctx.shadowBlur = 12
  ctx.font = `900 ${Math.round(Math.min(w, h) * 0.1)}px system-ui, sans-serif`
  ctx.fillText(String(runnerScore(state)), w * 0.96, h * 0.035)
  ctx.font = `${Math.round(Math.min(w, h) * 0.05)}px system-ui, sans-serif`
  ctx.fillText(`🪙 ${state.coins}`, w * 0.96, h * 0.15)
  ctx.shadowBlur = 0

  if (flashing) {
    ctx.fillStyle = 'rgba(239,68,68,0.26)'
    ctx.fillRect(0, 0, w, h)
  }
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, now: number): void {
  const rw = Math.abs(Math.cos(now / 170)) * s * 0.42 + s * 0.08
  const grd = ctx.createRadialGradient(x - rw * 0.3, y - s * 0.2, 1, x, y, s * 0.6)
  grd.addColorStop(0, '#fff3b0')
  grd.addColorStop(1, '#f5a623')
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.ellipse(x, y, rw, s * 0.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(160,105,0,0.7)'
  ctx.lineWidth = s * 0.07
  ctx.stroke()
}

/** Solid lane blocker — a subway car chunk (dodge to another lane). */
function drawTrain(ctx: CanvasRenderingContext2D, x: number, yBase: number, s: number): void {
  const bw = s * 1.6
  const bh = s * 2.2
  const x0 = x - bw / 2
  const y0 = yBase - bh
  const grd = ctx.createLinearGradient(x0, 0, x0 + bw, 0)
  grd.addColorStop(0, '#b91c1c')
  grd.addColorStop(0.5, '#ef4444')
  grd.addColorStop(1, '#b91c1c')
  ctx.fillStyle = grd
  roundRect(ctx, x0, y0, bw, bh, s * 0.16)
  ctx.fill()
  // Warning stripe + windows.
  ctx.fillStyle = '#fde047'
  ctx.fillRect(x0, y0 + bh * 0.44, bw, bh * 0.1)
  ctx.fillStyle = 'rgba(10,20,40,0.7)'
  roundRect(ctx, x0 + bw * 0.16, y0 + bh * 0.12, bw * 0.28, bh * 0.22, s * 0.06)
  ctx.fill()
  roundRect(ctx, x0 + bw * 0.56, y0 + bh * 0.12, bw * 0.28, bh * 0.22, s * 0.06)
  ctx.fill()
}

/** Low hurdle — jump over it. */
function drawHurdle(ctx: CanvasRenderingContext2D, x: number, yBase: number, s: number): void {
  const bw = s * 1.7
  const bh = s * 0.5
  ctx.fillStyle = '#38bdf8'
  roundRect(ctx, x - bw / 2, yBase - bh, bw, bh, s * 0.12)
  ctx.fill()
  ctx.fillStyle = 'rgba(2,20,40,0.55)'
  ctx.fillRect(x - bw / 2, yBase - bh * 0.35, bw, bh * 0.18)
  hint(ctx, '▲', x, yBase - bh - s * 0.7, s, '#7dd3fc')
}

/** Overhead beam — crouch under it. */
function drawOverhead(ctx: CanvasRenderingContext2D, x: number, yBase: number, s: number): void {
  const bw = s * 1.9
  const bh = s * 0.55
  const top = yBase - s * 2.5
  ctx.strokeStyle = 'rgba(180,130,20,0.6)'
  ctx.lineWidth = s * 0.12
  ctx.beginPath()
  ctx.moveTo(x - bw * 0.35, top + bh)
  ctx.lineTo(x - bw * 0.35, top + bh + s * 0.7)
  ctx.moveTo(x + bw * 0.35, top + bh)
  ctx.lineTo(x + bw * 0.35, top + bh + s * 0.7)
  ctx.stroke()
  ctx.fillStyle = '#f59e0b'
  roundRect(ctx, x - bw / 2, top, bw, bh, s * 0.1)
  ctx.fill()
  hint(ctx, '▼', x, top + bh + s * 0.95, s, '#fcd34d')
}

function hint(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  ctx.fillStyle = color
  ctx.font = `900 ${Math.round(s * 0.8)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(glyph, x, y)
}

/** The runner — a little lime character that jumps / squashes with the controls. */
function drawAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  yBase: number,
  s: number,
  control: Control,
  now: number,
  invincible: boolean,
): void {
  // Ground shadow first.
  ctx.globalAlpha = 0.35
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.ellipse(x, yBase + s * 0.1, s * 0.62, s * 0.18, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  if (invincible && Math.floor(now / 110) % 2 === 0) return // blink while invincible

  let lift = 0
  let squash = 1
  if (control.airborne) lift = s * 1.4
  else if (control.crouching) squash = 0.62

  const bob = control.airborne ? 0 : Math.sin(now / 90) * s * 0.09
  const legSwing = control.airborne ? s * 0.25 : Math.sin(now / 90) * s * 0.32
  const hipY = yBase - lift - bob
  const bodyH = s * 1.05 * squash
  const shoulderY = hipY - bodyH

  // Legs.
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = s * 0.17
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x, hipY)
  ctx.lineTo(x - legSwing, hipY + s * 0.5)
  ctx.moveTo(x, hipY)
  ctx.lineTo(x + legSwing, hipY + s * 0.5)
  ctx.stroke()

  // Body.
  ctx.fillStyle = '#a3e635'
  roundRect(ctx, x - s * 0.34, shoulderY, s * 0.68, bodyH, s * 0.28)
  ctx.fill()

  // Arms swinging opposite the legs.
  ctx.strokeStyle = '#65a30d'
  ctx.lineWidth = s * 0.14
  ctx.beginPath()
  ctx.moveTo(x, shoulderY + bodyH * 0.4)
  ctx.lineTo(x + legSwing * 0.8, shoulderY + bodyH * 0.4 + s * 0.3)
  ctx.moveTo(x, shoulderY + bodyH * 0.4)
  ctx.lineTo(x - legSwing * 0.8, shoulderY + bodyH * 0.4 + s * 0.3)
  ctx.stroke()

  // Head.
  ctx.fillStyle = '#ecfccb'
  ctx.beginPath()
  ctx.arc(x, shoulderY - s * 0.16, s * 0.28, 0, Math.PI * 2)
  ctx.fill()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
