import { Cast, Swords, Trophy, Users, Zap } from 'lucide-react'
import { useState } from 'react'
import { LANGS, useI18n } from '../i18n'
import { loadSession, sessionLeader } from '../session'
import type { CastStatus } from '../show'
import { loadProfiles } from '../storage'

interface Props {
  onQuickMatch: () => void
  onTournament: () => void
  onRoster: () => void
  tournamentActive: boolean
  castSupported: boolean
  castStatus: CastStatus
  onCast: () => void
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
    <div className="arena-grid absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-arena-950 px-4 py-6">
      <div className="flex w-full max-w-md flex-1 flex-col gap-4">
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Swords className="size-6 text-neon-yellow" aria-hidden />
            <h1 className="font-display text-xl font-black tracking-[0.18em]">
              <span className="text-neon-blue">SPEED</span>{' '}
              <span className="text-white">BATTLE</span>
            </h1>
          </div>
          <div className="flex gap-1">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`rounded-md px-2 py-1 text-[11px] font-bold tracking-wider transition-colors ${
                  l === lang
                    ? 'bg-white/15 text-white'
                    : 'text-slate-500 hover:text-slate-300'
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
          className="group flex flex-col gap-1 rounded-2xl bg-neon-green px-5 py-5 text-left transition-transform active:scale-[0.98]"
        >
          <span className="flex items-center gap-2 text-lg font-black tracking-wide text-arena-950">
            <Zap className="size-5 fill-current" aria-hidden />
            {t('home.quick')}
          </span>
          <span className="text-sm font-medium text-arena-950/70">{t('home.quickHint')}</span>
        </button>

        <button
          type="button"
          onClick={onTournament}
          className={`flex items-center justify-between rounded-2xl border bg-white/5 px-5 py-4 text-left transition-colors ${
            tournamentActive
              ? 'border-neon-yellow/60 hover:border-neon-yellow'
              : 'border-white/10 hover:border-white/25'
          }`}
        >
          <span className="flex items-center gap-3">
            <Trophy className="size-6 text-neon-blue" aria-hidden />
            <span className="flex flex-col">
              <span className="text-base font-bold text-slate-200">{t('home.tournament')}</span>
              <span className="text-xs text-slate-500">
                {tournamentActive ? t('home.tournamentResume') : t('home.tournamentHint')}
              </span>
            </span>
          </span>
          {tournamentActive && (
            <span className="size-2.5 rounded-full bg-neon-yellow shadow-[0_0_8px_rgba(255,230,0,0.8)]" />
          )}
        </button>

        <button
          type="button"
          onClick={onRoster}
          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left transition-colors hover:border-white/25"
        >
          <span className="flex items-center gap-3">
            <Users className="size-6 text-slate-300" aria-hidden />
            <span className="text-base font-bold text-slate-200">{t('home.players')}</span>
          </span>
          <span className="text-xs text-slate-500">{t('home.playersSaved', { n: profileCount })}</span>
        </button>

        {castSupported && (
          <button
            type="button"
            onClick={onCast}
            className={`flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition-colors ${
              castStatus === 'live'
                ? 'border-neon-green/60 hover:border-neon-green'
                : 'border-white/10 hover:border-white/25'
            } bg-white/5`}
          >
            <span className="flex items-center gap-3">
              <Cast
                className={`size-6 ${castStatus === 'live' ? 'text-neon-green' : 'text-slate-300'}`}
                aria-hidden
              />
              <span className="flex flex-col">
                <span className="text-base font-bold text-slate-200">{castLabel}</span>
                <span className="text-xs text-slate-500">{t('cast.hint')}</span>
              </span>
            </span>
            {castStatus === 'live' && (
              <span className="size-2.5 rounded-full bg-neon-green shadow-[0_0_8px_rgba(57,255,136,0.8)]" />
            )}
          </button>
        )}

        {session.matches > 0 && (
          <p className="text-center text-xs text-slate-500">
            {t('home.session', { n: session.matches })}
            {leader && (
              <>
                {' · '}
                <span className="font-bold text-neon-yellow">
                  {t('home.sessionLeader', { name: leader.name, n: leader.wins })}
                </span>
              </>
            )}
          </p>
        )}

        <p className="mt-auto pt-6 text-center text-xs text-slate-600">{t('home.footer')}</p>
      </div>
    </div>
  )
}
