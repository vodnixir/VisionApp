/**
 * Self-correcting countdown timer.
 *
 * A plain setInterval accumulates scheduler jitter: each late tick pushes the
 * next one later, so a 3-2-1 that should take 2.4 s can end up noticeably long
 * on a busy main thread. Here every tick targets an ABSOLUTE timestamp derived
 * from one start time, so a late tick never shifts the ones after it — the
 * total duration stays put.
 *
 * onTick fires for `from`, `from-1`, … 1 (the first one synchronously); onDone
 * fires once at 0. Returns a cancel function that stops any pending ticks.
 */
export function runCountdown(opts: {
  /** Starting number, shown immediately (e.g. 3). */
  from: number
  /** Milliseconds between numbers; total run = from × stepMs. */
  stepMs: number
  /** Called with each number from `from` down to 1. */
  onTick: (n: number) => void
  /** Called once when the countdown reaches zero ("GO"). */
  onDone: () => void
}): () => void {
  const { from, stepMs, onTick, onDone } = opts
  const t0 = performance.now()
  let cancelled = false
  const timers: ReturnType<typeof setTimeout>[] = []

  onTick(from)
  for (let i = 1; i <= from; i++) {
    const remaining = from - i // from-1 … 0
    const target = t0 + i * stepMs
    timers.push(
      setTimeout(
        () => {
          if (cancelled) return
          if (remaining > 0) onTick(remaining)
          else onDone()
        },
        Math.max(0, target - performance.now()),
      ),
    )
  }

  return () => {
    cancelled = true
    timers.forEach(clearTimeout)
  }
}
