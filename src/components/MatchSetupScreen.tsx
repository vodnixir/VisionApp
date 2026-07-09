import { ArrowLeft, Flame, FlipHorizontal2, Snowflake, Volume2, VolumeX, Zap } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { loadProfiles } from '../storage'
import {
  HANDICAP_STEPS,
  PLAYER_COLORS,
  ROUND_DURATION_MS,
  ROUND_MODES,
  type GameSettings,
  type PlayerProfile,
  type PlayerSlot,
} from '../types'

interface Props {
  settings: GameSettings
  onPatch: (patch: Partial<GameSettings>) => void
  onSetPlayer: (index: 0 | 1, slot: PlayerSlot) => void
  onStart: () => void
  onBack: () => void
}

/** Match setup for the host: pick two players, round length, head start — GO. */
export function MatchSetupScreen({ settings, onPatch, onSetPlayer, onStart, onBack }: Props) {
  const { t } = useI18n()
  const [profiles] = useState<PlayerProfile[]>(loadProfiles)

  return (
    <div className="arena-grid absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-arena-950 px-4 py-6">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="rounded-xl border border-white/10 p-2 text-slate-300 transition-colors hover:border-white/30"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <h1 className="text-lg font-bold tracking-wide text-white">{t('setup.title')}</h1>
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([0, 1] as const).map((i) => (
            <PlayerPicker
              key={i}
              index={i}
              slot={settings.players[i]}
              otherSlot={settings.players[i === 0 ? 1 : 0]}
              profiles={profiles}
              handicap={settings.handicap[i]}
              onSlot={(slot) => onSetPlayer(i, slot)}
              onHandicap={(value) => {
                const handicap = [...settings.handicap] as [number, number]
                handicap[i] = value
                onPatch({ handicap })
              }}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-slate-500">
            {t('setup.round').toUpperCase()}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {ROUND_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onPatch({ roundMode: mode })}
                className={`rounded-xl border px-2 py-3 transition-all ${
                  settings.roundMode === mode
                    ? 'border-neon-yellow bg-neon-yellow/10 text-neon-yellow'
                    : 'border-white/10 text-slate-400 hover:border-white/25'
                }`}
              >
                <span className="block text-sm font-bold sm:text-base">{t(`mode.${mode}`)}</span>
                <span className="block text-[11px] opacity-70">
                  {t('setup.seconds', { n: ROUND_DURATION_MS[mode] / 1000 })}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Toggle
            active={settings.comboMode}
            onClick={() => onPatch({ comboMode: !settings.comboMode })}
            icon={<Flame className="size-4" aria-hidden />}
            label={t('setup.combo')}
            onLabel={t('common.on')}
            offLabel={t('common.off')}
          />
          <Toggle
            active={settings.freezeMode}
            onClick={() => onPatch({ freezeMode: !settings.freezeMode })}
            icon={<Snowflake className="size-4" aria-hidden />}
            label={t('setup.freeze')}
            onLabel={t('common.on')}
            offLabel={t('common.off')}
          />
          <Toggle
            active={settings.mirrorMode}
            onClick={() => onPatch({ mirrorMode: !settings.mirrorMode })}
            icon={<FlipHorizontal2 className="size-4" aria-hidden />}
            label={t('setup.mirror')}
            onLabel={t('common.on')}
            offLabel={t('common.off')}
          />
          <Toggle
            active={settings.soundEnabled}
            onClick={() => onPatch({ soundEnabled: !settings.soundEnabled })}
            icon={
              settings.soundEnabled ? (
                <Volume2 className="size-4" aria-hidden />
              ) : (
                <VolumeX className="size-4" aria-hidden />
              )
            }
            label={t('setup.sound')}
            onLabel={t('common.on')}
            offLabel={t('common.off')}
          />
        </div>

        <button
          type="button"
          onClick={onStart}
          className="mt-1 flex items-center justify-center gap-3 rounded-2xl bg-neon-green px-10 py-4 text-2xl font-black tracking-[0.15em] text-arena-950 transition-transform active:scale-[0.98]"
        >
          <Zap className="size-7 fill-current" aria-hidden />
          {t('setup.start')}
        </button>

        <p className="pb-2 text-center text-xs leading-relaxed text-slate-600">{t('setup.hint')}</p>
      </div>
    </div>
  )
}

function PlayerPicker({
  index,
  slot,
  otherSlot,
  profiles,
  handicap,
  onSlot,
  onHandicap,
}: {
  index: 0 | 1
  slot: PlayerSlot
  otherSlot: PlayerSlot
  profiles: PlayerProfile[]
  handicap: number
  onSlot: (slot: PlayerSlot) => void
  onHandicap: (value: number) => void
}) {
  const { t } = useI18n()
  const color = PLAYER_COLORS[index]
  const defaultName = index === 0 ? t('setup.player1') : t('setup.player2')

  return (
    <div
      className="rounded-2xl border bg-white/5 p-4"
      style={{ borderColor: `${color}66` }}
    >
      <p className="mb-2 text-xs font-bold tracking-[0.2em]" style={{ color }}>
        {defaultName.toUpperCase()}
      </p>

      <input
        type="text"
        value={slot.name}
        maxLength={14}
        onChange={(e) => onSlot({ profileId: null, name: e.target.value })}
        placeholder={defaultName}
        className="mb-3 w-full rounded-xl border border-white/10 bg-arena-950/70 px-3 py-2.5 text-base font-bold text-white outline-none placeholder:text-slate-600 focus:border-white/35"
      />

      {profiles.length > 0 && (
        <div className="mb-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
          <Chip
            active={slot.profileId === null && slot.name === ''}
            label={t('setup.guest')}
            onClick={() => onSlot({ profileId: null, name: '' })}
          />
          {profiles.map((p) => (
            <Chip
              key={p.id}
              active={slot.profileId === p.id}
              dimmed={otherSlot.profileId === p.id}
              label={p.name}
              onClick={() => onSlot({ profileId: p.id, name: p.name })}
            />
          ))}
        </div>
      )}

      <p className="mb-1.5 text-[11px] font-semibold tracking-[0.15em] text-slate-500">
        {t('setup.handicap').toUpperCase()}
      </p>
      <div className="flex gap-1.5">
        {HANDICAP_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => onHandicap(step)}
            className={`flex-1 rounded-lg border px-1 py-1.5 text-xs font-bold transition-all ${
              handicap === step
                ? 'border-white/50 bg-white/15 text-white'
                : 'border-white/10 text-slate-500 hover:border-white/25'
            }`}
          >
            {step === 0 ? t('common.none') : `+${step}%`}
          </button>
        ))}
      </div>
    </div>
  )
}

function Chip({
  active,
  dimmed,
  label,
  onClick,
}: {
  active: boolean
  dimmed?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
        active
          ? 'border-white/60 bg-white/20 text-white'
          : dimmed
            ? 'border-white/5 text-slate-700'
            : 'border-white/10 text-slate-400 hover:border-white/30'
      }`}
    >
      {label}
    </button>
  )
}

function Toggle({
  active,
  onClick,
  icon,
  label,
  onLabel,
  offLabel,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  onLabel: string
  offLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
        active ? 'border-neon-blue/70 text-neon-blue' : 'border-white/10 text-slate-500'
      }`}
    >
      {icon}
      {label}
      <span className={`text-[10px] font-bold ${active ? 'text-neon-green' : 'text-slate-600'}`}>
        {active ? onLabel : offLabel}
      </span>
    </button>
  )
}
