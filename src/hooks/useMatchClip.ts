import { useCallback, useState } from 'react'
import {
  ENDING_MS,
  HIGHLIGHT_TARGET_MS,
  endingWindow,
  extractSegments,
  pickHighlights,
  shareClip,
  type MatchClip,
  type MatchRecorder,
} from '../recorder'

/**
 * Lifecycle of the shareable highlight clip, shared by all three game screens
 * (duel, runner, online). Gives the UI something to show at every stage instead
 * of a share button that silently never appears:
 *
 *  - 'idle'        nothing recorded (demo, or recording unsupported)
 *  - 'preparing'   the run just ended; the encoder is finalizing the clip
 *  - 'ready'       clip is available → offer the share buttons
 *  - 'unavailable' recording ran but produced nothing (codec/WebView limits)
 */
export type ClipStatus = 'idle' | 'preparing' | 'ready' | 'unavailable'

/** Which cut of the match to share. */
export type ClipKind = 'whole' | 'highlights' | 'ending'

export type MatchClipState = ReturnType<typeof useMatchClip>

export function useMatchClip() {
  const [clip, setClip] = useState<MatchClip | null>(null)
  const [status, setStatus] = useState<ClipStatus>('idle')
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState(false)
  /** Non-null while a cut is being re-encoded (runs in real time). */
  const [cutting, setCutting] = useState<ClipKind | null>(null)
  const [cutProgress, setCutProgress] = useState(0)
  const [cutError, setCutError] = useState(false)

  /** Call at game over: finalize the recording and track its progress. */
  const capture = useCallback((recorder: MatchRecorder, tailMs?: number) => {
    if (!recorder.active) {
      // Nothing was being recorded (demo run, unsupported platform).
      setClip(null)
      setStatus('idle')
      return
    }
    setStatus('preparing')
    void recorder.finish(tailMs).then((c) => {
      setClip(c)
      setStatus(c ? 'ready' : 'unavailable')
    })
  }, [])

  /** Call when leaving the result screen / starting a rematch. */
  const reset = useCallback(() => {
    setClip(null)
    setStatus('idle')
    setSharing(false)
    setShareError(false)
    setCutting(null)
    setCutProgress(0)
    setCutError(false)
  }, [])

  /**
   * Cut (if asked) and share. A cut re-encodes in real time, so the UI shows
   * progress; a match too short to cut is simply shared whole rather than
   * pointlessly re-encoded.
   */
  const share = useCallback(
    async (kind: ClipKind = 'whole') => {
      if (!clip || sharing || cutting) return
      setShareError(false)
      setCutError(false)

      let target = clip
      if (kind !== 'whole') {
        const windows =
          kind === 'highlights'
            ? pickHighlights(clip.activity, clip.durationMs)
            : endingWindow(clip.durationMs)
        if (windows.length > 0) {
          setCutting(kind)
          setCutProgress(0)
          const cut = await extractSegments(clip, windows, setCutProgress)
          setCutting(null)
          if (!cut) {
            setCutError(true)
            return
          }
          target = cut
        }
      }

      setSharing(true)
      try {
        await shareClip(target)
      } catch {
        setShareError(true)
      } finally {
        setSharing(false)
      }
    },
    [clip, sharing, cutting],
  )

  /** Cuts worth offering — a short match has nothing to trim down to. */
  const kinds: ClipKind[] = clip
    ? [
        'whole',
        ...(clip.durationMs > HIGHLIGHT_TARGET_MS + 5000 ? (['highlights'] as const) : []),
        ...(clip.durationMs > ENDING_MS + 5000 ? (['ending'] as const) : []),
      ]
    : []

  return {
    clip,
    status,
    kinds,
    sharing,
    shareError,
    cutting,
    cutProgress,
    cutError,
    capture,
    reset,
    share,
  }
}
