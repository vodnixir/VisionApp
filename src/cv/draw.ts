import type { BBox } from './tracking'

/**
 * Neon corner brackets [ ] around a fighter. Glow intensity scales with speed,
 * alpha fades while the track survives on persistence only.
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
  ctx.shadowColor = color
  ctx.shadowBlur = 12 + options.speed * 28

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
  ctx.font = `700 ${size}px Orbitron, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const cx = Math.min(Math.max(bbox.x + bbox.w / 2, size * 2), canvasWidth - size * 2)
  const cy = Math.max(bbox.y - size * 0.4, size)
  ctx.shadowColor = color
  ctx.shadowBlur = 14
  ctx.fillStyle = color
  ctx.fillText(text.toUpperCase(), cx, cy)
  ctx.restore()
}
