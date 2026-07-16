import { RefreshCw, Share2 } from 'lucide-react'
import { useI18n } from '../i18n'
import type { ClipStatus } from '../hooks/useMatchClip'

/**
 * Status-aware share control for the auto-recorded highlight clip. Instead of a
 * button that silently never appears when recording fails, it shows the clip's
 * actual state at every stage (preparing / ready / unavailable / share error),
 * shared across the duel, runner and online result screens.
 */
export function ClipShare({
  status,
  sharing,
  shareError,
  onShare,
  tone = 'card',
}: {
  status: ClipStatus
  sharing: boolean
  shareError: boolean
  onShare: () => void
  /** 'card' for the light duel panel, 'dark' over the runner/online canvas. */
  tone?: 'card' | 'dark'
}) {
  const { t } = useI18n()
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

  const btn =
    tone === 'dark'
      ? 'flex items-center gap-2 rounded-full bg-chip px-6 py-3 text-base font-black text-onchip shadow-lg active:scale-95 disabled:opacity-50'
      : 'flex items-center gap-2 rounded-xl border border-edge bg-card px-5 py-2.5 text-sm font-semibold text-t2 transition-all hover:border-edge2 disabled:opacity-50'

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button type="button" onClick={onShare} disabled={sharing} className={btn}>
        {sharing ? (
          <RefreshCw className="size-4 animate-spin" aria-hidden />
        ) : (
          <Share2 className="size-4" aria-hidden />
        )}
        {t('over.share')}
      </button>
      {shareError && <p className="text-xs text-danger">{t('over.shareFailed')}</p>}
    </div>
  )
}
