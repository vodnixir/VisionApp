import { useReducer } from 'react'
import {
  DEFAULT_SETTINGS,
  type CalibrationPhase,
  type GamePhase,
  type GameSettings,
  type MatchResults,
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
  | { type: 'UPDATE_SETTINGS'; patch: Partial<GameSettings> }
  | { type: 'START_CALIBRATION' }
  | { type: 'SET_CALIBRATION_PHASE'; value: CalibrationPhase }
  | { type: 'COUNTDOWN_TICK'; value: number }
  | { type: 'MATCH_START'; at: number }
  | { type: 'MATCH_END'; results: MatchResults }
  | { type: 'REMATCH' }
  | { type: 'BACK_TO_SETUP' }

const initialState: GameMachineState = {
  phase: 'SETUP',
  calibrationPhase: 'SEARCHING',
  countdown: null,
  settings: DEFAULT_SETTINGS,
  results: null,
  matchStartedAt: null,
}

function reducer(state: GameMachineState, action: GameAction): GameMachineState {
  switch (action.type) {
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } }

    case 'START_CALIBRATION':
      if (state.phase !== 'SETUP') return state
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

    case 'BACK_TO_SETUP':
      return { ...initialState, settings: state.settings }

    default:
      return state
  }
}

export function useGameState() {
  return useReducer(reducer, initialState)
}
