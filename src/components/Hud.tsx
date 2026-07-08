import { memo } from 'react'
import { Timer, Zap } from 'lucide-react'
import type { PlayerStats } from '../types'

interface Props {
  stats: [PlayerStats, PlayerStats]
  names: [string, string]
  targetScore: number
  elapsedMs: number
  playing: boolean
}

/** Top-of-screen neon HUD: two mirrored progress bars + match timer. */
export const Hud = memo(function Hud({ stats, names, targetScore, elapsedMs, playing }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 p-2 sm:gap-4 sm:p-4">
      <PlayerPanel side="left" name={names[0]} stats={stats[0]} targetScore={targetScore} />

      <div className="neon-panel flex min-w-16 flex-col items-center rounded-xl px-2 py-2 sm:min-w-24 sm:px-4">
        <span className="text-[9px] font-bold tracking-[0.2em] text-slate-400 sm:text-[11px]">
          {playing ? 'FIGHT' : 'READY'}
        </span>
        <span className="flex items-center gap-1 text-base font-black text-white sm:text-2xl">
          <Timer className="size-3.5 text-neon-yellow sm:size-5" aria-hidden />
          {formatTime(elapsedMs)}
        </span>
      </div>

      <PlayerPanel side="right" name={names[1]} stats={stats[1]} targetScore={targetScore} />
    </div>
  )
})

function PlayerPanel({
  side,
  name,
  stats,
  targetScore,
}: {
  side: 'left' | 'right'
  name: string
  stats: PlayerStats
  targetScore: number
}) {
  const isLeft = side === 'left'
  const percent = Math.min((stats.progress / targetScore) * 100, 100)
  const textGlow = isLeft ? 'neon-text-blue' : 'neon-text-red'
  const border = isLeft ? 'neon-border-blue' : 'neon-border-red'
  const fill = isLeft ? 'bar-fill-blue' : 'bar-fill-red'

  return (
    <div
      className={`flex-1 rounded-xl border-2 bg-arena-900/75 p-2 backdrop-blur-sm sm:p-3 ${border} ${
        stats.present ? '' : 'opacity-60'
      }`}
    >
      <div className={`flex items-baseline justify-between gap-2 ${isLeft ? '' : 'flex-row-reverse'}`}>
        <span className={`truncate text-sm font-black tracking-widest sm:text-2xl ${textGlow}`}>
          {name}
        </span>
        <span className="text-lg font-black tabular-nums text-white sm:text-3xl">
          {Math.floor(percent)}
          <span className="text-xs text-slate-400 sm:text-base">%</span>
        </span>
      </div>

      {/* Progress bar — P2's fills right-to-left for symmetry on the TV. */}
      <div className="mt-1.5 h-3 overflow-hidden rounded-full border border-white/15 bg-arena-950 sm:mt-2 sm:h-5">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ease-linear ${fill} ${
            isLeft ? '' : 'ml-auto'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className={`mt-1.5 flex items-center gap-1.5 sm:mt-2 ${isLeft ? '' : 'flex-row-reverse'}`}>
        <Zap
          className={`size-3.5 sm:size-4 ${
            stats.speed > 0.05 ? 'fill-current text-neon-yellow' : 'text-slate-600'
          }`}
          aria-hidden
        />
        <SpeedMeter speed={stats.speed} reverse={!isLeft} />
        {!stats.present && (
          <span className="animate-pulse-glow text-[9px] font-bold tracking-widest text-neon-yellow sm:text-[11px]">
            OUT OF FRAME
          </span>
        )}
      </div>
    </div>
  )
}

/** Five-segment live speed gauge. */
function SpeedMeter({ speed, reverse }: { speed: number; reverse: boolean }) {
  const lit = Math.round(speed * 5)
  const segments = [0, 1, 2, 3, 4]
  return (
    <div className={`flex gap-0.5 sm:gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
      {segments.map((i) => (
        <span
          key={i}
          className={`h-2 w-3 rounded-[2px] sm:h-2.5 sm:w-5 ${
            i < lit
              ? i >= 3
                ? 'bg-neon-yellow shadow-[0_0_8px_rgba(255,230,0,0.8)]'
                : 'bg-neon-green shadow-[0_0_8px_rgba(57,255,136,0.7)]'
              : 'bg-arena-700'
          }`}
        />
      ))}
    </div>
  )
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
