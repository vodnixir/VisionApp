import { Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { music, useMusic } from '../audio/music'
import { LANGS, useI18n } from '../i18n'
import { useStrictSideLock } from '../identityLock'
import { loadSession, sessionLeader } from '../session'
import type { CastStatus } from '../show'
import { loadProfiles } from '../storage'
import { THEME_IDS, useTheme, type ThemeId } from '../theme'
import type { MatchMode } from '../types'
import { FeedbackModal } from './FeedbackModal'
import { RaveBackground } from './RaveBackground'

interface Props {
  /** A duel-family tile (Speed Battle / Red Light Green Light / Copy the
   *  Pose): pre-select the mode, then land on the normal Match Setup flow. */
  onPlayMode: (mode: MatchMode) => void
  onTournament: () => void
  onRoster: () => void
  tournamentActive: boolean
  castSupported: boolean
  castStatus: CastStatus
  onCast: () => void
}

/** Foreground accent — the "Colour 1" the BPM dot and working-on panel stay
 * pinned to, same reasoning as the Start screen (see RaveBackground). */
const COLOUR_1 = '#ff3b7f'

const THEME_SWATCH: Record<ThemeId, string> = {
  light: '#f7f7f5',
  dark: '#141414',
  neon: 'linear-gradient(135deg, #05060f 55%, #00c3ff)',
}

type CategoryKey = 'pvc' | 'pvp' | 'more'

interface GameRow {
  key: string
  title: string
  desc: string
  onClick: () => void
  dot?: boolean
}

interface Category {
  key: CategoryKey
  letter: string
  title: string
  color: string
  games: GameRow[]
}

/** Each hash route (game mode / tool) is rendered from main.tsx after a reload. */
function openHashRoute(hash: string) {
  window.location.hash = hash
  window.location.reload()
}

/** Category accent colours — fixed per category regardless of theme, matching the design brief exactly. */
const ACCENT = {
  pvc: '#3CFFB0',
  pvp: '#ff3b7f',
  more: '#33c9ff',
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
  const { strictSideLock, setStrictSideLock } = useStrictSideLock()
  const { musicEnabled, setMusicEnabled } = useMusic()
  const [profileCount] = useState(() => loadProfiles().length)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // Single-open accordion: opening one category collapses whichever else was open.
  const [openCategory, setOpenCategory] = useState<CategoryKey | null>(null)
  // A second-level reveal inside "More" — not a route of its own (out of
  // scope for this redesign's two screens), just shows the same app-wide
  // controls that used to sit in a permanent utility row.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [session] = useState(loadSession)
  const leader = sessionLeader(session)
  const castLabel =
    castStatus === 'live' ? t('cast.live') : castStatus === 'connecting' ? t('cast.connecting') : t('cast.tv')

  const categories: Category[] = [
    {
      key: 'pvc',
      letter: 'C',
      title: t('home.pvc'),
      color: ACCENT.pvc,
      games: [
        { key: 'runner-solo', title: t('runner.mode.solo'), desc: t('runner.mode.soloHint'), onClick: () => openHashRoute('runner?mode=solo') },
        { key: 'runner-duel', title: t('runner.mode.duel'), desc: t('runner.mode.duelHint'), onClick: () => openHashRoute('runner?mode=duel') },
        { key: 'runner-squad', title: t('runner.mode.squad'), desc: t('runner.mode.squadHint'), onClick: () => openHashRoute('runner?mode=squad') },
        { key: 'infinite-pose', title: t('pose.title'), desc: t('pose.homeHint'), onClick: () => openHashRoute('pose') },
      ],
    },
    {
      key: 'pvp',
      letter: 'P',
      title: t('home.pvp'),
      color: ACCENT.pvp,
      games: [
        { key: 'speed', title: t('home.speedBattle'), desc: t('home.speedBattleHint'), onClick: () => onPlayMode('classic') },
        { key: 'online', title: t('home.online'), desc: t('home.onlineHint'), onClick: () => openHashRoute('online') },
        { key: 'tournament', title: t('home.tournament'), desc: tournamentActive ? t('home.tournamentResume') : t('home.tournamentHint'), onClick: onTournament, dot: tournamentActive },
        { key: 'redLight', title: t('block.redLight'), desc: t('gmode.trafficHint'), onClick: () => onPlayMode('traffic') },
        { key: 'copyPose', title: t('block.copyPose'), desc: t('gmode.poseHint'), onClick: () => onPlayMode('pose') },
      ],
    },
    {
      key: 'more',
      letter: 'M',
      title: t('nav.more'),
      color: ACCENT.more,
      games: [
        { key: 'roster', title: t('home.players'), desc: t('home.playersSaved', { n: profileCount }), onClick: onRoster },
        ...(castSupported
          ? [{ key: 'cast', title: castLabel, desc: t('cast.hint'), onClick: onCast, dot: castStatus === 'live' } satisfies GameRow]
          : []),
        { key: 'settings', title: t('home.settings'), desc: t('home.settingsHint'), onClick: () => setSettingsOpen((v) => !v) },
      ],
    },
  ]

  const toggleMusic = () => {
    music.unlock()
    setMusicEnabled(!musicEnabled)
  }

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#0e0518' }}>
      <RaveBackground variant="home" />
      <div className="relative h-full w-full overflow-y-auto" style={{ padding: '24px 18px 18px' }}>
        <div className="mx-auto flex w-full max-w-md flex-col">
          {/* Header */}
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
            <div style={{ font: "900 20px system-ui, -apple-system, sans-serif" }}>
              <span style={{ color: '#33c9ff' }}>HIT</span>
              <span style={{ color: '#fff' }}>BOX</span>
            </div>
            <div
              className="flex items-center rounded-full"
              style={{ gap: 5, padding: '3px 8px', background: 'rgba(255,255,255,.08)' }}
            >
              <div className="hbx-beat-dot rounded-full" style={{ width: 5, height: 5, background: COLOUR_1 }} aria-hidden />
              <span style={{ font: '700 9px ui-monospace, monospace', color: '#fff' }}>128 BPM</span>
            </div>
          </div>

          {/* Category cards */}
          {categories.map((cat) => {
            const open = openCategory === cat.key
            return (
              <div
                key={cat.key}
                className="overflow-hidden"
                style={{
                  marginBottom: 12,
                  borderRadius: 16,
                  border: `1.5px solid ${cat.color}`,
                  background: 'rgba(255,255,255,.045)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenCategory(open ? null : cat.key)
                    if (open) setSettingsOpen(false)
                  }}
                  aria-expanded={open}
                  className="flex w-full items-stretch text-left"
                  style={{ cursor: 'pointer' }}
                >
                  <div className="flex flex-1 items-center" style={{ gap: 12, padding: '13px 16px' }}>
                    <div
                      className="flex shrink-0 items-center justify-center rounded-full"
                      style={{ width: 32, height: 32, background: hexAlpha(cat.color, 0.18) }}
                    >
                      <span style={{ font: '800 13px system-ui, sans-serif', color: cat.color }}>{cat.letter}</span>
                    </div>
                    <div>
                      <div style={{ font: '700 14.5px system-ui, -apple-system, sans-serif', color: '#fff' }}>{cat.title}</div>
                      <div style={{ font: '400 10.5px system-ui, -apple-system, sans-serif', color: 'rgba(255,255,255,.45)' }}>
                        {t('home.gamesCount', { n: cat.games.length })}
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-center"
                    style={{ width: 40, color: cat.color, font: '700 11px sans-serif' }}
                  >
                    {open ? '▲' : '▼'}
                  </div>
                </button>

                <div
                  className="overflow-hidden transition-[grid-template-rows] duration-[180ms] ease-out"
                  style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr' }}
                >
                  <div className="min-h-0" style={{ borderTop: open ? '1px solid rgba(255,255,255,.1)' : 'none' }}>
                    {cat.games.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        onClick={g.onClick}
                        className="flex w-full items-center justify-between text-left"
                        style={{ padding: '9px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }}
                      >
                        <span>
                          <span className="flex items-center gap-1.5" style={{ font: '600 12px system-ui, -apple-system, sans-serif', color: '#fff' }}>
                            {g.title}
                          </span>
                          <span className="block" style={{ font: '400 10px system-ui, -apple-system, sans-serif', color: 'rgba(255,255,255,.4)' }}>
                            {g.desc}
                          </span>
                        </span>
                        {g.dot && <span className="size-2 shrink-0 rounded-full" style={{ background: cat.color }} />}
                      </button>
                    ))}

                    {cat.key === 'more' && settingsOpen && (
                      <div className="flex flex-col" style={{ padding: '12px 16px 4px', gap: 12 }}>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={toggleMusic}
                            aria-label={musicEnabled ? t('music.on') : t('music.off')}
                            aria-pressed={musicEnabled}
                            className="rounded-md p-1.5"
                            style={{ color: musicEnabled ? '#fff' : 'rgba(255,255,255,.45)' }}
                          >
                            {musicEnabled ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
                          </button>

                          <div className="flex items-center gap-1">
                            {LANGS.map((l) => (
                              <button
                                key={l}
                                type="button"
                                onClick={() => setLang(l)}
                                className="rounded-md px-2 py-1"
                                style={{
                                  font: '700 11px system-ui, sans-serif',
                                  letterSpacing: '.02em',
                                  color: l === lang ? '#fff' : 'rgba(255,255,255,.45)',
                                  background: l === lang ? 'rgba(255,255,255,.12)' : 'transparent',
                                }}
                              >
                                {l.toUpperCase()}
                              </button>
                            ))}
                          </div>

                          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.12)' }} />

                          <div className="flex gap-2">
                            {THEME_IDS.map((id) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setTheme(id)}
                                aria-label={t(`theme.${id}`)}
                                title={t(`theme.${id}`)}
                                className="rounded-full"
                                style={{
                                  width: 22,
                                  height: 22,
                                  background: THEME_SWATCH[id],
                                  border: id === theme ? '2px solid #fff' : '2px solid rgba(255,255,255,.25)',
                                }}
                              />
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setStrictSideLock(!strictSideLock)}
                          aria-pressed={strictSideLock}
                          className="self-start rounded-lg"
                          style={{
                            padding: '6px 10px',
                            font: '600 10.5px system-ui, sans-serif',
                            color: strictSideLock ? '#fff' : 'rgba(255,255,255,.45)',
                            border: `1px solid ${strictSideLock ? '#fff' : 'rgba(255,255,255,.2)'}`,
                          }}
                        >
                          {t('settings.strictSideLock')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* "What we're working on" panel */}
          <div
            className="flex flex-none flex-col"
            style={{
              borderRadius: 14,
              background: 'rgba(255,255,255,.05)',
              border: `1.5px solid ${hexAlpha(COLOUR_1, 0.5)}`,
              padding: '12px 16px',
              gap: 6,
              marginTop: 2,
            }}
          >
            <div style={{ font: '700 9px ui-monospace, monospace', color: COLOUR_1, letterSpacing: '.1em' }}>
              {t('home.workingOn').toUpperCase()}
            </div>
            <div style={{ font: '600 13px/1.3 system-ui, -apple-system, sans-serif', color: '#fff' }}>
              {t('home.workingOnBody')}
            </div>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="self-start rounded-full"
              style={{
                padding: '7px 14px',
                background: COLOUR_1,
                color: '#0e0518',
                font: '700 11px system-ui, -apple-system, sans-serif',
                cursor: 'pointer',
              }}
            >
              {t('home.suggestImprovement')}
            </button>
          </div>

          <div className="mt-4 flex flex-col items-center gap-2 pb-2">
            {session.matches > 0 && (
              <p className="text-center" style={{ font: '400 11px system-ui, sans-serif', color: 'rgba(255,255,255,.4)' }}>
                {t('home.session', { n: session.matches })}
                {leader && (
                  <>
                    {' · '}
                    <span style={{ color: 'rgba(255,255,255,.6)', fontWeight: 600 }}>
                      {t('home.sessionLeader', { name: leader.name, n: leader.wins })}
                    </span>
                  </>
                )}
              </p>
            )}
            <p className="text-center" style={{ font: '400 11px system-ui, sans-serif', color: 'rgba(255,255,255,.4)' }}>
              {t('home.footer')}
            </p>
          </div>
        </div>
      </div>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
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
