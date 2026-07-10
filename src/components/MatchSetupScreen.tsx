import {
  Activity,
  ArrowLeft,
  Camera,
  Flame,
  FlipHorizontal2,
  Music,
  Skull,
  Smile,
  Snowflake,
  Swords,
  TrafficCone,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { isProMode } from '../pro'
import { loadProfiles } from '../storage'
import {
  HANDICAP_STEPS,
  MATCH_MODES,
  PLAYER_COLORS_UI,
  ROUND_DURATION_MS,
  ROUND_MODES,
  mirrorDefaultForLabel,
  type GameSettings,
  type MatchMode,
  type PlayerProfile,
  type PlayerSlot,
} from '../types'

const MODE_ICONS: Record<MatchMode, React.ReactNode> = {
  classic: <Swords className="size-4" aria-hidden />,
  rhythm: <Music className="size-4" aria-hidden />,
  endurance: <Activity className="size-4" aria-hidden />,
  traffic: <TrafficCone className="size-4" aria-hidden />,
  boss: <Skull className="size-4" aria-hidden />,
}

interface Props {
  settings: GameSettings
  onPatch: (patch: Partial<GameSettings>) => void
  onSetPlayer: (index: 0 | 1, slot: PlayerSlot) => void
  onStart: () => void
  onBack: () => void
}

/** Video inputs of this device (labels are empty until a camera permission is granted). */
function useCameras(): MediaDeviceInfo[] {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    let alive = true
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          if (alive) setCameras(all.filter((d) => d.kind === 'videoinput'))
        })
        .catch(() => {})
    }
    refresh()
    navigator.mediaDevices.addEventListener?.('devicechange', refresh)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh)
    }
  }, [])
  return cameras
}

/** Match setup for the host: pick two players, round length, head start — GO. */
export function MatchSetupScreen({ settings, onPatch, onSetPlayer, onStart, onBack }: Props) {
  const { t } = useI18n()
  const [profiles] = useState<PlayerProfile[]>(loadProfiles)
  const cameras = useCameras()

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-paper px-4 py-6">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="rounded-xl border border-black/10 bg-white p-2 text-neutral-500 transition-colors hover:border-black/25"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <h1 className="text-lg font-semibold text-neutral-900">{t('setup.title')}</h1>
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
              showHandicap={settings.matchMode !== 'boss'}
              onSlot={(slot) => onSetPlayer(i, slot)}
              onHandicap={(value) => {
                const handicap = [...settings.handicap] as [number, number]
                handicap[i] = value
                onPatch({ handicap })
              }}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <p className="mb-3 text-xs font-medium tracking-wider text-neutral-400">
            {t('setup.mode').toUpperCase()}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MATCH_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onPatch({ matchMode: mode })}
                className={`relative rounded-xl border px-2.5 py-2.5 text-left transition-all ${
                  settings.matchMode === mode
                    ? 'border-neutral-900 bg-black/5 text-neutral-900'
                    : 'border-black/10 text-neutral-500 hover:border-black/25'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {MODE_ICONS[mode]}
                  {t(`gmode.${mode}`)}
                  {isProMode(mode) && <ProBadge />}
                </span>
                <span className="mt-0.5 block text-[10px] leading-tight opacity-70">
                  {t(`gmode.${mode}Hint`)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <p className="mb-3 text-xs font-medium tracking-wider text-neutral-400">
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
                    ? 'border-neutral-900 bg-black/5 text-neutral-900'
                    : 'border-black/10 text-neutral-500 hover:border-black/25'
                }`}
              >
                <span className="block text-sm font-semibold sm:text-base">{t(`mode.${mode}`)}</span>
                <span className="block text-[11px] opacity-70">
                  {t('setup.seconds', { n: ROUND_DURATION_MS[mode] / 1000 })}
                </span>
              </button>
            ))}
          </div>
        </div>

        {cameras.length > 1 && (
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wider text-neutral-400">
              <Camera className="size-4" aria-hidden />
              {t('setup.camera').toUpperCase()}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {cameras.map((cam, i) => {
                const active =
                  settings.cameraId === cam.deviceId || (settings.cameraId === null && i === 0)
                return (
                  <Chip
                    key={cam.deviceId || i}
                    active={active}
                    label={cam.label || t('setup.cameraN', { n: i + 1 })}
                    onClick={() =>
                      // Picking a camera also resets the mirror to its natural
                      // default: front = mirrored, rear/external = not.
                      onPatch({
                        cameraId: i === 0 ? null : cam.deviceId,
                        mirrorMode: mirrorDefaultForLabel(cam.label),
                      })
                    }
                  />
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {settings.matchMode === 'classic' && (
            <Toggle
              active={settings.comboMode}
              onClick={() => onPatch({ comboMode: !settings.comboMode })}
              icon={<Flame className="size-4" aria-hidden />}
              label={t('setup.combo')}
              onLabel={t('common.on')}
              offLabel={t('common.off')}
            />
          )}
          {settings.matchMode === 'classic' && (
            <Toggle
              active={settings.freezeMode}
              onClick={() => onPatch({ freezeMode: !settings.freezeMode })}
              icon={<Snowflake className="size-4" aria-hidden />}
              label={t('setup.freeze')}
              onLabel={t('common.on')}
              offLabel={t('common.off')}
            />
          )}
          <Toggle
            active={settings.maskMode}
            onClick={() => onPatch({ maskMode: !settings.maskMode })}
            icon={<Smile className="size-4" aria-hidden />}
            label={t('setup.mask')}
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
          className="mt-1 flex items-center justify-center gap-3 rounded-2xl bg-lime-400 px-10 py-4 text-xl font-semibold text-lime-950 transition-transform active:scale-[0.98]"
        >
          <Zap className="size-6" aria-hidden />
          {t('setup.start')}
        </button>

        <p className="pb-2 text-center text-xs leading-relaxed text-neutral-400">{t('setup.hint')}</p>
      </div>
    </div>
  )
}

/** Tiny "this will be paid later" marker — features stay unlocked for now. */
function ProBadge() {
  return (
    <span className="rounded bg-neutral-900 px-1 py-px text-[9px] font-semibold tracking-wider text-white">
      PRO
    </span>
  )
}

function PlayerPicker({
  index,
  slot,
  otherSlot,
  profiles,
  handicap,
  showHandicap,
  onSlot,
  onHandicap,
}: {
  index: 0 | 1
  slot: PlayerSlot
  otherSlot: PlayerSlot
  profiles: PlayerProfile[]
  handicap: number
  showHandicap: boolean
  onSlot: (slot: PlayerSlot) => void
  onHandicap: (value: number) => void
}) {
  const { t } = useI18n()
  const color = PLAYER_COLORS_UI[index]
  const defaultName = index === 0 ? t('setup.player1') : t('setup.player2')

  return (
    <div
      className="rounded-2xl border bg-white p-4"
      style={{ borderColor: `${color}4d` }}
    >
      <p className="mb-2 text-xs font-semibold tracking-wider" style={{ color }}>
        {defaultName.toUpperCase()}
      </p>

      <input
        type="text"
        value={slot.name}
        maxLength={14}
        onChange={(e) => onSlot({ profileId: null, name: e.target.value })}
        placeholder={defaultName}
        className="mb-3 w-full rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2.5 text-base font-semibold text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
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

      {showHandicap && (
        <>
          <p className="mb-1.5 text-[11px] font-medium tracking-wider text-neutral-400">
            {t('setup.handicap').toUpperCase()}
          </p>
          <div className="flex gap-1.5">
            {HANDICAP_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => onHandicap(step)}
                className={`flex-1 rounded-lg border px-1 py-1.5 text-xs font-semibold transition-all ${
                  handicap === step
                    ? 'border-neutral-900 bg-black/5 text-neutral-900'
                    : 'border-black/10 text-neutral-400 hover:border-black/25'
                }`}
              >
                {step === 0 ? t('common.none') : `+${step}%`}
              </button>
            ))}
          </div>
        </>
      )}
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
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : dimmed
            ? 'border-black/5 text-neutral-300'
            : 'border-black/10 text-neutral-500 hover:border-black/30'
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
        active ? 'border-neutral-900 bg-white text-neutral-900' : 'border-black/10 text-neutral-400'
      }`}
    >
      {icon}
      {label}
      <span className={`text-[10px] font-semibold ${active ? 'text-lime-600' : 'text-neutral-300'}`}>
        {active ? onLabel : offLabel}
      </span>
    </button>
  )
}
