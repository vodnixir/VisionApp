import { ArrowLeft, Play, Trophy, Users } from 'lucide-react'
import { useState } from 'react'
import { MAX_ENTRANTS, MIN_ENTRANTS, champion, nextMatch, type Tournament } from '../bracket'
import { FREE_BRACKET_MAX } from '../pro'
import { useI18n } from '../i18n'
import { loadProfiles } from '../storage'
import { playerColorsUI } from '../theme'
import type { PlayerSlot } from '../types'

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
    <div className="screen absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-page px-4 py-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="rounded-xl border border-edge bg-card p-2 text-t2 transition-colors hover:border-edge2"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <h1 className="text-lg font-semibold text-t1">{t('home.tournament')}</h1>
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
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-edge px-5 py-8">
        <p className="text-center text-sm leading-relaxed text-t2">{t('tour.needPlayers')}</p>
        <button
          type="button"
          onClick={onRoster}
          className="flex items-center gap-2 rounded-xl border border-edge bg-card px-5 py-2.5 text-sm font-semibold text-t2 transition-colors hover:border-edge2"
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
      <p className="text-sm text-t2">
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
                  ? 'border-chipedge bg-chip text-onchip'
                  : 'border-edge text-t2 hover:border-edge2'
              }`}
            >
              {order >= 0 && (
                <span className="text-[10px] font-semibold text-gold">{order + 1}</span>
              )}
              {p.name}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-t3">
        {t('tour.selected', { n: selected.length })}
        {selected.length > FREE_BRACKET_MAX && (
          <span className="ml-2 rounded bg-chip px-1 py-px text-[9px] font-semibold tracking-wider text-onchip">
            PRO
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={start}
        disabled={selected.length < MIN_ENTRANTS}
        className="flex items-center justify-center gap-2.5 rounded-2xl bg-accent px-8 py-4 text-lg font-semibold text-on-accent transition-transform active:scale-[0.98] disabled:opacity-40"
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
        <div className="animate-winner-flash flex flex-col items-center gap-1 rounded-2xl border border-edge bg-card px-5 py-5">
          <Trophy className="size-10 text-gold" aria-hidden />
          <p className="text-xs font-medium tracking-wider text-t3">
            {t('tour.champion').toUpperCase()}
          </p>
          <p className="text-2xl font-semibold text-t1">{winner.name}</p>
        </div>
      )}

      {tournament.rounds.map((matches, r) => {
        const isFinal = r === tournament.rounds.length - 1
        return (
          <section key={r}>
            <p className="mb-2 text-xs font-medium tracking-wider text-t3">
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
                    className={`flex items-center gap-2 rounded-xl border bg-card px-3.5 py-2.5 ${
                      isNext ? 'border-dot/50' : 'border-edge'
                    }`}
                  >
                    {isBye ? (
                      <span className="min-w-0 flex-1 truncate text-sm text-t2">
                        <b className="font-semibold text-t1">
                          {m.players[m.winner === 0 ? 0 : 1]?.name ?? '—'}
                        </b>{' '}
                        {t('tour.bye')}
                      </span>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        <SideName slot={m.players[0]} won={m.winner === 0} color={playerColorsUI()[0]} />
                        <span className="shrink-0 text-[10px] font-semibold text-t3/60">VS</span>
                        <SideName slot={m.players[1]} won={m.winner === 1} color={playerColorsUI()[1]} />
                      </span>
                    )}
                    {isNext && (
                      <button
                        type="button"
                        onClick={() => onPlay(r, i)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-on-accent transition-transform active:scale-[0.97]"
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
        className={`mt-1 rounded-xl px-5 py-3 text-sm font-semibold transition-all ${
          winner
            ? 'bg-accent text-on-accent active:scale-[0.98]'
            : 'border border-edge bg-card text-t2 hover:border-edge2'
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
        slot === null ? 'text-t3/60' : won ? '' : 'text-t2'
      }`}
      style={won && slot !== null ? { color } : undefined}
    >
      {slot?.name ?? '···'}
    </span>
  )
}
