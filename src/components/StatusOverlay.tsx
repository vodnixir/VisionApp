import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useI18n } from '../i18n'

/**
 * Small, unobtrusive "getting ready" chip — NOT a full-screen overlay. The
 * live camera video is already visible underneath (the engine paints it the
 * moment the video has real dimensions, well before the pose model finishes
 * loading), so this must never dim or block it. Scoring readiness is what's
 * still pending here, not the picture itself.
 */
export function LoadingOverlay() {
  const { t } = useI18n()
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center">
      <div className="flex items-center gap-3 rounded-full bg-black/70 px-6 py-3 backdrop-blur">
        <LoaderCircle className="size-5 animate-spin text-white" aria-hidden />
        <span className="text-base font-semibold text-white sm:text-lg">{t('load.title')}</span>
      </div>
    </div>
  )
}

export function ErrorOverlay({
  message,
  onBack,
  onRetry,
}: {
  message: string
  onBack: () => void
  /** Optional same-screen retry (re-attempt the failed action) shown alongside Back. */
  onRetry?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-page px-6 py-6 text-center landscape:gap-2">
      <TriangleAlert className="size-12 text-danger sm:size-16 landscape:size-8" aria-hidden />
      <p className="text-base font-semibold text-t1 sm:text-xl">{t('err.title')}</p>
      <p className="max-w-md text-sm leading-relaxed text-t2">{message}</p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-edge bg-card px-8 py-3 font-semibold text-t2 transition-all hover:border-edge2"
        >
          {t('err.back')}
        </button>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl bg-accent px-8 py-3 font-black text-on-accent transition-all"
          >
            {t('runner.again')}
          </button>
        )}
      </div>
    </div>
  )
}
