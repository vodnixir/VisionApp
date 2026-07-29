import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { runCountdown } from '../countdown'
import { drawPoseTarget } from '../cv/draw'
import type { EngineFrame } from '../cv/engine'
import type { RawPosture } from '../cv/tracking'
import { usePoseDetection } from '../hooks/usePoseDetection'
import { useWakeLock } from '../hooks/useWakeLock'
import { useI18n } from '../i18n'
import { nextInfinitePoseId, poseConfidenceOk, poseSimilarity, poseTargetFor, type PoseId } from '../modes'
import { InstructionCard, type Rule } from './InstructionCard'
import { PoseStickFigure } from './PoseStickFigure'

type Phase = 'idle' | 'calibrate' | 'countdown' | 'play' | 'over'

/** Solo lock — quicker than the duel's 3s since there's only one body to find. */
const LOCK_DURATION_MS = 1500
/** The calibration overlay must never be able to hang indefinitely. */
const CALIBRATION_TIMEOUT_MS = 8000

/**
 * Outer pacing envelope: how long the player has to land the CURRENT pose
 * before it's a miss. The accuracy ramp (POSE_BANDS below — tighter
 * tolerance, longer required continuous hold, higher threshold) already
 * carries Infinite Pose's difficulty curve; this window only exists so
 * standing still and never attempting a pose can't stall the run forever.
 * Same shrinking shape as before this rewrite.
 */
const BASE_WINDOW_MS = 4000
const MIN_WINDOW_MS = 1200
const WINDOW_DECAY = 0.95

function poseWindowMs(level: number): number {
  return Math.max(MIN_WINDOW_MS, BASE_WINDOW_MS * Math.pow(WINDOW_DECAY, level))
}

interface PoseBand {
  toleranceDeg: number
  holdMs: number
  passThreshold: number
}

/** Infinite Pose escalation table. attemptNumber is 1-indexed (landed count + 1) — pool expansion (Tier 2 from 6) lives in nextInfinitePoseId itself. */
function poseBandFor(attemptNumber: number): PoseBand {
  if (attemptNumber >= 21) return { toleranceDeg: 18, holdMs: 500, passThreshold: 0.8 }
  if (attemptNumber >= 13) return { toleranceDeg: 22, holdMs: 700, passThreshold: 0.72 }
  if (attemptNumber >= 6) return { toleranceDeg: 28, holdMs: 900, passThreshold: 0.65 }
  return { toleranceDeg: 35, holdMs: 1200, passThreshold: 0.55 }
}

/** Below this fraction of the video's height, the tracked torso reads too small — the player is too far away. */
const FAR_TORSO_FRACTION = 0.12
/** Above this fraction the torso reads too large — the player is too close and risks clipping out of frame. */
const CLOSE_TORSO_FRACTION = 0.6

/** Torso-height framing hint — shoulders + hips only (RawPosture.torsoHeight), never legs. */
function framingHint(posture: RawPosture | null, videoHeight: number): 'stepBack' | 'comeCloser' | null {
  if (!posture || videoHeight <= 0 || posture.torsoHeight <= 0) return null
  const frac = posture.torsoHeight / videoHeight
  if (frac < FAR_TORSO_FRACTION) return 'comeCloser'
  if (frac > CLOSE_TORSO_FRACTION) return 'stepBack'
  return null
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
 * Infinite Pose Challenge: solo, endless. A target pose appears and must be
 * held — score at or above the current level's passThreshold, continuously,
 * for holdMs — before the outer per-pose window runs out. Landing it
 * advances the level, which tightens tolerance/threshold/hold and (from
 * level 6) opens the asymmetric Tier 2 pool. Reuses the pose-scoring
 * primitives in modes.ts (poseSimilarity / nextInfinitePoseId /
 * POSE_DEFINITIONS) and the same drawPoseTarget skeleton renderer
 * cv/draw.ts already exports — this screen only owns the escalating solo
 * loop around them. Reached at #pose.
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
  const [hintText, setHintText] = useState<string | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)
  const [calibrationStalled, setCalibrationStalled] = useState(false)
  const wakeLock = useWakeLock()

  const lockStartRef = useRef<number | null>(null)
  const calibrationStartRef = useRef<number | null>(null)
  const currentPoseIdRef = useRef<PoseId | null>(null)
  const bandRef = useRef<PoseBand>(poseBandFor(1))
  const holdStartRef = useRef<number | null>(null)
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

  const drawOverlay = (matchNow: number, poseId: PoseId) => {
    const cv = overlayRef.current
    if (!cv) return
    if (cv.width !== cv.clientWidth || cv.height !== cv.clientHeight) {
      cv.width = cv.clientWidth
      cv.height = cv.clientHeight
    }
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    const target = poseTargetFor(poseId)
    drawPoseTarget(ctx, cv.width, cv.height, target.arms, [matchNow, matchNow])
  }

  /** Choose the next target pose and reset both the hold accumulator and the outer window. */
  const advancePose = (now: number) => {
    const attemptNumber = levelRef.current + 1
    currentPoseIdRef.current = nextInfinitePoseId(currentPoseIdRef.current, attemptNumber, Math.random)
    bandRef.current = poseBandFor(attemptNumber)
    holdStartRef.current = null
    windowStartRef.current = now
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
        if (calibrationStartRef.current === null) calibrationStartRef.current = frame.now
        const calibrationElapsed = frame.now - (calibrationStartRef.current ?? frame.now)

        const posture = frame.players[0]?.posture ?? null
        const fh = framingHint(posture, videoRef.current?.videoHeight ?? 0)
        setHintText(fh ? t(`pose.hint.${fh}`) : null)

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

        // Safety net: the overlay must never be able to hang indefinitely.
        if (calibrationElapsed >= CALIBRATION_TIMEOUT_MS) {
          if (frame.presentCount >= 1) {
            console.warn('[Calibration] Timed out waiting for a stable lock — proceeding anyway.')
            setPhase('countdown')
          } else {
            setCalibrationStalled(true)
          }
        }
        return
      }

      if (phase === 'play') {
        const p = frame.players[0]
        const pose = p?.arms ?? null
        const confidence = p?.armsConfidence ?? null
        const posture = p?.posture ?? null
        const poseId = currentPoseIdRef.current
        if (!poseId) return

        const fh = framingHint(posture, videoRef.current?.videoHeight ?? 0)
        if (fh) {
          setHintText(t(`pose.hint.${fh}`))
        } else if (!poseConfidenceOk(confidence)) {
          setHintText(t('pose.hint.showArms'))
        } else {
          setHintText(null)
        }

        const band = bandRef.current
        const match = poseSimilarity(pose, confidence, poseId, band.toleranceDeg)
        drawOverlay(match, poseId)

        if (match >= band.passThreshold) {
          if (holdStartRef.current === null) holdStartRef.current = frame.now
          const held = frame.now - (holdStartRef.current ?? frame.now)
          setHoldProgress(Math.min(1, held / band.holdMs))
          if (held >= band.holdMs) {
            // Landed it — level up, next pose is faster and stricter.
            levelRef.current += 1
            setLevel(levelRef.current)
            sfx.tick()
            advancePose(frame.now)
            setHoldProgress(0)
            return
          }
        } else {
          holdStartRef.current = null
          setHoldProgress(0)
        }

        const window = poseWindowMs(levelRef.current)
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
    currentPoseIdRef.current = null
    advancePose(performance.now())
    setIsNewBest(false)
    setHoldProgress(0)
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
    calibrationStartRef.current = null
    setCalibrationStalled(false)
    setHintText(null)
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
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2">
          <div className="flex items-center gap-4 rounded-full bg-black/60 px-6 py-2 backdrop-blur">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
              {t('pose.level')}
            </span>
            <span className="text-2xl font-black tabular-nums">{level}</span>
          </div>
          {phase === 'play' && holdProgress > 0 && (
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-lime-400" style={{ width: `${holdProgress * 100}%` }} />
            </div>
          )}
          {phase === 'play' && hintText && (
            <div className="rounded-full bg-black/60 px-4 py-1 text-xs font-semibold text-white/85 backdrop-blur">
              {hintText}
            </div>
          )}
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
          preview={<PoseStickFigure left={{ upper: 90, fore: 90 }} right={{ upper: 90, fore: 90 }} />}
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
          {status === 'running' && phase === 'calibrate' && !calibrationStalled && (
            <>
              <div
                className="rounded-full px-8 py-4 text-lg font-black"
                style={{
                  background: presentCount >= 1 ? '#a3e635' : 'rgba(255,255,255,0.15)',
                  color: presentCount >= 1 ? '#000' : '#fff',
                }}
              >
                {presentCount >= 1 ? t('pose.ready') : t('pose.stepIn')}
              </div>
              {hintText && (
                <div className="rounded-full bg-black/70 px-5 py-2 text-sm font-semibold text-white/80">
                  {hintText}
                </div>
              )}
            </>
          )}
          {status === 'running' && phase === 'calibrate' && calibrationStalled && (
            <div className="flex flex-col items-center gap-3">
              <div className="max-w-sm rounded-xl bg-black/70 px-5 py-3 text-center text-sm font-semibold text-white/85">
                {hintText ?? t('pose.stepIn')}
              </div>
              <button
                onClick={() => setPhase('countdown')}
                className="rounded-full bg-lime-400 px-6 py-3 text-sm font-black text-black"
              >
                {t('common.letsGo')}
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
