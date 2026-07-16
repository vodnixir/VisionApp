import { Clapperboard, Flag, RefreshCw, Share2, Sparkles } from 'lucide-react'
import { useI18n, type I18nKey } from '../i18n'
import type { ClipKind, MatchClipState } from '../hooks/useMatchClip'

/**
 * Share control for the auto-recorded highlight clip. Two jobs:
 *
 *  - never leave the user guessing: the clip's real state is always on screen
 *    (preparing / ready / unavailable / cutting / failed), instead of a button
 *    that silently fails to appear;
 *  - let them pick the cut — the whole match, the liveliest ~20s, or the finish.
 *
 * Cutting re-encodes in real time (~20s for the highlights), so that path shows
 * a percentage and says so up front rather than looking frozen.
 */
const KIND_META: Record<ClipKind, { key: I18nKey; icon: typeof Share2 }> = {
  whole: { key: 'over.clipWhole', icon: Clapperboard },
  highlights: { key: 'over.clipHighlights', icon: Sparkles },
  ending: { key: 'over.clipEnding', icon: Flag },
}

export function ClipShare({
  state,
  tone = 'card',
}: {
  state: MatchClipState
  /** 'card' for the light duel panel, 'dark' over the runner/online canvas. */
  tone?: 'card' | 'dark'
}) {
  const { t } = useI18n()
  const { status, kinds, sharing, shareError, cutting, cutProgress, cutError, share } = state

  if (status === 'idle') return null

  if (status === 'preparing') {
    return (
      <p className="flex items-center gap-2 text-sm text-t3">
        <RefreshCw className="size-4 animate-spin" aria-hidden />
        {t('over.clipPreparing')}
      </p>
    )
  }

  if (status === 'unavailable') {
    return <p className="text-sm text-t3">{t('over.clipFailed')}</p>
  }

  // Mid-cut: a progress read-out, because this genuinely takes ~20 seconds.
  if (cutting) {
    return (
      <div className="flex w-full max-w-xs flex-col items-center gap-1.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-t2">
          <RefreshCw className="size-4 animate-spin" aria-hidden />
          {t('over.clipCutting', { percent: Math.round(cutProgress * 100) })}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-card2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${Math.round(cutProgress * 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-t3">{t('over.clipCutHint')}</p>
      </div>
    )
  }

  const btn =
    tone === 'dark'
      ? 'flex items-center gap-1.5 rounded-full bg-chip px-4 py-2.5 text-sm font-black text-onchip shadow-lg active:scale-95 disabled:opacity-50'
      : 'flex items-center gap-1.5 rounded-xl border border-edge bg-card px-4 py-2.5 text-sm font-semibold text-t2 transition-all hover:border-edge2 disabled:opacity-50'

  return (
    <div className="flex flex-col items-center gap-2">
      <p className={`text-xs ${tone === 'dark' ? 'text-white/60' : 'text-t3'}`}>
        {t('over.clipPick')}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {kinds.map((kind) => {
          const { key, icon: Icon } = KIND_META[kind]
          return (
            <button
              key={kind}
              type="button"
              onClick={() => void share(kind)}
              disabled={sharing}
              className={btn}
            >
              {sharing ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden />
              ) : (
                <Icon className="size-4" aria-hidden />
              )}
              {t(key)}
            </button>
          )
        })}
      </div>
      {shareError && <p className="text-xs text-danger">{t('over.shareFailed')}</p>}
      {cutError && <p className="text-xs text-danger">{t('over.clipCutFailed')}</p>}
    </div>
  )
}
