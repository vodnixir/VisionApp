import { Flame, Gauge, Home, RotateCcw, Share2, Trophy, Users, Zap } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { shareClip, type MatchClip } from '../recorder'
import type { MatchResults } from '../types'
import { PLAYER_COLORS } from '../types'

interface Props {
  results: MatchResults
  clip: MatchClip | null
  onNext: () => void
  onChangePlayers: () => void
  onHome: () => void
  /** Set while a bracket match was just played — the primary action reports the winner. */
  onContinueTournament?: () => void
}

/**
 * The host's between-matches loop. The canvas behind has already celebrated;
 * this panel is about ONE thing — getting the next match running in one tap.
 */
export function GameOverScreen({
  results,
  clip,
  onNext,
  onChangePlayers,
  onHome,
  onContinueTournament,
}: Props) {
  const { t } = useI18n()
  const [sharing, setSharing] = useState(false)
  const winnerColor = PLAYER_COLORS[results.winnerIndex]

  const handleShare = async () => {
    if (!clip || sharing) return
    setSharing(true)
    try {
      await shareClip(clip)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-arena-950/85 px-4 backdrop-blur-sm">
      <div className="animate-winner-flash flex flex-col items-center gap-1">
        <Trophy className="size-12 text-neon-yellow sm:size-16" aria-hidden />
        <p className="text-xs font-bold tracking-[0.35em] text-slate-400">
          {t('over.winner').toUpperCase()}
        </p>
        <h2
          className="max-w-full truncate px-2 text-4xl font-black tracking-wide sm:text-6xl"
          style={{ color: winnerColor }}
        >
          {results.winnerName}
        </h2>
        {results.endedByTimer && (
          <p className="text-xs font-semibold tracking-wide text-neon-yellow">{t('over.byTimer')}</p>
        )}
      </div>

      <div className="grid w-full max-w-xl grid-cols-2 gap-3">
        {results.players.map((p, i) => (
          <div
            key={i}
            className={`rounded-2xl border bg-arena-900/85 p-3 sm:p-4 ${
              i === results.winnerIndex ? '' : 'opacity-70'
            }`}
            style={{ borderColor: `${PLAYER_COLORS[i]}88` }}
          >
            <p
              className="mb-1.5 truncate text-sm font-black tracking-wide sm:text-lg"
              style={{ color: PLAYER_COLORS[i] }}
            >
              {p.name}
            </p>
            <StatRow
              icon={<Trophy className="size-3.5" aria-hidden />}
              label={t('over.score')}
              value={`${Math.floor(p.progress)}%`}
            />
            <StatRow
              icon={<Zap className="size-3.5" aria-hidden />}
              label={t('over.peak')}
              value={`${Math.round(p.maxSpeed * 100)}%`}
            />
            <StatRow
              icon={<Gauge className="size-3.5" aria-hidden />}
              label={t('over.avg')}
              value={`${Math.round(p.avgSpeed * 100)}%`}
            />
            {(p.maxCombo ?? 1) > 1 && (
              <StatRow
                icon={<Flame className="size-3.5" aria-hidden />}
                label={t('over.combo')}
                value={`×${p.maxCombo}`}
              />
            )}
          </div>
        ))}
      </div>

      {clip && (
        <button
          type="button"
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center gap-2 rounded-xl border border-neon-blue/70 px-5 py-2.5 text-sm font-bold text-neon-blue transition-all hover:bg-neon-blue/10 disabled:opacity-50"
        >
          <Share2 className="size-4" aria-hidden />
          {t('over.share')}
        </button>
      )}

      <div className="flex w-full max-w-xl flex-col gap-2.5">
        {onContinueTournament ? (
          <button
            type="button"
            onClick={onContinueTournament}
            className="flex items-center justify-center gap-2.5 rounded-2xl bg-neon-green px-8 py-4 text-xl font-black tracking-wide text-arena-950 transition-transform active:scale-[0.98]"
          >
            <Trophy className="size-6" aria-hidden />
            {t('over.continueTour')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="flex items-center justify-center gap-2.5 rounded-2xl bg-neon-green px-8 py-4 text-xl font-black tracking-wide text-arena-950 transition-transform active:scale-[0.98]"
          >
            <RotateCcw className="size-6" aria-hidden />
            {t('over.next')}
          </button>
        )}
        <div className="flex gap-2.5">
          {onContinueTournament ? (
            <button
              type="button"
              onClick={onNext}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-slate-300 transition-colors hover:border-white/35"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('over.replay')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onChangePlayers}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-slate-300 transition-colors hover:border-white/35"
            >
              <Users className="size-4" aria-hidden />
              {t('over.change')}
            </button>
          )}
          <button
            type="button"
            onClick={onHome}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-slate-400 transition-colors hover:border-white/35"
          >
            <Home className="size-4" aria-hidden />
            {t('over.home')}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-white/10 py-1.5 text-slate-300">
      <span className="flex items-center gap-1.5 text-[10px] tracking-wide text-slate-500 sm:text-xs">
        {icon}
        {label.toUpperCase()}
      </span>
      <span className="text-sm font-black tabular-nums text-white sm:text-base">{value}</span>
    </div>
  )
}
