import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { runCountdown } from '../countdown'
import { DEFAULT_HUD, drawPoseTarget } from '../cv/draw'
import type { EngineFrame } from '../cv/engine'
import { armsReady, type RawPosture } from '../cv/tracking'
import { prefetchEngine, usePoseDetection } from '../hooks/usePoseDetection'
import { useWakeLock } from '../hooks/useWakeLock'
import { useI18n } from '../i18n'
import {
  nextInfinitePoseId,
  poseArmScores,
  poseConfidenceOk,
  poseSimilarity,
  poseTargetFor,
  type PoseId,
} from '../modes'
import { InstructionCard, type Rule } from './InstructionCard'
import { PoseStickFigure } from './PoseStickFigure'

type Phase = 'idle' | 'calibrate' | 'countdown' | 'play' | 'over'

/** Solo lock — quicker than the duel's 3s since there's only one body to find. */
const LOCK_DURATION_MS = 1500
/** The calibration overlay must never be able to hang indefinitely. */
const CALIBRATION_TIMEOUT_MS = 8000
/** Lives a run starts with — a miss costs one, not the whole run. */
const START_LIVES = 3

/**
 * Outer pacing envelope: how long the player has to land the CURRENT pose
 * before it's a miss. The accuracy ramp (poseBandFor below — tighter
 * tolerance, longer required continuous hold, higher threshold) already
 * carries Infinite Pose's difficulty curve; this window only exists so
 * standing still and never attempting a pose can't stall the run forever.
 */
const BASE_WINDOW_MS = 4000
const MIN_WINDOW_MS = 1200
const WINDOW_DECAY = 0.95

function poseWindowMs(attemptNumber: number): number {
  return Math.max(MIN_WINDOW_MS, BASE_WINDOW_MS * Math.pow(WINDOW_DECAY, attemptNumber))
}

interface PoseBand {
  toleranceDeg: number
  holdMs: number
  passThreshold: number
}

/** Infinite Pose escalation table. attemptNumber is 1-indexed (the "Level" shown on screen) — pool expansion (Tier 2 from 6) lives in nextInfinitePoseId itself. */
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
 * level 6) opens the asymmetric Tier 2 pool. A miss costs one of 3 lives
 * instead of ending the run outright. Reuses the pose-scoring primitives in
 * modes.ts (poseSimilarity / poseArmScores / nextInfinitePoseId /
 * POSE_DEFINITIONS); the live per-limb correctness skeleton and the target
 * figure are both drawn by the engine/cv-draw layer this screen configures.
 * Reached at #pose.
 */
export function InfinitePoseScreen() {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [showRules, setShowRules] = useState(true)
  const [mirror, setMirror] = useState(true)
  const [count, setCount] = useState(3)
  const [presentCount, setPresentCount] = useState(0)
  const [level, setLevel] = useState(1)
  const [lives, setLives] = useState(START_LIVES)
  const [best, setBest] = useState(() => loadBest())
  const [isNewBest, setIsNewBest] = useState(false)
  const [hintText, setHintText] = useState<string | null>(null)
  const [hintIcon, setHintIcon] = useState<string>('🙌')
  const [holdProgress, setHoldProgress] = useState(0)
  const [calibrationStalled, setCalibrationStalled] = useState(false)
  const wakeLock = useWakeLock()

  const lockStartRef = useRef<number | null>(null)
  const calibrationStartRef = useRef<number | null>(null)
  const currentPoseIdRef = useRef<PoseId | null>(null)
  const bandRef = useRef<PoseBand>(poseBandFor(1))
  const holdStartRef = useRef<number | null>(null)
  const windowStartRef = useRef(0)
  const attemptRef = useRef(1)
  const livesRef = useRef(START_LIVES)
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
      showSkeleton: true,
      rolesLocked: false,
      names: [t('runner.you')],
    })
  }, [mirror, configure, t])

  // This screen is its own page load (reached via a hash + full reload from
  // Home), so Home's own prefetch never runs for it — start pulling in the
  // model right away, while the rules card is still showing.
  useEffect(() => {
    prefetchEngine()
  }, [])

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

  const drawOverlay = (poseId: PoseId) => {
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
    drawPoseTarget(ctx, cv.width, cv.height, target.arms, mirror)
  }

  /** Choose the next target pose (at the CURRENT attempt number) and reset the hold accumulator + outer window. Does not itself change the attempt number — landing vs missing decide that. */
  const advancePose = (now: number) => {
    currentPoseIdRef.current = nextInfinitePoseId(currentPoseIdRef.current, attemptRef.current, Math.random)
    bandRef.current = poseBandFor(attemptRef.current)
    holdStartRef.current = null
    windowStartRef.current = now
    drawOverlay(currentPoseIdRef.current)
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
        const ready = frame.presentCount >= 1 && armsReady(frame.players[0]?.skeleton)
        const fh = framingHint(posture, videoRef.current?.videoHeight ?? 0)
        if (fh) {
          setHintIcon(fh === 'stepBack' ? '⬅️' : '➡️')
          setHintText(t(`pose.hint.${fh}`))
        } else if (frame.presentCount >= 1 && !ready) {
          setHintIcon('🙌')
          setHintText(t('pose.hint.showArms'))
        } else {
          setHintText(null)
        }

        if (ready) {
          if (lockStartRef.current === null) {
            lockStartRef.current = frame.now
            sfx.lock()
            console.log('[Calibration] Player + arms detected — locking...')
          } else if (frame.now - lockStartRef.current >= LOCK_DURATION_MS) {
            console.log('[Calibration] Solo Pose calibrated successfully, transitioning to game loop.')
            setPhase('countdown')
          }
        } else {
          if (lockStartRef.current !== null) {
            console.log('[Calibration] Player or arms lost — lock reset.')
          }
          lockStartRef.current = null
        }

        // Safety net: the overlay must never be able to hang indefinitely.
        // Only auto-proceed once actually ready — auto-starting into a
        // framing where arms aren't visible would just reproduce the bug
        // this gate exists to prevent.
        if (calibrationElapsed >= CALIBRATION_TIMEOUT_MS) {
          if (ready) {
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
          setHintIcon(fh === 'stepBack' ? '⬅️' : '➡️')
          setHintText(t(`pose.hint.${fh}`))
        } else if (!poseConfidenceOk(confidence)) {
          setHintIcon('🙌')
          setHintText(t('pose.hint.showArms'))
        } else {
          setHintText(null)
        }

        const band = bandRef.current
        const match = poseSimilarity(pose, confidence, poseId, band.toleranceDeg)
        const armScores = poseArmScores(pose, confidence, poseId, band.toleranceDeg)
        configure({
          hud: {
            ...DEFAULT_HUD,
            poseArmMatch: [armScores, { left: null, right: null }],
            posePassThreshold: band.passThreshold,
          },
        })

        if (match >= band.passThreshold) {
          if (holdStartRef.current === null) holdStartRef.current = frame.now
          const held = frame.now - (holdStartRef.current ?? frame.now)
          setHoldProgress(Math.min(1, held / band.holdMs))
          if (held >= band.holdMs) {
            // Landed it — next attempt is faster and stricter.
            sfx.tick()
            attemptRef.current += 1
            setLevel(attemptRef.current)
            advancePose(frame.now)
            setHoldProgress(0)
            return
          }
        } else {
          holdStartRef.current = null
          setHoldProgress(0)
        }

        const window = poseWindowMs(attemptRef.current)
        if (frame.now - windowStartRef.current >= window) {
          // Missed this pose — costs a life, but the run continues at the
          // same difficulty (a new pose, not a harder one) until lives run out.
          livesRef.current -= 1
          setLives(livesRef.current)
          if (livesRef.current <= 0) {
            finish()
          } else {
            sfx.alert()
            advancePose(frame.now)
          }
        }
      }
    } catch (err) {
      console.error('[Calibration] Unexpected error in the pose frame handler:', err)
    }
  }

  const startPlay = () => {
    attemptRef.current = 1
    setLevel(1)
    livesRef.current = START_LIVES
    setLives(START_LIVES)
    // The very first pose of every run is always the easiest, most
    // recognizable one (arms level out to the sides) at the most forgiving
    // band, so a brand-new player gets an early success and can confirm the
    // system is actually responding to them before anything harder shows up.
    currentPoseIdRef.current = 't_pose'
    bandRef.current = poseBandFor(1)
    holdStartRef.current = null
    windowStartRef.current = performance.now()
    setIsNewBest(false)
    setHoldProgress(0)
    drawOverlay('t_pose')
    console.log('[Calibration] Countdown complete — entering the pose game loop.')
    setPhase('play')
  }

  const finish = () => {
    sfx.whistle()
    const finalLevel = attemptRef.current
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
    // Clear any correctness colors left over from the previous run so the
    // live skeleton reads neutral again during the next calibration.
    configure({ hud: { ...DEFAULT_HUD } })
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

  // Booting (camera + model loading) gets a small non-blocking pill only —
  // the live video is already visible underneath by this point and must
  // never be dimmed or covered while we're merely waiting on the model.
  // The bigger dim+card treatment is reserved for states that genuinely
  // need the player's attention: framing themselves, or a real error.
  const booting = phase === 'idle' && status === 'starting'
  const chromeVisible = phase === 'calibrate' || (phase === 'idle' && status === 'error')
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
          <div className="flex items-center gap-5 rounded-full bg-black/70 px-6 py-2 backdrop-blur">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
                {t('pose.level')}
              </span>
              <span className="text-3xl font-black tabular-nums">{level}</span>
            </span>
            <span className="flex gap-1">
              {Array.from({ length: START_LIVES }).map((_, i) => (
                <span
                  key={i}
                  className={`text-3xl transition-all duration-300 ${
                    i < lives ? 'scale-100 opacity-100' : 'scale-75 opacity-25 grayscale'
                  }`}
                >
                  ❤️
                </span>
              ))}
            </span>
          </div>
          {phase === 'play' && holdProgress > 0 && (
            <div className="h-2 w-40 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-lime-400" style={{ width: `${holdProgress * 100}%` }} />
            </div>
          )}
          {phase === 'play' && hintText && (
            <div className="flex items-center gap-2 rounded-full bg-black/75 px-5 py-2 backdrop-blur">
              <span className="text-2xl">{hintIcon}</span>
              <span className="text-lg font-black text-white">{hintText}</span>
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
        {(chromeVisible || booting) && (
          <label className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm backdrop-blur">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            {t('online.mirror')}
          </label>
        )}
      </div>

      {/* Booting: a small non-blocking pill — the live video is already
          showing underneath, so this must never dim or cover it. */}
      {booting && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-20 flex justify-center">
          <div className="flex items-center gap-3 rounded-full bg-black/70 px-6 py-3 backdrop-blur">
            <LoaderCircle className="size-5 animate-spin text-white" aria-hidden />
            <span className="text-base font-semibold text-white sm:text-lg">
              {t('runner.startingCamera')}
            </span>
          </div>
        </div>
      )}

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
                <div className="flex items-center gap-2 rounded-full bg-black/70 px-5 py-3 text-base font-bold text-white">
                  <span className="text-2xl">{hintIcon}</span>
                  {hintText}
                </div>
              )}
            </>
          )}
          {status === 'running' && phase === 'calibrate' && calibrationStalled && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex max-w-sm items-center gap-2 rounded-xl bg-black/70 px-5 py-3 text-center text-base font-bold text-white">
                <span className="text-2xl">{hintIcon}</span>
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
            <div className="flex max-w-sm flex-col items-center gap-3">
              <div className="rounded-xl bg-red-600/85 px-5 py-3 text-center text-sm font-semibold">{error}</div>
              <button
                onClick={() => void start()}
                className="rounded-full bg-lime-400 px-6 py-3 text-sm font-black text-black"
              >
                {t('runner.again')}
              </button>
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
