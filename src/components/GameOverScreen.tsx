import { Gauge, RotateCcw, Settings2, Trophy, Zap } from 'lucide-react'
import type { MatchResults } from '../types'
import { PLAYER_COLORS } from '../types'

interface Props {
  results: MatchResults
  onRematch: () => void
  onBackToSetup: () => void
}

export function GameOverScreen({ results, onRematch, onBackToSetup }: Props) {
  const winnerGlow = results.winnerIndex === 0 ? 'neon-text-blue' : 'neon-text-red'

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-arena-950/80 px-4 backdrop-blur-sm">
      <div className="animate-winner-flash flex flex-col items-center gap-2">
        <Trophy className="size-14 text-neon-yellow drop-shadow-[0_0_18px_rgba(255,230,0,0.8)] sm:size-24" aria-hidden />
        <p className="text-xs font-bold tracking-[0.4em] text-slate-300 sm:text-base">WINNER</p>
        <h2 className={`text-4xl font-black tracking-widest sm:text-7xl ${winnerGlow}`}>
          {results.winnerName}
        </h2>
        <p className="text-xs tracking-[0.25em] text-slate-400 sm:text-sm">
          MATCH TIME {formatTime(results.durationMs)}
        </p>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:gap-4">
        {results.players.map((p, i) => (
          <div
            key={i}
            className={`rounded-xl border-2 bg-arena-900/85 p-3 sm:p-5 ${
              i === 0 ? 'neon-border-blue' : 'neon-border-red'
            } ${i === results.winnerIndex ? '' : 'opacity-70'}`}
          >
            <p
              className="mb-2 truncate text-sm font-black tracking-widest sm:text-xl"
              style={{ color: PLAYER_COLORS[i] }}
            >
              {p.name}
            </p>
            <StatRow icon={<Trophy className="size-3.5 sm:size-4" aria-hidden />} label="SCORE" value={`${Math.floor(p.progress)}%`} />
            <StatRow icon={<Zap className="size-3.5 sm:size-4" aria-hidden />} label="PEAK SPEED" value={`${Math.round(p.maxSpeed * 100)}%`} />
            <StatRow icon={<Gauge className="size-3.5 sm:size-4" aria-hidden />} label="AVG ACTIVITY" value={`${Math.round(p.avgSpeed * 100)}%`} />
          </div>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap justify-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onRematch}
          className="flex items-center gap-2 rounded-xl border-2 border-neon-green bg-neon-green/10 px-6 py-3 text-base font-black tracking-widest text-neon-green transition-all hover:bg-neon-green/20 hover:shadow-[0_0_24px_rgba(57,255,136,0.5)] sm:px-10 sm:py-4 sm:text-xl"
        >
          <RotateCcw className="size-5 sm:size-6" aria-hidden />
          REMATCH
        </button>
        <button
          type="button"
          onClick={onBackToSetup}
          className="flex items-center gap-2 rounded-xl border-2 border-arena-700 px-6 py-3 text-base font-bold tracking-widest text-slate-300 transition-all hover:border-slate-400 sm:px-10 sm:py-4 sm:text-xl"
        >
          <Settings2 className="size-5 sm:size-6" aria-hidden />
          SETTINGS
        </button>
      </div>
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-white/10 py-1.5 text-slate-300 sm:py-2">
      <span className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] text-slate-400 sm:text-xs">
        {icon}
        {label}
      </span>
      <span className="text-sm font-black tabular-nums text-white sm:text-lg">{value}</span>
    </div>
  )
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
