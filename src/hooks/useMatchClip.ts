import { useCallback, useState } from 'react'
import { type MatchClip, type MatchRecorder, shareClip } from '../recorder'

/**
 * Lifecycle of the shareable highlight clip, shared by all three game screens
 * (duel, runner, online). Gives the UI something to show at every stage instead
 * of a share button that silently never appears:
 *
 *  - 'idle'        nothing recorded (demo, or recording unsupported)
 *  - 'preparing'   the run just ended; the encoder is finalizing the clip
 *  - 'ready'       clip is available → offer the share button
 *  - 'unavailable' recording ran but produced nothing (codec/WebView limits)
 */
export type ClipStatus = 'idle' | 'preparing' | 'ready' | 'unavailable'

export function useMatchClip() {
  const [clip, setClip] = useState<MatchClip | null>(null)
  const [status, setStatus] = useState<ClipStatus>('idle')
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState(false)

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
  }, [])

  const share = useCallback(async () => {
    if (!clip || sharing) return
    setSharing(true)
    setShareError(false)
    try {
      await shareClip(clip)
    } catch {
      setShareError(true)
    } finally {
      setSharing(false)
    }
  }, [clip, sharing])

  return { clip, status, sharing, shareError, capture, reset, share }
}
