import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'

interface Props {
  onGetStarted: () => void
}

/**
 * Variant B — the stakes, not the tech. Two giant colour panels mid-match,
 * bars climbing unevenly against each other, big numbers ticking — this is
 * what the LAST ten seconds of a round look like, showing before anyone has
 * even started one. No camera, no live tracking: pure animated UI telling a
 * "someone's about to win" story instead of a "here's how it works" one.
 */
export function WelcomeScoreboard({ onGetStarted }: Props) {
  const { t } = useI18n()
  const [scoreA, setScoreA] = useState(41)
  const [scoreB, setScoreB] = useState(53)

  useEffect(() => {
    const id = setInterval(() => {
      setScoreA((v) => {
        const next = v + (Math.random() * 10 - 3)
        return next > 96 ? 30 : next < 20 ? 45 : next
      })
      setScoreB((v) => {
        const next = v + (Math.random() * 10 - 3)
        return next > 96 ? 25 : next < 20 ? 40 : next
      })
    }, 550)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black">
      <div className="absolute inset-0 flex">
        <div className="relative flex-1 overflow-hidden" style={{ background: '#070d08' }}>
          <div className="welcome-vs-fill welcome-vs-fill-a" />
        </div>
        <div className="relative flex-1 overflow-hidden" style={{ background: '#0d0709' }}>
          <div className="welcome-vs-fill welcome-vs-fill-b" />
        </div>
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/80" />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-between px-6 py-10 text-center">
        <h1 className="welcome-title text-5xl sm:text-6xl">
          <span className="welcome-title-a">Hit</span>
          <span className="welcome-title-b">box</span>
        </h1>

        <div className="flex w-full items-center justify-center gap-4 sm:gap-8">
          <div
            className="font-black tabular-nums leading-none"
            style={{
              fontFamily: 'Orbitron, sans-serif',
              fontSize: 'clamp(3rem, 16vmin, 7rem)',
              color: '#39ff88',
              textShadow: '0 0 24px rgba(57,255,136,0.8)',
            }}
          >
            {Math.round(scoreA)}
          </div>
          <div
            className="text-2xl font-black text-white/50 sm:text-3xl"
            style={{ fontFamily: 'Orbitron, sans-serif' }}
          >
            VS
          </div>
          <div
            className="font-black tabular-nums leading-none"
            style={{
              fontFamily: 'Orbitron, sans-serif',
              fontSize: 'clamp(3rem, 16vmin, 7rem)',
              color: '#ff2e63',
              textShadow: '0 0 24px rgba(255,46,99,0.8)',
            }}
          >
            {Math.round(scoreB)}
          </div>
        </div>

        <button type="button" onClick={onGetStarted} className="welcome-play" aria-label={t('home.play')}>
          <span className="welcome-play-label">{t('home.play')}</span>
        </button>
      </div>
    </div>
  )
}
