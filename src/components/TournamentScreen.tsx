import { ArrowLeft, Play, Trophy, Users } from 'lucide-react'
import { useState } from 'react'
import { MAX_ENTRANTS, MIN_ENTRANTS, champion, nextMatch, type Tournament } from '../bracket'
import { FREE_BRACKET_MAX } from '../pro'
import { useI18n } from '../i18n'
import { loadProfiles } from '../storage'
import { PLAYER_COLORS, type PlayerSlot } from '../types'

interface Props {
  tournament: Tournament | null
  onCreate: (entrants: PlayerSlot[]) => void
  onPlay: (round: number, index: number) => void
  onFinish: () => void
  onBack: () => void
  onRoster: () => void
}

/** Tournament hub: pick the kids → live bracket → champion. */
export function TournamentScreen({ tournament, onCreate, onPlay, onFinish, onBack, onRoster }: Props) {
  const { t } = useI18n()

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
          <h1 className="text-lg font-bold tracking-wide text-white">{t('home.tournament')}</h1>
        </header>

        {tournament === null ? (
          <EntrantPicker onCreate={onCreate} onRoster={onRoster} />
        ) : (
          <BracketView tournament={tournament} onPlay={onPlay} onFinish={onFinish} />
        )}
      </div>
    </div>
  )
}

function EntrantPicker({
  onCreate,
  onRoster,
}: {
  onCreate: (entrants: PlayerSlot[]) => void
  onRoster: () => void
}) {
  const { t } = useI18n()
  const [profiles] = useState(loadProfiles)
  const [selected, setSelected] = useState<string[]>([])

  if (profiles.length < MIN_ENTRANTS) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-white/10 px-5 py-8">
        <p className="text-center text-sm leading-relaxed text-slate-500">{t('tour.needPlayers')}</p>
        <button
          type="button"
          onClick={onRoster}
          className="flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-bold text-slate-300 transition-colors hover:border-white/35"
        >
          <Users className="size-4" aria-hidden />
          {t('tour.toRoster')}
        </button>
      </div>
    )
  }

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_ENTRANTS
          ? prev
          : [...prev, id],
    )
  }

  const start = () => {
    const entrants: PlayerSlot[] = selected
      .map((id) => profiles.find((p) => p.id === id))
      .filter((p) => p !== undefined)
      .map((p) => ({ profileId: p.id, name: p.name }))
    if (entrants.length >= MIN_ENTRANTS) onCreate(entrants)
  }

  return (
    <>
      <p className="text-sm text-slate-400">
        {t('tour.pick', { min: MIN_ENTRANTS, max: MAX_ENTRANTS })}
      </p>
      <div className="flex flex-wrap gap-2">
        {profiles.map((p) => {
          const order = selected.indexOf(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${
                order >= 0
                  ? 'border-white/60 bg-white/20 text-white'
                  : 'border-white/10 text-slate-400 hover:border-white/30'
              }`}
            >
              {order >= 0 && (
                <span className="text-[10px] font-black text-neon-yellow">{order + 1}</span>
              )}
              {p.name}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-slate-600">
        {t('tour.selected', { n: selected.length })}
        {selected.length > FREE_BRACKET_MAX && (
          <span className="ml-2 rounded bg-neon-yellow/20 px-1 py-px text-[9px] font-black tracking-wider text-neon-yellow">
            PRO
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={start}
        disabled={selected.length < MIN_ENTRANTS}
        className="flex items-center justify-center gap-2.5 rounded-2xl bg-neon-green px-8 py-4 text-lg font-black tracking-wide text-arena-950 transition-transform active:scale-[0.98] disabled:opacity-40"
      >
        <Trophy className="size-5" aria-hidden />
        {t('tour.start')}
      </button>
    </>
  )
}

function BracketView({
  tournament,
  onPlay,
  onFinish,
}: {
  tournament: Tournament
  onPlay: (round: number, index: number) => void
  onFinish: () => void
}) {
  const { t } = useI18n()
  const playable = nextMatch(tournament)
  const winner = champion(tournament)

  return (
    <>
      {winner && (
        <div className="animate-winner-flash flex flex-col items-center gap-1 rounded-2xl border border-neon-yellow/50 bg-neon-yellow/10 px-5 py-5">
          <Trophy className="size-10 text-neon-yellow" aria-hidden />
          <p className="text-xs font-bold tracking-[0.3em] text-neon-yellow">
            {t('tour.champion').toUpperCase()}
          </p>
          <p className="text-2xl font-black text-white">{winner.name}</p>
        </div>
      )}

      {tournament.rounds.map((matches, r) => {
        const isFinal = r === tournament.rounds.length - 1
        return (
          <section key={r}>
            <p className="mb-2 text-xs font-semibold tracking-[0.2em] text-slate-500">
              {(isFinal ? t('tour.final') : t('tour.round', { n: r + 1 })).toUpperCase()}
            </p>
            <div className="flex flex-col gap-2">
              {matches.map((m, i) => {
                const isNext = playable !== null && playable.round === r && playable.index === i
                const isBye =
                  m.winner !== null && (m.players[0] === null || m.players[1] === null)
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 ${
                      isNext ? 'border-neon-green/70 bg-neon-green/5' : 'border-white/10 bg-white/5'
                    }`}
                  >
                    {isBye ? (
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
                        <b className="text-white">
                          {m.players[m.winner === 0 ? 0 : 1]?.name ?? '—'}
                        </b>{' '}
                        {t('tour.bye')}
                      </span>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        <SideName slot={m.players[0]} won={m.winner === 0} color={PLAYER_COLORS[0]} />
                        <span className="shrink-0 text-[10px] font-black text-slate-600">VS</span>
                        <SideName slot={m.players[1]} won={m.winner === 1} color={PLAYER_COLORS[1]} />
                      </span>
                    )}
                    {isNext && (
                      <button
                        type="button"
                        onClick={() => onPlay(r, i)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-neon-green px-3.5 py-1.5 text-xs font-black tracking-wide text-arena-950 transition-transform active:scale-[0.97]"
                      >
                        <Play className="size-3.5 fill-current" aria-hidden />
                        {t('tour.play').toUpperCase()}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      <button
        type="button"
        onClick={onFinish}
        className={`mt-1 rounded-xl px-5 py-3 text-sm font-bold transition-all ${
          winner
            ? 'bg-neon-green text-arena-950 active:scale-[0.98]'
            : 'border border-white/15 text-slate-400 hover:border-white/35'
        }`}
      >
        {winner ? t('tour.new') : t('tour.abandon')}
      </button>
    </>
  )
}

function SideName({
  slot,
  won,
  color,
}: {
  slot: PlayerSlot | null
  won: boolean
  color: string
}) {
  return (
    <span
      className={`min-w-0 flex-1 truncate font-semibold ${
        slot === null ? 'text-slate-700' : won ? '' : 'text-slate-300'
      }`}
      style={won && slot !== null ? { color } : undefined}
    >
      {slot?.name ?? '···'}
    </span>
  )
}
