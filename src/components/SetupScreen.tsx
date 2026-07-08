import { FlipHorizontal2, Swords, Volume2, VolumeX, Zap } from 'lucide-react'
import type { Difficulty, GameSettings } from '../types'

const DIFFICULTIES: Array<{ value: Difficulty; label: string; hint: string }> = [
  { value: 'easy', label: 'SPRINT', hint: '~30 sec' },
  { value: 'normal', label: 'FIGHT', hint: '~60 sec' },
  { value: 'hard', label: 'MARATHON', hint: '~90 sec' },
]

interface Props {
  settings: GameSettings
  onChange: (patch: Partial<GameSettings>) => void
  onStart: () => void
}

export function SetupScreen({ settings, onChange, onStart }: Props) {
  return (
    <div className="arena-grid absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 overflow-y-auto bg-arena-950 px-4 py-8">
      <header className="text-center">
        <div className="mb-2 flex items-center justify-center gap-3">
          <Swords className="size-8 text-neon-yellow sm:size-12" aria-hidden />
          <h1 className="text-3xl font-black tracking-widest sm:text-6xl">
            <span className="neon-text-blue">SPEED</span> <span className="neon-text-white">BATTLE</span>{' '}
            <span className="neon-text-red">AI</span>
          </h1>
          <Swords className="size-8 -scale-x-100 text-neon-yellow sm:size-12" aria-hidden />
        </div>
        <p className="text-xs tracking-[0.3em] text-slate-400 sm:text-sm">
          MOVE FAST · SCORE POINTS · FIRST TO 100% WINS
        </p>
      </header>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <PlayerCard
          label="PLAYER 1 · BLUE CORNER"
          accent="blue"
          value={settings.player1Name}
          onChange={(v) => onChange({ player1Name: v })}
        />
        <PlayerCard
          label="PLAYER 2 · RED CORNER"
          accent="red"
          value={settings.player2Name}
          onChange={(v) => onChange({ player2Name: v })}
        />
      </div>

      <div className="neon-panel w-full max-w-3xl rounded-xl p-4">
        <p className="mb-3 text-center text-xs tracking-[0.25em] text-slate-400">ROUND LENGTH</p>
        <div className="grid grid-cols-3 gap-2">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => onChange({ difficulty: d.value })}
              className={`rounded-lg border px-2 py-3 font-bold tracking-wider transition-all ${
                settings.difficulty === d.value
                  ? 'border-neon-yellow bg-neon-yellow/10 text-neon-yellow shadow-[0_0_14px_rgba(255,230,0,0.4)]'
                  : 'border-arena-700 text-slate-400 hover:border-slate-500'
              }`}
            >
              <span className="block text-sm sm:text-base">{d.label}</span>
              <span className="block text-[10px] text-slate-500 sm:text-xs">{d.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex w-full max-w-3xl gap-4">
        <ToggleButton
          active={settings.mirrorMode}
          onClick={() => onChange({ mirrorMode: !settings.mirrorMode })}
          icon={<FlipHorizontal2 className="size-5" aria-hidden />}
          label="TV MIRROR"
        />
        <ToggleButton
          active={settings.soundEnabled}
          onClick={() => onChange({ soundEnabled: !settings.soundEnabled })}
          icon={
            settings.soundEnabled ? (
              <Volume2 className="size-5" aria-hidden />
            ) : (
              <VolumeX className="size-5" aria-hidden />
            )
          }
          label="SOUND"
        />
      </div>

      <button
        type="button"
        onClick={onStart}
        className="group relative mt-2 flex items-center gap-3 rounded-xl border-2 border-neon-green bg-neon-green/10 px-10 py-5 text-2xl font-black tracking-[0.2em] text-neon-green transition-all hover:bg-neon-green/20 hover:shadow-[0_0_30px_rgba(57,255,136,0.6)] sm:px-16 sm:text-4xl"
      >
        <Zap className="size-7 fill-current sm:size-10" aria-hidden />
        START
      </button>

      <p className="max-w-md text-center text-[11px] leading-relaxed text-slate-500 sm:text-xs">
        Both fighters must be fully visible in the camera frame. Stand apart — left side is the blue
        corner, right side is the red corner.
      </p>
    </div>
  )
}

function PlayerCard({
  label,
  accent,
  value,
  onChange,
}: {
  label: string
  accent: 'blue' | 'red'
  value: string
  onChange: (v: string) => void
}) {
  const border = accent === 'blue' ? 'neon-border-blue' : 'neon-border-red'
  const text = accent === 'blue' ? 'neon-text-blue' : 'neon-text-red'
  return (
    <div className={`rounded-xl border-2 bg-arena-900/80 p-4 ${border}`}>
      <p className={`mb-2 text-[11px] font-bold tracking-[0.25em] ${text}`}>{label}</p>
      <input
        type="text"
        value={value}
        maxLength={14}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="ENTER NAME"
        className="w-full rounded-md border border-arena-700 bg-arena-950 px-3 py-2 text-lg font-bold tracking-widest text-white outline-none placeholder:text-slate-600 focus:border-slate-400"
      />
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-bold tracking-widest transition-all ${
        active
          ? 'border-neon-blue text-neon-blue shadow-[0_0_14px_rgba(0,195,255,0.35)]'
          : 'border-arena-700 text-slate-500'
      }`}
    >
      {icon}
      {label}
      <span className={`ml-1 text-[10px] ${active ? 'text-neon-green' : 'text-slate-600'}`}>
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}
