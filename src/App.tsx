import { useCallback, useEffect, useRef, useState } from 'react'
import { music, type MusicTrack } from './audio/music'
import { sfx } from './audio/sfx'
import { createTournament, reportWinner, type Tournament } from './bracket'
import { CalibrationOverlay } from './components/CalibrationOverlay'
import { GameOverScreen } from './components/GameOverScreen'
import { HomeScreen } from './components/HomeScreen'
import { InstructionCard, type Rule } from './components/InstructionCard'
import { MatchSetupScreen } from './components/MatchSetupScreen'
import { RosterScreen } from './components/RosterScreen'
import { ErrorOverlay, LoadingOverlay } from './components/StatusOverlay'
import { TournamentScreen } from './components/TournamentScreen'
import { DEFAULT_HUD } from './cv/draw'
import type { EngineFrame, EngineHints } from './cv/engine'
import { useGameState } from './hooks/useGameState'
import { useWakeLock } from './hooks/useWakeLock'
import { prefetchEngine, usePoseDetection } from './hooks/usePoseDetection'
import { useI18n, type I18nKey } from './i18n'
import { MatchRecorder } from './recorder'
import { useMatchClip } from './hooks/useMatchClip'
import { recordSessionMatch } from './session'
import { ShowCast, type CastStatus } from './show'
import {
  loadTournament,
  recordMatchResult,
  saveLastPlayers,
  saveSettings,
  saveTournament,
} from './storage'
import {
  RHYTHM_PERIOD_MS,
  bossCharge,
  createModeState,
  modeTick,
  type ModeState,
} from './modes'
import {
  ARENA_PHASES,
  COMBO_GRACE_MS,
  COMBO_SPEED_MIN,
  FILL_RATE,
  FREEZE_WINDOW_MS,
  OVERTIME_DELTA,
  OVERTIME_MAX_MS,
  ROUND_DURATION_MS,
  SENSITIVITY_FACTOR,
  comboMultiplier,
  isEndless,
  isOvertimeTie,
  type GameSettings,
  type MatchMode,
  type MatchResults,
} from './types'

/** Pre-match briefing rules — tailored to the chosen mode so the card actually
 *  teaches how THAT mode is played (the traffic-light card, say, must warn that
 *  moving on red burns your bar — the opposite of the generic "move fast"). */
function battleRules(
  t: (key: I18nKey, vars?: Record<string, string | number>) => string,
  mode: MatchMode,
): Rule[] {
  const fill: Rule = { emoji: '🏁', text: t('battle.rule.fill') }
  const frame: Rule = { emoji: '🎨', text: t('battle.rule.frame') }
  switch (mode) {
    case 'rhythm':
      return [
        { emoji: '🎵', text: t('rules.rhythm.beat') },
        { emoji: '🎯', text: t('rules.rhythm.miss') },
        frame,
      ]
    case 'endurance':
      return [
        { emoji: '🏃', text: t('rules.endurance.pace') },
        { emoji: '🥵', text: t('rules.endurance.stop') },
        fill,
      ]
    case 'traffic':
      return [
        { emoji: '🟢', text: t('rules.traffic.green') },
        { emoji: '🔴', text: t('rules.traffic.red') },
        fill,
      ]
    case 'boss':
      return [
        { emoji: '🤝', text: t('rules.boss.team') },
        { emoji: '💥', text: t('rules.boss.attack') },
        { emoji: '⏱️', text: t('rules.boss.timer') },
      ]
    case 'classic':
    default:
      return [{ emoji: '⚡', text: t('battle.rule.move') }, fill, frame]
  }
}

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
  /** Unbroken movement streak per player, ms. */
  comboMs: [number, number]
  /** How long the player has been below the combo threshold (grace timer). */
  comboDipMs: [number, number]
  /** Current fill multiplier per player (1 = no streak). */
  comboMult: [number, number]
  maxCombo: [number, number]
  /** Per-mode machinery (beats, traffic light, boss attacks). */
  modeState: ModeState
  /** Sudden death after a buzzer tie. */
  overtime: boolean
  otBase: [number, number]
  otStartedAt: number
  /** Short visual flashes (rhythm hits, boss attacks), absolute deadlines. */
  beatFlashUntil: [number, number]
  bossFlashUntil: number
}

function createAccumulators(
  handicap: [number, number] = [0, 0],
  mode: MatchMode = 'classic',
): Accumulators {
  return {
    // The boss bar is shared — individual head starts don't apply.
    progress: mode === 'boss' ? [0, 0] : [handicap[0], handicap[1]],
    maxSpeed: [0, 0],
    speedIntegral: [0, 0],
    time: 0,
    lockStart: null,
    finished: false,
    freezes: [],
    frozen: false,
    comboMs: [0, 0],
    comboDipMs: [0, 0],
    comboMult: [1, 1],
    maxCombo: [1, 1],
    modeState: createModeState(mode),
    overtime: false,
    otBase: [0, 0],
    otStartedAt: 0,
    beatFlashUntil: [0, 0],
    bossFlashUntil: 0,
  }
}

/**
 * The round is endless, so freezes are scheduled on a rolling ~22–36 s cadence
 * from ~15 s in, out to a generous horizon (longer than any real living-room
 * round). Offsets are from match start, in ms.
 */
const FREEZE_HORIZON_MS = 600_000
function generateFreezes(): FreezeWindow[] {
  const windows: FreezeWindow[] = []
  let t = 15_000 + Math.random() * 8_000
  while (t < FREEZE_HORIZON_MS) {
    windows.push({ start: t, end: t + FREEZE_WINDOW_MS })
    t += 22_000 + Math.random() * 14_000
  }
  return windows
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
  /** Pre-match rules briefing, shown between setup and calibration. */
  const [showBattleRules, setShowBattleRules] = useState(false)
  const clipShare = useMatchClip()
  const { capture: captureClip, reset: resetClip } = clipShare
  const [tournament, setTournament] = useState<Tournament | null>(loadTournament)
  /** Which bracket match is being played right now (null = quick match). */
  const [pendingBracket, setPendingBracket] = useState<{ round: number; index: number } | null>(null)
  const accumRef = useRef<Accumulators>(createAccumulators())
  const recorderRef = useRef(new MatchRecorder())
  const showRef = useRef<ShowCast | null>(null)
  showRef.current ??= new ShowCast()
  const show = showRef.current
  const [castStatus, setCastStatus] = useState<CastStatus>('idle')
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
    const mode = g.settings.matchMode
    const coop = mode === 'boss'
    const teamLabel = `${names[0]} + ${names[1]}`
    const winnerName = coop
      ? winnerIndex === 0
        ? teamLabel
        : t('hud.boss')
      : names[winnerIndex]
    const results: MatchResults = {
      winnerIndex,
      winnerName,
      durationMs: now - (g.matchStartedAt ?? now),
      roundMode: g.settings.roundMode,
      matchMode: mode,
      endedByTimer,
      players: ([0, 1] as const).map((i) => ({
        name: names[i],
        profileId: g.settings.players[i].profileId,
        // Co-op: both kids share the team bar; speeds stay individual.
        progress: coop ? a.progress[0] : a.progress[i],
        maxSpeed: a.maxSpeed[i],
        avgSpeed: a.time > 0 ? a.speedIntegral[i] / a.time : 0,
        maxCombo: a.maxCombo[i],
      })) as unknown as MatchResults['players'],
    }
    sfx.victory()

    // Roster stats (wins/matches → belts, personal speed records) update locally.
    recordMatchResult(
      ([0, 1] as const).map((i) => ({
        profileId: g.settings.players[i].profileId,
        won: coop ? winnerIndex === 0 : i === winnerIndex,
        maxSpeed: a.maxSpeed[i],
      })),
    )
    // Tonight's tally for the host (co-op: the whole team scores the win).
    recordSessionMatch(coop ? (winnerIndex === 0 ? [...names] : []) : [names[winnerIndex]])

    // The canvas keeps celebrating — the clip records the splash for CLIP_TAIL_MS.
    const victoryHud = {
      mode: 'victory' as const,
      progress: [a.progress[0], a.progress[1]] as [number, number],
      remainingMs: 0,
      frozen: false,
      combo: [1, 1] as [number, number],
      winnerIndex,
      winnerName,
      endedByTimer,
    }
    configure({ hud: victoryHud })
    show.sendState({
      hud: victoryHud,
      names: coop ? [teamLabel, t('hud.boss')] : names,
      phase: 'over',
    })
    captureClip(recorderRef.current, CLIP_TAIL_MS)

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
      const mode = g.settings.matchMode
      const endless = isEndless(mode)
      const rate = FILL_RATE[g.settings.roundMode]
      const durationMs = ROUND_DURATION_MS[g.settings.roundMode]
      const elapsed = frame.now - (g.matchStartedAt ?? frame.now)
      const remaining = durationMs - elapsed
      // Endless modes never run out of clock — only a filled bar ends the round.
      const timeUp = endless ? false : remaining <= 0
      // Sensitivity scales the percent gained per movement (pre-match dial).
      const sens = SENSITIVITY_FACTOR[g.settings.sensitivity]
      const speeds: [number, number] = [frame.players[0].speed, frame.players[1].speed]

      // "Freeze!" window (classic-mode modifier): moving now DRAINS your bar.
      const frozen = a.freezes.some((f) => elapsed >= f.start && elapsed < f.end)
      if (frozen !== a.frozen) {
        a.frozen = frozen
        if (frozen) sfx.whistle()
        else sfx.release()
      }

      // Mode layer: how much fill/burn this frame + what just happened.
      const tick = modeTick(a.modeState, { dt: frame.dt, elapsedMs: elapsed, speeds, rate })
      if (tick.events.beat) sfx.tick()
      if (tick.events.hit) {
        for (const i of [0, 1] as const) {
          if (tick.events.hit[i]) a.beatFlashUntil[i] = frame.now + 220
        }
      }
      if (tick.events.trafficSwitch === 'red') sfx.whistle()
      else if (tick.events.trafficSwitch === 'green') sfx.release()
      if (tick.events.bossAttack !== undefined) {
        sfx.roar()
        a.bossFlashUntil = frame.now + 280
      }

      a.time += frame.dt
      // How lively this instant was, for the highlight cut: both players going
      // at once is what makes a moment worth keeping.
      recorderRef.current.mark((speeds[0] + speeds[1]) / 2)

      for (const i of [0, 1] as const) {
        const speed = speeds[i]

        // Combo streak: continuous movement compounds the fill rate (up to ×2)
        // in modes where that's fair (classic). A freeze window HOLDS the
        // streak while you stand still — flinching burns it with your bar.
        if (g.settings.comboMode && tick.comboEligible) {
          if (frozen) {
            if (speed >= COMBO_SPEED_MIN) {
              a.comboMs[i] = 0
              a.comboDipMs[i] = 0
            }
          } else if (speed >= COMBO_SPEED_MIN) {
            a.comboMs[i] += frame.dt * 1000
            a.comboDipMs[i] = 0
          } else {
            a.comboDipMs[i] += frame.dt * 1000
            if (a.comboDipMs[i] > COMBO_GRACE_MS) a.comboMs[i] = 0
          }
          const mult = comboMultiplier(a.comboMs[i])
          if (mult > a.comboMult[i]) sfx.comboUp(mult)
          a.comboMult[i] = mult
          if (mult > a.maxCombo[i]) a.maxCombo[i] = mult
        }

        // Penalties (freeze / red light / boss hits) are never combo-amplified.
        if (frozen) {
          a.progress[i] = Math.max(a.progress[i] - speed * rate * frame.dt, 0)
        } else {
          // Sensitivity scales the gain per movement; penalties (burn) are not
          // discounted, so an easier fill never softens a red-light mistake.
          a.progress[i] = Math.min(
            Math.max(a.progress[i] + tick.fill[i] * a.comboMult[i] * sens - tick.burn[i], 0),
            target,
          )
        }
        if (speed > a.maxSpeed[i]) a.maxSpeed[i] = speed
        a.speedIntegral[i] += speed * frame.dt
      }
      // Boss mode: the right panel shows the boss attack charging up.
      if (mode === 'boss') {
        a.progress[1] = (bossCharge(a.modeState, elapsed) / 100) * target
      }

      const names = playerNames(g.settings)
      const toPercent = (v: number) => (v / target) * 100
      const matchHud = {
        mode: 'match' as const,
        progress: [toPercent(a.progress[0]), toPercent(a.progress[1])] as [number, number],
        // Endless: the clock counts UP (elapsed) and never drives urgency.
        remainingMs: endless ? elapsed : Math.max(0, remaining),
        endless,
        frozen,
        combo: [a.comboMult[0], a.comboMult[1]] as [number, number],
        winnerIndex: null,
        winnerName: '',
        endedByTimer: false,
        overtime: a.overtime,
        beatPhase:
          mode === 'rhythm' ? (elapsed % RHYTHM_PERIOD_MS) / RHYTHM_PERIOD_MS : undefined,
        beatFlash:
          mode === 'rhythm'
            ? ([frame.now < a.beatFlashUntil[0], frame.now < a.beatFlashUntil[1]] as [
                boolean,
                boolean,
              ])
            : undefined,
        traffic: mode === 'traffic' ? (a.modeState.red ? ('red' as const) : ('green' as const)) : undefined,
        coop: mode === 'boss' ? true : undefined,
        bossFlash: mode === 'boss' && frame.now < a.bossFlashUntil ? true : undefined,
        panelNames:
          mode === 'boss'
            ? ([`${names[0]} + ${names[1]}`, t('hud.boss')] as [string, string])
            : undefined,
      }
      configure({ hud: matchHud })
      show.sendState({
        hud: matchHud,
        names: mode === 'boss' ? [`${names[0]} + ${names[1]}`, t('hud.boss')] : names,
        phase: 'playing',
      })

      // Co-op: the team races the clock, the boss "wins" on the buzzer.
      if (mode === 'boss') {
        if (a.progress[0] >= target) {
          a.finished = true
          finishMatch(0, frame.now, false)
        } else if (timeUp) {
          a.finished = true
          finishMatch(1, frame.now, true)
        }
        return
      }

      const p0Won = a.progress[0] >= target
      const p1Won = a.progress[1] >= target

      // Buzzer with a near-tie → OVERTIME: first to +OVERTIME_DELTA wins.
      if (
        !p0Won &&
        !p1Won &&
        timeUp &&
        !a.overtime &&
        isOvertimeTie(a.progress[0], a.progress[1])
      ) {
        a.overtime = true
        a.otBase = [a.progress[0], a.progress[1]]
        a.otStartedAt = frame.now
        sfx.alert()
        return
      }

      if (a.overtime) {
        const d0 = a.progress[0] - a.otBase[0]
        const d1 = a.progress[1] - a.otBase[1]
        const decided =
          p0Won || p1Won || d0 >= OVERTIME_DELTA || d1 >= OVERTIME_DELTA ||
          frame.now - a.otStartedAt >= OVERTIME_MAX_MS
        if (!decided) return
        a.finished = true
        const winner: 0 | 1 =
          d0 !== d1 ? (d0 > d1 ? 0 : 1) : speeds[0] >= speeds[1] ? 0 : 1
        finishMatch(winner, frame.now, true)
        return
      }

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
            : speeds[0] >= speeds[1]
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
    accumRef.current = createAccumulators(settings.handicap, settings.matchMode)
    // The freeze modifier belongs to classic; other modes bring their own rules.
    if (settings.freezeMode && settings.matchMode === 'classic') {
      accumRef.current.freezes = generateFreezes()
    }
    resetClip()
    if (canvasRef.current) {
      recorderRef.current.start(canvasRef.current, settings.soundEnabled ? sfx.captureStream() : null)
    }
    dispatch({ type: 'MATCH_START', at: performance.now() })
  }, [dispatch, canvasRef, resetClip])

  // While the host reads the menu, quietly pull in the heavy TFJS chunk so the
  // START button doesn't pay the download.
  useEffect(() => {
    prefetchEngine()
  }, [])

  // Music bed follows the phase: the high-energy round track while calibrating,
  // the mellow menu groove in menus. Rhythm mode swaps to its own beat-locked
  // track exactly at PLAYING — the round→rhythm switch restarts the loop so its
  // kick lands on the same beat grid the scoring uses (both begin at match
  // start; the ±window forgives the residual audio-clock offset). play() is a
  // no-op when muted and won't restart a track that's already sounding.
  useEffect(() => {
    let track: MusicTrack = 'menu'
    if (game.phase === 'PLAYING') {
      track = game.settings.matchMode === 'rhythm' ? 'rhythm' : 'round'
    } else if (game.phase === 'CALIBRATION') {
      track = 'round'
    }
    music.play(track)
  }, [game.phase, game.settings.matchMode])

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
      mask: game.settings.maskMode,
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
      configure({ hud: { ...DEFAULT_HUD } })
    }
  }, [game.phase, configure])

  /* ---------------- TV show (Chromecast / second window) ---------------- */

  useEffect(() => {
    show.onStatus = setCastStatus
    return () => {
      show.onStatus = null
    }
  }, [show])

  // Keep the TV in the loop outside of live scoring: menu = waiting splash,
  // calibration = "X VS Y" title card (the PLAYING/over pushes happen per frame).
  useEffect(() => {
    if (game.phase === 'PLAYING' || game.phase === 'GAME_OVER') return
    show.sendState({
      hud: { ...DEFAULT_HUD },
      names: playerNames(game.settings),
      phase: game.phase === 'CALIBRATION' ? 'calibration' : 'idle',
    })
  }, [game.phase, game.settings, playerNames, show])

  // Stream the arena canvas to the TV whenever both are alive. attachMedia is
  // safe to repeat — it renegotiates a fresh WebRTC peer.
  useEffect(() => {
    if (status !== 'running' || castStatus !== 'live') return
    if (!canvasRef.current) return
    show.attachMedia(
      canvasRef.current,
      gameRef.current.settings.soundEnabled ? sfx.captureStream() : null,
    )
    return () => show.detachMedia()
  }, [status, castStatus, show, canvasRef])

  const handleCast = () => {
    if (show.active) show.stop()
    else void show.start()
  }

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
    resetClip()
    setShowBattleRules(false)
    setPendingBracket(null)
    stop()
    wakeLock.release()
    resetRoundState()
    dispatch({ type: 'NAVIGATE', to })
  }

  const handleStart = () => {
    sfx.unlock() // user gesture: unlocks audio; camera prompt follows
    music.unlock()
    wakeLock.acquire()
    resetRoundState()
    saveLastPlayers(gameRef.current.settings.players)
    dispatch({ type: 'START_CALIBRATION' })
    void start(gameRef.current.settings.cameraId)
  }

  const handleQuickStart = () => {
    setPendingBracket(null)
    // Brief the players on the rules before the camera comes up.
    setShowBattleRules(true)
  }

  const handleRematch = () => {
    recorderRef.current.cancel()
    resetClip()
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
    dispatch({
      type: 'UPDATE_SETTINGS',
      patch: {
        players: [a, b],
        handicap: [0, 0],
        // Brackets are 1v1 — the co-op boss mode falls back to classic.
        ...(gameRef.current.settings.matchMode === 'boss'
          ? { matchMode: 'classic' as const }
          : {}),
      },
    })
    // Brief the players on the mode's rules before the camera comes up — the
    // same card quick matches get (bracket matches used to skip it).
    setShowBattleRules(true)
  }

  const handleContinueTournament = () => {
    const results = gameRef.current.results
    if (!pendingBracket || !results || !tournament) return
    updateTournament(
      reportWinner(tournament, pendingBracket.round, pendingBracket.index, results.winnerIndex),
    )
    setPendingBracket(null)
    recorderRef.current.cancel()
    resetClip()
    resetRoundState()
    // The camera stays on: the next bracket match starts instantly.
    dispatch({ type: 'NAVIGATE', to: 'TOURNAMENT' })
  }

  /* ---------------- Render ---------------- */

  const inArena = ARENA_PHASES.includes(game.phase)
  const settings = game.settings

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Hidden source video; everything visible is drawn onto the canvas. */}
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className={`h-full w-full object-contain ${inArena ? '' : 'hidden'}`} />

      {game.phase === 'HOME' && (
        <HomeScreen
          onQuickMatch={() => dispatch({ type: 'NAVIGATE', to: 'MATCH_SETUP' })}
          onTournament={() => dispatch({ type: 'NAVIGATE', to: 'TOURNAMENT' })}
          onRoster={() => dispatch({ type: 'NAVIGATE', to: 'ROSTER' })}
          tournamentActive={tournament !== null}
          castSupported={show.supported()}
          castStatus={castStatus}
          onCast={handleCast}
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

      {/* Mode-specific pre-match briefing — shown for both quick matches
          (MATCH_SETUP) and tournament brackets (TOURNAMENT). */}
      {showBattleRules && (
        <InstructionCard
          title={t(`gmode.${settings.matchMode}` as I18nKey)}
          subtitle={t(`gmode.${settings.matchMode}Hint` as I18nKey)}
          rules={battleRules(t, settings.matchMode)}
          onStart={() => {
            setShowBattleRules(false)
            handleStart()
          }}
          onBack={() => {
            setShowBattleRules(false)
            setPendingBracket(null)
          }}
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
          clip={clipShare}
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
