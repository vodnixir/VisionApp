import { useEffect, useRef, useState, type ReactNode } from 'react'
import { sfx } from '../audio/sfx'
import { usePoseDetection } from '../hooks/usePoseDetection'
import { useRunnerControl } from '../runner/useRunnerControl'
import { DEFAULT_GESTURE_CONFIG, type GestureConfig, type GestureReading } from '../runner/gestures'
import type { EngineFrame } from '../cv/engine'

/**
 * Detection spike for the single-player runner ("Subway Surfers in reality").
 *
 * NOT the game — a diagnostic harness. It reuses the pose engine to read one
 * body and shows the three control signals (lane / crouch / jump) live, with
 * sliders for their thresholds, so we can confirm on a real body that the
 * gestures read cleanly BEFORE building the runner graphics. Reached at #runner.
 */
export function RunnerSpikeScreen() {
  const [mirror, setMirror] = useState(true)
  const [config, setConfig] = useState<GestureConfig>(DEFAULT_GESTURE_CONFIG)
  const [reading, setReading] = useState<GestureReading | null>(null)

  const { reliable, calibrating, calibrated, beginCalibration, handleFrame } = useRunnerControl({
    mirror,
    config,
    onReading: (r) => {
      if (r.jump) sfx.beep()
      if (r.laneChanged) sfx.tick()
      setReading(r)
    },
    onCalibrated: () => sfx.gong(),
  })

  // The frame handler needs canvasRef (returned by the hook below), so route it
  // through a ref: the hook already calls the latest handler each frame.
  const onFrameRef = useRef<(frame: EngineFrame) => void>(() => {})
  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection(
    (frame) => onFrameRef.current(frame),
  )

  onFrameRef.current = (frame: EngineFrame) => {
    handleFrame(frame, canvasRef.current?.width ?? 0)
  }

  useEffect(() => {
    configure({ mirror, scoring: false, drawOverlays: true, rolesLocked: false })
  }, [mirror, configure])

  useEffect(() => () => stop(), [stop])

  const handleStart = () => {
    sfx.unlock()
    void start()
  }

  const handleCalibrate = () => {
    setReading(null)
    beginCalibration()
  }

  const goBack = () => {
    stop()
    window.location.hash = ''
    window.location.reload()
  }

  const setCfg = (patch: Partial<GestureConfig>) => setConfig((c) => ({ ...c, ...patch }))

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="h-full w-full object-contain" />

      {/* Lane guides — three columns, active one highlighted. */}
      {calibrated && (
        <div className="pointer-events-none absolute inset-0 flex">
          {([-1, 0, 1] as const).map((lane) => (
            <div
              key={lane}
              className={`flex-1 border-x transition-colors duration-75 ${
                reading?.lane === lane
                  ? 'border-lime-400/70 bg-lime-400/15'
                  : 'border-white/10 bg-transparent'
              }`}
            />
          ))}
        </div>
      )}

      {/* Jump flash */}
      {reading?.airborne && (
        <div className="pointer-events-none absolute inset-0 bg-sky-400/20 ring-4 ring-sky-300/60 ring-inset" />
      )}
      {/* Crouch flash */}
      {reading?.crouch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-amber-400/20" />
      )}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <button
          onClick={goBack}
          className="pointer-events-auto rounded-full bg-black/60 px-4 py-2 text-sm font-semibold backdrop-blur"
        >
          ← Назад
        </button>
        <div className="rounded-full bg-black/60 px-4 py-2 text-sm font-semibold backdrop-blur">
          Runner · detection spike
        </div>
        <label className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm backdrop-blur">
          <input
            type="checkbox"
            checked={mirror}
            onChange={(e) => setMirror(e.target.checked)}
          />
          Зеркало
        </label>
      </div>

      {/* Live event pills */}
      {calibrated && (
        <div className="pointer-events-none absolute inset-x-0 top-16 flex flex-col items-center gap-2">
          <Pill on={reading?.airborne} onColor="bg-sky-500">
            ПРЫЖОК
          </Pill>
          <Pill on={reading?.crouch} onColor="bg-amber-500">
            ПРИСЕД
          </Pill>
          <div className="mt-1 rounded-full bg-black/60 px-4 py-1 text-lg font-black tracking-widest backdrop-blur">
            {reading?.lane === -1 ? '◄ ЛЕВО' : reading?.lane === 1 ? 'ПРАВО ►' : 'ЦЕНТР'}
          </div>
        </div>
      )}

      {/* Not-visible warning */}
      {status === 'running' && !reliable && !calibrating && (
        <div className="pointer-events-none absolute inset-x-0 bottom-40 flex justify-center">
          <div className="rounded-xl bg-red-600/85 px-5 py-3 text-center text-sm font-semibold">
            Тела не видно — встань в полный рост в кадр
            <br />
            (нужны плечи и бёдра)
          </div>
        </div>
      )}

      {/* Calibration prompt / countdown */}
      {status === 'running' && (calibrating || !calibrated) && (
        <div className="absolute inset-x-0 bottom-28 flex flex-col items-center gap-3">
          <div className="rounded-xl bg-black/70 px-5 py-3 text-center text-sm backdrop-blur">
            {calibrating
              ? 'Стой ровно… снимаю нейтральную стойку'
              : 'Встань ровно в полный рост, руки вдоль тела, затем «Калибровать»'}
          </div>
        </div>
      )}

      {/* Bottom controls + tuning */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 p-3">
        {calibrated && reading && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/65 p-3 text-xs backdrop-blur sm:grid-cols-4">
            <Metric label="lane" value={reading.laneOffset} />
            <Metric label="reach" value={reading.reachRatio} />
            <Metric label="hipDrop" value={reading.hipDrop} />
            <Metric label="jumpVel" value={reading.jumpVel} />
          </div>
        )}

        {status === 'running' && (
          <div className="rounded-xl bg-black/65 p-3 backdrop-blur">
            <Slider
              label="Порог полосы"
              value={config.laneEnter}
              min={0.2}
              max={1.4}
              step={0.05}
              onChange={(v) => setCfg({ laneEnter: v, laneExit: v * 0.58 })}
            />
            <Slider
              label="Порог приседа (reach)"
              value={config.crouchRatio}
              min={0.5}
              max={0.95}
              step={0.01}
              onChange={(v) => setCfg({ crouchRatio: v })}
            />
            <Slider
              label="Порог прыжка (скорость)"
              value={config.jumpVel}
              min={0.8}
              max={5}
              step={0.1}
              onChange={(v) => setCfg({ jumpVel: v })}
            />
          </div>
        )}

        <div className="flex justify-center gap-3">
          {status === 'idle' && (
            <button
              onClick={handleStart}
              className="rounded-full bg-lime-400 px-8 py-4 text-lg font-black text-black"
            >
              Включить камеру
            </button>
          )}
          {status === 'starting' && (
            <div className="rounded-full bg-black/70 px-8 py-4 text-lg font-semibold">
              Запуск камеры…
            </div>
          )}
          {status === 'running' && (
            <button
              onClick={handleCalibrate}
              disabled={calibrating}
              className="rounded-full bg-white px-8 py-4 text-lg font-black text-black disabled:opacity-50"
            >
              {calibrated ? 'Калибровать заново' : 'Калибровать'}
            </button>
          )}
        </div>

        {status === 'error' && error && (
          <div className="rounded-xl bg-red-600/85 px-5 py-3 text-center text-sm font-semibold">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({
  on,
  onColor,
  children,
}: {
  on: boolean | undefined
  onColor: string
  children: ReactNode
}) {
  return (
    <div
      className={`rounded-full px-5 py-1 text-lg font-black tracking-widest transition-all duration-75 ${
        on ? `${onColor} scale-110 text-white` : 'bg-black/40 text-white/30'
      }`}
    >
      {children}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-white/5 py-1">
      <span className="text-[10px] uppercase tracking-wider text-white/50">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value.toFixed(2)}</span>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="mb-1 flex items-center gap-3 text-xs last:mb-0">
      <span className="w-44 shrink-0 text-white/70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-lime-400"
      />
      <span className="w-10 text-right font-mono tabular-nums">{value.toFixed(2)}</span>
    </label>
  )
}
