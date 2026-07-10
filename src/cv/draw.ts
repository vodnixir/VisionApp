import { t } from '../i18n'
import { PLAYER_COLORS } from '../types'
import type { BBox } from './tracking'

/** Everything the canvas HUD needs, updated per inference frame via engine config. */
export interface HudState {
  mode: 'none' | 'match' | 'victory'
  /** 0..100 — percent of target score per player. */
  progress: [number, number]
  remainingMs: number
  /** A "freeze!" window is active — moving drains the bar. */
  frozen: boolean
  /** Current combo fill multiplier per player (1 = no streak / mode off). */
  combo: [number, number]
  winnerIndex: 0 | 1 | null
  winnerName: string
  endedByTimer: boolean
  /** Sudden death after a buzzer tie — first to +OVERTIME_DELTA wins. */
  overtime?: boolean
  /** Rhythm: 0..1 phase to the next beat (0 = right on the beat). */
  beatPhase?: number
  /** Rhythm: player i landed the beat just now (short panel flash). */
  beatFlash?: [boolean, boolean]
  /** Traffic light mode: current light (null/undefined = not in this mode). */
  traffic?: 'red' | 'green' | null
  /** Co-op boss: right panel is the boss attack charge, left is the team bar. */
  coop?: boolean
  /** Boss attack landed a moment ago — full-frame red flash. */
  bossFlash?: boolean
  /** Panel captions when they differ from the bracket labels (boss: TEAM / BOSS). */
  panelNames?: [string, string]
}

export const DEFAULT_HUD: HudState = {
  mode: 'none',
  progress: [0, 0],
  remainingMs: 0,
  frozen: false,
  combo: [1, 1],
  winnerIndex: null,
  winnerName: '',
  endedByTimer: false,
}

const FONT = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
/** Frosted white chips/panels — the light UI carried onto the video. */
const PANEL_BG = 'rgba(255, 255, 255, 0.92)'
const INK = '#18181b'
const INK_MUTED = 'rgba(24, 24, 27, 0.55)'
/** Soft dark halo behind free-floating text so it survives any footage. */
const TEXT_HALO = 'rgba(0, 0, 0, 0.45)'

/**
 * Corner brackets [ ] around a fighter. Alpha fades while the track survives
 * on persistence only; a soft dark halo keeps them visible on bright footage.
 */
export function drawBrackets(
  ctx: CanvasRenderingContext2D,
  bbox: BBox,
  color: string,
  options: { alpha: number; speed: number },
): void {
  const { x, y, w, h } = bbox
  const len = Math.max(18, Math.min(w, h) * 0.24)
  const lw = Math.max(3, Math.min(w, h) * 0.02)

  ctx.save()
  ctx.globalAlpha = options.alpha
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.shadowColor = TEXT_HALO
  ctx.shadowBlur = 6

  ctx.beginPath()
  // top-left
  ctx.moveTo(x, y + len)
  ctx.lineTo(x, y)
  ctx.lineTo(x + len, y)
  // top-right
  ctx.moveTo(x + w - len, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + len)
  // bottom-right
  ctx.moveTo(x + w, y + h - len)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x + w - len, y + h)
  // bottom-left
  ctx.moveTo(x + len, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + h - len)
  ctx.stroke()
  ctx.restore()
}

/** Player name tag above the bracket. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  bbox: BBox,
  color: string,
  alpha: number,
  canvasWidth: number,
): void {
  const size = Math.round(Math.min(Math.max(bbox.w * 0.11, 18), 44))
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `700 ${size}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const cx = Math.min(Math.max(bbox.x + bbox.w / 2, size * 2), canvasWidth - size * 2)
  const cy = Math.max(bbox.y - size * 0.4, size)
  ctx.shadowColor = TEXT_HALO
  ctx.shadowBlur = 8
  ctx.fillStyle = color
  ctx.fillText(text, cx, cy)
  ctx.restore()
}

/**
 * Combo badge at the top-right corner of a fighter's bracket: "×1.5" / "×2".
 * White with a subtle pulse at the maximum tier — made for the TV/clip.
 */
export function drawComboTag(
  ctx: CanvasRenderingContext2D,
  bbox: BBox,
  mult: number,
  alpha: number,
): void {
  const maxTier = mult >= 2
  const size = Math.round(Math.min(Math.max(bbox.w * (maxTier ? 0.17 : 0.13), 20), 52))
  const pulse = maxTier ? 0.75 + 0.25 * Math.abs(Math.sin(performance.now() / 160)) : 1
  ctx.save()
  ctx.globalAlpha = alpha * pulse
  ctx.font = `700 ${size}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = TEXT_HALO
  ctx.shadowBlur = 8
  // Trailing zeros stripped: 1.25 → "×1.25", 1.5 → "×1.5", 2 → "×2".
  ctx.fillText(`×${mult}`, bbox.x + bbox.w + size * 0.2, bbox.y + size * 0.9)
  ctx.restore()
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Match HUD drawn ON the canvas (not DOM) so it is part of the TV picture and
 * of the recorded highlight clip: two progress bars, names, center timer.
 */
export function drawMatchHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hud: HudState,
  names: [string, string],
): void {
  const pad = Math.round(w * 0.015)
  const centerW = Math.max(92, Math.round(w * 0.115))
  const panelH = Math.max(58, Math.round(h * 0.145))
  const panelW = Math.round((w - centerW - pad * 4) / 2)
  const captions = hud.panelNames ?? names

  drawPlayerPanel(ctx, pad, pad, panelW, panelH, captions[0], hud.progress[0], 0, hud.beatFlash?.[0])
  drawPlayerPanel(
    ctx,
    w - pad - panelW,
    pad,
    panelW,
    panelH,
    captions[1],
    hud.progress[1],
    1,
    hud.beatFlash?.[1],
  )

  // Center timer chip.
  const timerH = Math.round(panelH * 0.78)
  const tx = Math.round((w - centerW) / 2)
  ctx.save()

  // Rhythm: a ring around the timer breathing with the beat (biggest ON it).
  if (hud.beatPhase !== undefined) {
    const strength = 1 - Math.min(hud.beatPhase, 1)
    ctx.strokeStyle = '#ffffff'
    ctx.globalAlpha = 0.2 + 0.6 * strength ** 2
    ctx.lineWidth = 3 + strength * 4
    ctx.beginPath()
    ctx.arc(tx + centerW / 2, pad + timerH / 2, timerH * (0.72 + strength * 0.16), 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  ctx.fillStyle = PANEL_BG
  roundedRect(ctx, tx, pad, centerW, timerH, 10)
  ctx.fill()

  const urgent = hud.overtime || hud.remainingMs <= 5_500
  const size = Math.round(timerH * 0.5)
  ctx.font = `700 ${size}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (urgent) {
    // Pulse the last five seconds — readable urgency without extra state.
    const pulse = 0.72 + 0.28 * Math.abs(Math.sin(performance.now() / 180))
    ctx.globalAlpha = pulse
    ctx.fillStyle = '#dc2626'
  } else {
    ctx.fillStyle = INK
  }
  ctx.fillText(
    hud.overtime ? 'OT' : formatClock(hud.remainingMs),
    tx + centerW / 2,
    pad + timerH / 2 + 1,
  )
  ctx.restore()

  if (hud.overtime) drawCenterBanner(ctx, w, h, t('hud.overtime'), 0.085)
  if (hud.traffic === 'red') {
    ctx.save()
    ctx.fillStyle = 'rgba(220, 38, 38, 0.16)'
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
    drawCenterBanner(ctx, w, h, t('hud.stop'), 0.12)
  } else if (hud.traffic === 'green') {
    drawCenterBanner(ctx, w, h, t('hud.go'), 0.07)
  }
  if (hud.bossFlash) {
    ctx.save()
    ctx.fillStyle = 'rgba(220, 38, 38, 0.22)'
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  if (hud.frozen) drawFreezeBanner(ctx, w, h)
}

/** Pulsing announcement in the upper-middle of the arena (OVERTIME / STOP / GO). */
function drawCenterBanner(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  sizeFrac: number,
): void {
  ctx.save()
  const pulse = 0.78 + 0.22 * Math.abs(Math.sin(performance.now() / 170))
  ctx.font = `700 ${Math.round(h * sizeFrac)}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = pulse
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = TEXT_HALO
  ctx.shadowBlur = 14
  ctx.fillText(text, w / 2, h * 0.3)
  ctx.restore()
}

/** Icy overlay + pulsing "FREEZE!" — anyone moving now is draining their bar. */
function drawFreezeBanner(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(59, 130, 246, 0.12)'
  ctx.fillRect(0, 0, w, h)

  const pulse = 0.8 + 0.2 * Math.abs(Math.sin(performance.now() / 150))
  const size = Math.round(h * 0.13)
  ctx.font = `700 ${size}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = pulse
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = TEXT_HALO
  ctx.shadowBlur = 14
  ctx.fillText(t('hud.freeze'), w / 2, h * 0.5)
  ctx.restore()
}

function drawPlayerPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  progressPercent: number,
  playerIndex: 0 | 1,
  flash?: boolean,
): void {
  const color = PLAYER_COLORS[playerIndex]
  const isLeft = playerIndex === 0
  const percent = Math.min(Math.max(progressPercent, 0), 100)

  ctx.save()
  ctx.fillStyle = PANEL_BG
  roundedRect(ctx, x, y, w, h, 12)
  ctx.fill()
  // Rhythm hit → the panel border pops for a beat; otherwise no border at all.
  if (flash) {
    ctx.strokeStyle = color
    ctx.lineWidth = 4
    ctx.stroke()
  }

  const inset = Math.round(h * 0.16)
  const nameSize = Math.round(h * 0.3)
  const pctSize = Math.round(h * 0.36)

  // Name (truncate to fit half of the panel).
  ctx.font = `600 ${nameSize}px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.fillStyle = color
  const maxNameW = w * 0.58
  let label = name
  while (label.length > 2 && ctx.measureText(label).width > maxNameW) {
    label = label.slice(0, -1)
  }
  ctx.textAlign = isLeft ? 'left' : 'right'
  ctx.fillText(label, isLeft ? x + inset : x + w - inset, y + inset)

  // Percent.
  ctx.font = `700 ${pctSize}px ${FONT}`
  ctx.fillStyle = INK
  ctx.textAlign = isLeft ? 'right' : 'left'
  ctx.fillText(`${Math.floor(percent)}%`, isLeft ? x + w - inset : x + inset, y + inset - 2)

  // Progress bar (P2's fills right-to-left for on-TV symmetry).
  const barH = Math.round(h * 0.22)
  const barY = y + h - inset - barH
  const barW = w - inset * 2
  ctx.fillStyle = 'rgba(24, 24, 27, 0.1)'
  roundedRect(ctx, x + inset, barY, barW, barH, barH / 2)
  ctx.fill()
  const fillW = Math.max((barW * percent) / 100, barH)
  if (percent > 0.5) {
    ctx.fillStyle = color
    roundedRect(ctx, isLeft ? x + inset : x + inset + barW - fillW, barY, fillW, barH, barH / 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Privacy mask: a friendly robot face over the child's real one, in the
 * player's color. Drawn on the canvas, so the TV picture AND the shared clip
 * never contain the face (COPPA/GDPR-K friendly sharing).
 */
export function drawFaceMask(
  ctx: CanvasRenderingContext2D,
  face: { x: number; y: number; r: number },
  color: string,
  alpha: number,
): void {
  const { x, y, r } = face
  ctx.save()
  ctx.globalAlpha = alpha
  // Opaque disc — fully covers the face.
  ctx.fillStyle = '#fafafa'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(2, r * 0.09)
  ctx.stroke()
  // Simple robot smile: two eyes + a mouth arc.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x - r * 0.35, y - r * 0.18, r * 0.13, 0, Math.PI * 2)
  ctx.arc(x + r * 0.35, y - r * 0.18, r * 0.13, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(2, r * 0.08)
  ctx.beginPath()
  ctx.arc(x, y + r * 0.12, r * 0.42, Math.PI * 0.18, Math.PI * 0.82)
  ctx.stroke()
  ctx.restore()
}

/**
 * Victory splash drawn on the canvas so the recorded clip ends with the
 * celebration (the DOM controls appear for the host a moment later).
 */
export function drawVictorySplash(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hud: HudState,
): void {
  if (hud.winnerIndex === null) return
  const color = PLAYER_COLORS[hud.winnerIndex]

  ctx.save()
  ctx.fillStyle = 'rgba(247, 247, 245, 0.82)'
  ctx.fillRect(0, 0, w, h)

  ctx.textAlign = 'center'

  if (hud.endedByTimer) {
    const chipSize = Math.round(h * 0.045)
    ctx.font = `600 ${chipSize}px ${FONT}`
    ctx.fillStyle = INK_MUTED
    ctx.textBaseline = 'bottom'
    ctx.fillText(t('hud.timeUp'), w / 2, h * 0.3)
  }

  const labelSize = Math.round(h * 0.05)
  ctx.font = `600 ${labelSize}px ${FONT}`
  ctx.fillStyle = INK_MUTED
  ctx.textBaseline = 'bottom'
  ctx.fillText(t('hud.winner'), w / 2, h * 0.42)

  const nameSize = Math.round(h * 0.14)
  ctx.font = `700 ${nameSize}px ${FONT}`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(hud.winnerName, w / 2, h * 0.53)

  const scoreSize = Math.round(h * 0.055)
  ctx.font = `600 ${scoreSize}px ${FONT}`
  ctx.fillStyle = INK
  ctx.textBaseline = 'top'
  ctx.fillText(
    `${Math.floor(hud.progress[0])}%  —  ${Math.floor(hud.progress[1])}%`,
    w / 2,
    h * 0.64,
  )
  ctx.restore()
}
