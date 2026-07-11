import { Lightbulb, MoveHorizontal, ScanLine, UserPlus, Users } from 'lucide-react'
import type { EngineHints } from '../cv/engine'
import { useI18n } from '../i18n'
import { playerColorsUI } from '../theme'
import type { CalibrationPhase } from '../types'

interface Props {
  phase: CalibrationPhase
  presentCount: number
  /** 0..1 progress of the 3-second lock. */
  lockProgress: number
  countdown: number | null
  hints: EngineHints
}

export function CalibrationOverlay({ phase, presentCount, lockProgress, countdown, hints }: Props) {
  const { t } = useI18n()

  if (phase === 'COUNTDOWN') {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <span
          key={countdown}
          className="countdown-digit animate-countdown-pop text-[9rem] font-bold leading-none sm:text-[16rem]"
        >
          {countdown}
        </span>
      </div>
    )
  }

  const locking = phase === 'LOCKING'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4 sm:bottom-12">
      <div className="overlay-panel flex w-full max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-4">
        <div className="flex items-center gap-3">
          {locking ? (
            <ScanLine className="size-6 text-dot sm:size-8" aria-hidden />
          ) : (
            <Users className="size-6 animate-pulse text-t2 sm:size-8" aria-hidden />
          )}
          <span className="text-sm font-semibold text-t1 sm:text-xl">
            {locking ? t('cal.locking') : t('cal.searching')}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-t2 sm:text-sm">
          <span
            className={presentCount >= 1 ? 'font-semibold' : 'text-t3/60'}
            style={presentCount >= 1 ? { color: playerColorsUI()[0] } : undefined}
          >
            P1
          </span>
          <span className="text-t3/60">·</span>
          <span
            className={presentCount >= 2 ? 'font-semibold' : 'text-t3/60'}
            style={presentCount >= 2 ? { color: playerColorsUI()[1] } : undefined}
          >
            P2
          </span>
          <span className="ml-2 text-t2">{t('cal.inFrame', { n: presentCount })}</span>
        </div>

        {locking && (
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-card2">
            <div
              className="glow-dot h-full rounded-full bg-dot transition-[width] duration-100 ease-linear"
              style={{ width: `${Math.min(lockProgress * 100, 100)}%` }}
            />
          </div>
        )}

        <QualityHint hints={hints} />
      </div>
    </div>
  )
}

/** One live setup hint at a time, most actionable first. */
function QualityHint({ hints }: { hints: EngineHints }) {
  const { t } = useI18n()
  const hint = hints.tooFar
    ? ({ icon: <UserPlus className="size-4" aria-hidden />, text: t('cal.closer') } as const)
    : hints.overlap
      ? ({ icon: <MoveHorizontal className="size-4" aria-hidden />, text: t('cal.apart') } as const)
      : hints.dark
        ? ({ icon: <Lightbulb className="size-4" aria-hidden />, text: t('cal.light') } as const)
        : null
  if (!hint) return null
  return (
    <p className="flex items-center gap-2 text-xs font-medium text-t2">
      {hint.icon}
      {hint.text}
    </p>
  )
}
