import { useCallback, useEffect, useRef } from 'react'

/**
 * Best-effort screen wake lock so the phone doesn't dim mid-game.
 *
 * Two things the naive one-shot version gets wrong and this one handles:
 *  - The browser AUTO-RELEASES the lock whenever the tab is hidden (or the
 *    screen turns off). When the player comes back, re-acquire it — otherwise
 *    the first background/foreground cycle silently kills the lock for good.
 *  - acquire() is idempotent: calling it again while a lock is held is a no-op,
 *    so callers can fire it from several entry points without leaking sentinels.
 *
 * Every call is guarded — an unsupported browser or a denied request just means
 * the game runs without the lock, never a thrown error.
 */
export function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)
  /** True between acquire() and release() — drives the visibility re-acquire. */
  const wantedRef = useRef(false)

  const request = useCallback(() => {
    if (sentinelRef.current) return
    navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        // Dropped while the request was in flight (released / lost focus).
        if (!wantedRef.current) {
          void sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        // A system release (tab hidden) clears our ref so the next foreground re-acquires.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
        })
      })
      .catch(() => {
        /* unsupported or denied — the game still works */
      })
  }, [])

  const acquire = useCallback(() => {
    wantedRef.current = true
    request()
  }, [request])

  const release = useCallback(() => {
    wantedRef.current = false
    void sentinelRef.current?.release().catch(() => {})
    sentinelRef.current = null
  }, [])

  // Re-acquire when the page returns to the foreground (locks die on hide).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wantedRef.current) request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [request])

  // Release on unmount.
  useEffect(() => release, [release])

  return { acquire, release }
}
