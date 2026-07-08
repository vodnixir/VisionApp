import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import * as poseDetection from '@tensorflow-models/pose-detection'
import { PLAYER_COLORS } from '../types'
import { PlayerTracker, PERSISTENCE_FRAMES, assignRoles, selectFighters, type BBox } from './tracking'
import { drawBrackets, drawLabel } from './draw'

export interface EngineConfig {
  mirror: boolean
  names: [string, string]
  /** Compute activity speed (only meaningful while a match runs). */
  scoring: boolean
  /** Draw brackets + labels on the canvas. */
  drawOverlays: boolean
}

export interface EnginePlayerFrame {
  present: boolean
  visible: boolean
  bbox: BBox | null
  /** Smoothed activity, 0..1. */
  speed: number
}

export interface EngineFrame {
  /** performance.now() of this inference frame, ms. */
  now: number
  /** Seconds since the previous inference frame (clamped). */
  dt: number
  presentCount: number
  players: [EnginePlayerFrame, EnginePlayerFrame]
}

/**
 * Owns the webcam stream, the TFJS detector and two render loops:
 *  - an inference loop running MoveNet MultiPose as fast as the device allows
 *  - a rAF render loop drawing the video + overlays at full display rate
 * All React interaction goes through getConfig()/onFrame so the engine itself
 * is framework-free and immune to re-renders.
 */
export class PoseEngine {
  private detector: poseDetection.PoseDetector | null = null
  private stream: MediaStream | null = null
  private trackers: [PlayerTracker, PlayerTracker] = [new PlayerTracker(), new PlayerTracker()]
  private running = false
  private destroyed = false
  private renderRaf = 0
  private lastInferenceAt = 0

  private readonly video: HTMLVideoElement
  private readonly canvas: HTMLCanvasElement
  private readonly getConfig: () => EngineConfig
  private readonly onFrame: (frame: EngineFrame) => void

  constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    getConfig: () => EngineConfig,
    onFrame: (frame: EngineFrame) => void,
  ) {
    this.video = video
    this.canvas = canvas
    this.getConfig = getConfig
    this.onFrame = onFrame
  }

  /** Full boot: camera -> WebGL backend -> MoveNet -> loops. Safe to abort via destroy(). */
  async start(): Promise<void> {
    if (this.running || this.destroyed) return

    // 1. Camera
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
    } catch (err) {
      throw new Error(friendlyCameraError(err))
    }
    if (this.destroyed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    this.video.srcObject = stream
    await this.video.play()
    await this.waitForVideoSize()
    if (this.destroyed) return

    // 2. WebGL backend
    try {
      await tf.setBackend('webgl')
      await tf.ready()
    } catch {
      throw new Error('WebGL is not available on this device — the pose model cannot run.')
    }
    if (this.destroyed) return

    // 3. MoveNet MultiPose Lightning (built-in tracker smooths raw keypoints;
    //    our own EMA + deadzone handle the rest). The model is bundled with the
    //    app (public/models) so no internet is needed at runtime.
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      modelUrl: `${import.meta.env.BASE_URL}models/movenet-multipose/model.json`,
      enableTracking: true,
      trackerType: poseDetection.TrackerType.BoundingBox,
      enableSmoothing: true,
    })
    if (this.destroyed) {
      detector.dispose()
      return
    }
    this.detector = detector

    // 4. Loops
    this.running = true
    this.lastInferenceAt = performance.now()
    this.renderRaf = requestAnimationFrame(this.renderTick)
    void this.inferenceLoop()
  }

  destroy(): void {
    this.destroyed = true
    this.running = false
    cancelAnimationFrame(this.renderRaf)
    this.detector?.dispose()
    this.detector = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    this.trackers.forEach((t) => t.reset())
  }

  /* ---------------- Inference loop ---------------- */

  private async inferenceLoop(): Promise<void> {
    while (this.running && !this.destroyed) {
      await nextAnimationFrame()
      if (!this.running || this.destroyed || !this.detector) return
      if (this.video.readyState < 2 || this.video.videoWidth === 0) continue

      const now = performance.now()
      // Clamp dt so a tab switch / hiccup can't produce a giant motion delta.
      const dt = Math.min((now - this.lastInferenceAt) / 1000, 0.1)
      this.lastInferenceAt = now

      let poses: poseDetection.Pose[]
      try {
        poses = await this.detector.estimatePoses(this.video)
      } catch {
        continue
      }
      if (!this.running || this.destroyed) return

      const config = this.getConfig()
      const fighters = selectFighters(poses)
      const roles = assignRoles(fighters, this.video.videoWidth, config.mirror)

      for (const tracker of this.trackers) tracker.age()
      roles.forEach((candidate, i) => {
        if (candidate) this.trackers[i].observe(candidate, dt, config.scoring)
      })
      for (const tracker of this.trackers) {
        if (tracker.present && !tracker.visible) tracker.decay()
      }

      const players = this.trackers.map((t) => ({
        present: t.present,
        visible: t.visible,
        bbox: t.bbox,
        speed: t.speed,
      })) as [EnginePlayerFrame, EnginePlayerFrame]

      this.onFrame({
        now,
        dt,
        presentCount: players.filter((p) => p.present).length,
        players,
      })
    }
  }

  /* ---------------- Render loop ---------------- */

  private renderTick = (): void => {
    if (!this.running || this.destroyed) return
    this.draw()
    this.renderRaf = requestAnimationFrame(this.renderTick)
  }

  private draw(): void {
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    if (vw === 0 || vh === 0) return
    if (this.canvas.width !== vw || this.canvas.height !== vh) {
      this.canvas.width = vw
      this.canvas.height = vh
    }
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const config = this.getConfig()

    // Video frame (mirrored for TV mode). Overlays are drawn afterwards in
    // un-mirrored space with manually flipped coordinates so text stays readable.
    ctx.save()
    if (config.mirror) {
      ctx.translate(vw, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(this.video, 0, 0, vw, vh)
    ctx.restore()

    if (!config.drawOverlays) return

    this.trackers.forEach((tracker, i) => {
      if (!tracker.present || !tracker.bbox) return
      let bbox = tracker.bbox
      if (config.mirror) bbox = { ...bbox, x: vw - bbox.x - bbox.w }
      // Fade the bracket while the track lives on persistence alone.
      const alpha = tracker.visible ? 1 : Math.max(0.3, 1 - (tracker.framesSinceSeen / (PERSISTENCE_FRAMES + 1)) * 0.7)
      drawBrackets(ctx, bbox, PLAYER_COLORS[i], { alpha, speed: tracker.speed })
      drawLabel(ctx, config.names[i], bbox, PLAYER_COLORS[i], alpha, vw)
    })
  }

  /* ---------------- Helpers ---------------- */

  private waitForVideoSize(): Promise<void> {
    if (this.video.videoWidth > 0) return Promise.resolve()
    return new Promise((resolve) => {
      const check = () => {
        if (this.destroyed || this.video.videoWidth > 0) resolve()
        else requestAnimationFrame(check)
      }
      check()
    })
  }
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

function friendlyCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Camera access was denied. Allow camera permission and try again.'
    if (err.name === 'NotFoundError') return 'No camera found on this device.'
    if (err.name === 'NotReadableError') return 'The camera is busy in another application.'
  }
  if (!window.isSecureContext) {
    return 'Camera requires HTTPS. Run "npm run dev:lan" and open the https:// URL on this device.'
  }
  return 'Could not start the camera.'
}
