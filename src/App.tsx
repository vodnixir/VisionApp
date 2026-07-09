import { useCallback, useEffect, useRef, useState } from 'react'
import { sfx } from './audio/sfx'
import { createTournament, reportWinner, type Tournament } from './bracket'
import { CalibrationOverlay } from './components/CalibrationOverlay'
import { GameOverScreen } from './components/GameOverScreen'
import { HomeScreen } from './components/HomeScreen'
import { MatchSetupScreen } from './components/MatchSetupScreen'
import { RosterScreen } from './components/RosterScreen'
import { ErrorOverlay, LoadingOverlay } from './components/StatusOverlay'
import { TournamentScreen } from './components/TournamentScreen'
import type { EngineFrame, EngineHints } from './cv/engine'
import { useGameState } from './hooks/useGameState'
import { prefetchEngine, usePoseDetection } from './hooks/usePoseDetection'
import { useI18n } from './i18n'
import { MatchRecorder, type MatchClip } from './recorder'
import {
  loadTournament,
  recordMatchResult,
  saveLastPlayers,
  saveSettings,
  saveTournament,
} from './storage'
import {
  ARENA_PHASES,
  FILL_RATE,
  FREEZE_WINDOW_MS,
  ROUND_DURATION_MS,
  type GameSettings,
  type MatchResults,
} from './types'

/** Both fighters must stay in frame this long before the countdown starts. */
const LOCK_DURATION_MS = 3000

/** The canvas celebrates alone for this long before the host controls appear. */
const GAME_OVER_UI_DELAY_MS = 2200

/** Extra recording after the win so the clip ends on the victory splash. */
const CLIP_TAIL_MS = 2500

interface FreezeWindow {
  start: number
  end: number
}

interface Accumulators {
  progress: [number, number]
  maxSpeed: [number, number]
  speedIntegral: [number, number]
  time: number
  lockStart: number | null
  finished: boolean
  /** "Freeze!" windows as ms offsets from match start (empty = mode off). */
  freezes: FreezeWindow[]
  frozen: boolean
}

function createAccumulators(handicap: [number, number] = [0, 0]): Accumulators {
  return {
    progress: [handicap[0], handicap[1]],
    maxSpeed: [0, 0],
    speedIntegral: [0, 0],
    time: 0,
    lockStart: null,
    finished: false,
    freezes: [],
    frozen: false,
  }
}

/** One freeze per ~30 s of round, spread over the middle of the match. */
function generateFreezes(durationMs: number): FreezeWindow[] {
  const count = Math.max(1, Math.round(durationMs / 30_000))
  const spanStart = durationMs * 0.2
  const segment = (durationMs * 0.65) / count
  return Array.from({ length: count }, (_, i) => {
    const start = spanStart + segment * i + Math.random() * Math.max(segment - FREEZE_WINDOW_MS, 0)
    return { start, end: start + FREEZE_WINDOW_MS }
  })
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
  const { t } = useI18n()
  const [game, dispatch] = useGameState()
  const gameRef = useRef(game)
  gameRef.current = game

  const NO_HINTS: EngineHints = { tooFar: false, overlap: false, dark: false }
  const [presentCount, setPresentCount] = useState(0)
  const [lockProgress, setLockProgress] = useState(0)
  const [hints, setHints] = useState<EngineHints>(NO_HINTS)
  const [showResults, setShowResults] = useState(false)
  const [clip, setClip] = useState<MatchClip | null>(null)
  const [tournament, setTournament] = useState<Tournament | null>(loadTournament)
  /** Which bracket match is being played right now (null = quick match). */
  const [pendingBracket, setPendingBracket] = useState<{ round: number; index: number } | null>(null)
  const accumRef = useRef<Accumulators>(createAccumulators())
  const recorderRef = useRef(new MatchRecorder())
  const wakeLock = useWakeLock()

  const playerNames = useCallback(
    (s: GameSettings): [string, string] => [
      s.players[0].name.trim() || t('setup.player1'),
      s.players[1].name.trim() || t('setup.player2'),
    ],
    [t],
  )

  /* ---------------- Per-inference-frame game logic ---------------- */

  const finishMatch = (winnerIndex: 0 | 1, now: number, endedByTimer: boolean) => {
    const g = gameRef.current
    const a = accumRef.current
    const names = playerNames(g.settings)
    const results: MatchResults = {
      winnerIndex,
      winnerName: names[winnerIndex],
      durationMs: now - (g.matchStartedAt ?? now),
      roundMode: g.settings.roundMode,
      endedByTimer,
      players: ([0, 1] as const).map((i) => ({
        name: names[i],
        profileId: g.settings.players[i].profileId,
        progress: a.progress[i],
        maxSpeed: a.maxSpeed[i],
        avgSpeed: a.time > 0 ? a.speedIntegral[i] / a.time : 0,
      })) as unknown as MatchResults['players'],
    }
    sfx.victory()

    // Roster stats (wins/matches → belts, personal speed records) update locally.
    recordMatchResult(
      ([0, 1] as const).map((i) => ({
        profileId: g.settings.players[i].profileId,
        won: i === winnerIndex,
        maxSpeed: a.maxSpeed[i],
      })),
    )

    // The canvas keeps celebrating — the clip records the splash for CLIP_TAIL_MS.
    configure({
      hud: {
        mode: 'victory',
        progress: [a.progress[0], a.progress[1]],
        remainingMs: 0,
        frozen: false,
        winnerIndex,
        winnerName: names[winnerIndex],
        endedByTimer,
      },
    })
    void recorderRef.current.finish(CLIP_TAIL_MS).then((c) => setClip(c))

    dispatch({ type: 'MATCH_END', results })
  }

  const onFrame = (frame: EngineFrame) => {
    const g = gameRef.current

    if (g.phase === 'CALIBRATION') {
      setPresentCount(frame.presentCount)
      setHints(frame.hints)
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
      const rate = FILL_RATE[g.settings.roundMode]
      const durationMs = ROUND_DURATION_MS[g.settings.roundMode]
      const elapsed = frame.now - (g.matchStartedAt ?? frame.now)
      const remaining = durationMs - elapsed

      // "Freeze!" window: moving now DRAINS your bar instead of filling it.
      const frozen = a.freezes.some((f) => elapsed >= f.start && elapsed < f.end)
      if (frozen !== a.frozen) {
        a.frozen = frozen
        if (frozen) sfx.whistle()
        else sfx.release()
      }

      a.time += frame.dt
      for (const i of [0, 1] as const) {
        const speed = frame.players[i].speed
        const delta = speed * rate * frame.dt
        a.progress[i] = frozen
          ? Math.max(a.progress[i] - delta, 0)
          : Math.min(a.progress[i] + delta, target)
        if (speed > a.maxSpeed[i]) a.maxSpeed[i] = speed
        a.speedIntegral[i] += speed * frame.dt
      }

      const toPercent = (v: number) => (v / target) * 100
      configure({
        hud: {
          mode: 'match',
          progress: [toPercent(a.progress[0]), toPercent(a.progress[1])],
          remainingMs: Math.max(0, remaining),
          frozen,
          winnerIndex: null,
          winnerName: '',
          endedByTimer: false,
        },
      })

      const p0Won = a.progress[0] >= target
      const p1Won = a.progress[1] >= target
      const timeUp = remaining <= 0

      if (!p0Won && !p1Won && !timeUp) return

      a.finished = true
      let winner: 0 | 1
      if (p0Won !== p1Won) {
        winner = p0Won ? 0 : 1
      } else {
        // Photo finish (both hit 100) or the clock ran out: higher bar wins,
        // a dead tie goes to whoever is faster right now.
        winner =
          a.progress[0] !== a.progress[1]
            ? a.progress[0] > a.progress[1]
              ? 0
              : 1
            : frame.players[0].speed >= frame.players[1].speed
              ? 0
              : 1
      }
      finishMatch(winner, frame.now, timeUp && !p0Won && !p1Won)
    }
  }

  const { videoRef, canvasRef, status, error, start, stop, configure } = usePoseDetection(onFrame)

  /* ---------------- Countdown (3 → 2 → 1 → gong) ---------------- */

  const startMatch = useCallback(() => {
    const settings = gameRef.current.settings
    accumRef.current = createAccumulators(settings.handicap)
    if (settings.freezeMode) {
      accumRef.current.freezes = generateFreezes(ROUND_DURATION_MS[settings.roundMode])
    }
    setClip(null)
    if (canvasRef.current) {
      recorderRef.current.start(canvasRef.current, settings.soundEnabled ? sfx.captureStream() : null)
    }
    dispatch({ type: 'MATCH_START', at: performance.now() })
  }, [dispatch, canvasRef])

  // While the host reads the menu, quietly pull in the heavy TFJS chunk so the
  // START button doesn't pay the download.
  useEffect(() => {
    prefetchEngine()
  }, [])

  // Self-correcting countdown: each tick targets an absolute timestamp, so the
  // gong lands on the displayed "1 → GO" without setInterval drift.
  useEffect(() => {
    if (game.phase !== 'CALIBRATION' || game.calibrationPhase !== 'COUNTDOWN') return
    sfx.beep()
    const t0 = performance.now()
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const schedule = (value: number) => {
      const target = t0 + (3 - value) * 1000
      timers.push(
        setTimeout(
          () => {
            if (cancelled) return
            if (value >= 1) {
              sfx.beep()
              dispatch({ type: 'COUNTDOWN_TICK', value })
              schedule(value - 1)
            } else {
              sfx.gong()
              startMatch()
            }
          },
          Math.max(0, target - performance.now()),
        ),
      )
    }
    schedule(2)
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [game.phase, game.calibrationPhase, dispatch, startMatch])

  /* ---------------- Keep the engine config in sync ---------------- */

  useEffect(() => {
    configure({
      mirror: game.settings.mirrorMode,
      names: playerNames(game.settings),
      drawOverlays: ARENA_PHASES.includes(game.phase),
      scoring: game.phase === 'PLAYING',
      // From the countdown on, roles stick to the tracked bodies — kids can
      // cross sides mid-match without swapping who is blue and who is red.
      rolesLocked:
        game.phase === 'PLAYING' ||
        game.phase === 'GAME_OVER' ||
        (game.phase === 'CALIBRATION' && game.calibrationPhase === 'COUNTDOWN'),
    })
    sfx.enabled = game.settings.soundEnabled
  }, [game.settings, game.phase, game.calibrationPhase, configure, playerNames])

  // Fresh calibration → clean HUD (a rematch inherits the victory splash otherwise).
  useEffect(() => {
    if (game.phase === 'CALIBRATION') {
      configure({
        hud: {
          mode: 'none',
          progress: [0, 0],
          remainingMs: 0,
          frozen: false,
          winnerIndex: null,
          winnerName: '',
          endedByTimer: false,
        },
      })
    }
  }, [game.phase, configure])

  // Persist settings so the next party starts pre-configured.
  useEffect(() => {
    saveSettings(game.settings)
  }, [game.settings])

  // Let the canvas celebrate before the host controls slide in.
  useEffect(() => {
    if (game.phase !== 'GAME_OVER') {
      setShowResults(false)
      return
    }
    const id = setTimeout(() => setShowResults(true), GAME_OVER_UI_DELAY_MS)
    return () => clearTimeout(id)
  }, [game.phase])

  /* ---------------- User actions ---------------- */

  const resetRoundState = () => {
    accumRef.current = createAccumulators()
    setPresentCount(0)
    setLockProgress(0)
    setHints(NO_HINTS)
  }

  const leaveArena = (to: 'HOME' | 'MATCH_SETUP' | 'TOURNAMENT') => {
    recorderRef.current.cancel()
    setClip(null)
    setPendingBracket(null)
    stop()
    wakeLock.release()
    resetRoundState()
    dispatch({ type: 'NAVIGATE', to })
  }

  const handleStart = () => {
    sfx.unlock() // user gesture: unlocks audio; camera prompt follows
    wakeLock.acquire()
    resetRoundState()
    saveLastPlayers(gameRef.current.settings.players)
    dispatch({ type: 'START_CALIBRATION' })
    void start()
  }

  const handleQuickStart = () => {
    setPendingBracket(null)
    handleStart()
  }

  const handleRematch = () => {
    recorderRef.current.cancel()
    setClip(null)
    resetRoundState()
    dispatch({ type: 'REMATCH' })
  }

  /* ---------------- Tournament actions ---------------- */

  const updateTournament = (next: Tournament | null) => {
    setTournament(next)
    saveTournament(next)
  }

  const handlePlayBracket = (round: number, index: number) => {
    if (!tournament) return
    const match = tournament.rounds[round][index]
    const [a, b] = match.players
    if (!a || !b) return
    setPendingBracket({ round, index })
    dispatch({ type: 'UPDATE_SETTINGS', patch: { players: [a, b], handicap: [0, 0] } })
    handleStart()
  }

  const handleContinueTournament = () => {
    const results = gameRef.current.results
    if (!pendingBracket || !results || !tournament) return
    updateTournament(
      reportWinner(tournament, pendingBracket.round, pendingBracket.index, results.winnerIndex),
    )
    setPendingBracket(null)
    recorderRef.current.cancel()
    setClip(null)
    resetRoundState()
    // The camera stays on: the next bracket match starts instantly.
    dispatch({ type: 'NAVIGATE', to: 'TOURNAMENT' })
  }

  /* ---------------- Render ---------------- */

  const inArena = ARENA_PHASES.includes(game.phase)
  const settings = game.settings

  return (
    <div className="relative h-full w-full overflow-hidden bg-arena-950">
      {/* Hidden source video; everything visible is drawn onto the canvas. */}
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className={`h-full w-full object-contain ${inArena ? '' : 'hidden'}`} />

      {game.phase === 'HOME' && (
        <HomeScreen
          onQuickMatch={() => dispatch({ type: 'NAVIGATE', to: 'MATCH_SETUP' })}
          onTournament={() => dispatch({ type: 'NAVIGATE', to: 'TOURNAMENT' })}
          onRoster={() => dispatch({ type: 'NAVIGATE', to: 'ROSTER' })}
          tournamentActive={tournament !== null}
        />
      )}

      {game.phase === 'TOURNAMENT' && (
        <TournamentScreen
          tournament={tournament}
          onCreate={(entrants) => updateTournament(createTournament(entrants))}
          onPlay={handlePlayBracket}
          onFinish={() => updateTournament(null)}
          onBack={() => leaveArena('HOME')}
          onRoster={() => dispatch({ type: 'NAVIGATE', to: 'ROSTER' })}
        />
      )}

      {game.phase === 'ROSTER' && (
        <RosterScreen onBack={() => dispatch({ type: 'NAVIGATE', to: 'HOME' })} />
      )}

      {game.phase === 'MATCH_SETUP' && (
        <MatchSetupScreen
          settings={settings}
          onPatch={(patch) => dispatch({ type: 'UPDATE_SETTINGS', patch })}
          onSetPlayer={(index, slot) => dispatch({ type: 'SET_PLAYER', index, slot })}
          onStart={handleQuickStart}
          onBack={() => dispatch({ type: 'NAVIGATE', to: 'HOME' })}
        />
      )}

      {game.phase === 'CALIBRATION' && status === 'running' && (
        <CalibrationOverlay
          phase={game.calibrationPhase}
          presentCount={presentCount}
          lockProgress={lockProgress}
          countdown={game.countdown}
          hints={hints}
        />
      )}

      {game.phase === 'GAME_OVER' && game.results && showResults && (
        <GameOverScreen
          results={game.results}
          clip={clip}
          onNext={handleRematch}
          onChangePlayers={() => leaveArena('MATCH_SETUP')}
          onHome={() => leaveArena('HOME')}
          onContinueTournament={pendingBracket ? handleContinueTournament : undefined}
        />
      )}

      {inArena && status === 'starting' && <LoadingOverlay />}
      {inArena && status === 'error' && error && (
        <ErrorOverlay
          message={error}
          onBack={() => leaveArena(pendingBracket ? 'TOURNAMENT' : 'MATCH_SETUP')}
        />
      )}
    </div>
  )
}
