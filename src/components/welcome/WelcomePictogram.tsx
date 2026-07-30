import { useI18n } from '../../i18n'

interface Props {
  onGetStarted: () => void
}

/**
 * Variant C — graphic design, not a tech demo. One giant Olympic-pictogram-
 * style figure, mid-motion, solid and monochrome like a sport signage icon —
 * the most minimal, most poster-like of the three. No camera, no animated
 * data, a single bold shape generated from angles (so it costs nothing to
 * swap poses later) plus the wordmark and one CTA.
 */
export function WelcomePictogram({ onGetStarted }: Props) {
  const { t } = useI18n()

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center overflow-hidden px-6 py-10"
      style={{ background: '#05060f' }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 30%, rgba(255,46,99,0.16), transparent 60%), radial-gradient(ellipse 70% 50% at 50% 85%, rgba(57,255,136,0.14), transparent 60%)',
        }}
        aria-hidden
      />

      <div className="relative z-10 flex w-full max-w-md flex-1 flex-col items-center justify-between py-4 text-center">
        <h1 className="welcome-title text-4xl sm:text-5xl">
          <span className="welcome-title-a">Hit</span>
          <span className="welcome-title-b">box</span>
        </h1>

        <svg
          viewBox="0 0 200 220"
          className="welcome-pictogram-figure h-[38vh] w-auto max-w-[70vw]"
          style={{ color: '#00c3ff' }}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="100" y1="60" x2="100" y2="128" strokeWidth="26" />
          <line x1="100" y1="66" x2="34" y2="18" strokeWidth="22" />
          <line x1="100" y1="66" x2="166" y2="18" strokeWidth="22" />
          <line x1="100" y1="124" x2="38" y2="204" strokeWidth="24" />
          <line x1="100" y1="124" x2="162" y2="204" strokeWidth="24" />
          <circle cx="100" cy="32" r="21" fill="currentColor" stroke="none" />
        </svg>

        <div>
          <p className="mb-5 text-sm font-medium tracking-wide text-white/60">{t('welcome.tagline')}</p>
          <button type="button" onClick={onGetStarted} className="welcome-play" aria-label={t('home.play')}>
            <span className="welcome-play-label">{t('home.play')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
