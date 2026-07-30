import { useWelcomeVariant } from '../welcomeVariant'
import { WelcomeCameraLive } from './welcome/WelcomeCameraLive'
import { WelcomePictogram } from './welcome/WelcomePictogram'
import { WelcomeScoreboard } from './welcome/WelcomeScoreboard'

interface Props {
  onGetStarted: () => void
}

const VARIANT_LABEL: Record<string, string> = {
  camera: 'A',
  scoreboard: 'B',
  pictogram: 'C',
}

/**
 * The very first thing the app shows. Currently a three-way dev switch
 * between redesign candidates (see welcomeVariant.ts) — tap the small chip
 * top-right to cycle through them and judge from a few meters away, which
 * is the only test that matters here. Once a direction is picked, delete
 * this switcher, the losing variants, and go back to a single component.
 */
export function HitboxWelcomeScreen({ onGetStarted }: Props) {
  const { variant, cycleWelcomeVariant } = useWelcomeVariant()

  return (
    <div className="fixed inset-0 z-50">
      {variant === 'camera' && <WelcomeCameraLive onGetStarted={onGetStarted} />}
      {variant === 'scoreboard' && <WelcomeScoreboard onGetStarted={onGetStarted} />}
      {variant === 'pictogram' && <WelcomePictogram onGetStarted={onGetStarted} />}

      <button
        type="button"
        onClick={cycleWelcomeVariant}
        className="fixed right-3 top-3 z-[60] rounded-full border border-white/25 bg-black/60 px-3 py-1.5 text-xs font-bold tracking-wider text-white/70 backdrop-blur"
        title="Dev: switch welcome screen variant"
      >
        {VARIANT_LABEL[variant]} · {variant}
      </button>
    </div>
  )
}
