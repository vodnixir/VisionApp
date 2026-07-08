import { useCallback, useEffect, useRef, useState } from 'react'
import { sfx } from './audio/sfx'
import { CalibrationOverlay } from './components/CalibrationOverlay'
import { GameOverScreen } from './components/GameOverScreen'
import { Hud } from './components/Hud'
import { SetupScreen } from './components/SetupScreen'
import { ErrorOverlay, LoadingOverlay } from './components/StatusOverlay'
import type { EngineFrame } from './cv/engine'
import { useGameState } from './hooks/useGameState'
import { usePoseDetection } from './hooks/usePoseDetection'
import {
  EMPTY_STATS,
  type Difficulty,
  type GameSettings,
  type MatchResults,
  type PlayerStats,
} from './types'

/** Both fighters must stay in frame this long before the countdown starts. */
const LOCK_DURATION_MS = 3000

/** Bar fill per second at maximum activity (percent), by difficulty. */
const FILL_RATE: Record<Difficulty, number> = {
  easy: 9,
  normal: 6.5,
  hard: 4.5,
}

interface Accumulators {
  progress: [number, number]
  maxSpeed: [number, number]
  speedIntegral: [number, number]
  time: number
  lockStart: number | null
  finished: boolean
}

function createAccumulators(): Accumulators {
  return {
    progress: [0, 0],
    maxSpeed: [0, 0],
    speedIntegral: [0, 0],
    time: 0,
    lockStart: null,
    finished: false,
  }
}

function playerNames(s: GameSettings): [string, string] {
  return [s.player1Name.trim() || 'PLAYER 1', s.player2Name.trim() || 'PLAYER 2']
}

/** Best-effort screen wake lock so the phone doesn't dim mid-match. */
function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)
  const acquire = useCallback(() => {
    navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        sentinelRef.current = sentinel
      })
      .catch(() => {
        /* unsupported or denied — the game still works */
      })
  }, [])
  const release = useCallback(() => {
    void sentinelRef.current?.release().catch(() => {})
    sentinelRef.current = null
  }, [])
  useEffect(() => release, [release])
  return { acquire, release }
}

export default function App() {
  const [game, dispatch] = useGameState()
  const gameRef = useRef(game)
  gameRef.current = game

  const [liveStats, setLiveStats] = useState<[PlayerStats, PlayerStats]>([EMPTY_STATS, EMPTY_STATS])
  const [presentCount, setPresentCount] = useState(0)
  const [lockProgress, setLockProgress] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const accumRef = useRef<Accumulators>(createAccumulators())
  const wakeLock = useWakeLock()

  /* ---------------- Per-inference-frame game logic ---------------- */

  const finishMatch = (winnerIndex: 0 | 1, now: number) => {
    const g = gameRef.current
    const a = accumRef.current
    const names = playerNames(g.settings)
    const results: MatchResults = {
      winnerIndex,
      winnerName: names[winnerIndex],
      durationMs: now - (g.matchStartedAt ?? now),
      players: ([0, 1] as const).map((i) => ({
        name: names[i],
        progress: a.progress[i],
        maxSpeed: a.maxSpeed[i],
        avgSpeed: a.time > 0 ? a.speedIntegral[i] / a.time : 0,
      })) as unknown as MatchResults['players'],
    }
    sfx.victory()
    dispatch({ type: 'MATCH_END', results })
  }

  const onFrame = (frame: EngineFrame) => {
    const g = gameRef.current

    if (g.phase === 'CALIBRATION') {
      setPresentCount(frame.presentCount)
      setLiveStats(
        frame.players.map((p) => ({ ...EMPTY_STATS, present: p.present })) as [
          PlayerStats,
          PlayerStats,
        ],
      )
      if (g.calibrationPhase === 'COUNTDOWN') return

      const a = accumRef.current
      if (frame.presentCount === 2) {
        if (a.lockStart === null) {
          a.lockStart = frame.now
          sfx.lock()
          dispatch({ type: 'SET_CALIBRATION_PHASE', value: 'LOCKING' })
        }
        const progress = (frame.now - a.lockStart) / LOCK_DURATION_MS
        setLockProgress(Math.min(progress, 1))
        if (progress >= 1) {
          dispatch({ type: 'SET_CALIBRATION_PHASE', value: 'COUNTDOWN' })
        }
      } else if (a.lockStart !== null) {
        a.lockStart = null
        setLockProgress(0)
        dispatch({ type: 'SET_CALIBRATION_PHASE', value: 'SEARCHING' })
      }
      return
    }

    if (g.phase === 'PLAYING') {
      const a = accumRef.current
      if (a.finished) return
      const target = g.settings.targetScore
      const rate = FILL_RATE[g.settings.difficulty]

      a.time += frame.dt
      for (const i of [0, 1] as const) {
        const speed = frame.players[i].speed
        a.progress[i] = Math.min(a.progress[i] + speed * rate * frame.dt, target)
        if (speed > a.maxSpeed[i]) a.maxSpeed[i] = speed
        a.speedIntegral[i] += speed * frame.dt
      }

      setElapsedMs(frame.now - (g.matchStartedAt ?? frame.now))
      setLiveStats(
        ([0, 1] as const).map((i) => ({
          progress: a.progress[i],
          speed: frame.players[i].speed,
          maxSpeed: a.maxSpeed[i],
          avgSpeed: a.time > 0 ? a.speedIntegral[i] / a.time : 0,
          present: frame.players[i].present,
        })) as unknown as [PlayerStats, PlayerStats],
      )

      const p0Won = a.progress[0] >= target
      const p1Won = a.progress[1] >= target
      if (p0Won || p1Won) {
        a.finished = true
        let winner: 0 | 1
        if (p0Won && p1Won) {
          // Photo finish: higher bar wins, dead tie goes to whoever is faster right now.
          winner =
            a.progress[0] !== a.progress[1]
              ? a.progress[0] > a.progress[1]
                ? 0
                : 1
              : frame.players[0].speed >= frame.players[1].speed
                ? 0
                : 1
        } else {
          winner = p0Won ? 0 : 1
        }
        finishMatch(winner, frame.now)
      }
    }
  }

  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection(onFrame)

  /* ---------------- Countdown (3 → 2 → 1 → gong) ---------------- */

  const startMatch = useCallback(() => {
    accumRef.current = createAccumulators()
    setLiveStats([EMPTY_STATS, EMPTY_STATS])
    setElapsedMs(0)
    setLockProgress(0)
    dispatch({ type: 'MATCH_START', at: performance.now() })
  }, [dispatch])

  useEffect(() => {
    if (game.phase !== 'CALIBRATION' || game.calibrationPhase !== 'COUNTDOWN') return
    sfx.beep()
    let value = 3
    const id = setInterval(() => {
      value--
      if (value >= 1) {
        sfx.beep()
        dispatch({ type: 'COUNTDOWN_TICK', value })
      } else {
        clearInterval(id)
        sfx.gong()
        startMatch()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [game.phase, game.calibrationPhase, dispatch, startMatch])

  /* ---------------- Keep the engine config in sync ---------------- */

  useEffect(() => {
    configure({
      mirror: game.settings.mirrorMode,
      names: playerNames(game.settings),
      drawOverlays: game.phase === 'CALIBRATION' || game.phase === 'PLAYING',
      scoring: game.phase === 'PLAYING',
    })
    sfx.enabled = game.settings.soundEnabled
  }, [game.settings, game.phase, configure])

  /* ---------------- User actions ---------------- */

  const resetRoundState = () => {
    accumRef.current = createAccumulators()
    setLiveStats([EMPTY_STATS, EMPTY_STATS])
    setPresentCount(0)
    setLockProgress(0)
    setElapsedMs(0)
  }

  const handleStart = () => {
    sfx.unlock() // user gesture: unlocks audio; camera prompt follows
    wakeLock.acquire()
    resetRoundState()
    dispatch({ type: 'START_CALIBRATION' })
    void start()
  }

  const handleRematch = () => {
    resetRoundState()
    dispatch({ type: 'REMATCH' })
  }

  const handleBackToSetup = () => {
    stop()
    wakeLock.release()
    resetRoundState()
    dispatch({ type: 'BACK_TO_SETUP' })
  }

  /* ---------------- Render ---------------- */

  const names = playerNames(game.settings)
  const inArena = game.phase !== 'SETUP'
  const showHud = (game.phase === 'CALIBRATION' || game.phase === 'PLAYING') && status === 'running'

  return (
    <div className="relative h-full w-full overflow-hidden bg-arena-950">
      {/* Hidden source video; everything visible is drawn onto the canvas. */}
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="h-full w-full object-contain" />

      {showHud && (
        <Hud
          stats={liveStats}
          names={names}
          targetScore={game.settings.targetScore}
          elapsedMs={elapsedMs}
          playing={game.phase === 'PLAYING'}
        />
      )}

      {game.phase === 'CALIBRATION' && status === 'running' && (
        <CalibrationOverlay
          phase={game.calibrationPhase}
          presentCount={presentCount}
          lockProgress={lockProgress}
          countdown={game.countdown}
        />
      )}

      {game.phase === 'GAME_OVER' && game.results && (
        <GameOverScreen
          results={game.results}
          onRematch={handleRematch}
          onBackToSetup={handleBackToSetup}
        />
      )}

      {game.phase === 'SETUP' && (
        <SetupScreen
          settings={game.settings}
          onChange={(patch) => dispatch({ type: 'UPDATE_SETTINGS', patch })}
          onStart={handleStart}
        />
      )}

      {inArena && status === 'starting' && <LoadingOverlay />}
      {inArena && status === 'error' && error && (
        <ErrorOverlay message={error} onBack={handleBackToSetup} />
      )}
    </div>
  )
}
