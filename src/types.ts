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

/**
 * Game modes (how movement turns into progress). Round length (RoundMode)
 * composes with any of them.
 */
export type MatchMode = 'classic' | 'rhythm' | 'endurance' | 'traffic' | 'boss'

export const MATCH_MODES: MatchMode[] = ['classic', 'rhythm', 'endurance', 'traffic', 'boss']

/* ---------------- Overtime (near-tie at the buzzer) ---------------- */

/** Bars closer than this (percent) when time runs out → overtime. */
export const OVERTIME_TIE_EPS = 1.5
/** Sudden death: first player to gain this much over their buzzer score wins. */
export const OVERTIME_DELTA = 5
/** Safety cap — if nobody scores the delta, the higher bar takes it. */
export const OVERTIME_MAX_MS = 20_000

/** True when the buzzer result is too close to call fairly. */
export function isOvertimeTie(p0: number, p1: number): boolean {
  return Math.abs(p0 - p1) < OVERTIME_TIE_EPS
}

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
  /** How movement scores: classic race, rhythm, endurance, traffic light, co-op boss. */
  matchMode: MatchMode
  /** Head start per player (bar percent, 0..30). */
  handicap: [number, number]
  /** Progress needed to win (percent). */
  targetScore: number
  /** Random "freeze!" windows during the round: moving DRAINS your bar. */
  freezeMode: boolean
  /** Streak multipliers (up to ×2) for CONTINUOUS movement. */
  comboMode: boolean
  /** Flip the canvas horizontally (natural for players watching themselves on a TV). */
  mirrorMode: boolean
  /** Chosen camera deviceId; null = default front camera. */
  cameraId: string | null
  /** Draw fun masks over the kids' faces (privacy for shared clips). */
  maskMode: boolean
  soundEnabled: boolean
}

export const DEFAULT_SETTINGS: GameSettings = {
  players: [
    { profileId: null, name: '' },
    { profileId: null, name: '' },
  ],
  roundMode: 'fight',
  matchMode: 'classic',
  handicap: [0, 0],
  targetScore: 100,
  freezeMode: false,
  comboMode: true,
  mirrorMode: true,
  cameraId: null,
  maskMode: false,
  soundEnabled: true,
}

/**
 * Sensible mirror default for a camera: a front camera behaves like a mirror
 * (flip ON feels natural), a rear/external camera does not — flipping it makes
 * every movement look reversed on the TV.
 */
export function mirrorDefaultForLabel(label: string): boolean {
  return !/back|rear|environment|trase|world|задн|тыл/i.test(label)
}

/** One "freeze!" window lasts this long. */
export const FREEZE_WINDOW_MS = 3000

/* ---------------- Combo (reward for CONTINUOUS movement) ---------------- */

/** Smoothed activity (0..1) that counts as "still moving" for the streak. */
export const COMBO_SPEED_MIN = 0.45
/** Dips below the threshold shorter than this don't break the streak. */
export const COMBO_GRACE_MS = 600
/** Streak tiers: keep moving this long → fill-rate multiplier. */
export const COMBO_TIERS = [
  { atMs: 3_000, mult: 1.25 },
  { atMs: 6_000, mult: 1.5 },
  { atMs: 10_000, mult: 2 },
] as const

/** Fill multiplier for an unbroken movement streak of the given length. */
export function comboMultiplier(streakMs: number): number {
  let mult = 1
  for (const tier of COMBO_TIERS) if (streakMs >= tier.atMs) mult = tier.mult
  return mult
}

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
  { key: 'white', minWins: 0, color: '#ffffff' },
  { key: 'yellow', minWins: 2, color: '#eab308' },
  { key: 'orange', minWins: 5, color: '#f97316' },
  { key: 'green', minWins: 9, color: '#22c55e' },
  { key: 'blue', minWins: 14, color: '#3b82f6' },
  { key: 'red', minWins: 20, color: '#ef4444' },
  { key: 'black', minWins: 30, color: '#18181b' },
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
  /** Highest combo multiplier reached (1 = never comboed / mode off). */
  maxCombo: number
}

export interface MatchResults {
  winnerIndex: 0 | 1
  winnerName: string
  durationMs: number
  roundMode: RoundMode
  matchMode: MatchMode
  /** True when the clock ran out (winner decided by higher bar). */
  endedByTimer: boolean
  players: [PlayerResult, PlayerResult]
}

/** Player identity on the CANVAS (over live video) — bright enough to read on any footage. */
export const PLAYER_COLORS = ['#3b82f6', '#ef4444'] as const

/** Player identity on LIGHT surfaces (menus, results) — one step deeper for contrast on white. */
export const PLAYER_COLORS_UI = ['#2563eb', '#dc2626'] as const
