import { Flame, Gauge, Home, RotateCcw, Trophy, Users, Zap } from 'lucide-react'
import { useI18n } from '../i18n'
import { playerColorsUI } from '../theme'
import type { MatchResults } from '../types'
import { ClipShare } from './ClipShare'
import type { MatchClipState } from '../hooks/useMatchClip'

interface Props {
  results: MatchResults
  clip: MatchClipState
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
  const winnerColor = playerColorsUI()[results.winnerIndex]

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-scrim px-4 backdrop-blur-sm">
      <div className="animate-winner-flash flex flex-col items-center gap-1">
        <Trophy className="size-12 text-gold sm:size-16" aria-hidden />
        <p className="text-xs font-medium tracking-wider text-t2">
          {t('over.winner').toUpperCase()}
        </p>
        <h2
          className="max-w-full truncate px-2 text-4xl font-bold sm:text-6xl"
          style={{ color: winnerColor }}
        >
          {results.winnerName}
        </h2>
        {results.endedByTimer && (
          <p className="text-xs font-medium text-t2">{t('over.byTimer')}</p>
        )}
      </div>

      <div className="grid w-full max-w-xl grid-cols-2 gap-3">
        {results.players.map((p, i) => (
          <div
            key={i}
            className={`rounded-2xl border bg-card p-3 sm:p-4 ${
              i === results.winnerIndex ? '' : 'opacity-70'
            }`}
            style={{ borderColor: `${playerColorsUI()[i]}4d` }}
          >
            <p
              className="mb-1.5 truncate text-sm font-semibold sm:text-lg"
              style={{ color: playerColorsUI()[i] }}
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

      <ClipShare state={clip} />

      <div className="flex w-full max-w-xl flex-col gap-2.5">
        {onContinueTournament ? (
          <button
            type="button"
            onClick={onContinueTournament}
            className="flex items-center justify-center gap-2.5 rounded-2xl bg-accent px-8 py-4 text-xl font-semibold text-on-accent transition-transform active:scale-[0.98]"
          >
            <Trophy className="size-6" aria-hidden />
            {t('over.continueTour')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="flex items-center justify-center gap-2.5 rounded-2xl bg-accent px-8 py-4 text-xl font-semibold text-on-accent transition-transform active:scale-[0.98]"
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
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-edge bg-card px-4 py-3 text-sm font-semibold text-t2 transition-colors hover:border-edge2"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('over.replay')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onChangePlayers}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-edge bg-card px-4 py-3 text-sm font-semibold text-t2 transition-colors hover:border-edge2"
            >
              <Users className="size-4" aria-hidden />
              {t('over.change')}
            </button>
          )}
          <button
            type="button"
            onClick={onHome}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-edge bg-card px-4 py-3 text-sm font-semibold text-t2 transition-colors hover:border-edge2"
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
    <div className="flex items-center justify-between border-t border-edge/60 py-1.5">
      <span className="flex items-center gap-1.5 text-[10px] text-t3 sm:text-xs">
        {icon}
        {label.toUpperCase()}
      </span>
      <span className="text-sm font-semibold tabular-nums text-t1 sm:text-base">{value}</span>
    </div>
  )
}
