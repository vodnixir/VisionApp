import { ArrowLeft, Crown, Gauge, Medal, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { MAX_PROFILES, createProfile, loadProfiles, saveProfiles } from '../storage'
import { beltFor, type PlayerProfile } from '../types'

/** The house record book: best of the saved roster, updated after every match. */
function RecordBook({ profiles }: { profiles: PlayerProfile[] }) {
  const { t } = useI18n()
  const withMatches = profiles.filter((p) => p.matches > 0)
  if (withMatches.length === 0) return null
  const top = (score: (p: PlayerProfile) => number) =>
    [...withMatches].sort((a, b) => score(b) - score(a))[0]
  const champion = top((p) => p.wins)
  const fastest = top((p) => p.bestSpeed ?? 0)
  const busiest = top((p) => p.matches)
  const rows: Array<{ icon: React.ReactNode; label: string; name: string; value: string }> = [
    {
      icon: <Crown className="size-4 text-amber-500" aria-hidden />,
      label: t('records.champion'),
      name: champion.name,
      value: `${champion.wins}`,
    },
    ...(fastest.bestSpeed
      ? [
          {
            icon: <Gauge className="size-4 text-neutral-400" aria-hidden />,
            label: t('records.fastest'),
            name: fastest.name,
            value: `${Math.round((fastest.bestSpeed ?? 0) * 100)}%`,
          },
        ]
      : []),
    {
      icon: <Medal className="size-4 text-neutral-400" aria-hidden />,
      label: t('records.active'),
      name: busiest.name,
      value: `${busiest.matches}`,
    },
  ]
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <p className="mb-2.5 text-xs font-medium tracking-wider text-neutral-400">
        {t('records.title').toUpperCase()}
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-sm">
            {r.icon}
            <span className="text-neutral-500">{r.label}</span>
            <span className="ml-auto font-semibold text-neutral-900">{r.name}</span>
            <span className="w-12 text-right font-semibold tabular-nums text-neutral-900">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface Props {
  onBack: () => void
}

/** Saved players: add the kids once, reuse them every match. Wins grow belts. */
export function RosterScreen({ onBack }: Props) {
  const { t } = useI18n()
  const [profiles, setProfiles] = useState<PlayerProfile[]>(loadProfiles)
  const [draft, setDraft] = useState('')

  const persist = (next: PlayerProfile[]) => {
    setProfiles(next)
    saveProfiles(next)
  }

  const add = () => {
    const name = draft.trim()
    if (!name || profiles.length >= MAX_PROFILES) return
    persist([...profiles, createProfile(name)])
    setDraft('')
  }

  const remove = (id: string) => {
    persist(profiles.filter((p) => p.id !== id))
  }

  const full = profiles.length >= MAX_PROFILES

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-paper px-4 py-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="rounded-xl border border-black/10 bg-white p-2 text-neutral-500 transition-colors hover:border-black/25"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <h1 className="text-lg font-semibold text-neutral-900">{t('roster.title')}</h1>
        </header>

        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            maxLength={14}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            placeholder={t('roster.placeholder')}
            className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-base font-semibold text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim() || full}
            className="flex items-center gap-1.5 rounded-xl bg-lime-400 px-4 py-3 text-sm font-semibold text-lime-950 transition-all active:scale-[0.97] disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
            {t('roster.add')}
          </button>
        </div>
        {full && <p className="text-xs text-neutral-500">{t('roster.full')}</p>}

        <RecordBook profiles={profiles} />

        {profiles.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/15 px-5 py-8 text-center text-sm leading-relaxed text-neutral-500">
            {t('roster.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {profiles.map((p) => {
              const belt = beltFor(p.wins)
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3"
                >
                  <span
                    title={t(`belt.${belt.key}`)}
                    className="size-4 shrink-0 rounded-full ring-1 ring-black/15"
                    style={{ backgroundColor: belt.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-neutral-900">{p.name}</span>
                    <span className="block text-xs text-neutral-400">
                      {t(`belt.${belt.key}`)} · {t('roster.record', { w: p.wins, m: p.matches })}
                      {(p.bestSpeed ?? 0) > 0 &&
                        ` · ${t('roster.best', { n: Math.round((p.bestSpeed ?? 0) * 100) })}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    aria-label={`${p.name} ✕`}
                    className="rounded-lg p-2 text-neutral-300 transition-colors hover:text-red-600"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
