import { Cast, Trophy, Users, Zap } from 'lucide-react'
import { useState } from 'react'
import { LANGS, useI18n } from '../i18n'
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

/** Swatch preview per theme — the picker button backgrounds. */
const THEME_SWATCH: Record<ThemeId, string> = {
  light: '#f7f7f5',
  dark: '#141414',
  neon: 'linear-gradient(135deg, #05060f 55%, #00c3ff)',
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

  return (
    <div className="screen absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-page px-4 py-6">
      <div className="flex w-full max-w-md flex-1 flex-col gap-3">
        <header className="mb-3 flex items-center justify-between">
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

        <button
          type="button"
          onClick={onQuickMatch}
          className="flex flex-col gap-1 rounded-2xl bg-accent px-5 py-5 text-left transition-transform active:scale-[0.98]"
        >
          <span className="flex items-center gap-2 text-lg font-semibold text-on-accent">
            <Zap className="size-5" aria-hidden />
            {t('home.quick')}
          </span>
          <span className="text-sm text-on-accent/65">{t('home.quickHint')}</span>
        </button>

        <button
          type="button"
          onClick={onTournament}
          className="flex items-center justify-between rounded-2xl border border-edge bg-card px-5 py-4 text-left transition-colors hover:border-edge2"
        >
          <span className="flex items-center gap-3">
            <Trophy className="size-5 text-t3" aria-hidden />
            <span className="flex flex-col">
              <span className="text-base font-semibold text-t1">{t('home.tournament')}</span>
              <span className="text-xs text-t3">
                {tournamentActive ? t('home.tournamentResume') : t('home.tournamentHint')}
              </span>
            </span>
          </span>
          {tournamentActive && <span className="glow-dot size-2 rounded-full bg-dot" />}
        </button>

        <button
          type="button"
          onClick={onRoster}
          className="flex items-center justify-between rounded-2xl border border-edge bg-card px-5 py-4 text-left transition-colors hover:border-edge2"
        >
          <span className="flex items-center gap-3">
            <Users className="size-5 text-t3" aria-hidden />
            <span className="text-base font-semibold text-t1">{t('home.players')}</span>
          </span>
          <span className="text-xs text-t3">{t('home.playersSaved', { n: profileCount })}</span>
        </button>

        {castSupported && (
          <button
            type="button"
            onClick={onCast}
            className="flex items-center justify-between rounded-2xl border border-edge bg-card px-5 py-4 text-left transition-colors hover:border-edge2"
          >
            <span className="flex items-center gap-3">
              <Cast
                className={`size-5 ${castStatus === 'live' ? 'text-dot' : 'text-t3'}`}
                aria-hidden
              />
              <span className="flex flex-col">
                <span className="text-base font-semibold text-t1">{castLabel}</span>
                <span className="text-xs text-t3">{t('cast.hint')}</span>
              </span>
            </span>
            {castStatus === 'live' && <span className="glow-dot size-2 rounded-full bg-dot" />}
          </button>
        )}

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

        <div className="mt-auto flex items-center justify-center gap-3 pt-6">
          {THEME_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              aria-label={t(`theme.${id}`)}
              title={t(`theme.${id}`)}
              className={`size-8 rounded-full border-2 transition-all ${
                id === theme ? 'scale-110 border-sel' : 'border-edge hover:border-edge2'
              }`}
              style={{ background: THEME_SWATCH[id] }}
            />
          ))}
        </div>

        <p className="pt-3 text-center text-xs text-t3">{t('home.footer')}</p>
      </div>
    </div>
  )
}
