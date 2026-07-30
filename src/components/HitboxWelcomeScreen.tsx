import { Play } from 'lucide-react'
import { useI18n } from '../i18n'

interface Props {
  onGetStarted: () => void
}

/**
 * The very first thing the app shows: a fixed, always-neon brand splash (see
 * the "Hitbox welcome screen" block in index.css for why it doesn't read the
 * light/dark/neon theme system). One job — say what this is, look exciting,
 * get out of the way. `onGetStarted` hands control back to the caller, which
 * swaps this out for the normal Home flow.
 */
export function HitboxWelcomeScreen({ onGetStarted }: Props) {
  const { t } = useI18n()

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center overflow-hidden px-6 py-10"
      style={{ background: '#05060f' }}
    >
      <div className="welcome-glow welcome-glow-a" aria-hidden />
      <div className="welcome-glow welcome-glow-b" aria-hidden />
      <div className="welcome-rays" aria-hidden />

      <div className="relative z-10 flex w-full max-w-md flex-1 flex-col items-center justify-between py-4 text-center">
        <div>
          <h1 className="welcome-title text-5xl sm:text-6xl">
            <span className="welcome-title-a">Hit</span>
            <span className="welcome-title-b">box</span>
          </h1>
          <p className="mt-3 text-sm font-medium tracking-wide text-white/60">
            {t('welcome.tagline')}
          </p>
        </div>

        <button
          type="button"
          onClick={onGetStarted}
          className="welcome-play"
          aria-label={`${t('home.play')} — ${t('welcome.cta')}`}
        >
          <Play className="welcome-play-icon size-10 sm:size-12" fill="currentColor" aria-hidden />
          <span className="welcome-play-label">{t('home.play')}</span>
          <span className="welcome-play-sub">{t('welcome.cta')}</span>
        </button>

        {/* Spacer balancing the header above so the button sits dead center. */}
        <div aria-hidden />
      </div>
    </div>
  )
}
