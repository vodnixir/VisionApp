/**
 * Records the match into a shareable highlight clip.
 *
 * The whole show (camera + brackets + HUD + victory splash) is drawn onto one
 * landscape canvas by the engine. For sharing, that canvas is re-composed live
 * into a portrait 9:16 frame (blurred cover background + the show letterboxed
 * in the middle + wordmark) — the format TikTok / Reels / Shorts expect.
 * Recording starts at the gong and stops ~2.5 s after the winner splash so the
 * clip ends on the celebration. If the encoder refuses the portrait canvas,
 * recording falls back to the raw landscape canvas rather than producing nothing.
 */

export interface MatchClip {
  blob: Blob
  /** File extension matching the actual container ('mp4' | 'webm'). */
  ext: string
}

/** Portrait clip frame — TikTok's recommended 1080×1920. */
export const PORTRAIT_W = 1080
export const PORTRAIT_H = 1920
/** Composition rate; matches captureStream(30) so no frames are wasted. */
const COMPOSE_FPS = 30
/** Same face as the canvas HUD (draw.ts) so the clip reads as one product. */
const BRAND_FONT = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"

/** Centered crop of an sw×sh source that covers the given aspect (w/h). */
export function coverCrop(
  sw: number,
  sh: number,
  aspect: number,
): { x: number; y: number; w: number; h: number } {
  let w = sw
  let h = sh
  if (sw / sh > aspect) w = sh * aspect
  else h = sw / aspect
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h }
}

/**
 * Contain-fit of an sw×sh source into the portrait frame, sitting slightly
 * above center (leaves headroom for the wordmark, feels balanced on 9:16).
 */
export function portraitLayout(
  sw: number,
  sh: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(PORTRAIT_W / sw, PORTRAIT_H / sh)
  const w = Math.round(sw * scale)
  const h = Math.round(sh * scale)
  return {
    x: Math.round((PORTRAIT_W - w) / 2),
    y: Math.round(Math.max(0, (PORTRAIT_H - h) * 0.44)),
    w,
    h,
  }
}

/**
 * Live 9:16 re-composition of the match canvas. Runs its own ~30 fps rAF loop
 * only while a recording is active, so it costs nothing outside matches.
 */
class PortraitComposer {
  readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D | null
  /** Tiny 9:16 thumbnail; drawing through it down-then-up is a free strong blur. */
  private readonly thumb = document.createElement('canvas')
  private readonly thumbCtx: CanvasRenderingContext2D | null
  private readonly source: HTMLCanvasElement
  private raf = 0
  private running = false
  private lastDrawAt = 0

  constructor(source: HTMLCanvasElement) {
    this.source = source
    this.canvas.width = PORTRAIT_W
    this.canvas.height = PORTRAIT_H
    this.ctx = this.canvas.getContext('2d', { alpha: false })
    this.thumb.width = 54
    this.thumb.height = 96
    this.thumbCtx = this.thumb.getContext('2d', { alpha: false })
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.raf = requestAnimationFrame(this.tick)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  private tick = (now: number): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.tick)
    // Pace at COMPOSE_FPS regardless of display refresh rate.
    if (now - this.lastDrawAt < 1000 / COMPOSE_FPS - 2) return
    this.lastDrawAt = now
    this.draw()
  }

  private draw(): void {
    const ctx = this.ctx
    const sw = this.source.width
    const sh = this.source.height
    if (!ctx || sw === 0 || sh === 0) return

    // Background: cover-crop through the thumbnail (cheap blur) + dark veil.
    const crop = coverCrop(sw, sh, PORTRAIT_W / PORTRAIT_H)
    if (this.thumbCtx) {
      this.thumbCtx.drawImage(
        this.source,
        crop.x, crop.y, crop.w, crop.h,
        0, 0, this.thumb.width, this.thumb.height,
      )
      ctx.drawImage(this.thumb, 0, 0, PORTRAIT_W, PORTRAIT_H)
      ctx.fillStyle = 'rgba(3, 5, 14, 0.55)'
    } else {
      ctx.fillStyle = '#05070f'
    }
    ctx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H)

    // Foreground: the whole show, letterboxed.
    const fg = portraitLayout(sw, sh)
    ctx.drawImage(this.source, fg.x, fg.y, fg.w, fg.h)

    // Wordmark + hashtag, only when the letterbox leaves room for them
    // (a portrait source fills the whole frame — no bands to write on).
    if (fg.y > 170 && PORTRAIT_H - (fg.y + fg.h) > 170) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.font = `700 64px ${BRAND_FONT}`
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
      ctx.shadowBlur = 12
      ctx.fillText('Speed Battle', PORTRAIT_W / 2, fg.y - 64)
      ctx.shadowBlur = 0
      ctx.font = `600 40px ${BRAND_FONT}`
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
      ctx.fillText('#SpeedBattleDuel', PORTRAIT_W / 2, fg.y + fg.h + 92)
      ctx.restore()
    }
  }
}

/** Preference order: mp4 shares best into social apps, webm is the safe fallback. */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function recordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype
  )
}

export class MatchRecorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private composer: PortraitComposer | null = null
  private chunks: Blob[] = []
  private stopTimer: ReturnType<typeof setTimeout> | null = null

  get active(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive'
  }

  /** Release the capture tracks so the encoder pipeline shuts down promptly. */
  private releaseStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }

  private stopComposer(): void {
    this.composer?.stop()
    this.composer = null
  }

  /** Begin recording. Silently does nothing when the platform can't record. */
  start(canvas: HTMLCanvasElement, audio?: MediaStream | null): void {
    if (!recordingSupported() || this.active) return
    const composer = new PortraitComposer(canvas)
    composer.start()
    this.composer = composer
    // Preference order: portrait+audio → portrait video-only (some encoders
    // reject audio+video combos) → raw landscape canvas as the last resort.
    for (const source of [composer.canvas, canvas]) {
      for (const a of audio ? [audio, null] : [null]) {
        if (this.tryStart(source, a)) {
          // Landscape fallback — don't burn battery compositing portrait frames.
          if (source === canvas) this.stopComposer()
          return
        }
      }
    }
    this.stopComposer()
  }

  private tryStart(canvas: HTMLCanvasElement, audio: MediaStream | null): boolean {
    try {
      const stream = canvas.captureStream(30)
      if (audio) {
        // Clone shared sfx tracks — stopping our copy must not mute the game.
        for (const track of audio.getAudioTracks()) stream.addTrack(track.clone())
      }
      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        // Portrait 1080×1920 carries ~2.25× the pixels of the 720p canvas.
        videoBitsPerSecond: canvas.height > canvas.width ? 5_000_000 : 2_500_000,
      })
      this.chunks = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data)
      }
      recorder.start(1000)
      this.recorder = recorder
      this.stream = stream
      return true
    } catch {
      this.recorder = null
      this.releaseStream()
      return false
    }
  }

  /**
   * Keep recording for `tailMs` (the victory splash), then stop and return the
   * clip. Resolves null when recording never started or produced nothing.
   */
  finish(tailMs = 2500): Promise<MatchClip | null> {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve) => {
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null
        recorder.onstop = () => {
          const type = recorder.mimeType || 'video/webm'
          const blob = new Blob(this.chunks, { type })
          this.recorder = null
          this.chunks = []
          this.releaseStream()
          this.stopComposer()
          resolve(blob.size > 0 ? { blob, ext: type.includes('mp4') ? 'mp4' : 'webm' } : null)
        }
        try {
          recorder.stop()
        } catch {
          this.recorder = null
          this.releaseStream()
          this.stopComposer()
          resolve(null)
        }
      }, tailMs)
    })
  }

  /** Drop the current recording (rematch started, user left the arena…). */
  cancel(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    const recorder = this.recorder
    this.recorder = null
    this.chunks = []
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        /* already stopped */
      }
    }
    this.releaseStream()
    this.stopComposer()
  }
}

/** Share the clip via the native sheet; fall back to a plain download. */
export async function shareClip(clip: MatchClip): Promise<void> {
  const file = new File([clip.blob], `speed-battle.${clip.ext}`, { type: clip.blob.type })
  const shareData: ShareData = { files: [file] }
  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData)
      return
    } catch {
      // AbortError (user closed the sheet) or share failure — fall through to download.
    }
  }
  const url = URL.createObjectURL(clip.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
