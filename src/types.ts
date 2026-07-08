/** Top-level game phases (finite state machine). */
export type GamePhase = 'SETUP' | 'CALIBRATION' | 'PLAYING' | 'GAME_OVER'

/** Sub-phases inside CALIBRATION. */
export type CalibrationPhase = 'SEARCHING' | 'LOCKING' | 'COUNTDOWN'

export type Difficulty = 'easy' | 'normal' | 'hard'

export interface GameSettings {
  player1Name: string
  player2Name: string
  /** Progress needed to win (percent). */
  targetScore: number
  /** Scales how fast movement fills the bar. */
  difficulty: Difficulty
  /** Flip the canvas horizontally (natural for players watching themselves on a TV). */
  mirrorMode: boolean
  soundEnabled: boolean
}

export const DEFAULT_SETTINGS: GameSettings = {
  player1Name: 'PLAYER 1',
  player2Name: 'PLAYER 2',
  targetScore: 100,
  difficulty: 'normal',
  mirrorMode: true,
  soundEnabled: true,
}

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
  progress: number
  maxSpeed: number
  avgSpeed: number
}

export interface MatchResults {
  winnerIndex: 0 | 1
  winnerName: string
  durationMs: number
  players: [PlayerResult, PlayerResult]
}

export const PLAYER_COLORS = ['#00c3ff', '#ff2e63'] as const
