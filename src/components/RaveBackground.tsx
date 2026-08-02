/**
 * The "living background" behind Start and Home: floating radial-gradient
 * blobs that drift, grouped into three palettes that crossfade into each
 * other on a slow loop. Pure CSS — this component renders once and never
 * touches React state; all motion lives in index.css's hbx-* keyframes
 * (fade3 for the palette crossfade, drift for the blobs themselves).
 *
 * Three wrappers (Group A/B/C) each hold a copy of all 3 blobs in that
 * group's colours, absolutely stacked. Each wrapper fades 0→1→0 over the
 * same 24s cycle, offset by a third (8s) from the other two — the
 * triangular ramps always sum to opacity 1, so there's never a dark gap at
 * handover between groups (see the fade3 keyframes for why the exact stops
 * matter).
 */

const CYCLE_LEN_S = 24

/** Colour-group order matches the design brief: A (pink/blue/violet), B (violet/pink/blue), C (green/blue/violet). */
const GROUPS: readonly (readonly [string, string, string])[] = [
  ['#ff3b7f', '#33c9ff', '#8b5cff'],
  ['#8b5cff', '#ff3b7f', '#33c9ff'],
  ['#3CFFB0', '#33c9ff', '#8b5cff'],
]

/** Each group's blob wrapper starts at a different phase of the same 24s cycle, a third apart. */
const GROUP_DELAYS_S = [0, -(CYCLE_LEN_S / 3) * 2, -(CYCLE_LEN_S / 3)]

/** Blob anchor positions, in order, shared by every group. */
const ANCHORS: readonly (readonly [string, string])[] = [
  ['30%', '28%'],
  ['72%', '68%'],
  ['50%', '92%'],
]

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = Number.parseInt(v.slice(0, 2), 16)
  const g = Number.parseInt(v.slice(2, 4), 16)
  const b = Number.parseInt(v.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface Props {
  /** Start uses the lighter vignette; Home's is heavier so busy card content stays legible. */
  variant: 'start' | 'home'
}

export function RaveBackground({ variant }: Props) {
  return (
    <div className="hbx-bg" aria-hidden>
      {GROUPS.map((colors, gi) => (
        <div key={gi} className="hbx-bg-group" style={{ animationDelay: `${GROUP_DELAYS_S[gi]}s` }}>
          {colors.map((color, i) => {
            const [x, y] = ANCHORS[i]
            return (
              <div
                key={i}
                className="hbx-blob"
                style={{
                  background: `radial-gradient(circle at ${x} ${y}, ${hexToRgba(color, 0.3)}, transparent 55%)`,
                  animationDuration: `${12 + i * 3}s`,
                  animationDirection: i % 2 === 1 ? 'reverse' : 'normal',
                }}
              />
            )
          })}
        </div>
      ))}
      <div className={variant === 'start' ? 'hbx-scrim-start' : 'hbx-scrim-home'} />
    </div>
  )
}
