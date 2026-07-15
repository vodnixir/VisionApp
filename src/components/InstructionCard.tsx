import { useI18n } from '../i18n'

/** One rule line: an emoji glyph and a short instruction. */
export interface Rule {
  emoji: string
  text: string
}

interface Props {
  /** Big heading — usually the game/mode name. */
  title: string
  /** Optional one-line subtitle under the title. */
  subtitle?: string
  /** The ordered "how to play" rules shown as a list. */
  rules: Rule[]
  /** Primary CTA label (defaults to "Let's go"). */
  startLabel?: string
  onStart: () => void
  onBack: () => void
}

/**
 * The pre-game briefing shown before every game starts — a themed modal that
 * explains the rules so a new player is never dropped in cold. Uses the global
 * arcade/neon tokens (bg-page/card, accent, edge) so it matches every theme and
 * layers over the menu backdrop with high contrast.
 */
export function InstructionCard({ title, subtitle, rules, startLabel, onStart, onBack }: Props) {
  const { t } = useI18n()
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-edge bg-page p-6 shadow-2xl">
        <header className="mb-4 text-center">
          <h2 className="text-2xl font-black text-t1">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-t3">{subtitle}</p>}
        </header>

        <ul className="mb-6 flex flex-col gap-3">
          {rules.map((r, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-4 py-3">
              <span className="shrink-0 text-2xl" aria-hidden>
                {r.emoji}
              </span>
              <span className="text-sm font-medium text-t1">{r.text}</span>
            </li>
          ))}
        </ul>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-2xl border border-edge bg-card px-5 py-3 text-sm font-semibold text-t2 transition-colors hover:text-t1"
          >
            {t('common.back')}
          </button>
          <button
            type="button"
            onClick={onStart}
            className="flex-1 rounded-2xl bg-accent px-5 py-3 text-base font-black text-on-accent transition-transform active:scale-[0.98]"
          >
            {startLabel ?? t('common.letsGo')}
          </button>
        </div>
      </div>
    </div>
  )
}
