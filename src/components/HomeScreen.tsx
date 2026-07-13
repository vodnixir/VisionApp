import {
  Cast,
  LayoutGrid,
  LayoutList,
  Square,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { LANGS, useI18n } from '../i18n'
import { LAYOUT_IDS, useLayout, type LayoutId } from '../layout'
import { loadSession, sessionLeader } from '../session'
import type { CastStatus } from '../show'
import { loadProfiles } from '../storage'
import { THEME_IDS, useTheme, type ThemeId } from '../theme'

interface Props {
  onQuickMatch: () => void
  onTournament: () => void
  onRoster: () => void
  tournamentActive: boolean
  castSupported: boolean
  castStatus: CastStatus
  onCast: () => void
}

/** One home action, rendered differently by each layout. */
interface Action {
  key: string
  label: string
  hint?: string
  Icon: LucideIcon
  onClick: () => void
  /** The lime hero action (there is exactly one). */
  primary?: boolean
  /** Live indicator dot (tournament in progress / cast live). */
  dot?: boolean
  /** Tint the icon with the accent (cast live). */
  iconActive?: boolean
}

/** Swatch preview per theme — the picker button backgrounds. */
const THEME_SWATCH: Record<ThemeId, string> = {
  light: '#f7f7f5',
  dark: '#141414',
  neon: 'linear-gradient(135deg, #05060f 55%, #00c3ff)',
}

const LAYOUT_ICON: Record<LayoutId, LucideIcon> = {
  stack: LayoutList,
  grid: LayoutGrid,
  hero: Square,
}

/** Host console home: the phone is the remote, the show is on the TV. */
export function HomeScreen({
  onQuickMatch,
  onTournament,
  onRoster,
  tournamentActive,
  castSupported,
  castStatus,
  onCast,
}: Props) {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  const { layout, setLayout } = useLayout()
  const [profileCount] = useState(() => loadProfiles().length)
  // Refreshes whenever we come back to Home (the component remounts).
  const [session] = useState(loadSession)
  const leader = sessionLeader(session)
  const castLabel =
    castStatus === 'live'
      ? t('cast.live')
      : castStatus === 'connecting'
        ? t('cast.connecting')
        : t('cast.tv')

  const actions: Action[] = [
    {
      key: 'quick',
      label: t('home.quick'),
      hint: t('home.quickHint'),
      Icon: Zap,
      onClick: onQuickMatch,
      primary: true,
    },
    {
      key: 'tournament',
      label: t('home.tournament'),
      hint: tournamentActive ? t('home.tournamentResume') : t('home.tournamentHint'),
      Icon: Trophy,
      onClick: onTournament,
      dot: tournamentActive,
    },
    {
      key: 'roster',
      label: t('home.players'),
      hint: t('home.playersSaved', { n: profileCount }),
      Icon: Users,
      onClick: onRoster,
    },
    ...(castSupported
      ? [
          {
            key: 'cast',
            label: castLabel,
            hint: t('cast.hint'),
            Icon: Cast,
            onClick: onCast,
            dot: castStatus === 'live',
            iconActive: castStatus === 'live',
          } satisfies Action,
        ]
      : []),
  ]

  return (
    <div className="screen absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-page px-4 py-6">
      <div className="flex w-full max-w-md flex-1 flex-col gap-3">
        <header className="mb-1 flex items-center justify-between">
          <h1 className="brand text-base text-t1">
            <span className="brand-a">Speed</span> <span className="brand-b">Battle</span>
          </h1>
          <div className="flex gap-1">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold tracking-wider transition-colors ${
                  l === lang ? 'bg-selbg text-t1' : 'text-t3 hover:text-t2'
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </header>

        {layout === 'grid' ? (
          <GridBody actions={actions} />
        ) : layout === 'hero' ? (
          <HeroBody actions={actions} />
        ) : (
          <StackBody actions={actions} />
        )}

        <div className="mt-auto flex flex-col items-center gap-3 pt-4">
          {session.matches > 0 && (
            <p className="text-center text-xs text-t3">
              {t('home.session', { n: session.matches })}
              {leader && (
                <>
                  {' · '}
                  <span className="font-semibold text-t2">
                    {t('home.sessionLeader', { name: leader.name, n: leader.wins })}
                  </span>
                </>
              )}
            </p>
          )}

          <div className="flex items-center gap-3">
            <div className="flex gap-1 rounded-xl border border-edge bg-card p-1">
              {LAYOUT_IDS.map((id) => {
                const Icon = LAYOUT_ICON[id]
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLayout(id)}
                    aria-label={t(`layout.${id}`)}
                    title={t(`layout.${id}`)}
                    className={`rounded-lg p-1.5 transition-colors ${
                      id === layout ? 'bg-selbg text-sel' : 'text-t3 hover:text-t2'
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                  </button>
                )
              })}
            </div>

            <div className="h-5 w-px bg-edge" />

            <div className="flex gap-2">
              {THEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  aria-label={t(`theme.${id}`)}
                  title={t(`theme.${id}`)}
                  className={`size-7 rounded-full border-2 transition-all ${
                    id === theme ? 'scale-110 border-sel' : 'border-edge hover:border-edge2'
                  }`}
                  style={{ background: THEME_SWATCH[id] }}
                />
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-t3">{t('home.footer')}</p>

          {/* Experimental body-controlled runner modes — hidden #-routes for now. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.hash = 'online'
                window.location.reload()
              }}
              className="flex items-center gap-1.5 rounded-full border border-edge bg-card px-4 py-1.5 text-xs font-semibold text-t2 transition-colors hover:border-edge2 hover:text-t1"
            >
              🌐 Онлайн с другом <span className="text-t3">· бета</span>
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.hash = 'runner'
                window.location.reload()
              }}
              className="flex items-center gap-1.5 rounded-full border border-edge bg-card px-4 py-1.5 text-xs font-semibold text-t2 transition-colors hover:border-edge2 hover:text-t1"
            >
              🏃 Бегун · соло <span className="text-t3">· бета</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Layout bodies ---------------- */

/** Classic: a big primary CTA over a vertical list of rows. */
function StackBody({ actions }: { actions: Action[] }) {
  const primary = actions.find((a) => a.primary)
  const rest = actions.filter((a) => !a.primary)
  return (
    <>
      {primary && <PrimaryCard action={primary} />}
      {rest.map((a) => (
        <ListRow key={a.key} action={a} />
      ))}
    </>
  )
}

/** Compact tiles: primary banner, then a 2-column grid. Odd tile spans wide. */
function GridBody({ actions }: { actions: Action[] }) {
  const primary = actions.find((a) => a.primary)
  const rest = actions.filter((a) => !a.primary)
  const oddFirstWide = rest.length % 2 === 1
  return (
    <>
      {primary && <PrimaryCard action={primary} />}
      <div className="grid grid-cols-2 gap-3">
        {rest.map((a, i) => (
          <GridTile key={a.key} action={a} wide={oddFirstWide && i === 0} />
        ))}
      </div>
    </>
  )
}

/** Focus mode: one oversized action fills the screen; the rest are icon buttons. */
function HeroBody({ actions }: { actions: Action[] }) {
  const primary = actions.find((a) => a.primary)
  const rest = actions.filter((a) => !a.primary)
  return (
    <>
      {primary && (
        <button
          type="button"
          onClick={primary.onClick}
          className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl bg-accent px-6 py-12 text-center transition-transform active:scale-[0.98]"
        >
          <primary.Icon className="size-14 text-on-accent" aria-hidden />
          <span className="text-3xl font-semibold text-on-accent">{primary.label}</span>
          {primary.hint && (
            <span className="max-w-xs text-sm text-on-accent/65">{primary.hint}</span>
          )}
        </button>
      )}
      <div className="grid grid-cols-3 gap-2">
        {rest.map((a) => (
          <IconAction key={a.key} action={a} />
        ))}
      </div>
    </>
  )
}

/* ---------------- Shared pieces ---------------- */

function PrimaryCard({ action }: { action: Action }) {
  const { Icon } = action
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="flex flex-col gap-1 rounded-2xl bg-accent px-5 py-5 text-left transition-transform active:scale-[0.98]"
    >
      <span className="flex items-center gap-2 text-lg font-semibold text-on-accent">
        <Icon className="size-5" aria-hidden />
        {action.label}
      </span>
      {action.hint && <span className="text-sm text-on-accent/65">{action.hint}</span>}
    </button>
  )
}

function ListRow({ action }: { action: Action }) {
  const { Icon } = action
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="flex items-center justify-between rounded-2xl border border-edge bg-card px-5 py-4 text-left transition-colors hover:border-edge2"
    >
      <span className="flex items-center gap-3">
        <Icon className={`size-5 ${action.iconActive ? 'text-dot' : 'text-t3'}`} aria-hidden />
        <span className="flex flex-col">
          <span className="text-base font-semibold text-t1">{action.label}</span>
          {action.hint && <span className="text-xs text-t3">{action.hint}</span>}
        </span>
      </span>
      {action.dot && <span className="glow-dot size-2 rounded-full bg-dot" />}
    </button>
  )
}

function GridTile({ action, wide }: { action: Action; wide?: boolean }) {
  const { Icon } = action
  return (
    <button
      type="button"
      onClick={action.onClick}
      className={`relative flex min-h-28 flex-col items-start justify-between rounded-2xl border border-edge bg-card p-4 text-left transition-colors hover:border-edge2 ${
        wide ? 'col-span-2' : ''
      }`}
    >
      <Icon className={`size-6 ${action.iconActive ? 'text-dot' : 'text-t3'}`} aria-hidden />
      <span className="mt-3 min-w-0">
        <span className="block truncate text-sm font-semibold text-t1">{action.label}</span>
        {action.hint && <span className="block truncate text-[11px] text-t3">{action.hint}</span>}
      </span>
      {action.dot && (
        <span className="glow-dot absolute right-3 top-3 size-2 rounded-full bg-dot" />
      )}
    </button>
  )
}

function IconAction({ action }: { action: Action }) {
  const { Icon } = action
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="relative flex flex-col items-center gap-1.5 rounded-2xl border border-edge bg-card px-2 py-3 transition-colors hover:border-edge2"
    >
      <Icon className={`size-6 ${action.iconActive ? 'text-dot' : 'text-t2'}`} aria-hidden />
      <span className="max-w-full truncate text-xs font-medium text-t1">{action.label}</span>
      {action.dot && (
        <span className="glow-dot absolute right-2 top-2 size-2 rounded-full bg-dot" />
      )}
    </button>
  )
}
