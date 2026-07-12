import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { usePoseDetection } from '../hooks/usePoseDetection'
import type { EngineFrame } from '../cv/engine'
import {
  DEFAULT_GESTURE_CONFIG,
  averageNeutral,
  createGestureState,
  detectGesture,
  type Lane,
  type Neutral,
  type PostureSample,
} from '../runner/gestures'
import {
  PLAYER_Z,
  START_LIVES,
  createRunnerState,
  loadRunnerBest,
  runnerScore,
  saveRunnerBest,
  stepRunner,
  type Entity,
  type RunnerState,
} from '../runner/game'

/** How long the still-stance sample runs before locking the neutral baseline. */
const CALIBRATE_MS = 1200

type Phase = 'idle' | 'calibrate' | 'countdown' | 'play' | 'over'

interface Control {
  lane: Lane
  airborne: boolean
  crouching: boolean
}

interface Result {
  score: number
  coins: number
  best: number
  isBest: boolean
}

/**
 * The single-player runner ("Subway Surfers in reality"), split-screen:
 *  - one panel is the metro world — a stylized 3-lane tunnel with a running
 *    avatar the player steers by stepping / jumping / crouching;
 *  - the other panel is the live camera with the player framed, so they see
 *    themselves driving it.
 * Camera stacks under the world in portrait, sits beside it in landscape.
 *
 * The world panel is a transparent canvas driven by its own rAF loop (smooth
 * 60 fps, decoupled from the ~30–40 Hz pose rate — gestures update a control
 * ref the loop reads). Reached at #runner.
 */
export function RunnerGameScreen({ demo = false }: { demo?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [mirror, setMirror] = useState(true)
  const [reliable, setReliable] = useState(true)
  const [result, setResult] = useState<Result | null>(null)
  const [best, setBest] = useState(() => loadRunnerBest())

  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gestureStateRef = useRef(createGestureState())
  const neutralRef = useRef<Neutral | null>(null)
  const calibBufRef = useRef<PostureSample[]>([])
  const calibStartRef = useRef<number | null>(null)
  const calibratingRef = useRef(false)
  const mirrorRef = useRef(mirror)
  mirrorRef.current = mirror
  const controlRef = useRef<Control>({ lane: 0, airborne: false, crouching: false })
  const gameRef = useRef<RunnerState | null>(null)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  const flashUntilRef = useRef(0)

  // The frame handler needs canvasRef (returned below) — route through a ref.
  const onFrameRef = useRef<(frame: EngineFrame) => void>(() => {})
  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection(
    (frame) => onFrameRef.current(frame),
  )

  onFrameRef.current = (frame: EngineFrame) => {
    const player = frame.players.find((p) => p.present && p.posture)
    setReliable(Boolean(player))
    if (!player || !player.posture) return

    const cw = canvasRef.current?.width ?? 0
    const raw = player.posture
    const centerX = mirrorRef.current && cw > 0 ? cw - raw.centerX : raw.centerX
    const scale = raw.shoulderWidth > 4 ? raw.shoulderWidth : raw.torsoHeight
    const sample: PostureSample = { centerX, hipY: raw.hipY, topY: raw.topY, scale, t: frame.now }

    if (calibratingRef.current) {
      calibStartRef.current ??= frame.now
      calibBufRef.current.push(sample)
      if (frame.now - calibStartRef.current >= CALIBRATE_MS) {
        const base = averageNeutral(calibBufRef.current)
        if (base) {
          neutralRef.current = base
          gestureStateRef.current = createGestureState()
          calibratingRef.current = false
          setCount(3)
          setPhase('countdown')
        }
      }
      return
    }

    const base = neutralRef.current
    if (!base) return
    const r = detectGesture(gestureStateRef.current, sample, base, DEFAULT_GESTURE_CONFIG)
    controlRef.current = { lane: r.lane, airborne: r.airborne, crouching: r.crouch }
  }

  useEffect(() => {
    // Overlays ON: the camera panel frames the player with a tracking bracket.
    configure({ mirror, scoring: false, drawOverlays: true, rolesLocked: false, names: ['ТЫ', ''] })
  }, [mirror, configure])

  // Camera came up → move to the calibration prompt.
  useEffect(() => {
    if (status === 'running' && phase === 'idle') setPhase('calibrate')
  }, [status, phase])

  // Demo mode (#runner-demo): no camera, an auto-player drives — straight to the run.
  useEffect(() => {
    if (demo && phase === 'idle') {
      setCount(3)
      setPhase('countdown')
    }
  }, [demo, phase])

  // Countdown 3 → 2 → 1 → GO, then start the run.
  useEffect(() => {
    if (phase !== 'countdown') return
    sfx.beep()
    let n = 3
    setCount(3)
    const id = setInterval(() => {
      n -= 1
      if (n > 0) {
        setCount(n)
        sfx.beep()
      } else {
        clearInterval(id)
        sfx.gong()
        startRun()
      }
    }, 800)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Teardown.
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      stop()
    },
    [stop],
  )

  const startRun = () => {
    gameRef.current = createRunnerState()
    flashUntilRef.current = 0
    lastRef.current = performance.now()
    setPhase('play')
    rafRef.current = requestAnimationFrame(loop)
  }

  const loop = (now: number) => {
    const g = gameRef.current
    const cv = overlayRef.current
    if (!g || !cv) return
    if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) {
      cv.width = cv.clientWidth
      cv.height = cv.clientHeight
    }
    const dt = Math.min((now - lastRef.current) / 1000, 0.05)
    lastRef.current = now

    const c = demo ? demoBot(g) : controlRef.current
    if (demo) controlRef.current = c
    const ev = stepRunner(g, {
      dt,
      lane: c.lane,
      airborne: c.airborne,
      crouching: c.crouching,
      nowMs: now,
    })
    if (ev.coin) sfx.tick()
    if (ev.dodge) sfx.release()
    if (ev.hit) {
      flashUntilRef.current = now + 350
      sfx.whistle()
    }

    const ctx = cv.getContext('2d')
    if (ctx) drawScene(ctx, cv.width, cv.height, g, c, now < flashUntilRef.current, now)

    if (ev.gameOver) {
      sfx.victory()
      const score = runnerScore(g)
      const isBest = saveRunnerBest(score)
      setBest(loadRunnerBest())
      setResult({ score, coins: g.coins, best: loadRunnerBest(), isBest })
      setPhase('over')
      return
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  const handleStart = () => {
    sfx.unlock()
    void start()
  }

  const handleCalibrate = () => {
    calibBufRef.current = []
    calibStartRef.current = null
    neutralRef.current = null
    calibratingRef.current = true
  }

  const handleAgain = () => {
    setResult(null)
    if (demo) {
      setCount(3)
      setPhase('countdown')
      return
    }
    if (neutralRef.current) {
      setCount(3)
      setPhase('countdown')
    } else {
      setPhase('calibrate')
    }
  }

  const goBack = () => {
    cancelAnimationFrame(rafRef.current)
    stop()
    window.location.hash = ''
    window.location.reload()
  }

  const chromeVisible = phase === 'idle' || phase === 'calibrate'

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-white select-none">
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Split: metro world + player camera. */}
      <div className="flex h-full w-full flex-col landscape:flex-row">
        {/* Metro world */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
        </div>

        {/* Player camera, framed */}
        <div className="relative min-h-0 flex-1 overflow-hidden border-t-2 border-white/10 landscape:border-l-2 landscape:border-t-0">
          {demo ? (
            <div className="absolute inset-0 bg-gradient-to-b from-slate-700 to-slate-900" />
          ) : (
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="pointer-events-none absolute inset-2 rounded-xl ring-2 ring-white/25" />
          <div className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-black tracking-widest backdrop-blur">
            ТЫ
          </div>
          {phase === 'play' && !reliable && !demo && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <div className="rounded-lg bg-red-600/85 px-4 py-1.5 text-xs font-semibold">
                Встань в кадр целиком
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between p-3">
        <button
          onClick={goBack}
          className="rounded-full bg-black/60 px-4 py-2 text-sm font-semibold backdrop-blur"
        >
          ← Назад
        </button>
        {chromeVisible && (
          <label className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm backdrop-blur">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            Зеркало
          </label>
        )}
      </div>

      {/* Countdown */}
      {phase === 'countdown' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="text-[26vh] font-black leading-none drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
            {count}
          </div>
        </div>
      )}

      {/* Idle / calibrate chrome */}
      {chromeVisible && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/45 p-8 backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl bg-black/70 px-6 py-5 text-center">
            <h1 className="mb-2 text-2xl font-black">🏃 Бегун по метро</h1>
            <p className="text-sm text-white/75">
              Ты управляешь бегуном телом. <b>Шаг вбок</b> — сменить полосу,{' '}
              <b>подпрыгни</b> — через барьер, <b>присядь</b> — под преградой. Собирай монеты. Три
              жизни.
            </p>
            {best > 0 && <p className="mt-2 text-sm font-semibold text-lime-400">Рекорд: {best}</p>}
          </div>
          {status === 'idle' && (
            <button
              onClick={handleStart}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              Включить камеру
            </button>
          )}
          {status === 'starting' && (
            <div className="rounded-full bg-black/70 px-8 py-4 text-lg font-semibold">
              Запуск камеры…
            </div>
          )}
          {status === 'running' && (
            <button
              onClick={handleCalibrate}
              disabled={calibratingRef.current}
              className="rounded-full bg-white px-8 py-4 text-lg font-black text-black disabled:opacity-50"
            >
              {calibratingRef.current ? 'Стой ровно…' : 'Готов — старт'}
            </button>
          )}
          {status === 'error' && error && (
            <div className="max-w-sm rounded-xl bg-red-600/85 px-5 py-3 text-center text-sm font-semibold">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Game over */}
      {phase === 'over' && result && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/72 p-8 backdrop-blur">
          <div className="text-center">
            <div className="text-sm uppercase tracking-widest text-white/60">Забег окончен</div>
            <div className="mt-1 text-7xl font-black tabular-nums">{result.score}</div>
            <div className="mt-1 text-sm text-white/70">🪙 {result.coins} монет</div>
            {result.isBest ? (
              <div className="mt-2 text-lg font-black text-lime-400">🏆 Новый рекорд!</div>
            ) : (
              <div className="mt-2 text-sm text-white/60">Рекорд: {result.best}</div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAgain}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              Ещё раз
            </button>
            <button
              onClick={goBack}
              className="rounded-full bg-white/15 px-6 py-4 text-lg font-semibold"
            >
              Выход
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Demo auto-player ---------------- */

/**
 * Auto-player for the camera-free demo: reacts to the most imminent entity —
 * aligns to coins/barriers (jumping or crouching when they arrive), dodges solid
 * blocks to a free lane. Occasional hits are fine; they show the lives/flash too.
 */
function demoBot(state: RunnerState): Control {
  let target: Entity | null = null
  for (const e of state.entities) {
    if (e.resolved || e.z >= PLAYER_Z) continue
    if (!target || e.z > target.z) target = e
  }
  if (!target) return { lane: 0, airborne: false, crouching: false }
  if (target.type === 'block') {
    return { lane: target.lane === 0 ? 1 : 0, airborne: false, crouching: false }
  }
  const close = target.z > 0.6
  return {
    lane: target.lane,
    airborne: target.type === 'jump' && close,
    crouching: target.type === 'duck' && close,
  }
}

/* ---------------- Metro scene rendering ---------------- */

/** Perspective easing: things near the viewer move fast, far ones crawl. */
function scr(z: number): number {
  return z * 0.5 + z * z * 0.5
}

function drawScene(
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
