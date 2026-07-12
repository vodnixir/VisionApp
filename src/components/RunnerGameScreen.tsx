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
  type ObstacleType,
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
 * The single-player runner ("Subway Surfers in reality"). The live camera is the
 * backdrop and the player's body is the runner: step between three lanes, jump
 * low barriers, crouch under high ones, grab coins, 3 lives. Reached at #runner.
 *
 * The pose engine draws the mirrored video; a transparent overlay canvas draws
 * the game via its own rAF loop (smooth 60 fps, decoupled from the ~30–40 Hz
 * pose rate — gestures just update a control ref the loop reads).
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
    configure({ mirror, scoring: false, drawOverlays: false, rolesLocked: false })
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
    if (ctx) drawRunner(ctx, cv.width, cv.height, g, c, now < flashUntilRef.current, now)

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

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} className="hidden" playsInline muted />
      {/* Backdrop: gradient in demo, otherwise the mirrored live video. */}
      {demo && <div className="absolute inset-0 bg-gradient-to-b from-slate-700 to-slate-950" />}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full object-cover opacity-90 ${demo ? 'hidden' : ''}`}
      />
      {/* Game layer. */}
      <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3">
        <button
          onClick={goBack}
          className="rounded-full bg-black/60 px-4 py-2 text-sm font-semibold backdrop-blur"
        >
          ← Назад
        </button>
        {phase !== 'play' && (
          <label className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm backdrop-blur">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            Зеркало
          </label>
        )}
      </div>

      {/* Not-visible warning during play */}
      {phase === 'play' && !reliable && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center">
          <div className="rounded-xl bg-red-600/85 px-5 py-2 text-sm font-semibold">
            Встань в кадр целиком
          </div>
        </div>
      )}

      {/* Countdown */}
      {phase === 'countdown' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-[28vh] font-black leading-none drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]">
            {count}
          </div>
        </div>
      )}

      {/* Idle / calibrate chrome */}
      {(phase === 'idle' || phase === 'calibrate') && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-end gap-4 p-8 pb-16">
          <div className="max-w-sm rounded-2xl bg-black/70 px-6 py-5 text-center backdrop-blur">
            <h1 className="mb-2 text-2xl font-black">🏃 Бегун</h1>
            <p className="text-sm text-white/75">
              Встань в полный рост в кадр. Шаг вбок — сменить полосу, подпрыгни — над барьером,
              присядь — под барьером. Лови монеты, три жизни.
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
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-black/70 p-8 backdrop-blur">
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

/* ---------------- Canvas rendering ---------------- */

const TYPE_STYLE: Record<ObstacleType, { fill: string; glyph: string }> = {
  coin: { fill: '#fbbf24', glyph: '●' },
  jump: { fill: '#38bdf8', glyph: '▲' }, // step OVER → jump
  duck: { fill: '#f59e0b', glyph: '▼' }, // duck UNDER → crouch
  block: { fill: '#ef4444', glyph: '✕' },
}

/** Perspective: lane offset & vertical position & size grow as z: 0→1 (far→near). */
function laneX(w: number, lane: Lane, z: number): number {
  return w / 2 + lane * w * (0.05 + 0.26 * z)
}
function planeY(h: number, z: number): number {
  return h * 0.34 + (h * 0.9 - h * 0.34) * z
}

function drawRunner(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  state: RunnerState,
  control: Control,
  flashing: boolean,
  now: number,
): void {
  ctx.clearRect(0, 0, w, h)

  // Lane guide lines converging toward the horizon.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  for (const lane of [-1, 0, 1] as Lane[]) {
    ctx.beginPath()
    ctx.moveTo(laneX(w, lane, 0), planeY(h, 0))
    ctx.lineTo(laneX(w, lane, 1), planeY(h, 1))
    ctx.stroke()
  }

  // Entities, far first so nearer ones overlap.
  for (const e of [...state.entities].sort((a, b) => a.z - b.z)) {
    const x = laneX(w, e.lane, e.z)
    const y = planeY(h, e.z)
    const size = w * (0.035 + 0.11 * e.z)
    const style = TYPE_STYLE[e.type]
    ctx.globalAlpha = Math.min(1, 0.35 + e.z)
    if (e.type === 'coin') {
      ctx.fillStyle = style.fill
      ctx.beginPath()
      ctx.arc(x, y, size * 0.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = size * 0.12
      ctx.stroke()
    } else {
      ctx.fillStyle = style.fill
      roundRect(ctx, x - size, y - size * 0.6, size * 2, size * 1.2, size * 0.25)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.85)'
      ctx.font = `900 ${Math.round(size * 0.9)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(style.glyph, x, y)
    }
    ctx.globalAlpha = 1
  }

  // Player reticle in the current lane, reacting to jump/crouch.
  const px = laneX(w, control.lane, 1)
  let py = planeY(h, 1)
  let color = '#ffffff'
  if (control.airborne) {
    py -= h * 0.09
    color = '#38bdf8'
  } else if (control.crouching) {
    py += h * 0.02
    color = '#f59e0b'
  }
  const invincible = now < state.invincibleUntil
  if (!invincible || Math.floor(now / 100) % 2 === 0) {
    const rw = w * 0.11
    ctx.strokeStyle = color
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(px, py, rw, Math.PI * 0.15, Math.PI - Math.PI * 0.15)
    ctx.stroke()
  }

  // HUD: lives (top-left), score (top-right).
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.font = `${Math.round(h * 0.045)}px system-ui, sans-serif`
  let hearts = ''
  for (let i = 0; i < START_LIVES; i++) hearts += i < state.lives ? '❤️' : '🖤'
  ctx.fillText(hearts, w * 0.03, h * 0.08)

  ctx.textAlign = 'right'
  ctx.fillStyle = '#ffffff'
  ctx.font = `900 ${Math.round(h * 0.07)}px system-ui, sans-serif`
  ctx.shadowColor = 'rgba(0,0,0,0.7)'
  ctx.shadowBlur = 12
  ctx.fillText(String(runnerScore(state)), w * 0.97, h * 0.075)
  ctx.font = `${Math.round(h * 0.035)}px system-ui, sans-serif`
  ctx.fillText(`🪙 ${state.coins}`, w * 0.97, h * 0.16)
  ctx.shadowBlur = 0

  if (flashing) {
    ctx.fillStyle = 'rgba(239,68,68,0.28)'
    ctx.fillRect(0, 0, w, h)
  }
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
