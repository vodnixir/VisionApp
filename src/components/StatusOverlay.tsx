import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useI18n } from '../i18n'

export function LoadingOverlay() {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-arena-950/90">
      <LoaderCircle className="size-12 animate-spin text-neon-blue sm:size-16" aria-hidden />
      <p className="neon-text-blue text-sm font-black tracking-[0.25em] sm:text-lg">
        {t('load.title').toUpperCase()}
      </p>
      <p className="text-xs tracking-widest text-slate-400">{t('load.sub')}</p>
    </div>
  )
}

export function ErrorOverlay({ message, onBack }: { message: string; onBack: () => void }) {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-arena-950/95 px-6 text-center">
      <TriangleAlert className="size-12 text-neon-red sm:size-16" aria-hidden />
      <p className="neon-text-red text-base font-black tracking-widest sm:text-xl">
        {t('err.title').toUpperCase()}
      </p>
      <p className="max-w-md text-sm leading-relaxed text-slate-300">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 rounded-xl border-2 border-arena-700 px-8 py-3 font-bold tracking-widest text-slate-200 transition-all hover:border-slate-400"
      >
        {t('err.back').toUpperCase()}
      </button>
    </div>
  )
}
