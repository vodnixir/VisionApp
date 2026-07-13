import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { EngineFrame } from '../cv/engine'
import type { Control } from './draw'
import {
  DEFAULT_GESTURE_CONFIG,
  averageNeutral,
  createGestureState,
  detectGesture,
  type GestureConfig,
  type GestureReading,
  type Neutral,
  type PostureSample,
} from './gestures'

/** Still-stance sample length before the neutral baseline locks in. */
export const CALIBRATE_MS = 1200

const NEUTRAL_CONTROL: Control = { lane: 0, airborne: false, crouching: false }

export interface UseRunnerControlOptions {
  /** Mirror the horizontal axis (the video is shown mirrored → step-right reads +). */
  mirror: boolean
  /** Detection thresholds. The spike tunes these live; the games use the default. */
  config?: GestureConfig
  /** Fired once a calibration completes with a usable baseline. */
  onCalibrated?: (neutral: Neutral) => void
  /** Fired every detection frame after calibration — for live UI / sound cues. */
  onReading?: (reading: GestureReading) => void
}

export interface RunnerControl {
  /** Latest lane / airborne / crouching — read by the game's rAF loop each frame. */
  controlRef: RefObject<Control>
  /** A full body is currently tracked (the lane/jump signals are reliable). */
  reliable: boolean
  /** A still-stance baseline is being captured right now. */
  calibrating: boolean
  /** A neutral baseline exists and gestures are live. */
  calibrated: boolean
  /** Begin (or restart) the still-stance calibration. */
  beginCalibration: () => void
  /** Drop the baseline and reset control to neutral. */
  reset: () => void
  /** Feed each pose frame here (from usePoseDetection's onFrame). */
  handleFrame: (frame: EngineFrame, canvasWidth: number) => void
}

/**
 * The runner control layer, shared by every body-driven screen (the solo game,
 * the online battle and the detection spike). It owns the calibration state
 * machine and the per-frame gesture detection so those ~40 identical lines stop
 * living in three components that were already drifting apart.
 *
 * The hot path (handleFrame) reads everything through refs, so it's stable
 * across renders and allocation-free — the pose engine calls it ~30–40×/s.
 */
export function useRunnerControl(opts: UseRunnerControlOptions): RunnerControl {
  const [reliable, setReliable] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrated, setCalibrated] = useState(false)

  const controlRef = useRef<Control>({ ...NEUTRAL_CONTROL })
  const gestureStateRef = useRef(createGestureState())
  const neutralRef = useRef<Neutral | null>(null)
  const calibBufRef = useRef<PostureSample[]>([])
  const calibStartRef = useRef<number | null>(null)
  const calibratingRef = useRef(false)

  // Live-updated refs so the frame callback never captures stale props.
  const mirrorRef = useRef(opts.mirror)
  mirrorRef.current = opts.mirror
  const configRef = useRef<GestureConfig>(opts.config ?? DEFAULT_GESTURE_CONFIG)
  configRef.current = opts.config ?? DEFAULT_GESTURE_CONFIG
  const onCalibratedRef = useRef(opts.onCalibrated)
  onCalibratedRef.current = opts.onCalibrated
  const onReadingRef = useRef(opts.onReading)
  onReadingRef.current = opts.onReading

  const beginCalibration = useCallback(() => {
    calibBufRef.current = []
    calibStartRef.current = null
    neutralRef.current = null
    calibratingRef.current = true
    setCalibrated(false)
    setCalibrating(true)
  }, [])

  const reset = useCallback(() => {
    calibratingRef.current = false
    calibStartRef.current = null
    calibBufRef.current = []
    neutralRef.current = null
    controlRef.current = { ...NEUTRAL_CONTROL }
    setCalibrating(false)
    setCalibrated(false)
  }, [])

  const handleFrame = useCallback((frame: EngineFrame, canvasWidth: number) => {
    const player = frame.players.find((p) => p.present && p.posture)
    // Only re-render when the reliability actually flips.
    setReliable((prev) => (prev === Boolean(player) ? prev : Boolean(player)))
    if (!player || !player.posture) return

    const raw = player.posture
    // Mirror X so "step to your right" reads as +offset, matching the mirrored
    // video the player sees. The neutral baseline is captured the same way.
    const centerX = mirrorRef.current && canvasWidth > 0 ? canvasWidth - raw.centerX : raw.centerX
    const scale = raw.shoulderWidth > 4 ? raw.shoulderWidth : raw.torsoHeight
    const sample: PostureSample = { centerX, hipY: raw.hipY, topY: raw.topY, scale, t: frame.now }

    if (calibratingRef.current) {
      calibStartRef.current ??= frame.now
      calibBufRef.current.push(sample)
      if (frame.now - calibStartRef.current >= CALIBRATE_MS) {
        const base = averageNeutral(calibBufRef.current)
        calibratingRef.current = false
        setCalibrating(false)
        if (base) {
          neutralRef.current = base
          gestureStateRef.current = createGestureState()
          setCalibrated(true)
          onCalibratedRef.current?.(base)
        }
      }
      return
    }

    const base = neutralRef.current
    if (!base) return
    const reading = detectGesture(gestureStateRef.current, sample, base, configRef.current)
    controlRef.current = {
      lane: reading.lane,
      airborne: reading.airborne,
      crouching: reading.crouch,
    }
    onReadingRef.current?.(reading)
  }, [])

  // Reset on unmount so a re-mounted screen never inherits a stale baseline.
  useEffect(() => reset, [reset])

  return { controlRef, reliable, calibrating, calibrated, beginCalibration, reset, handleFrame }
}
