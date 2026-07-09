import { useReducer } from 'react'
import { loadLastPlayers, loadSettingsPatch } from '../storage'
import {
  DEFAULT_SETTINGS,
  type CalibrationPhase,
  type GamePhase,
  type GameSettings,
  type MatchResults,
  type PlayerSlot,
} from '../types'

export interface GameMachineState {
  phase: GamePhase
  /** Only meaningful while phase === 'CALIBRATION'. */
  calibrationPhase: CalibrationPhase
  /** 3 → 2 → 1 while counting down, null otherwise. */
  countdown: number | null
  settings: GameSettings
  results: MatchResults | null
  matchStartedAt: number | null
}

export type GameAction =
  | { type: 'NAVIGATE'; to: 'HOME' | 'ROSTER' | 'MATCH_SETUP' | 'TOURNAMENT' }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<GameSettings> }
  | { type: 'SET_PLAYER'; index: 0 | 1; slot: PlayerSlot }
  | { type: 'START_CALIBRATION' }
  | { type: 'SET_CALIBRATION_PHASE'; value: CalibrationPhase }
  | { type: 'COUNTDOWN_TICK'; value: number }
  | { type: 'MATCH_START'; at: number }
  | { type: 'MATCH_END'; results: MatchResults }
  | { type: 'REMATCH' }

const MENU_PHASES: readonly GamePhase[] = ['HOME', 'ROSTER', 'MATCH_SETUP', 'TOURNAMENT', 'GAME_OVER']

function initialState(): GameMachineState {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, ...loadSettingsPatch() }
  const lastPlayers = loadLastPlayers()
  if (lastPlayers) settings.players = lastPlayers
  return {
    phase: 'HOME',
    calibrationPhase: 'SEARCHING',
    countdown: null,
    settings,
    results: null,
    matchStartedAt: null,
  }
}

function reducer(state: GameMachineState, action: GameAction): GameMachineState {
  switch (action.type) {
    case 'NAVIGATE':
      // Menu-to-menu moves only; the arena exits through GAME_OVER or the error overlay.
      if (!MENU_PHASES.includes(state.phase) && state.phase !== 'CALIBRATION') return state
      return {
        ...state,
        phase: action.to,
        calibrationPhase: 'SEARCHING',
        countdown: null,
        results: null,
        matchStartedAt: null,
      }

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } }

    case 'SET_PLAYER': {
      const players = [...state.settings.players] as [PlayerSlot, PlayerSlot]
      players[action.index] = action.slot
      // The same roster profile can't play both sides — demote the other slot to guest.
      const other = action.index === 0 ? 1 : 0
      if (
        action.slot.profileId !== null &&
        players[other].profileId === action.slot.profileId
      ) {
        players[other] = { profileId: null, name: '' }
      }
      return { ...state, settings: { ...state.settings, players } }
    }

    case 'START_CALIBRATION':
      if (state.phase !== 'MATCH_SETUP' && state.phase !== 'TOURNAMENT') return state
      return {
        ...state,
        phase: 'CALIBRATION',
        calibrationPhase: 'SEARCHING',
        countdown: null,
        results: null,
        matchStartedAt: null,
      }

    case 'SET_CALIBRATION_PHASE':
      if (state.phase !== 'CALIBRATION') return state
      return {
        ...state,
        calibrationPhase: action.value,
        countdown: action.value === 'COUNTDOWN' ? 3 : null,
      }

    case 'COUNTDOWN_TICK':
      if (state.phase !== 'CALIBRATION' || state.calibrationPhase !== 'COUNTDOWN') return state
      return { ...state, countdown: action.value }

    case 'MATCH_START':
      if (state.phase !== 'CALIBRATION') return state
      return { ...state, phase: 'PLAYING', countdown: null, matchStartedAt: action.at }

    case 'MATCH_END':
      if (state.phase !== 'PLAYING') return state
      return { ...state, phase: 'GAME_OVER', results: action.results }

    case 'REMATCH':
      if (state.phase !== 'GAME_OVER') return state
      return {
        ...state,
        phase: 'CALIBRATION',
        calibrationPhase: 'SEARCHING',
        countdown: null,
        results: null,
        matchStartedAt: null,
      }

    default:
      return state
  }
}

export function useGameState() {
  return useReducer(reducer, undefined, initialState)
}
