import {
  Bot,
  Cast,
  ChevronDown,
  Footprints,
  Globe,
  Infinity as InfinityIcon,
  LayoutGrid,
  LayoutList,
  Lightbulb,
  MoreHorizontal,
  PersonStanding,
  Square,
  Swords,
  TrafficCone,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { music, useMusic } from '../audio/music'
import { LANGS, useI18n } from '../i18n'
import { LAYOUT_IDS, useLayout, type LayoutId } from '../layout'
import { isProMode } from '../pro'
import { loadSession, sessionLeader } from '../session'
import type { CastStatus } from '../show'
import { loadProfiles } from '../storage'
import { THEME_IDS, useTheme, type ThemeId } from '../theme'
import type { MatchMode } from '../types'
import { FeedbackModal } from './FeedbackModal'
import { MenuBackdrop } from './MenuBackdrop'

interface Props {
  /** A duel-family tile (Quick Match / Red Light Green Light / Copy the
   *  Pose): pre-select the mode, then land on the normal Match Setup flow. */
  onPlayMode: (mode: MatchMode) => void
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
  /** Live indicator dot (tournament in progress / cast live). */
  dot?: boolean
  /** Tint the icon with the accent (cast live). */
  iconActive?: boolean
  /** Small "PRO" chip — informational for now (everything is unlocked). */
  pro?: boolean
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

type CategoryKey = 'pvc' | 'pvp' | 'more'

/** One top-level accordion category. */
interface Category {
  key: CategoryKey
  label: string
  Icon: LucideIcon
  /** Fixed accent color — same for every layout/theme, per category. */
  accent: string
  actions: Action[]
}

/** Each hash route (game mode / tool) is rendered from main.tsx after a reload. */
function openHashRoute(hash: string) {
  window.location.hash = hash
  window.location.reload()
}

/** Cyber green / neon red-pink / electric blue — fixed regardless of theme,
 *  so the three category buttons read as a consistent trio everywhere. */
const ACCENT = {
  pvc: '#39ff88',
  pvp: '#ff2e63',
  more: '#00c3ff',
} as const

/** Host console home: the phone is the remote, the show is on the TV. */
export function HomeScreen({
  onPlayMode,
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
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // Single-open accordion: opening one category collapses whichever else was open.
  const [openCategory, setOpenCategory] = useState<CategoryKey | null>(null)
  // Refreshes whenever we come back to Home (the component remounts).
  const [session] = useState(loadSession)
  const leader = sessionLeader(session)
  const castLabel =
    castStatus === 'live'
      ? t('cast.live')
      : castStatus === 'connecting'
        ? t('cast.connecting')
        : t('cast.tv')

  // Every playable game, sorted into exactly one of three categories.
  // Boss Fight / Dancing / Keep Moving / the gesture-tuning dev tool are
  // deliberately absent from Home — see the exclusion note below.
  const categories: Category[] = [
    {
      key: 'pvc',
      label: t('home.pvc'),
      Icon: Bot,
      accent: ACCENT.pvc,
      actions: [
        {
          key: 'runner-solo',
          label: t('runner.mode.solo'),
          hint: t('runner.mode.soloHint'),
          Icon: Footprints,
          onClick: () => openHashRoute('runner?mode=solo'),
        },
        {
          key: 'runner-duel',
          label: t('runner.mode.duel'),
          hint: t('runner.mode.duelHint'),
          Icon: Footprints,
          onClick: () => openHashRoute('runner?mode=duel'),
        },
        {
          key: 'runner-squad',
          label: t('runner.mode.squad'),
          hint: t('runner.mode.squadHint'),
          Icon: Footprints,
          onClick: () => openHashRoute('runner?mode=squad'),
        },
        {
          key: 'infinite-pose',
          label: t('pose.title'),
          hint: t('pose.homeHint'),
          Icon: InfinityIcon,
          onClick: () => openHashRoute('pose'),
        },
      ],
    },
    {
      key: 'pvp',
      label: t('home.pvp'),
      Icon: Swords,
      accent: ACCENT.pvp,
      actions: [
        {
          key: 'online',
          label: t('home.online'),
          hint: t('home.onlineHint'),
          Icon: Globe,
          onClick: () => openHashRoute('online'),
        },
        {
          // Unified 2/3/4-player entry point — the player-count picker lives
          // in Match Setup (only shown for classic mode); 2 stays on the
          // normal duel flow there, 3/4 hands off to Group Race.
          key: 'speed',
          label: t('home.speedBattle'),
          hint: t('home.speedBattleHint'),
          Icon: Swords,
          onClick: () => onPlayMode('classic'),
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
          key: 'redLight',
          label: t('block.redLight'),
          hint: t('gmode.trafficHint'),
          Icon: TrafficCone,
          onClick: () => onPlayMode('traffic'),
          pro: isProMode('traffic'),
        },
        {
          key: 'copyPose',
          label: t('block.copyPose2p'),
          hint: t('gmode.poseHint'),
          Icon: PersonStanding,
          onClick: () => onPlayMode('pose'),
        },
      ],
    },
    {
      key: 'more',
      label: t('nav.more'),
      Icon: MoreHorizontal,
      accent: ACCENT.more,
      actions: [
        {
          key: 'roster',
          label: t('home.players'),
          hint: t('home.playersSaved', { n: profileCount }),
          Icon: Users,
          onClick: onRoster,
        },
        {
          key: 'feedback',
          label: t('home.feedback'),
          hint: t('home.feedbackHint'),
          Icon: Lightbulb,
          onClick: () => setFeedbackOpen(true),
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

  /** Render a set of actions in the shape the active layout dictates. */
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
        <header className="mb-1 flex items-center justify-center">
          <h1 className="brand text-base text-t1">
            <span className="brand-a">Hit</span><span className="brand-b">box</span>
          </h1>
        </header>

        {categories.map((c) => {
          const open = openCategory === c.key
          return (
            <section key={c.key} className="flex flex-col">
              <CategoryButton
                category={c}
                open={open}
                onToggle={() => setOpenCategory(open ? null : c.key)}
              />
              <div
                className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
                  open ? 'mt-2 max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div
                  className="rounded-2xl border p-3"
                  style={{ borderColor: `${c.accent}33` }}
                >
                  {renderItems(c.actions)}

                  {/* The More drawer also carries the app-wide settings —
                      not a "game", so it's a distinct sub-section here rather
                      than its own category tile. */}
                  {c.key === 'more' && (
                    <div className="mt-3 flex flex-col gap-3 border-t border-edge/60 pt-3">
                      <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-t3">
                        {t('setup.utilityRow')}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 px-1">
                        <button
                          type="button"
                          onClick={toggleMusic}
                          aria-label={musicEnabled ? t('music.on') : t('music.off')}
                          aria-pressed={musicEnabled}
                          title={musicEnabled ? t('music.on') : t('music.off')}
                          className={`rounded-md p-1.5 transition-colors ${
                            musicEnabled ? 'text-t1' : 'text-t3 hover:text-t2'
                          }`}
                        >
                          {musicEnabled ? (
                            <Volume2 className="size-4" aria-hidden />
                          ) : (
                            <VolumeX className="size-4" aria-hidden />
                          )}
                        </button>

                        <div className="flex items-center gap-1">
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

                        <div className="h-5 w-px bg-edge" />

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
                    </div>
                  )}
                </div>
              </div>
            </section>
          )
        })}

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
          <p className="text-center text-xs text-t3">{t('home.footer')}</p>
        </div>
      </div>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </div>
  )
}

/* ---------------- Category accordion button ---------------- */

/**
 * All three categories render this exact same element with the exact same
 * className string — visual parity (dimensions/padding/font size/weight) is
 * guaranteed by construction, not by eyeballing three separate buttons.
 * Only the accent color (inline style) and content differ per category.
 */
function CategoryButton({
  category,
  open,
  onToggle,
}: {
  category: Category
  open: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  const { Icon, accent, label, actions } = category
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between rounded-2xl border-2 px-5 py-5 text-left transition-colors"
      style={{
        borderColor: open ? accent : `${accent}55`,
        background: open ? `${accent}14` : 'transparent',
      }}
    >
      <span className="flex items-center gap-3">
        <Icon className="size-6" style={{ color: accent }} aria-hidden />
        <span className="flex flex-col">
          <span className="text-lg font-bold text-t1">{label}</span>
          <span className="text-xs text-t3">{t('home.gamesCount', { n: actions.length })}</span>
        </span>
      </span>
      <ChevronDown
        className={`size-5 transition-transform ${open ? 'rotate-180' : ''}`}
        style={{ color: accent }}
        aria-hidden
      />
    </button>
  )
}

/* ---------------- Shared pieces ---------------- */

/** Tiny "this will be paid later" marker — features stay unlocked for now. */
function ProBadge() {
  return (
    <span className="rounded bg-chip px-1 py-px text-[9px] font-semibold tracking-wider text-onchip">
      PRO
    </span>
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
          <span className="flex items-center gap-1.5 text-base font-semibold text-t1">
            {action.label}
            {action.pro && <ProBadge />}
          </span>
          {action.hint && <span className="text-xs text-t3">{action.hint}</span>}
        </span>
      </span>
      {action.dot && <span className="glow-dot size-2 rounded-full bg-dot" />}
    </button>
  )
}

function GridTile({ action }: { action: Action }) {
  const { Icon } = action
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="relative flex min-h-28 flex-col items-start justify-between rounded-2xl border border-edge bg-card p-4 text-left transition-colors hover:border-edge2"
    >
      <Icon className={`size-6 ${action.iconActive ? 'text-dot' : 'text-t3'}`} aria-hidden />
      <span className="mt-3 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="block truncate text-sm font-semibold text-t1">{action.label}</span>
          {action.pro && <ProBadge />}
        </span>
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
      <span className="flex max-w-full items-center gap-1 truncate text-xs font-medium text-t1">
        {action.label}
        {action.pro && <ProBadge />}
      </span>
      {action.dot && (
        <span className="glow-dot absolute right-2 top-2 size-2 rounded-full bg-dot" />
      )}
    </button>
  )
}
