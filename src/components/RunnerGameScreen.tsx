import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { usePoseDetection } from '../hooks/usePoseDetection'
import { useWakeLock } from '../hooks/useWakeLock'
import type { EngineFrame } from '../cv/engine'
import { runCountdown } from '../countdown'
import { useRunnerControl } from '../runner/useRunnerControl'
import {
  PLAYER_Z,
  createRunnerState,
  loadRunnerBest,
  runnerScore,
  saveRunnerBest,
  stepRunner,
  type Entity,
  type RunnerState,
} from '../runner/game'
import { drawScene, type Control } from '../runner/draw'
import { useI18n } from '../i18n'

type Phase = 'idle' | 'calibrate' | 'countdown' | 'play' | 'over'

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
  const { t, lang } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [mirror, setMirror] = useState(true)
  const [result, setResult] = useState<Result | null>(null)
  const [best, setBest] = useState(() => loadRunnerBest())

  const overlayRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<RunnerState | null>(null)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  const flashUntilRef = useRef(0)
  const wakeLock = useWakeLock()

  const { controlRef, reliable, calibrating, calibrated, beginCalibration, handleFrame } =
    useRunnerControl({
      mirror,
      onCalibrated: () => {
        setCount(3)
        setPhase('countdown')
      },
    })

  // The frame handler needs canvasRef (returned below) — route through a ref.
  const onFrameRef = useRef<(frame: EngineFrame) => void>(() => {})
  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection(
    (frame) => onFrameRef.current(frame),
  )

  onFrameRef.current = (frame: EngineFrame) => {
    handleFrame(frame, canvasRef.current?.width ?? 0)
  }

  useEffect(() => {
    // Overlays ON: the camera panel frames the player with a tracking bracket.
    configure({
      mirror,
      scoring: false,
      drawOverlays: true,
      rolesLocked: false,
      names: [t('runner.you'), ''],
    })
  }, [mirror, configure, t, lang])

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

  // Countdown 3 → 2 → 1 → GO, then start the run. Self-correcting so a busy
  // main thread can't stretch the total (a plain setInterval drifts).
  useEffect(() => {
    if (phase !== 'countdown') return
    return runCountdown({
      from: 3,
      stepMs: 800,
      onTick: (n) => {
        setCount(n)
        sfx.beep()
      },
      onDone: () => {
        sfx.gong()
        startRun()
      },
    })
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
    wakeLock.acquire()
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
    wakeLock.acquire()
    void start()
  }

  const handleAgain = () => {
    setResult(null)
    if (demo) {
      setCount(3)
      setPhase('countdown')
      return
    }
    if (calibrated) {
      setCount(3)
      setPhase('countdown')
    } else {
      setPhase('calibrate')
    }
  }

  const goBack = () => {
    cancelAnimationFrame(rafRef.current)
    stop()
    wakeLock.release()
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
            {t('runner.you')}
          </div>
          {phase === 'play' && !reliable && !demo && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <div className="rounded-lg bg-red-600/85 px-4 py-1.5 text-xs font-semibold">
                {t('runner.inFrame')}
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
          ← {t('common.back')}
        </button>
        {chromeVisible && (
          <label className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm backdrop-blur">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            {t('online.mirror')}
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
            <h1 className="mb-2 text-2xl font-black">{t('runner.title')}</h1>
            <p className="text-sm text-white/75">{t('runner.howto')}</p>
            {best > 0 && (
              <p className="mt-2 text-sm font-semibold text-lime-400">{t('runner.record', { n: best })}</p>
            )}
          </div>
          {status === 'idle' && (
            <button
              onClick={handleStart}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              {t('runner.enableCamera')}
            </button>
          )}
          {status === 'starting' && (
            <div className="rounded-full bg-black/70 px-8 py-4 text-lg font-semibold">
              {t('runner.startingCamera')}
            </div>
          )}
          {status === 'running' && (
            <button
              onClick={beginCalibration}
              disabled={calibrating}
              className="rounded-full bg-white px-8 py-4 text-lg font-black text-black disabled:opacity-50"
            >
              {calibrating ? t('runner.holdStill') : t('runner.ready')}
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
            <div className="text-sm uppercase tracking-widest text-white/60">{t('runner.runOver')}</div>
            <div className="mt-1 text-7xl font-black tabular-nums">{result.score}</div>
            <div className="mt-1 text-sm text-white/70">{t('runner.coins', { n: result.coins })}</div>
            {result.isBest ? (
              <div className="mt-2 text-lg font-black text-lime-400">{t('runner.newRecord')}</div>
            ) : (
              <div className="mt-2 text-sm text-white/60">{t('runner.record', { n: result.best })}</div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAgain}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              {t('runner.again')}
            </button>
            <button
              onClick={goBack}
              className="rounded-full bg-white/15 px-6 py-4 text-lg font-semibold"
            >
              {t('runner.exit')}
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

