import { useI18n } from '../i18n'
import { RaveBackground } from './RaveBackground'

interface Props {
  onGetStarted: () => void
}

/** Foreground accent colours — fixed regardless of which background palette
 * group is crossfaded in behind them (see RaveBackground): shifting the
 * play button / BPM dot to match the drifting backdrop would make them
 * illegible to track at a glance, so they stay pinned to "Colour 1/2". */
const COLOUR_1 = '#ff3b7f'
const COLOUR_2 = '#33c9ff'
const BASE = '#0e0518'

/** width/height% pairs for the skyline silhouette, left to right; two buildings carry a roof antenna. */
const BUILDINGS: { w: number; h: number; antenna?: number }[] = [
  { w: 26, h: 52 },
  { w: 20, h: 78, antenna: 14 },
  { w: 34, h: 44 },
  { w: 18, h: 92 },
  { w: 28, h: 60 },
  { w: 22, h: 38 },
  { w: 30, h: 70, antenna: 18 },
  { w: 19, h: 50 },
  { w: 32, h: 84 },
  { w: 24, h: 41 },
  { w: 21, h: 66 },
  { w: 29, h: 48 },
]

/**
 * The very first thing the app shows: a fixed, always-neon brand splash (see
 * the "Hitbox Rave Pulse background" block in index.css for why it doesn't
 * read the light/dark/neon theme system) — a BPM-synced pulse ring around
 * PLAY, over a living gradient background and a city skyline. One job — say
 * what this is, look exciting, get out of the way. `onGetStarted` hands
 * control back to the caller, which swaps this out for the normal Home flow.
 *
 * Built against a 300×640 reference frame (see design_handoff_hitbox_rave_pulse/README.md)
 * and scaled proportionally to fit the real viewport via a CSS transform, so
 * every absolute position below is the design's own px value, unmodified.
 */
export function HitboxWelcomeScreen({ onGetStarted }: Props) {
  const { t } = useI18n()

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ background: BASE }}>
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: 300,
          height: 640,
          transform: 'translate(-50%, -50%) scale(min(calc(100vw / 300), calc(100dvh / 640)))',
        }}
      >
        <RaveBackground variant="start" />

        {/* BPM pill */}
        <div
          className="absolute flex items-center gap-1.5 rounded-full"
          style={{ top: 26, right: 18, padding: '5px 10px', background: 'rgba(0,0,0,.4)' }}
        >
          <div
            className="hbx-beat-dot rounded-full"
            style={{ width: 6, height: 6, background: COLOUR_1 }}
            aria-hidden
          />
          <span style={{ font: '700 10px ui-monospace, monospace', color: '#fff' }}>128 BPM</span>
        </div>

        {/* Wordmark */}
        <div className="absolute inset-x-0 text-center" style={{ top: 118 }}>
          <div style={{ font: "900 46px/1 system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }}>
            <span style={{ color: COLOUR_2 }}>HIT</span>
            <span style={{ color: '#fff' }}>BOX</span>
          </div>
          <div
            style={{
              marginTop: 10,
              font: "500 13px system-ui, -apple-system, sans-serif",
              color: 'rgba(255,255,255,.65)',
            }}
          >
            {t('welcome.tagline')}
          </div>
        </div>

        {/* Play button */}
        <button
          type="button"
          onClick={onGetStarted}
          aria-label={`${t('home.play')} — ${t('welcome.cta')}`}
          className="absolute cursor-pointer border-0 bg-transparent p-0"
          style={{ left: '50%', top: 372, width: 180, height: 180, transform: 'translate(-50%, -50%)' }}
        >
          <div className="hbx-ring" style={{ border: `2px solid ${hexAlpha(COLOUR_1, 0.6)}` }} />
          <div
            className="hbx-ring"
            style={{ border: `2px solid ${hexAlpha(COLOUR_2, 0.6)}`, animationDelay: '1s' }}
          />
          <div
            className="absolute flex flex-col items-center justify-center gap-1.5 rounded-full"
            style={{
              inset: 28,
              background: `radial-gradient(circle at 35% 30%, ${hexAlpha(COLOUR_1, 0.22)}, ${BASE})`,
              boxShadow: `0 0 40px ${hexAlpha(COLOUR_1, 0.35)}`,
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: '16px solid transparent',
                borderBottom: '16px solid transparent',
                borderLeft: '26px solid #fff',
              }}
              aria-hidden
            />
            <span style={{ font: "800 14px system-ui, -apple-system, sans-serif", color: '#fff', letterSpacing: '.06em' }}>
              {t('home.play')}
            </span>
          </div>
        </button>

        {/* City skyline */}
        <div className="absolute inset-x-0 bottom-0" style={{ height: 140 }}>
          <div
            className="absolute inset-x-0 top-0"
            style={{
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent)',
            }}
          />
          <div
            className="absolute inset-x-0 bottom-0 flex items-end"
            style={{ height: 110, gap: 5, padding: '0 10px', opacity: 0.72 }}
          >
            {BUILDINGS.map((b, i) => (
              <div
                key={i}
                className="relative"
                style={{ width: b.w, height: `${b.h}%`, background: 'rgba(0,0,0,.72)' }}
              >
                {b.antenna && (
                  <div
                    className="absolute left-1/2"
                    style={{
                      top: -b.antenna,
                      width: 2,
                      height: b.antenna,
                      background: 'rgba(0,0,0,.72)',
                      transform: 'translateX(-50%)',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** hex -> rgba() string at the given alpha. */
function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
