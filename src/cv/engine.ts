import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import * as poseDetection from '@tensorflow-models/pose-detection'
import { playerColors } from '../theme'
import {
  FULL_SCAN_EVERY,
  PERSISTENCE_MS,
  PlayerTracker,
  ROI_WARMUP_FRAMES,
  assignRoles,
  computeRoi,
  emaBBox,
  iou,
  matchLockedRoles,
  roiTouchesEdge,
  selectFighters,
  type BBox,
  type RawPosture,
} from './tracking'
import {
  drawBrackets,
  drawComboTag,
  drawFaceMask,
  drawLabel,
  drawMatchHud,
  drawVictorySplash,
  type HudState,
} from './draw'

export interface EngineConfig {
  mirror: boolean
  names: [string, string]
  /** Compute activity speed (only meaningful while a match runs). */
  scoring: boolean
  /** Draw brackets + labels on the canvas. */
  drawOverlays: boolean
  /**
   * false → roles follow screen position (left = P1) — calibration behavior.
   * true → roles stick to the tracked bodies even when players cross sides.
   */
  rolesLocked: boolean
  /** Canvas HUD (bars / timer / victory) — part of the TV picture and the clip. */
  hud: HudState
  /** Privacy: draw robot masks over the players' faces (TV + clip). */
  mask: boolean
}

/** Live setup-quality signals, shown as hints during calibration. */
export interface EngineHints {
  /** Both players are in frame but too small — ask them to step closer. */
  tooFar: boolean
  /** The two boxes overlap a lot — ask the players to spread apart. */
  overlap: boolean
  /** The scene is too dark for reliable keypoints. */
  dark: boolean
}

const NO_HINTS: EngineHints = { tooFar: false, overlap: false, dark: false }

/** Players smaller than this fraction of frame height detect poorly. */
const TOO_FAR_HEIGHT_FRAC = 0.28
/** Above this IoU the pose model starts confusing the two bodies. */
const OVERLAP_IOU = 0.18
/** Average luma (0..255) below this = "turn on the lights". */
const DARK_LUMA = 58
/** Sample scene brightness every N-th inference frame (it needs a GPU readback). */
const LUMA_EVERY = 40

/**
 * Never infer more often than this: pose sampling above ~40 Hz adds nothing to
 * motion scoring and just burns battery on 60 fps cameras / 120 Hz displays.
 */
const MIN_INFER_INTERVAL_MS = 25

/** This many estimatePoses() failures in a row = the GPU pipeline is dead. */
const FATAL_FAILURE_STREAK = 45

/**
 * Crop dimensions snap to this grid. Stable tensor shapes mean the WebGL
 * backend compiles each conv shader once instead of on every ±1 px ROI jitter.
 */
const CROP_QUANTUM = 32

/** localStorage key remembering which TFJS backend actually works here. */
const BACKEND_CACHE_KEY = 'sb.backend.v1'

/* ---------------- Hitmarker particles ---------------- */

/**
 * One neon hitmarker spark. Position/velocity live in DISPLAY space (already
 * mirror-flipped at spawn), so the render step draws them as-is and they always
 * land on the correct side of a TV-mirrored arena.
 */
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  alpha: number
  color: string
  size: number
}

/**
 * Smoothed speed (0..1) above which a wrist burst spawns — a strong, near-full
 * strike (~2.5× the idle/deadzone motion floor), not casual guarding.
 */
const BURST_SPEED = 0.7
/** Min gap between bursts per player, so a fast flurry sparks steadily without flooding. */
const BURST_COOLDOWN_MS = 90
/** Per-frame velocity retention (drag) applied to each particle. */
const PARTICLE_DRAG = 0.9
/** Per-frame alpha lost by each particle (≈22 frames of life). */
const PARTICLE_FADE = 0.045

export interface EnginePlayerFrame {
  present: boolean
  visible: boolean
  bbox: BBox | null
  /** Smoothed activity, 0..1. */
  speed: number
  /** Raw torso geometry for the single-player runner controls (null if unreliable). */
  posture: RawPosture | null
}

export interface EngineFrame {
  /** performance.now() of this inference frame, ms. */
  now: number
  /** Seconds since the previous inference frame (clamped). */
  dt: number
  presentCount: number
  players: [EnginePlayerFrame, EnginePlayerFrame]
  hints: EngineHints
}

/**
 * Owns the webcam stream, the TFJS detector and two loops:
 *  - an inference loop paced by NEW camera frames (requestVideoFrameCallback
 *    where available — no wasted inference on duplicate frames)
 *  - a rAF render loop drawing the video + overlays at full display rate
 * All React interaction goes through getConfig()/onFrame so the engine itself
 * is framework-free and immune to re-renders.
 *
 * Recognition pipeline (v2):
 *  - WebGPU backend when available (1.5–3× faster inference), WebGL fallback;
 *    the working choice is cached so later boots skip the failed probe.
 *  - ROI zoom: once both players are tracked, inference runs on a padded crop
 *    around them — each body is 3–4× larger for the model at living-room
 *    distances. Every FULL_SCAN_EVERY-th frame re-scans the whole video.
 *  - Identity is OURS, not the model's: candidates are matched to player slots
 *    by proximity while roles are locked (see matchLockedRoles), so the blue
 *    player stays blue even when the kids cross.
 */
export class PoseEngine {
  private detector: poseDetection.PoseDetector | null = null
  private stream: MediaStream | null = null
  private trackers: [PlayerTracker, PlayerTracker] = [new PlayerTracker(), new PlayerTracker()]
  private running = false
  private destroyed = false
  private renderRaf = 0
  private lastInferenceAt = 0
  private failureStreak = 0
  private fatalFired = false

  private roi: BBox | null = null
  private roiWarmup = 0
  private sinceFullScan = 0
  private readonly cropCanvas = document.createElement('canvas')
  private cropCtx: CanvasRenderingContext2D | null = null
  private canvasCtx: CanvasRenderingContext2D | null = null
  private lumaCounter = 0
  private lastLuma = 128
  private readonly lumaCanvas = document.createElement('canvas')
  private lumaCtx: CanvasRenderingContext2D | null = null

  /** Live hitmarker sparks, in mirror-corrected display space. */
  private particles: Particle[] = []
  /** Last burst time per player, for the per-player burst cooldown. */
  private lastBurstAt: [number, number] = [-Infinity, -Infinity]

  private readonly video: HTMLVideoElement
  private readonly canvas: HTMLCanvasElement
  private readonly getConfig: () => EngineConfig
  private readonly onFrame: (frame: EngineFrame) => void
  private readonly onFatal: ((message: string) => void) | undefined

  constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    getConfig: () => EngineConfig,
    onFrame: (frame: EngineFrame) => void,
    onFatal?: (message: string) => void,
  ) {
    this.video = video
    this.canvas = canvas
    this.getConfig = getConfig
    this.onFrame = onFrame
    this.onFatal = onFatal
  }

  /** Full boot: camera -> GPU backend -> MoveNet -> loops. Safe to abort via destroy(). */
  async start(cameraId?: string | null): Promise<void> {
    if (this.running || this.destroyed) return

    // 1. Camera. A remembered deviceId may be stale (USB cam unplugged,
    //    permissions re-scoped) — fall back to the default front camera.
    const size = { width: { ideal: 1280 }, height: { ideal: 720 } }
    let stream: MediaStream
    try {
      stream = cameraId
        ? await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cameraId }, ...size },
            audio: false,
          })
        : await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', ...size },
            audio: false,
          })
    } catch (err) {
      if (!cameraId) throw new Error(friendlyCameraError(err))
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', ...size },
          audio: false,
        })
      } catch (err2) {
        throw new Error(friendlyCameraError(err2))
      }
    }
    if (this.destroyed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    // A dead camera (unplugged / stolen by another app) must not freeze the
    // game silently — surface a real error the host can react to.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.fatal('The camera stopped (disconnected or taken by another app). Start the match again.')
    })
    this.video.srcObject = stream
    await this.video.play()
    await this.waitForVideoSize()
    if (this.destroyed) return

    // 2. GPU backend: WebGPU when the device has it, WebGL otherwise.
    await this.initBackend()
    if (this.destroyed) return

    // 3. MoveNet MultiPose Lightning. The model is bundled with the app
    //    (public/models) so no internet is needed at runtime. Tracking and
    //    smoothing are OFF: the ROI crop changes the coordinate space between
    //    frames (which would corrupt the built-in tracker), so identity and
    //    smoothing are handled by our own trackers in full-frame coordinates.
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      modelUrl: `${import.meta.env.BASE_URL}models/movenet-multipose/model.json`,
      enableTracking: false,
      enableSmoothing: false,
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

  private async initBackend(): Promise<void> {
    let cached: string | null = null
    try {
      cached = localStorage.getItem(BACKEND_CACHE_KEY)
    } catch {
      /* storage unavailable */
    }

    // Stable tensor shapes come from crop quantization; this flag removes the
    // remaining shader recompiles by passing shapes as uniforms (WebGL only).
    try {
      tf.env().set('WEBGL_USE_SHAPES_UNIFORMS', true)
    } catch {
      /* older tfjs without the flag */
    }

    if (cached !== 'webgl' && 'gpu' in navigator) {
      try {
        await import('@tensorflow/tfjs-backend-webgpu')
        await tf.setBackend('webgpu')
        await tf.ready()
        this.rememberBackend('webgpu')
        return
      } catch {
        /* fall through to WebGL */
      }
    }
    try {
      await tf.setBackend('webgl')
      await tf.ready()
      this.rememberBackend('webgl')
    } catch {
      throw new Error('Neither WebGPU nor WebGL is available — the pose model cannot run.')
    }
  }

  private rememberBackend(name: 'webgpu' | 'webgl'): void {
    try {
      localStorage.setItem(BACKEND_CACHE_KEY, name)
    } catch {
      /* storage unavailable */
    }
  }

  private fatal(message: string): void {
    if (this.fatalFired || this.destroyed) return
    this.fatalFired = true
    this.onFatal?.(message)
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
    this.particles = []
    this.lastBurstAt = [-Infinity, -Infinity]
  }

  /* ---------------- Inference loop ---------------- */

  /** Resolve on the next NEW camera frame (falls back to rAF pacing). */
  private nextInferenceTick(): Promise<void> {
    return new Promise((resolve) => {
      const v = this.video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number
      }
      if (typeof v.requestVideoFrameCallback === 'function') {
        v.requestVideoFrameCallback(() => resolve())
      } else {
        requestAnimationFrame(() => resolve())
      }
    })
  }

  private async inferenceLoop(): Promise<void> {
    while (this.running && !this.destroyed) {
      await this.nextInferenceTick()
      if (!this.running || this.destroyed || !this.detector) return
      if (this.video.readyState < 2 || this.video.videoWidth === 0) continue

      const now = performance.now()
      // Cap the inference rate — 120 Hz displays / 60 fps cameras gain nothing
      // above this, they only burn battery.
      if (now - this.lastInferenceAt < MIN_INFER_INTERVAL_MS) continue
      // Clamp dt so a tab switch / hiccup can't produce a giant motion delta.
      const dt = Math.min((now - this.lastInferenceAt) / 1000, 0.1)
      this.lastInferenceAt = now
      const vw = this.video.videoWidth
      const vh = this.video.videoHeight

      // ROI zoom: crop to the players when the region is warm, with periodic
      // full scans so someone stepping into frame is never missed for long.
      const roi = this.roi
      const cropActive =
        roi !== null && this.roiWarmup >= ROI_WARMUP_FRAMES && this.sinceFullScan < FULL_SCAN_EVERY

      let poses: poseDetection.Pose[]
      try {
        if (cropActive && roi) {
          poses = await this.estimateOnCrop(roi, vw, vh)
          this.sinceFullScan++
        } else {
          poses = await this.detector.estimatePoses(this.video)
          this.sinceFullScan = 0
        }
        this.failureStreak = 0
      } catch {
        if (++this.failureStreak >= FATAL_FAILURE_STREAK) {
          this.fatal('The vision engine crashed. Return to setup and start again.')
          return
        }
        continue
      }
      if (!this.running || this.destroyed) return

      const config = this.getConfig()
      const fighters = selectFighters(poses)
      const roles = config.rolesLocked
        ? matchLockedRoles(this.trackers, fighters, now, vw, config.mirror)
        : assignRoles(fighters, vw, config.mirror)

      for (const tracker of this.trackers) tracker.age(now)
      roles.forEach((candidate, i) => {
        if (candidate) this.trackers[i].observe(candidate, dt, config.scoring, now)
      })
      for (const tracker of this.trackers) {
        if (tracker.present && !tracker.visible) tracker.decay(dt)
      }

      this.updateRoi(vw, vh)
      this.sampleLuma()

      // Kinetic feedback: a fast strike throws a neon burst off the moving wrist.
      // Only while scoring (a live match), so menus/calibration stay clean.
      if (config.scoring) {
        this.maybeSpawnBurst(0, now, vw, config.mirror)
        this.maybeSpawnBurst(1, now, vw, config.mirror)
      }

      const players = this.trackers.map((t) => ({
        present: t.present,
        visible: t.visible,
        bbox: t.bbox,
        speed: t.speed,
        posture: t.posture,
      })) as [EnginePlayerFrame, EnginePlayerFrame]

      this.onFrame({
        now,
        dt,
        presentCount: players.filter((p) => p.present).length,
        players,
        hints: this.computeHints(vh),
      })
    }
  }

  /**
   * Draw the ROI into an offscreen canvas and run the detector on the crop.
   * Crop size snaps to CROP_QUANTUM so tensor shapes (and compiled shaders)
   * stay stable while the ROI drifts by a few pixels per frame.
   */
  private async estimateOnCrop(roi: BBox, vw: number, vh: number): Promise<poseDetection.Pose[]> {
    let w = Math.min(vw, Math.ceil(roi.w / CROP_QUANTUM) * CROP_QUANTUM)
    let h = Math.min(vh, Math.ceil(roi.h / CROP_QUANTUM) * CROP_QUANTUM)
    // Center the quantized window on the ROI, clamped into the frame.
    const x = Math.max(0, Math.min(vw - w, Math.round(roi.x + roi.w / 2 - w / 2)))
    const y = Math.max(0, Math.min(vh - h, Math.round(roi.y + roi.h / 2 - h / 2)))
    w = Math.min(w, vw - x)
    h = Math.min(h, vh - y)

    if (this.cropCanvas.width !== w || this.cropCanvas.height !== h) {
      this.cropCanvas.width = w
      this.cropCanvas.height = h
      this.cropCtx = null
    }
    this.cropCtx ??= this.cropCanvas.getContext('2d', { alpha: false })
    if (!this.cropCtx || !this.detector) return []
    this.cropCtx.drawImage(this.video, x, y, w, h, 0, 0, w, h)
    const poses = await this.detector.estimatePoses(this.cropCanvas)
    // Map keypoints back into full-frame coordinates.
    for (const pose of poses) {
      for (const k of pose.keypoints) {
        k.x += x
        k.y += y
      }
    }
    return poses
  }

  /** Keep the crop region hugging both tracked players (smoothed). */
  private updateRoi(vw: number, vh: number): void {
    const live = this.trackers.filter((t) => t.present && t.bbox).map((t) => t.bbox as BBox)
    if (live.length !== 2) {
      this.roi = null
      this.roiWarmup = 0
      return
    }
    const target = computeRoi(live, vw, vh)
    if (!target) {
      this.roi = null
      this.roiWarmup = 0
      return
    }
    this.roi = this.roi ? emaBBox(this.roi, target, 0.3) : target
    this.roiWarmup++
    // A player is drifting out of the crop → next frame scans the full video.
    if (live.some((b) => roiTouchesEdge(b, this.roi as BBox, vw, vh))) {
      this.sinceFullScan = FULL_SCAN_EVERY
    }
  }

  /** Cheap scene-brightness probe (tiny downscale + readback, every N frames). */
  private sampleLuma(): void {
    this.lumaCounter++
    if (this.lumaCounter % LUMA_EVERY !== 1) return
    const w = 24
    const h = 14
    if (this.lumaCanvas.width !== w) {
      this.lumaCanvas.width = w
      this.lumaCanvas.height = h
      this.lumaCtx = null
    }
    this.lumaCtx ??= this.lumaCanvas.getContext('2d', { willReadFrequently: true })
    if (!this.lumaCtx) return
    try {
      this.lumaCtx.drawImage(this.video, 0, 0, w, h)
      const data = this.lumaCtx.getImageData(0, 0, w, h).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      }
      this.lastLuma = sum / (data.length / 4)
    } catch {
      /* canvas readback unavailable — keep the previous estimate */
    }
  }

  private computeHints(videoHeight: number): EngineHints {
    const [a, b] = this.trackers
    if (!a.present || !a.bbox || !b.present || !b.bbox) {
      return this.lastLuma < DARK_LUMA ? { ...NO_HINTS, dark: true } : NO_HINTS
    }
    return {
      tooFar: Math.max(a.bbox.h, b.bbox.h) / videoHeight < TOO_FAR_HEIGHT_FRAC,
      overlap: iou(a.bbox, b.bbox) > OVERLAP_IOU,
      dark: this.lastLuma < DARK_LUMA,
    }
  }

  /**
   * Spawn a burst of neon particles at a player's active wrist when their
   * smoothed motion crosses the burst threshold. Coordinates are converted to
   * mirrored DISPLAY space here (once), so the render step draws them untouched
   * and they land on the correct side of a TV-mirrored arena.
   */
  private maybeSpawnBurst(index: 0 | 1, now: number, vw: number, mirror: boolean): void {
    const tracker = this.trackers[index]
    if (tracker.speed < BURST_SPEED) return
    if (now - this.lastBurstAt[index] < BURST_COOLDOWN_MS) return
    const wrist = tracker.activeWrist()
    if (!wrist) return
    this.lastBurstAt[index] = now

    const color = playerColors()[index]
    const cx = mirror ? vw - wrist.x : wrist.x
    const cy = wrist.y
    // 8–12 sparks, a couple more the harder the strike.
    const count = 8 + Math.round(Math.min(1, (tracker.speed - BURST_SPEED) / (1 - BURST_SPEED)) * 4)
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6
      const speed = 2 + Math.random() * 3.5
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        color,
        size: 3 + Math.random() * 3,
      })
    }
  }

  /** Advance every live particle one frame, paint it, and prune the dead. */
  private drawParticles(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) return
    ctx.save()
    // Additive blend: overlapping neon sparks build a hot core, like a real hit.
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      p.x += p.vx
      p.y += p.vy
      p.vx *= PARTICLE_DRAG
      p.vy *= PARTICLE_DRAG
      p.alpha -= PARTICLE_FADE
      if (p.alpha <= 0) continue
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = p.color
      ctx.shadowColor = p.color
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    this.particles = this.particles.filter((p) => p.alpha > 0)
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
      this.canvasCtx = null
    }
    // Opaque canvas → the compositor skips alpha blending for the video layer.
    this.canvasCtx ??= this.canvas.getContext('2d', { alpha: false })
    const ctx = this.canvasCtx
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

    // Keep sparks fading even when overlays are off so none freeze on screen.
    if (!config.drawOverlays) {
      this.drawParticles(ctx)
      return
    }

    const nowMs = performance.now()
    this.trackers.forEach((tracker, i) => {
      if (!tracker.present || !tracker.bbox) return
      let bbox = tracker.bbox
      if (config.mirror) bbox = { ...bbox, x: vw - bbox.x - bbox.w }
      // Fade the bracket while the track lives on persistence alone.
      const alpha = tracker.visible
        ? 1
        : Math.max(0.3, 1 - ((nowMs - tracker.lastSeenAtMs) / PERSISTENCE_MS) * 0.7)
      drawBrackets(ctx, bbox, playerColors()[i], { alpha, speed: tracker.speed })
      drawLabel(ctx, config.names[i], bbox, playerColors()[i], alpha, vw)
      if (config.hud.mode === 'match' && config.hud.combo[i] > 1) {
        drawComboTag(ctx, bbox, config.hud.combo[i], alpha)
      }
      if (config.mask && tracker.face) {
        const face = config.mirror
          ? { ...tracker.face, x: vw - tracker.face.x }
          : tracker.face
        drawFaceMask(ctx, face, playerColors()[i], Math.max(alpha, 0.9))
      }
    })

    if (config.hud.mode === 'match') drawMatchHud(ctx, vw, vh, config.hud, config.names)
    else if (config.hud.mode === 'victory') drawVictorySplash(ctx, vw, vh, config.hud)

    // Hitmarkers on top of the HUD so a fast strike always reads.
    this.drawParticles(ctx)
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
