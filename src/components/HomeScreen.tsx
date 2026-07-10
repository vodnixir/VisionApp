import { Cast, Trophy, Users, Zap } from 'lucide-react'
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
    <div className="absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-paper px-4 py-6">
      <div className="flex w-full max-w-md flex-1 flex-col gap-3">
        <header className="mb-3 flex items-center justify-between">
          <h1 className="text-base font-semibold text-neutral-900">Speed Battle</h1>
          <div className="flex gap-1">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold tracking-wider transition-colors ${
                  l === lang ? 'bg-black/5 text-neutral-900' : 'text-neutral-400 hover:text-neutral-600'
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
          className="flex flex-col gap-1 rounded-2xl bg-lime-400 px-5 py-5 text-left transition-transform active:scale-[0.98]"
        >
          <span className="flex items-center gap-2 text-lg font-semibold text-lime-950">
            <Zap className="size-5" aria-hidden />
            {t('home.quick')}
          </span>
          <span className="text-sm text-lime-950/65">{t('home.quickHint')}</span>
        </button>

        <button
          type="button"
          onClick={onTournament}
          className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-5 py-4 text-left transition-colors hover:border-black/25"
        >
          <span className="flex items-center gap-3">
            <Trophy className="size-5 text-neutral-400" aria-hidden />
            <span className="flex flex-col">
              <span className="text-base font-semibold text-neutral-900">{t('home.tournament')}</span>
              <span className="text-xs text-neutral-400">
                {tournamentActive ? t('home.tournamentResume') : t('home.tournamentHint')}
              </span>
            </span>
          </span>
          {tournamentActive && <span className="size-2 rounded-full bg-lime-600" />}
        </button>

        <button
          type="button"
          onClick={onRoster}
          className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-5 py-4 text-left transition-colors hover:border-black/25"
        >
          <span className="flex items-center gap-3">
            <Users className="size-5 text-neutral-400" aria-hidden />
            <span className="text-base font-semibold text-neutral-900">{t('home.players')}</span>
          </span>
          <span className="text-xs text-neutral-400">{t('home.playersSaved', { n: profileCount })}</span>
        </button>

        {castSupported && (
          <button
            type="button"
            onClick={onCast}
            className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-5 py-4 text-left transition-colors hover:border-black/25"
          >
            <span className="flex items-center gap-3">
              <Cast
                className={`size-5 ${castStatus === 'live' ? 'text-lime-600' : 'text-neutral-400'}`}
                aria-hidden
              />
              <span className="flex flex-col">
                <span className="text-base font-semibold text-neutral-900">{castLabel}</span>
                <span className="text-xs text-neutral-400">{t('cast.hint')}</span>
              </span>
            </span>
            {castStatus === 'live' && <span className="size-2 rounded-full bg-lime-600" />}
          </button>
        )}

        {session.matches > 0 && (
          <p className="text-center text-xs text-neutral-400">
            {t('home.session', { n: session.matches })}
            {leader && (
              <>
                {' · '}
                <span className="font-semibold text-neutral-700">
                  {t('home.sessionLeader', { name: leader.name, n: leader.wins })}
                </span>
              </>
            )}
          </p>
        )}

        <p className="mt-auto pt-6 text-center text-xs text-neutral-400">{t('home.footer')}</p>
      </div>
    </div>
  )
}
