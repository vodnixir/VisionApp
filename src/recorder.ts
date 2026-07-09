/**
 * Records the match canvas into a shareable highlight clip.
 *
 * The whole show (camera + brackets + HUD + victory splash) is drawn onto one
 * canvas, so canvas.captureStream() + MediaRecorder is all we need — no extra
 * compositing. Recording starts at the gong and stops ~2.5 s after the winner
 * splash so the clip ends on the celebration.
 */

export interface MatchClip {
  blob: Blob
  /** File extension matching the actual container ('mp4' | 'webm'). */
  ext: string
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

  /** Begin recording. Silently does nothing when the platform can't record. */
  start(canvas: HTMLCanvasElement, audio?: MediaStream | null): void {
    if (!recordingSupported() || this.active) return
    // Some encoders reject audio+video combos — retry video-only before giving up.
    if (!this.tryStart(canvas, audio ?? null) && audio) {
      this.tryStart(canvas, null)
    }
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
        videoBitsPerSecond: 2_500_000,
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
          resolve(blob.size > 0 ? { blob, ext: type.includes('mp4') ? 'mp4' : 'webm' } : null)
        }
        try {
          recorder.stop()
        } catch {
          this.recorder = null
          this.releaseStream()
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
