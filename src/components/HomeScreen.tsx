import {
  Cast,
  FlaskConical,
  Footprints,
  Globe,
  LayoutGrid,
  LayoutList,
  Square,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { music, useMusic } from '../audio/music'
import { LANGS, useI18n } from '../i18n'
import { LAYOUT_IDS, useLayout, type LayoutId } from '../layout'
import { loadSession, sessionLeader } from '../session'
import type { CastStatus } from '../show'
import { loadProfiles } from '../storage'
import { THEME_IDS, useTheme, type ThemeId } from '../theme'
import { MenuBackdrop } from './MenuBackdrop'

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

/** One PvP/PvE/utility group of home actions, rendered under its own label. */
interface ActionGroup {
  key: string
  label: string
  actions: Action[]
}

/**
 * Experimental dev tools behind the "Beta" entry. The player-facing modes
 * (Online, Runner) graduated to first-class PvP / PvE entries; what stays here
 * is the gesture-tuning spike.
 */
interface BetaMode {
  key: string
  hash: string
  emoji: string
  labelKey: 'beta.spike'
  hintKey: 'beta.spikeHint'
}

const BETA_MODES: BetaMode[] = [
  { key: 'spike', hash: 'runner-spike', emoji: '🎯', labelKey: 'beta.spike', hintKey: 'beta.spikeHint' },
]

/** Each hash route (game mode / tool) is rendered from main.tsx after a reload. */
function openHashRoute(hash: string) {
  window.location.hash = hash
  window.location.reload()
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
  const { musicEnabled, setMusicEnabled } = useMusic()
  const [profileCount] = useState(() => loadProfiles().length)
  const [betaOpen, setBetaOpen] = useState(false)
  // Refreshes whenever we come back to Home (the component remounts).
  const [session] = useState(loadSession)
  const leader = sessionLeader(session)
  const castLabel =
    castStatus === 'live'
      ? t('cast.live')
      : castStatus === 'connecting'
        ? t('cast.connecting')
        : t('cast.tv')

  // The flagship PvP action — the massive neon PLAY hero.
  const primary: Action = {
    key: 'quick',
    label: t('home.quick'),
    hint: t('home.quickHint'),
    Icon: Zap,
    onClick: onQuickMatch,
    primary: true,
  }

  // Top-level navigation: games split into PvP (against people) and PvE
  // (against the game), plus a utility group.
  const groups: ActionGroup[] = [
    {
      key: 'pvp',
      label: t('nav.pvp'),
      actions: [
        {
          key: 'tournament',
          label: t('home.tournament'),
          hint: tournamentActive ? t('home.tournamentResume') : t('home.tournamentHint'),
          Icon: Trophy,
          onClick: onTournament,
          dot: tournamentActive,
        },
        {
          key: 'online',
          label: t('home.online'),
          hint: t('home.onlineHint'),
          Icon: Globe,
          onClick: () => openHashRoute('online'),
        },
      ],
    },
    {
      key: 'pve',
      label: t('nav.pve'),
      actions: [
        {
          key: 'runner',
          label: t('home.runner'),
          hint: t('home.runnerHint'),
          Icon: Footprints,
          onClick: () => openHashRoute('runner'),
        },
      ],
    },
    {
      key: 'more',
      label: t('nav.more'),
      actions: [
        {
          key: 'roster',
          label: t('home.players'),
          hint: t('home.playersSaved', { n: profileCount }),
          Icon: Users,
          onClick: onRoster,
        },
        {
          key: 'beta',
          label: t('home.beta'),
          hint: t('home.betaHint'),
          Icon: FlaskConical,
          onClick: () => setBetaOpen(true),
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
      ],
    },
  ]

  /** Render a group's actions in the shape the active layout dictates. */
  const renderItems = (acts: Action[]) => {
    if (layout === 'grid') {
      return (
        <div className="grid grid-cols-2 gap-3">
          {acts.map((a) => (
            <GridTile key={a.key} action={a} />
          ))}
        </div>
      )
    }
    if (layout === 'hero') {
      return (
        <div className="grid grid-cols-3 gap-2">
          {acts.map((a) => (
            <IconAction key={a.key} action={a} />
          ))}
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-3">
        {acts.map((a) => (
          <ListRow key={a.key} action={a} />
        ))}
      </div>
    )
  }

  const toggleMusic = () => {
    music.unlock()
    setMusicEnabled(!musicEnabled)
  }

  return (
    <div className="screen absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-page px-4 py-6">
      <MenuBackdrop />
      <div className="relative z-10 flex w-full max-w-md flex-1 flex-col gap-3">
        <header className="mb-1 flex items-center justify-between">
          <h1 className="brand text-base text-t1">
            <span className="brand-a">Speed</span> <span className="brand-b">Battle</span>
          </h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleMusic}
              aria-label={musicEnabled ? t('music.on') : t('music.off')}
              aria-pressed={musicEnabled}
              title={musicEnabled ? t('music.on') : t('music.off')}
              className={`mr-1 rounded-md p-1.5 transition-colors ${
                musicEnabled ? 'text-t1' : 'text-t3 hover:text-t2'
              }`}
            >
              {musicEnabled ? (
                <Volume2 className="size-4" aria-hidden />
              ) : (
                <VolumeX className="size-4" aria-hidden />
              )}
            </button>
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

        <button
          type="button"
          onClick={() => {
            music.unlock()
            primary.onClick()
          }}
          className="neon-play"
          aria-label={t('home.play')}
        >
          <span className="neon-play-label">{t('home.play')}</span>
          <span className="neon-play-sub">{t('home.playSub')}</span>
        </button>

        {groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-2">
            <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-t3">{g.label}</h2>
            {renderItems(g.actions)}
          </section>
        ))}

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
        </div>
      </div>

      {betaOpen && <BetaOverlay onClose={() => setBetaOpen(false)} />}
    </div>
  )
}

/* ---------------- Beta modes ---------------- */

/** A modal sheet listing the experimental modes, each a hash-route jump. */
function BetaOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-edge bg-page p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="flex items-center gap-2 text-lg font-semibold text-t1">
              <FlaskConical className="size-5 text-t3" aria-hidden />
              {t('beta.title')}
            </span>
            <span className="mt-0.5 text-xs text-t3">{t('beta.subtitle')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.back')}
            className="rounded-lg p-1.5 text-t3 transition-colors hover:bg-selbg hover:text-t1"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-3">
          {BETA_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => openHashRoute(m.hash)}
              className="flex items-center gap-3 rounded-2xl border border-edge bg-card px-4 py-4 text-left transition-colors hover:border-edge2"
            >
              <span className="text-2xl" aria-hidden>
                {m.emoji}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span className="text-base font-semibold text-t1">{t(m.labelKey)}</span>
                  <span className="rounded-full bg-selbg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-t3">
                    {t('beta.badge')}
                  </span>
                </span>
                <span className="text-xs text-t3">{t(m.hintKey)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Shared pieces ---------------- */

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
