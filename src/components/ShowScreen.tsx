import { useEffect, useRef, useState } from 'react'
import { drawMatchHud, drawVictorySplash } from '../cv/draw'
import { useI18n } from '../i18n'
import { attachShowReceiver, type ShowState } from '../show'
import { canvasTheme, playerColors, setTheme } from '../theme'

/** Scoreboard canvas logical size (scaled to the TV with object-contain). */
const W = 1280
const H = 720

/**
 * The big-screen side of the show: rendered on a Chromecast (Presentation API
 * receiver) or in the fallback second window. Shows the live arena video when
 * WebRTC connects; otherwise a scoreboard driven by tiny state messages.
 */
export function ShowScreen() {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<ShowState | null>(null)
  const [hasStream, setHasStream] = useState(false)

  useEffect(() => {
    return attachShowReceiver({
      onState: (s) => {
        stateRef.current = s
        // Mirror the host's look without adopting it as this device's choice.
        if (s.theme) setTheme(s.theme, { persist: false })
      },
      onStream: (stream) => {
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          if (stream) {
            // TVs allow autoplay with sound; desktop windows may not — retry muted.
            video.muted = false
            video.play().catch(() => {
              video.muted = true
              video.play().catch(() => {})
            })
          }
        }
        setHasStream(stream !== null)
      },
    })
  }, [])

  // Scoreboard loop — only drawn while there is no video to show.
  useEffect(() => {
    if (hasStream) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      drawScoreboard(ctx, stateRef.current, t('show.waiting'))
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [hasStream, t])

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        playsInline
        className={`h-full w-full object-contain ${hasStream ? '' : 'hidden'}`}
      />
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className={`h-full w-full object-contain ${hasStream ? 'hidden' : ''}`}
      />
    </div>
  )
}

/** Exported for smoke tests; the component drives it via rAF. */
export function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  state: ShowState | null,
  waitingText: string,
): void {
  const th = canvasTheme()

  // Backdrop: flat in minimal themes, the arena gradient in neon.
  if (th.board.bg[0] === th.board.bg[1]) {
    ctx.fillStyle = th.board.bg[0]
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, th.board.bg[0])
    g.addColorStop(1, th.board.bg[1])
    ctx.fillStyle = g
  }
  ctx.fillRect(0, 0, W, H)

  const phase = state?.phase ?? 'idle'

  if (phase === 'idle' || phase === 'calibration') {
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (th.glow) {
      // The original two-tone arcade wordmark.
      ctx.font = `900 ${Math.round(H * 0.11)}px ${th.font}`
      ctx.fillStyle = '#00c3ff'
      ctx.shadowColor = '#00c3ff'
      ctx.shadowBlur = 24
      ctx.fillText('SPEED', W / 2 - H * 0.19, H * 0.42)
      ctx.fillStyle = '#ffffff'
      ctx.shadowBlur = 0
      ctx.fillText('BATTLE', W / 2 + H * 0.21, H * 0.42)
    } else {
      ctx.font = `700 ${Math.round(H * 0.1)}px ${th.font}`
      ctx.fillStyle = th.board.ink
      ctx.fillText('Speed Battle', W / 2, H * 0.42)
    }
    ctx.font = `${th.glow ? 600 : 500} ${Math.round(H * 0.038)}px ${th.font}`
    ctx.fillStyle = th.board.muted
    const line =
      phase === 'calibration' && state
        ? th.glow
          ? `${state.names[0].toUpperCase()}  VS  ${state.names[1].toUpperCase()}`
          : `${state.names[0]}  ·  ${state.names[1]}`
        : waitingText
    ctx.fillText(line, W / 2, th.glow ? H * 0.58 : H * 0.56)
    ctx.restore()
    return
  }

  if (!state) return

  if (phase === 'over') {
    drawVictorySplash(ctx, W, H, state.hud)
    return
  }

  // PLAYING scoreboard: the shared HUD (bars / timer / freeze banner) plus
  // giant center percentages readable from the back of the room.
  drawMatchHud(ctx, W, H, state.hud, state.names)
  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.font = `${th.glow ? 900 : 700} ${Math.round(H * 0.3)}px ${th.font}`
  for (const i of [0, 1] as const) {
    ctx.fillStyle = playerColors()[i]
    if (th.glow) {
      ctx.shadowColor = playerColors()[i]
      ctx.shadowBlur = 30
    }
    ctx.textAlign = 'center'
    ctx.fillText(`${Math.floor(state.hud.progress[i])}`, W * (i === 0 ? 0.27 : 0.73), H * 0.58)
  }
  ctx.font = `${th.glow ? 700 : 600} ${Math.round(H * 0.07)}px ${th.font}`
  ctx.fillStyle = th.board.vs
  ctx.shadowBlur = 0
  ctx.fillText('VS', W / 2, H * 0.58)
  ctx.restore()
}
