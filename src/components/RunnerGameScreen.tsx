import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { usePoseDetection } from '../hooks/usePoseDetection'
import { useWakeLock } from '../hooks/useWakeLock'
import type { EngineFrame } from '../cv/engine'
import { runCountdown } from '../countdown'
import { mulberry32, randomSeed } from '../online/protocol'
import { MatchRecorder } from '../recorder'
import { useMatchClip } from '../hooks/useMatchClip'
import { ClipShare } from './ClipShare'
import { useRunnerControl } from '../runner/useRunnerControl'
import { RUNNER_MODES, runnerModeSpec, type RunnerMode } from '../runner/modes'
import {
  MAX_FRAME_S,
  PLAYER_Z,
  SIM_STEP_S,
  createRunnerState,
  loadRunnerBest,
  runnerScore,
  saveRunnerBest,
  stepRunner,
  type Entity,
  type RunnerState,
} from '../runner/game'
import { drawScene, type Control } from '../runner/draw'
import { InstructionCard, type Rule } from './InstructionCard'
import { useI18n } from '../i18n'

type Phase = 'idle' | 'calibrate' | 'countdown' | 'play' | 'over'

/** Fixed identity colours for the runner avatars (P1 cyan, P2 magenta, P3 lime). */
const RUNNER_COLORS = ['#00c3ff', '#ff2e63', '#a3e635']

interface PlayerResult {
  index: number
  score: number
  coins: number
}

interface Result {
  players: PlayerResult[]
  /** Winner slot, or null for a draw / solo. */
  winnerIndex: number | null
  /** Solo-only: the stored best and whether this run beat it. */
  best: number
  isBest: boolean
}

/**
 * The body-driven Metro Runner, now Solo / Duel / Squad. Everyone runs their own
 * avatar on the SAME seeded obstacle stream (mulberry32 shared seed), so a race
 * is fair. The engine tracks `mode.players` bodies (its maxPoses); left-to-right
 * people drive the left-to-right worlds via fixed pose slots.
 *
 * Layout: N metro worlds across the top, one shared camera strip below framing
 * everyone. Each world is a transparent canvas driven by the single rAF loop
 * that steps every player's state in lockstep. Reached at #runner.
 */
export function RunnerGameScreen({ demo = false }: { demo?: boolean }) {
  const { t, lang } = useI18n()
  const [mode, setMode] = useState<RunnerMode | null>(demo ? 'solo' : null)
  const [showRules, setShowRules] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [mirror, setMirror] = useState(true)
  const [result, setResult] = useState<Result | null>(null)
  const [best, setBest] = useState(() => loadRunnerBest())
  /** Auto-recorded vertical highlight clip, ready once the run ends. */
  const {
    status: clipStatus,
    sharing,
    shareError,
    capture: captureClip,
    reset: resetClip,
    share: handleShareClip,
  } = useMatchClip()

  const players = mode ? runnerModeSpec(mode).players : 1

  const worldRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const gamesRef = useRef<RunnerState[]>([])
  const flashRef = useRef<number[]>([])
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  /** Leftover real time (<1 sim step) carried between frames. */
  const accRef = useRef(0)
  const recorderRef = useRef(new MatchRecorder())
  const wakeLock = useWakeLock()

  // Rules of hooks: always create MAX_PLAYERS controls, each pinned to a fixed
  // pose slot; only the first `players` of them are used this session.
  const c0 = useRunnerControl({ mirror, slotIndex: 0, onCalibrated: () => sfx.lock() })
  const c1 = useRunnerControl({ mirror, slotIndex: 1, onCalibrated: () => sfx.lock() })
  const c2 = useRunnerControl({ mirror, slotIndex: 2, onCalibrated: () => sfx.lock() })
  const controls = [c0, c1, c2]
  const active = controls.slice(0, players)

  // The frame handler needs canvasRef (returned below) — route through a ref.
  const onFrameRef = useRef<(frame: EngineFrame) => void>(() => {})
  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection(
    (frame) => onFrameRef.current(frame),
  )

  onFrameRef.current = (frame: EngineFrame) => {
    const w = canvasRef.current?.width ?? 0
    for (let i = 0; i < players; i++) controls[i].handleFrame(frame, w)
  }

  // Engine tracks exactly `players` bodies; overlays frame each with a bracket.
  useEffect(() => {
    const names =
      players === 1
        ? [t('runner.you')]
        : Array.from({ length: players }, (_, i) => t('runner.pLabel', { n: i + 1 }))
    configure({
      mirror,
      maxPlayers: players,
      scoring: false,
      drawOverlays: true,
      rolesLocked: false,
      names,
    })
  }, [mirror, players, configure, t, lang])

  // Camera came up → move to the calibration prompt.
  useEffect(() => {
    if (status === 'running' && phase === 'idle') setPhase('calibrate')
  }, [status, phase])

  // Demo mode (#runner-demo): no camera, an auto-player drives — straight to the run.
  useEffect(() => {
    if (demo && mode && phase === 'idle') {
      setCount(3)
      setPhase('countdown')
    }
  }, [demo, mode, phase])

  // Every active player has a fresh neutral baseline → start the countdown.
  const allCalibrated = active.length > 0 && active.every((c) => c.calibrated)
  useEffect(() => {
    if (!demo && phase === 'calibrate' && allCalibrated) {
      setCount(3)
      setPhase('countdown')
    }
  }, [demo, phase, allCalibrated])

  // Countdown 3 → 2 → 1 → GO, then start the run. Self-correcting so a busy main
  // thread can't stretch the total.
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
      recorderRef.current.cancel()
      stop()
    },
    [stop],
  )

  const startRun = () => {
    // One shared seed → identical obstacles for every runner (fair race).
    const seed = randomSeed()
    gamesRef.current = Array.from({ length: players }, () => createRunnerState(mulberry32(seed)))
    flashRef.current = Array.from({ length: players }, () => 0)
    lastRef.current = performance.now()
    accRef.current = 0
    wakeLock.acquire()
    resetClip()
    // Record the metro world into a vertical highlight clip (P1's view in a
    // race). The camera-free demo has no run worth sharing, so skip it there.
    const worldCanvas = worldRefs.current[0]
    if (!demo && worldCanvas) {
      recorderRef.current.start(worldCanvas, sfx.captureStream())
    }
    setPhase('play')
    rafRef.current = requestAnimationFrame(loop)
  }

  const loop = (now: number) => {
    const games = gamesRef.current
    if (games.length === 0) return

    // Step the sim in fixed slices so the world keeps real-time pace even when
    // the frame rate drops (heavy 3-body tracking in Squad). One shared step
    // count drives every player's world in lockstep; drawing happens once.
    accRef.current = Math.min(accRef.current + (now - lastRef.current) / 1000, MAX_FRAME_S)
    lastRef.current = now
    const steps = Math.floor(accRef.current / SIM_STEP_S)
    accRef.current -= steps * SIM_STEP_S

    for (let i = 0; i < games.length; i++) {
      const g = games[i]
      const cv = worldRefs.current[i]
      if (!cv) continue
      if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) {
        cv.width = cv.clientWidth
        cv.height = cv.clientHeight
      }
      const c = demo ? demoBot(g) : controls[i].controlRef.current
      if (demo) controls[i].controlRef.current = c
      let coin = false
      let dodge = false
      let hit = false
      for (let s = 0; s < steps; s++) {
        const ev = stepRunner(g, {
          dt: SIM_STEP_S,
          lane: c.lane,
          airborne: c.airborne,
          crouching: c.crouching,
          nowMs: now,
        })
        if (ev.coin) coin = true
        if (ev.dodge) dodge = true
        if (ev.hit) hit = true
        if (g.over) break
      }
      if (coin) sfx.tick()
      if (dodge) sfx.release()
      if (hit) {
        flashRef.current[i] = now + 350
        sfx.whistle()
      }
      const ctx = cv.getContext('2d')
      if (ctx) drawScene(ctx, cv.width, cv.height, g, c, now < flashRef.current[i], now)
    }

    if (games.every((g) => g.over)) {
      finishRun()
      return
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  const finishRun = () => {
    sfx.victory()
    const games = gamesRef.current
    const perPlayer: PlayerResult[] = games.map((g, i) => ({
      index: i,
      score: runnerScore(g),
      coins: g.coins,
    }))
    let winnerIndex: number | null = null
    let isBest = false
    if (players === 1) {
      const score = perPlayer[0].score
      isBest = saveRunnerBest(score)
      setBest(loadRunnerBest())
    } else {
      const top = Math.max(...perPlayer.map((p) => p.score))
      const leaders = perPlayer.filter((p) => p.score === top)
      winnerIndex = leaders.length === 1 ? leaders[0].index : null
    }
    setResult({ players: perPlayer, winnerIndex, best: loadRunnerBest(), isBest })
    // The world freezes on the final frame; keep recording a short tail so the
    // clip ends on it, then hand back the shareable highlight.
    captureClip(recorderRef.current, 1200)
    setPhase('over')
  }

  const handleStart = () => {
    sfx.unlock()
    wakeLock.acquire()
    void start()
  }

  const beginCalibration = () => {
    for (const c of active) c.beginCalibration()
  }

  const handlePickMode = (m: RunnerMode) => {
    setMode(m)
    setShowRules(true)
  }

  const handleRulesStart = () => {
    setShowRules(false)
    if (!demo && status === 'idle') handleStart()
  }

  const handleAgain = () => {
    recorderRef.current.cancel()
    resetClip()
    setResult(null)
    if (demo) {
      setCount(3)
      setPhase('countdown')
      return
    }
    if (allCalibrated) {
      setCount(3)
      setPhase('countdown')
    } else {
      setPhase('calibrate')
    }
  }

  const goBack = () => {
    cancelAnimationFrame(rafRef.current)
    recorderRef.current.cancel()
    stop()
    wakeLock.release()
    window.location.hash = ''
    window.location.reload()
  }

  const backToModes = () => {
    cancelAnimationFrame(rafRef.current)
    recorderRef.current.cancel()
    stop()
    for (const c of controls) c.reset()
    wakeLock.release()
    resetClip()
    setResult(null)
    setShowRules(false)
    setPhase('idle')
    setMode(null)
  }

  /* ---------------- Mode select ---------------- */

  if (!mode) {
    return (
      <div className="screen relative flex h-full w-full flex-col items-center overflow-y-auto bg-page px-4 py-8 text-t1 select-none">
        <div className="flex w-full max-w-md flex-1 flex-col gap-4">
          <header className="flex items-center justify-between">
            <button
              onClick={goBack}
              className="rounded-full border border-edge bg-card px-4 py-2 text-sm font-semibold text-t2 transition-colors hover:text-t1"
            >
              ← {t('common.back')}
            </button>
            {best > 0 && (
              <span className="text-sm font-semibold text-dot">{t('runner.record', { n: best })}</span>
            )}
          </header>

          <div className="mt-2 text-center">
            <h1 className="text-3xl font-black">{t('runner.title')}</h1>
            <p className="mt-1 text-sm text-t3">{t('runner.chooseMode')}</p>
          </div>

          <div className="mt-2 flex flex-col gap-3">
            {RUNNER_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handlePickMode(m.id)}
                className="flex items-center gap-4 rounded-2xl border border-edge bg-card px-5 py-4 text-left transition-colors hover:border-edge2"
              >
                <span className="text-3xl" aria-hidden>
                  {m.emoji}
                </span>
                <span className="flex flex-col">
                  <span className="text-lg font-bold">{t(m.labelKey)}</span>
                  <span className="text-xs text-t3">{t(m.hintKey)}</span>
                </span>
                <span
                  className="ml-auto flex gap-1"
                  aria-hidden
                >
                  {Array.from({ length: m.players }, (_, i) => (
                    <span
                      key={i}
                      className="size-2.5 rounded-full"
                      style={{ background: RUNNER_COLORS[i] }}
                    />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Rules / game ---------------- */

  const modeSpec = runnerModeSpec(mode)
  const rules: Rule[] = [
    { emoji: '↔️', text: t('runner.rule.lane') },
    { emoji: '⬆️', text: t('runner.rule.jump') },
    { emoji: '⬇️', text: t('runner.rule.crouch') },
    { emoji: '🪙', text: t('runner.rule.coins') },
    { emoji: '❤️', text: players === 1 ? t('runner.rule.livesSolo') : t('runner.rule.livesRace') },
  ]

  const chromeVisible = phase === 'idle' || phase === 'calibrate'

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-white select-none">
      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Worlds row + shared camera strip. */}
      <div className="flex h-full w-full flex-col">
        <div className="flex min-h-0 flex-1">
          {Array.from({ length: players }, (_, i) => (
            <div
              key={i}
              className="relative min-h-0 min-w-0 flex-1 overflow-hidden border-white/10 [&:not(:first-child)]:border-l-2"
            >
              <canvas
                ref={(el) => {
                  worldRefs.current[i] = el
                }}
                className="absolute inset-0 h-full w-full"
              />
              <div
                className="absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-black tracking-wider backdrop-blur"
                style={{ background: 'rgba(0,0,0,0.55)', color: RUNNER_COLORS[i] }}
              >
                {players === 1 ? t('runner.you') : t('runner.pLabel', { n: i + 1 })}
              </div>
              {phase === 'play' && !demo && !controls[i].reliable && (
                <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                  <div className="rounded-lg bg-red-600/85 px-3 py-1 text-[11px] font-semibold">
                    {t('runner.inFrame')}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Shared player camera, framing everyone. */}
        <div className="relative h-2/5 min-h-0 overflow-hidden border-t-2 border-white/10 landscape:h-1/3">
          {demo ? (
            <div className="absolute inset-0 bg-gradient-to-b from-slate-700 to-slate-900" />
          ) : (
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="pointer-events-none absolute inset-2 rounded-xl ring-2 ring-white/20" />
        </div>
      </div>

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between p-3">
        <button
          onClick={backToModes}
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

      {/* Pre-game rules briefing */}
      {showRules && (
        <InstructionCard
          title={t('runner.title')}
          subtitle={t(modeSpec.labelKey)}
          rules={rules}
          onStart={handleRulesStart}
          onBack={backToModes}
        />
      )}

      {/* Idle / calibrate chrome */}
      {!showRules && chromeVisible && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/45 p-8 backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl bg-black/70 px-6 py-5 text-center">
            <h1 className="mb-2 text-2xl font-black">{t('runner.title')}</h1>
            <p className="text-sm text-white/75">
              {players === 1 ? t('runner.howto') : t('runner.rule.livesRace')}
            </p>
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
            <div className="flex flex-col items-center gap-3">
              {players > 1 && (
                <div className="flex gap-2">
                  {active.map((c, i) => (
                    <span
                      key={i}
                      className="rounded-full px-3 py-1 text-xs font-bold"
                      style={{
                        background: c.reliable ? RUNNER_COLORS[i] : 'rgba(255,255,255,0.15)',
                        color: c.reliable ? '#000' : '#fff',
                      }}
                    >
                      {t('runner.pLabel', { n: i + 1 })}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={beginCalibration}
                disabled={active.some((c) => c.calibrating)}
                className="rounded-full bg-white px-8 py-4 text-lg font-black text-black disabled:opacity-50"
              >
                {active.some((c) => c.calibrating) ? t('runner.holdStill') : t('runner.ready')}
              </button>
            </div>
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
            {players === 1 ? (
              <>
                <div className="mt-1 text-7xl font-black tabular-nums">{result.players[0].score}</div>
                <div className="mt-1 text-sm text-white/70">
                  {t('runner.coins', { n: result.players[0].coins })}
                </div>
                {result.isBest ? (
                  <div className="mt-2 text-lg font-black text-lime-400">{t('runner.newRecord')}</div>
                ) : (
                  <div className="mt-2 text-sm text-white/60">{t('runner.record', { n: result.best })}</div>
                )}
              </>
            ) : (
              <>
                <div className="mt-1 text-3xl font-black">
                  {result.winnerIndex === null
                    ? t('runner.draw')
                    : t('runner.wins', { name: t('runner.pLabel', { n: result.winnerIndex + 1 }) })}
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {[...result.players]
                    .sort((a, b) => b.score - a.score)
                    .map((p) => (
                      <div
                        key={p.index}
                        className="flex items-center justify-between gap-6 rounded-xl bg-white/10 px-4 py-2"
                      >
                        <span
                          className="text-sm font-bold"
                          style={{ color: RUNNER_COLORS[p.index] }}
                        >
                          {t('runner.pLabel', { n: p.index + 1 })}
                        </span>
                        <span className="tabular-nums text-lg font-black">{p.score}</span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
          <ClipShare
            status={clipStatus}
            sharing={sharing}
            shareError={shareError}
            onShare={handleShareClip}
            tone="dark"
          />
          <div className="flex gap-3">
            <button
              onClick={handleAgain}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              {t('runner.again')}
            </button>
            <button
              onClick={backToModes}
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
