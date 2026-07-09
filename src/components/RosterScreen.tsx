import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { MAX_PROFILES, createProfile, loadProfiles, saveProfiles } from '../storage'
import { beltFor, type PlayerProfile } from '../types'

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
    <div className="arena-grid absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-arena-950 px-4 py-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="rounded-xl border border-white/10 p-2 text-slate-300 transition-colors hover:border-white/30"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <h1 className="text-lg font-bold tracking-wide text-white">{t('roster.title')}</h1>
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
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base font-semibold text-white outline-none placeholder:text-slate-600 focus:border-white/35"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim() || full}
            className="flex items-center gap-1.5 rounded-xl bg-neon-green px-4 py-3 text-sm font-bold text-arena-950 transition-all active:scale-[0.97] disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
            {t('roster.add')}
          </button>
        </div>
        {full && <p className="text-xs text-neon-yellow">{t('roster.full')}</p>}

        {profiles.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center text-sm leading-relaxed text-slate-500">
            {t('roster.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {profiles.map((p) => {
              const belt = beltFor(p.wins)
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <span
                    title={t(`belt.${belt.key}`)}
                    className="size-4 shrink-0 rounded-full ring-1 ring-white/30"
                    style={{ backgroundColor: belt.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold text-white">{p.name}</span>
                    <span className="block text-xs text-slate-500">
                      {t(`belt.${belt.key}`)} · {t('roster.record', { w: p.wins, m: p.matches })}
                      {(p.bestSpeed ?? 0) > 0 &&
                        ` · ${t('roster.best', { n: Math.round((p.bestSpeed ?? 0) * 100) })}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    aria-label={`${p.name} ✕`}
                    className="rounded-lg p-2 text-slate-600 transition-colors hover:text-neon-red"
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
