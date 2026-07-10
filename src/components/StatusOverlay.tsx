import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useI18n } from '../i18n'

export function LoadingOverlay() {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-paper/90">
      <LoaderCircle className="size-12 animate-spin text-neutral-400 sm:size-16" aria-hidden />
      <p className="text-sm font-semibold text-neutral-900 sm:text-lg">{t('load.title')}</p>
      <p className="text-xs text-neutral-400">{t('load.sub')}</p>
    </div>
  )
}

export function ErrorOverlay({ message, onBack }: { message: string; onBack: () => void }) {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-paper px-6 text-center">
      <TriangleAlert className="size-12 text-red-500 sm:size-16" aria-hidden />
      <p className="text-base font-semibold text-neutral-900 sm:text-xl">{t('err.title')}</p>
      <p className="max-w-md text-sm leading-relaxed text-neutral-500">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 rounded-xl border border-black/10 bg-white px-8 py-3 font-semibold text-neutral-700 transition-all hover:border-black/25"
      >
        {t('err.back')}
      </button>
    </div>
  )
}
