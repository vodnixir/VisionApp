import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { runCountdown } from '../countdown'
import { drawPoseTarget } from '../cv/draw'
import type { EngineFrame } from '../cv/engine'
import { usePoseDetection } from '../hooks/usePoseDetection'
import { useWakeLock } from '../hooks/useWakeLock'
import { useI18n } from '../i18n'
import { POSE_LIBRARY, POSE_MATCH_MIN, nextPoseIndex, poseSimilarity } from '../modes'
import { InstructionCard, type Rule } from './InstructionCard'

type Phase = 'idle' | 'calibrate' | 'countdown' | 'play' | 'over'

/** Solo lock — quicker than the duel's 3s since there's only one body to find. */
const LOCK_DURATION_MS = 1500

/**
 * Escalating difficulty. Every landed pose shrinks the window for the next
 * one (down to a floor) and nudges up the accuracy required to land it (up
 * to a ceiling well short of a perfect 1 — real camera tracking never reads
 * that clean).
 */
const BASE_INTERVAL_MS = 4000
const MIN_INTERVAL_MS = 1200
const INTERVAL_DECAY = 0.95
const MAX_MATCH_THRESHOLD = 0.85
const MATCH_RAMP_PER_LEVEL = 0.015

function poseIntervalMs(level: number): number {
  return Math.max(MIN_INTERVAL_MS, BASE_INTERVAL_MS * Math.pow(INTERVAL_DECAY, level))
}

function matchThreshold(level: number): number {
  return Math.min(MAX_MATCH_THRESHOLD, POSE_MATCH_MIN + level * MATCH_RAMP_PER_LEVEL)
}

const BEST_KEY = 'sb.pose.best.v1'

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

function saveBest(level: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(level))
  } catch {
    /* storage unavailable */
  }
}

/**
 * Infinite Pose Challenge: solo, endless. A target pose appears and the
 * window to strike it shrinks every level (poseIntervalMs) while the
 * accuracy required to land it climbs (matchThreshold) — this reuses the
 * exact pose-scoring primitives the 1v1 "Copy the Pose" duel already runs on
 * (POSE_LIBRARY / poseSimilarity / POSE_MATCH_MIN in modes.ts, and the same
 * drawPoseTarget skeleton renderer from cv/draw.ts). This screen only adds
 * the escalating solo loop around them — no new CV or matching logic. Miss
 * the window once and it's over. Reached at #pose.
 */
export function InfinitePoseScreen() {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [showRules, setShowRules] = useState(true)
  const [mirror, setMirror] = useState(true)
  const [count, setCount] = useState(3)
  const [presentCount, setPresentCount] = useState(0)
  const [level, setLevel] = useState(0)
  const [best, setBest] = useState(() => loadBest())
  const [isNewBest, setIsNewBest] = useState(false)
  const wakeLock = useWakeLock()

  const lockStartRef = useRef<number | null>(null)
  const poseIndexRef = useRef(0)
  const windowStartRef = useRef(0)
  const levelRef = useRef(0)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  const onFrameRef = useRef<(frame: EngineFrame) => void>(() => {})
  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection((frame) =>
    onFrameRef.current(frame),
  )

  useEffect(() => {
    configure({
      mirror,
      // Exactly 1 tracked body — without this the engine defaults maxPlayers
      // to 2 (its duel-shaped default), which also disables the ROI zoom-in
      // crop entirely (it only activates once EVERY expected slot is filled,
      // and a lone solo player can never fill a phantom second slot).
      maxPlayers: 1,
      scoring: false,
      drawOverlays: true,
      rolesLocked: false,
      names: [t('runner.you')],
    })
  }, [mirror, configure, t])

  // Camera came up → move to the "step into frame" prompt.
  useEffect(() => {
    if (status === 'running' && phase === 'idle') setPhase('calibrate')
  }, [status, phase])

  // Countdown 3 → 2 → 1 → GO, then start the pose loop.
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
        startPlay()
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Teardown.
  useEffect(
    () => () => {
      stop()
      wakeLock.release()
    },
    [stop, wakeLock],
  )

  const drawOverlay = (matchNow: number) => {
    const cv = overlayRef.current
    if (!cv) return
    if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) {
      cv.width = cv.clientWidth
      cv.height = cv.clientHeight
    }
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    const target = POSE_LIBRARY[poseIndexRef.current]
    drawPoseTarget(ctx, cv.width, cv.height, target.arms, [matchNow, matchNow])
  }

  onFrameRef.current = (frame: EngineFrame) => {
    // The engine's inference loop calls this directly from an async while
    // loop with no surrounding try/catch of its own — an uncaught throw in
    // here would silently kill inference for good (no more frames, no error
    // shown anywhere, indistinguishable from "stuck"). Catching and logging
    // here turns that failure mode into a visible one instead.
    try {
      if (phase === 'calibrate') {
        setPresentCount(frame.presentCount)
        if (frame.presentCount >= 1) {
          if (lockStartRef.current === null) {
            lockStartRef.current = frame.now
            sfx.lock()
            console.log('[Calibration] Player detected — locking...')
          } else if (frame.now - lockStartRef.current >= LOCK_DURATION_MS) {
            console.log('[Calibration] Solo Pose calibrated successfully, transitioning to game loop.')
            setPhase('countdown')
          }
        } else {
          if (lockStartRef.current !== null) {
            console.log('[Calibration] Player lost frame — lock reset.')
          }
          lockStartRef.current = null
        }
        return
      }

      if (phase === 'play') {
        const pose = frame.players[0]?.arms ?? null
        const target = POSE_LIBRARY[poseIndexRef.current]
        const match = poseSimilarity(pose, target)
        drawOverlay(match)

        const threshold = matchThreshold(levelRef.current)
        if (match >= threshold) {
          // Landed it — level up, next pose is faster and stricter.
          levelRef.current += 1
          setLevel(levelRef.current)
          sfx.tick()
          poseIndexRef.current = nextPoseIndex(poseIndexRef.current, Math.random)
          windowStartRef.current = frame.now
          return
        }
        const window = poseIntervalMs(levelRef.current)
        if (frame.now - windowStartRef.current >= window) {
          finish()
        }
      }
    } catch (err) {
      console.error('[Calibration] Unexpected error in the pose frame handler:', err)
    }
  }

  const startPlay = () => {
    levelRef.current = 0
    setLevel(0)
    poseIndexRef.current = nextPoseIndex(-1, Math.random)
    windowStartRef.current = performance.now()
    setIsNewBest(false)
    console.log('[Calibration] Countdown complete — entering the pose game loop.')
    setPhase('play')
  }

  const finish = () => {
    sfx.whistle()
    const finalLevel = levelRef.current
    if (finalLevel > best) {
      setBest(finalLevel)
      saveBest(finalLevel)
      setIsNewBest(true)
    }
    setPhase('over')
  }

  const handleRulesStart = () => {
    setShowRules(false)
    sfx.unlock()
    wakeLock.acquire()
    if (status === 'idle') void start()
  }

  const handleAgain = () => {
    lockStartRef.current = null
    setPhase(presentCount >= 1 ? 'countdown' : 'calibrate')
  }

  const goHome = () => {
    stop()
    wakeLock.release()
    window.location.hash = ''
    window.location.reload()
  }

  const rules: Rule[] = [
    { emoji: '🧍', text: t('pose.rule.copy') },
    { emoji: '⏱️', text: t('pose.rule.shrink') },
    { emoji: '💥', text: t('pose.rule.miss') },
  ]

  const chromeVisible = phase === 'calibrate' || (phase === 'idle' && status !== 'running')
  const showWorld = phase === 'play' || phase === 'over'

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />
      <canvas
        ref={overlayRef}
        className={`pointer-events-none absolute inset-0 h-full w-full ${showWorld ? '' : 'hidden'}`}
      />

      {showWorld && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <div className="flex items-center gap-4 rounded-full bg-black/60 px-6 py-2 backdrop-blur">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
              {t('pose.level')}
            </span>
            <span className="text-2xl font-black tabular-nums">{level}</span>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between p-3">
        <button
          onClick={goHome}
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

      {/* Rules briefing */}
      {showRules && (
        <InstructionCard
          title={t('pose.title')}
          subtitle={t('pose.subtitle')}
          rules={rules}
          onStart={handleRulesStart}
          onBack={goHome}
        />
      )}

      {/* Idle / calibrate chrome */}
      {!showRules && chromeVisible && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/45 p-8 backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl bg-black/70 px-6 py-5 text-center">
            <h1 className="mb-2 text-2xl font-black">{t('pose.title')}</h1>
            <p className="text-sm text-white/75">{t('pose.lineUp')}</p>
          </div>
          {status === 'starting' && (
            <div className="rounded-full bg-black/70 px-8 py-4 text-lg font-semibold">
              {t('runner.startingCamera')}
            </div>
          )}
          {status === 'running' && phase === 'calibrate' && (
            <div
              className="rounded-full px-8 py-4 text-lg font-black"
              style={{
                background: presentCount >= 1 ? '#a3e635' : 'rgba(255,255,255,0.15)',
                color: presentCount >= 1 ? '#000' : '#fff',
              }}
            >
              {presentCount >= 1 ? t('pose.ready') : t('pose.stepIn')}
            </div>
          )}
          {status === 'error' && error && (
            <div className="max-w-sm rounded-xl bg-red-600/85 px-5 py-3 text-center text-sm font-semibold">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {phase === 'over' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/72 p-8 backdrop-blur">
          <div className="text-center">
            <div className="text-sm uppercase tracking-widest text-white/60">{t('pose.over')}</div>
            <div className="mt-1 text-5xl font-black tabular-nums">{level}</div>
            {isNewBest ? (
              <div className="mt-2 text-sm font-bold text-lime-400">{t('pose.newBest')}</div>
            ) : (
              <div className="mt-2 text-sm text-white/60">{t('pose.best', { n: best })}</div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAgain}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              {t('runner.again')}
            </button>
            <button onClick={goHome} className="rounded-full bg-white/15 px-6 py-4 text-lg font-semibold">
              {t('runner.exit')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
