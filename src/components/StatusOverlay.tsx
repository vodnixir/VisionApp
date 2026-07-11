import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useI18n } from '../i18n'

export function LoadingOverlay() {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-scrim">
      <LoaderCircle className="size-12 animate-spin text-t3 sm:size-16" aria-hidden />
      <p className="text-sm font-semibold text-t1 sm:text-lg">{t('load.title')}</p>
      <p className="text-xs text-t3">{t('load.sub')}</p>
    </div>
  )
}

export function ErrorOverlay({ message, onBack }: { message: string; onBack: () => void }) {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-page px-6 text-center">
      <TriangleAlert className="size-12 text-danger sm:size-16" aria-hidden />
      <p className="text-base font-semibold text-t1 sm:text-xl">{t('err.title')}</p>
      <p className="max-w-md text-sm leading-relaxed text-t2">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 rounded-xl border border-edge bg-card px-8 py-3 font-semibold text-t2 transition-all hover:border-edge2"
      >
        {t('err.back')}
      </button>
    </div>
  )
}
