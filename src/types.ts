/** Top-level game phases (finite state machine). */
export type GamePhase =
  | 'HOME'
  | 'ROSTER'
  | 'MATCH_SETUP'
  | 'TOURNAMENT'
  | 'CALIBRATION'
  | 'PLAYING'
  | 'GAME_OVER'

/** Phases where the camera engine must be running. */
export const ARENA_PHASES: readonly GamePhase[] = ['CALIBRATION', 'PLAYING', 'GAME_OVER']

/** Sub-phases inside CALIBRATION. */
export type CalibrationPhase = 'SEARCHING' | 'LOCKING' | 'COUNTDOWN'

/**
 * Round mode = REAL round length. The match ends either when someone fills the
 * bar to targetScore, or when the timer expires (higher bar wins).
 */
export type RoundMode = 'sprint' | 'fight' | 'marathon'

export const ROUND_MODES: RoundMode[] = ['sprint', 'fight', 'marathon']

export const ROUND_DURATION_MS: Record<RoundMode, number> = {
  sprint: 30_000,
  fight: 60_000,
  marathon: 90_000,
}

/**
 * Bar fill per second at maximum activity (percent). Longer rounds fill slower,
 * so a maxed-out player finishes just before the timer — most matches are
 * decided by the clock, which keeps both kids moving until the end.
 */
export const FILL_RATE: Record<RoundMode, number> = {
  sprint: 9,
  fight: 6.5,
  marathon: 4.5,
}

/** Head-start options for the weaker player, in bar percent. */
export const HANDICAP_STEPS = [0, 10, 20, 30] as const

/** A roster entry, persisted locally on the device. */
export interface PlayerProfile {
  id: string
  name: string
  wins: number
  matches: number
  /** Personal record: peak smoothed activity 0..1 (optional for pre-existing saves). */
  bestSpeed?: number
  createdAt: number
}

/** One side of a match: either a roster profile or an ad-hoc guest. */
export interface PlayerSlot {
  profileId: string | null
  name: string
}

export interface GameSettings {
  players: [PlayerSlot, PlayerSlot]
  roundMode: RoundMode
  /** Head start per player (bar percent, 0..30). */
  handicap: [number, number]
  /** Progress needed to win (percent). */
  targetScore: number
  /** Random "freeze!" windows during the round: moving DRAINS your bar. */
  freezeMode: boolean
  /** Flip the canvas horizontally (natural for players watching themselves on a TV). */
  mirrorMode: boolean
  soundEnabled: boolean
}

export const DEFAULT_SETTINGS: GameSettings = {
  players: [
    { profileId: null, name: '' },
    { profileId: null, name: '' },
  ],
  roundMode: 'fight',
  handicap: [0, 0],
  targetScore: 100,
  freezeMode: false,
  mirrorMode: true,
  soundEnabled: true,
}

/** One "freeze!" window lasts this long. */
export const FREEZE_WINDOW_MS = 3000

/* ---------------- Belts (rank derived from wins) ---------------- */

export type BeltKey = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'red' | 'black'

export interface Belt {
  key: BeltKey
  /** Wins required to reach this belt. */
  minWins: number
  /** Dot color for UI. */
  color: string
}

/** Ascending thresholds; beltFor() picks the highest reached. */
export const BELTS: Belt[] = [
  { key: 'white', minWins: 0, color: '#f1f5f9' },
  { key: 'yellow', minWins: 2, color: '#ffe600' },
  { key: 'orange', minWins: 5, color: '#ff9f1a' },
  { key: 'green', minWins: 9, color: '#39ff88' },
  { key: 'blue', minWins: 14, color: '#00c3ff' },
  { key: 'red', minWins: 20, color: '#ff2e63' },
  { key: 'black', minWins: 30, color: '#111318' },
]

export function beltFor(wins: number): Belt {
  let belt = BELTS[0]
  for (const b of BELTS) if (wins >= b.minWins) belt = b
  return belt
}

/* ---------------- Live match stats ---------------- */

/** Live, per-frame stats for one fighter while a match runs. */
export interface PlayerStats {
  /** 0..100 — the win bar. */
  progress: number
  /** Smoothed current activity, 0..1. */
  speed: number
  /** Peak smoothed activity reached during the match, 0..1. */
  maxSpeed: number
  /** Time-weighted average activity over the match, 0..1. */
  avgSpeed: number
  /** Is this fighter currently tracked in frame (incl. short persistence window). */
  present: boolean
}

export const EMPTY_STATS: PlayerStats = {
  progress: 0,
  speed: 0,
  maxSpeed: 0,
  avgSpeed: 0,
  present: false,
}

export interface PlayerResult {
  name: string
  profileId: string | null
  progress: number
  maxSpeed: number
  avgSpeed: number
}

export interface MatchResults {
  winnerIndex: 0 | 1
  winnerName: string
  durationMs: number
  roundMode: RoundMode
  /** True when the clock ran out (winner decided by higher bar). */
  endedByTimer: boolean
  players: [PlayerResult, PlayerResult]
}

export const PLAYER_COLORS = ['#00c3ff', '#ff2e63'] as const
