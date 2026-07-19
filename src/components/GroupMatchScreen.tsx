import { useEffect, useRef, useState } from 'react'
import { sfx } from '../audio/sfx'
import { runCountdown } from '../countdown'
import type { EngineFrame } from '../cv/engine'
import { usePoseDetection } from '../hooks/usePoseDetection'
import { useWakeLock } from '../hooks/useWakeLock'
import { useI18n } from '../i18n'
import { playerColors } from '../theme'
import { FILL_RATE, SENSITIVITY_FACTOR } from '../types'
import { InstructionCard, type Rule } from './InstructionCard'

type Phase = 'idle' | 'calibrate' | 'countdown' | 'play' | 'over'

/** Free-for-all supports three or four bodies. */
const PLAYER_COUNTS = [3, 4] as const
/** First bar to reach this (percent) wins. */
const TARGET = 100
/** Classic pace: movement fills the bar; group parties run at the "fight" rate. */
const RATE = FILL_RATE.fight
const SENS = SENSITIVITY_FACTOR.medium
/** Everyone must stay in frame this long before the countdown starts. */
const LOCK_DURATION_MS = 2000

/** Extra bar colours past the two duel colours — matches the engine's slotColor. */
const EXTRA_COLORS = ['#a3e635', '#f5a623']
function groupColor(i: number): string {
  return i < 2 ? playerColors()[i] : (EXTRA_COLORS[i - 2] ?? '#ffffff')
}

interface Standing {
  index: number
  progress: number
}
interface Result {
  rank: Standing[]
  winnerIndex: number
}

/**
 * Group free-for-all: 3–4 kids, each with their own bar, everyone for
 * themselves — classic scoring (movement fills your bar), first to 100% wins.
 * A separate camera screen (reached at #group) so the polished two-player duel
 * stays exactly as it was. Bodies are tracked left-to-right by position; each
 * one owns the coloured bracket and bar of its slot.
 */
export function GroupMatchScreen() {
  const { t } = useI18n()
  const [playerCount, setPlayerCount] = useState<number>(3)
  const [chosen, setChosen] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [mirror, setMirror] = useState(true)
  const [count, setCount] = useState(3)
  const [presentCount, setPresentCount] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const wakeLock = useWakeLock()

  const progressRef = useRef<number[]>([])
  const finishedRef = useRef(false)
  const lockStartRef = useRef<number | null>(null)
  const barFillRefs = useRef<(HTMLDivElement | null)[]>([])
  const pctRefs = useRef<(HTMLSpanElement | null)[]>([])

  const onFrameRef = useRef<(frame: EngineFrame) => void>(() => {})
  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection((frame) =>
    onFrameRef.current(frame),
  )

  // Keep the engine tracking exactly `playerCount` bodies; score only in play.
  useEffect(() => {
    configure({
      mirror,
      maxPlayers: playerCount,
      scoring: phase === 'play',
      drawOverlays: true,
      rolesLocked: false,
      names: Array.from({ length: playerCount }, (_, i) => t('runner.pLabel', { n: i + 1 })),
    })
  }, [mirror, playerCount, phase, configure, t])

  // Camera came up → move to the "line up" prompt.
  useEffect(() => {
    if (status === 'running' && phase === 'idle') setPhase('calibrate')
  }, [status, phase])

  // Countdown 3 → 2 → 1 → GO, then start scoring.
  useEffect(() => {
    if (phase !== 'countdown') return
    return runCountdown({
      from: 3,
      stepMs: 800,
      onTick: (n) => {
        setCount(n)
        sfx.beep()
      },
      onDone: () => {
        sfx.gong()
        startPlay()
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Teardown.
  useEffect(
    () => () => {
      stop()
      wakeLock.release()
    },
    [stop, wakeLock],
  )

  onFrameRef.current = (frame: EngineFrame) => {
    if (phase === 'calibrate') {
      setPresentCount(frame.presentCount)
      if (frame.presentCount >= playerCount) {
        if (lockStartRef.current === null) {
          lockStartRef.current = frame.now
          sfx.lock()
        } else if (frame.now - lockStartRef.current >= LOCK_DURATION_MS) {
          setPhase('countdown')
        }
      } else {
        lockStartRef.current = null
      }
      return
    }

    if (phase === 'play') {
      if (finishedRef.current) return
      const prog = progressRef.current
      let winner = -1
      for (let i = 0; i < playerCount; i++) {
        const speed = frame.players[i]?.speed ?? 0
        // Classic fill: movement raises the bar, scaled by pace + sensitivity.
        prog[i] = Math.min(TARGET, prog[i] + speed * RATE * frame.dt * SENS)
        const pct = (prog[i] / TARGET) * 100
        const fill = barFillRefs.current[i]
        if (fill) fill.style.height = `${pct}%`
        const label = pctRefs.current[i]
        if (label) label.textContent = `${Math.round(pct)}%`
        if (prog[i] >= TARGET && winner < 0) winner = i
      }
      if (winner >= 0) finish(winner)
    }
  }

  const startPlay = () => {
    progressRef.current = new Array(playerCount).fill(0)
    finishedRef.current = false
    for (const fill of barFillRefs.current) if (fill) fill.style.height = '0%'
    for (const label of pctRefs.current) if (label) label.textContent = '0%'
    setPhase('play')
  }

  const finish = (winner: number) => {
    finishedRef.current = true
    sfx.victory()
    const rank = progressRef.current
      .map((progress, index) => ({ index, progress }))
      .sort((a, b) => b.progress - a.progress)
    setResult({ rank, winnerIndex: winner })
    setPhase('over')
  }

  const handlePickCount = (n: number) => {
    setPlayerCount(n)
    setChosen(true)
    setShowRules(true)
  }

  const handleRulesStart = () => {
    setShowRules(false)
    sfx.unlock()
    wakeLock.acquire()
    if (status === 'idle') void start()
  }

  const handleAgain = () => {
    setResult(null)
    lockStartRef.current = null
    // Everyone's already in frame — a fresh countdown, then a clean race.
    setPhase(presentCount >= playerCount ? 'countdown' : 'calibrate')
  }

  const backToSelect = () => {
    stop()
    wakeLock.release()
    setResult(null)
    setShowRules(false)
    lockStartRef.current = null
    setPhase('idle')
    setChosen(false)
  }

  const goHome = () => {
    stop()
    wakeLock.release()
    window.location.hash = ''
    window.location.reload()
  }

  /* ---------------- Player-count select ---------------- */

  if (!chosen) {
    return (
      <div className="screen relative flex h-full w-full flex-col items-center overflow-y-auto bg-page px-4 py-8 text-t1 select-none">
        <div className="flex w-full max-w-md flex-1 flex-col gap-5">
          <header className="flex items-center">
            <button
              onClick={goHome}
              className="rounded-full border border-edge bg-card px-4 py-2 text-sm font-semibold text-t2 transition-colors hover:text-t1"
            >
              ← {t('common.back')}
            </button>
          </header>

          <div className="mt-2 text-center">
            <h1 className="text-3xl font-black">{t('group.title')}</h1>
            <p className="mt-1 text-sm text-t3">{t('group.subtitle')}</p>
          </div>

          <p className="mt-2 text-center text-xs font-medium tracking-wider text-t3">
            {t('group.howMany').toUpperCase()}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {PLAYER_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handlePickCount(n)}
                className="flex flex-col items-center gap-3 rounded-2xl border border-edge bg-card px-4 py-6 transition-colors hover:border-edge2"
              >
                <span className="text-5xl font-black tabular-nums">{n}</span>
                <span className="flex gap-1.5" aria-hidden>
                  {Array.from({ length: n }, (_, i) => (
                    <span
                      key={i}
                      className="size-3 rounded-full"
                      style={{ background: groupColor(i) }}
                    />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- Rules briefing ---------------- */

  const rules: Rule[] = [
    { emoji: '⚡', text: t('group.rule.move') },
    { emoji: '🏁', text: t('group.rule.fill') },
    { emoji: '🧍', text: t('group.rule.own') },
  ]

  const chromeVisible = phase === 'calibrate' || (phase === 'idle' && status !== 'running')

  /* ---------------- Game view ---------------- */

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

      {/* Per-player bars along the bottom — each rises as its player moves. */}
      {(phase === 'play' || phase === 'over') && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[46%] items-end gap-2 px-3 pb-3">
          {Array.from({ length: playerCount }, (_, i) => {
            const color = groupColor(i)
            const won = result?.winnerIndex === i
            // During play the fill is driven imperatively (no per-frame re-render);
            // on the results screen React re-renders, so pin the bar to its final
            // value there instead of letting the style prop blank it back to 0.
            const finalPct = result?.rank.find((r) => r.index === i)?.progress ?? 0
            const barHeight = phase === 'over' ? `${Math.min(100, finalPct)}%` : '0%'
            return (
              <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span ref={(el) => { pctRefs.current[i] = el }} className="text-sm font-black tabular-nums drop-shadow">
                  {phase === 'over' ? `${Math.round(finalPct)}%` : '0%'}
                </span>
                <div
                  className="relative w-full flex-1 overflow-hidden rounded-t-xl"
                  style={{ background: 'rgba(0,0,0,0.45)', boxShadow: won ? `0 0 24px ${color}` : undefined }}
                >
                  <div
                    ref={(el) => { barFillRefs.current[i] = el }}
                    className="absolute inset-x-0 bottom-0 transition-[height] duration-100 ease-linear"
                    style={{ height: barHeight, background: color }}
                  />
                </div>
                <span
                  className="max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-black tracking-wider"
                  style={{ background: 'rgba(0,0,0,0.55)', color }}
                >
                  {t('runner.pLabel', { n: i + 1 })}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between p-3">
        <button
          onClick={backToSelect}
          className="rounded-full bg-black/60 px-4 py-2 text-sm font-semibold backdrop-blur"
        >
          ← {t('common.back')}
        </button>
        {chromeVisible && (
          <label className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm backdrop-blur">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            {t('online.mirror')}
          </label>
        )}
      </div>

      {/* Countdown */}
      {phase === 'countdown' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="text-[26vh] font-black leading-none drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
            {count}
          </div>
        </div>
      )}

      {/* Rules briefing */}
      {showRules && (
        <InstructionCard
          title={t('group.title')}
          subtitle={t('group.subtitle')}
          rules={rules}
          onStart={handleRulesStart}
          onBack={backToSelect}
        />
      )}

      {/* Idle / calibrate chrome */}
      {!showRules && chromeVisible && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/45 p-8 backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl bg-black/70 px-6 py-5 text-center">
            <h1 className="mb-2 text-2xl font-black">{t('group.title')}</h1>
            <p className="text-sm text-white/75">{t('group.lineUp')}</p>
          </div>
          {status === 'starting' && (
            <div className="rounded-full bg-black/70 px-8 py-4 text-lg font-semibold">
              {t('runner.startingCamera')}
            </div>
          )}
          {status === 'running' && phase === 'calibrate' && (
            <div
              className="rounded-full px-8 py-4 text-lg font-black"
              style={{
                background: presentCount >= playerCount ? '#a3e635' : 'rgba(255,255,255,0.15)',
                color: presentCount >= playerCount ? '#000' : '#fff',
              }}
            >
              {t('group.waiting', { have: Math.min(presentCount, playerCount), need: playerCount })}
            </div>
          )}
          {status === 'error' && error && (
            <div className="max-w-sm rounded-xl bg-red-600/85 px-5 py-3 text-center text-sm font-semibold">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {phase === 'over' && result && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/72 p-8 backdrop-blur">
          <div className="text-center">
            <div className="text-sm uppercase tracking-widest text-white/60">{t('group.finish')}</div>
            <div className="mt-1 text-3xl font-black">
              {t('runner.wins', { name: t('runner.pLabel', { n: result.winnerIndex + 1 }) })}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {result.rank.map((p, place) => (
                <div
                  key={p.index}
                  className="flex items-center justify-between gap-6 rounded-xl bg-white/10 px-4 py-2"
                >
                  <span className="text-sm font-bold" style={{ color: groupColor(p.index) }}>
                    {place + 1}. {t('runner.pLabel', { n: p.index + 1 })}
                  </span>
                  <span className="tabular-nums text-lg font-black">{Math.round(p.progress)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAgain}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              {t('runner.again')}
            </button>
            <button
              onClick={backToSelect}
              className="rounded-full bg-white/15 px-6 py-4 text-lg font-semibold"
            >
              {t('runner.exit')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
