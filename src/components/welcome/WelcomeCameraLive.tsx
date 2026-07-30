import { Play } from 'lucide-react'
import { useEffect } from 'react'
import { useI18n } from '../../i18n'
import { usePoseDetection } from '../../hooks/usePoseDetection'

interface Props {
  onGetStarted: () => void
}

/**
 * Variant A — the product demonstrating itself. Live camera behind the
 * wordmark, tracked skeleton overlay in the app's own accent colors, before
 * the visitor has tapped anything. Explains "your body is the controller"
 * in one glance and doubles as a camera-permission/framing check.
 *
 * Zero new drawing code: this is the SAME engine + the SAME drawSkeleton /
 * drawBrackets pipeline every in-game screen already uses (brackets carry
 * the accent colors; the skeleton itself is intentionally neutral —
 * "correct/incorrect" has no meaning here, there's no pose to match).
 * Degrades to the static glow background if the camera is denied or
 * unavailable — this screen must never block on it.
 */
export function WelcomeCameraLive({ onGetStarted }: Props) {
  const { t } = useI18n()
  const { videoRef, canvasRef, status, start, configure } = usePoseDetection(() => {})

  useEffect(() => {
    configure({
      mirror: true,
      names: ['', ''],
      maxPlayers: 2,
      scoring: false,
      drawOverlays: true,
      showSkeleton: true,
      rolesLocked: false,
    })
    void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cameraLive = status === 'running'

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-hidden bg-black px-6 py-10">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
          cameraLive ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/60" />
      {!cameraLive && (
        <>
          <div className="welcome-glow welcome-glow-a" aria-hidden />
          <div className="welcome-glow welcome-glow-b" aria-hidden />
        </>
      )}

      <div className="relative z-10 flex w-full max-w-md flex-1 flex-col items-center justify-between py-4 text-center">
        <div>
          <h1 className="welcome-title text-5xl sm:text-6xl">
            <span className="welcome-title-a">Hit</span>
            <span className="welcome-title-b">box</span>
          </h1>
          <p className="mt-3 text-sm font-medium tracking-wide text-white/70">{t('welcome.tagline')}</p>
        </div>

        <button type="button" onClick={onGetStarted} className="welcome-play" aria-label={t('home.play')}>
          <Play className="welcome-play-icon size-10 sm:size-12" fill="currentColor" aria-hidden />
          <span className="welcome-play-label">{t('home.play')}</span>
        </button>

        <div aria-hidden />
      </div>
    </div>
  )
}
