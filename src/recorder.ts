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

import { canvasTheme } from './theme'

export interface MatchClip {
  blob: Blob
  /** File extension matching the actual container ('mp4' | 'webm'). */
  ext: string
  /** How long the recording ran, ms. */
  durationMs: number
  /** How lively the match was over time — drives the highlight cut. */
  activity: ActivitySample[]
}

/** One reading of "how much was happening", taken while recording. */
export interface ActivitySample {
  /** ms since recording started. */
  t: number
  /** Liveliness, roughly 0..1 — each screen defines its own signal. */
  a: number
}

/** A slice of a recording, in ms from its start. */
export interface ClipWindow {
  start: number
  end: number
}

/** How much highlight footage to aim for. */
export const HIGHLIGHT_TARGET_MS = 20_000
/** How much of the finish to keep for the "ending" cut. */
export const ENDING_MS = 15_000
/** Granularity of the highlight search — long enough for a moment to read. */
const WINDOW_MS = 2500
/** Activity is sampled at ~10 Hz; finer buys nothing for picking windows. */
const SAMPLE_EVERY_MS = 100

/**
 * Pick the liveliest ~`targetMs` of a recording, as time-ordered windows.
 *
 * Slices the timeline into fixed windows, ranks them by mean activity, takes the
 * best until the target is met, then puts them back in chronological order and
 * merges neighbours (so a long exciting stretch stays one continuous shot rather
 * than becoming visible seams).
 *
 * Returns [] when the recording is already at or under the target — the caller
 * should then just use the whole thing instead of pointlessly re-encoding it.
 */
export function pickHighlights(
  samples: ActivitySample[],
  durationMs: number,
  targetMs = HIGHLIGHT_TARGET_MS,
): ClipWindow[] {
  if (durationMs <= targetMs || samples.length === 0) return []

  const count = Math.floor(durationMs / WINDOW_MS)
  if (count === 0) return []

  const scored: { start: number; end: number; score: number }[] = []
  for (let i = 0; i < count; i++) {
    const start = i * WINDOW_MS
    const end = Math.min(start + WINDOW_MS, durationMs)
    let sum = 0
    let n = 0
    for (const s of samples) {
      if (s.t >= start && s.t < end) {
        sum += s.a
        n++
      }
    }
    scored.push({ start, end, score: n > 0 ? sum / n : 0 })
  }

  scored.sort((x, y) => y.score - x.score)
  const chosen: ClipWindow[] = []
  let total = 0
  for (const w of scored) {
    if (total >= targetMs) break
    chosen.push({ start: w.start, end: w.end })
    total += w.end - w.start
  }

  chosen.sort((x, y) => x.start - y.start)
  const merged: ClipWindow[] = []
  for (const w of chosen) {
    const prev = merged[merged.length - 1]
    if (prev && w.start <= prev.end) prev.end = Math.max(prev.end, w.end)
    else merged.push({ ...w })
  }
  return merged
}

/** The closing `ENDING_MS` of a recording — the finish and the victory splash. */
export function endingWindow(durationMs: number, lengthMs = ENDING_MS): ClipWindow[] {
  if (durationMs <= lengthMs) return []
  return [{ start: durationMs - lengthMs, end: durationMs }]
}

/** Portrait clip frame — TikTok's recommended 1080×1920. */
export const PORTRAIT_W = 1080
export const PORTRAIT_H = 1920
/** Composition rate; matches captureStream(30) so no frames are wasted. */
const COMPOSE_FPS = 30

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
      // Same face as the canvas HUD (theme.ts) so the clip reads as one product.
      const th = canvasTheme()
      ctx.save()
      ctx.textAlign = 'center'
      ctx.font = `${th.glow ? 900 : 700} 64px ${th.font}`
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = th.glow ? 'rgba(0, 195, 255, 0.8)' : 'rgba(0, 0, 0, 0.45)'
      ctx.shadowBlur = th.glow ? 24 : 12
      ctx.fillText(th.glow ? 'SPEED BATTLE' : 'Speed Battle', PORTRAIT_W / 2, fg.y - 64)
      ctx.shadowBlur = 0
      ctx.font = `${th.glow ? 700 : 600} 40px ${th.font}`
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
  private samples: ActivitySample[] = []
  private startedAt = 0

  get active(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive'
  }

  /**
   * Note how lively the game is right now (roughly 0..1) so the highlight cut
   * has something to rank. Cheap enough to call every frame: readings are
   * bucketed to ~10 Hz, keeping the peak of each bucket so a brief burst — the
   * exact thing a highlight wants — isn't averaged away.
   */
  mark(activity: number): void {
    if (!this.active) return
    const t = performance.now() - this.startedAt
    const last = this.samples[this.samples.length - 1]
    if (last && t - last.t < SAMPLE_EVERY_MS) {
      if (activity > last.a) last.a = activity
      return
    }
    this.samples.push({ t, a: activity })
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
    this.samples = []
    this.startedAt = performance.now()
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
          const durationMs = performance.now() - this.startedAt
          const activity = this.samples
          this.recorder = null
          this.chunks = []
          this.samples = []
          this.releaseStream()
          this.stopComposer()
          resolve(
            blob.size > 0
              ? { blob, ext: type.includes('mp4') ? 'mp4' : 'webm', durationMs, activity }
              : null,
          )
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

/* ---------------- Cutting a recording down ---------------- */

/** Resolve on the next `event` from `el`, or reject if it never comes. */
function once(el: HTMLElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      el.removeEventListener(event, done)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      el.removeEventListener(event, done)
      reject(new Error(`timed out waiting for ${event}`))
    }, timeoutMs)
    el.addEventListener(event, done)
  })
}

/**
 * Let the video run until `untilS`, reporting progress as it goes.
 *
 * Polls on a timer rather than rAF on purpose: rAF stops in a backgrounded tab,
 * which would hang the cut forever the moment someone switches apps mid-export.
 * The time budget is the same guard for a decode that simply stalls.
 */
function playUntil(
  video: HTMLVideoElement,
  untilS: number,
  onTick: (currentS: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const budgetMs = Math.max(0, untilS - video.currentTime) * 1000 + 8000
    const iv = setInterval(() => {
      if (video.currentTime >= untilS || video.ended) {
        clearInterval(iv)
        resolve()
        return
      }
      if (performance.now() - startedAt > budgetMs) {
        clearInterval(iv)
        reject(new Error('playback stalled'))
        return
      }
      onTick(video.currentTime)
    }, 100)
  })
}

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream }

/**
 * Cut `windows` out of a recording into a new clip.
 *
 * A browser can't trim an encoded blob without shipping a transcoder, so this
 * replays the recording and re-records just the wanted parts: seek to a window
 * with the recorder paused, resume, play it through, pause again. Capturing the
 * <video> element's own stream (rather than redrawing to a canvas) keeps the
 * audio and costs nothing.
 *
 * Runs in REAL TIME — a 20 s highlight takes ~20 s — so callers must show
 * progress. Returns null if the platform can't do it, rather than pretending.
 */
export async function extractSegments(
  clip: MatchClip,
  windows: ClipWindow[],
  onProgress?: (fraction: number) => void,
): Promise<MatchClip | null> {
  if (!recordingSupported() || windows.length === 0) return null

  const url = URL.createObjectURL(clip.blob)
  const video = document.createElement('video') as CapturableVideo
  video.src = url
  video.playsInline = true
  // Kept out of sight but NOT display:none — a hidden element may stop decoding.
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0'
  document.body.appendChild(video)

  const cleanup = () => {
    video.pause()
    video.remove()
    URL.revokeObjectURL(url)
  }

  try {
    await once(video, 'loadedmetadata', 8000)
    if (typeof video.captureStream !== 'function') return null
    const stream = video.captureStream()

    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
    const chunks: Blob[] = []
    let rec: MediaRecorder | null = null
    const totalMs = windows.reduce((s, w) => s + (w.end - w.start), 0)
    let doneMs = 0

    for (const [i, w] of windows.entries()) {
      if (rec) rec.pause()
      video.currentTime = w.start / 1000
      await once(video, 'seeked', 6000)

      if (i === 0) {
        // Start only once we're parked on the first frame we actually want.
        rec = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 5_000_000,
        })
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }
        rec.start(500)
      } else {
        rec!.resume()
      }

      await video.play()
      await playUntil(video, w.end / 1000, (cur) => {
        onProgress?.(Math.min(1, (doneMs + (cur * 1000 - w.start)) / totalMs))
      })
      video.pause()
      doneMs += w.end - w.start
      onProgress?.(Math.min(1, doneMs / totalMs))
    }

    if (!rec) return null
    const recorder = rec
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }))
      recorder.stop()
    })
    if (blob.size === 0) return null
    return {
      blob,
      ext: blob.type.includes('mp4') ? 'mp4' : 'webm',
      durationMs: totalMs,
      // The cut is the highlight — no reason to rank it again.
      activity: [],
    }
  } catch {
    return null
  } finally {
    cleanup()
  }
}

/** Inside the Capacitor APK the browser share/download paths don't work. */
function isNativePlatform(): boolean {
  return Boolean(
    (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
  )
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      // reader gives a data: URL; the plugin wants the raw base64 payload.
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Native share (Capacitor APK): the Android System WebView ignores blob:
 * downloads and rejects navigator.share({files}), so instead write the clip to
 * the app cache and hand its file:// URI to the native share sheet. The plugins
 * are dynamically imported so the web bundle never pulls them in.
 */
async function shareClipNative(clip: MatchClip): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const name = `speed-battle-${Date.now()}.${clip.ext}`
  const data = await blobToBase64(clip.blob)
  const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache })
  await Share.share({ title: 'Speed Battle', text: '#SpeedBattleDuel', url: uri })
}

/**
 * Share the clip. Throws if sharing genuinely failed (so callers can surface it)
 * but stays silent when the user simply cancels the share sheet.
 */
export async function shareClip(clip: MatchClip): Promise<void> {
  if (isNativePlatform()) {
    try {
      await shareClipNative(clip)
    } catch (e) {
      // User dismissed the native sheet — not an error worth reporting.
      if (isShareAbort(e)) return
      throw e
    }
    return
  }

  const file = new File([clip.blob], `speed-battle.${clip.ext}`, { type: clip.blob.type })
  const shareData: ShareData = { files: [file] }
  if (typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData)
      return
    } catch (e) {
      if (isShareAbort(e)) return
      // Other share failures — fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(clip.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** A user closing the share sheet reports as an AbortError — treat it as success. */
function isShareAbort(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase()
  return msg.includes('cancel') || msg.includes('abort') || msg.includes('dismiss')
}
