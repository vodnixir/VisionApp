import type { I18nKey } from '../i18n'

/**
 * Runner play modes. Each maps to how many people the pose engine tracks this
 * session (its "maxPoses"): Solo=1, Duel=2, Squad=3. Every player runs their own
 * avatar on the SAME seeded obstacle stream (see mulberry32 in online/protocol),
 * so a race is fair — identical obstacles, different bodies.
 */
export type RunnerMode = 'solo' | 'duel' | 'squad'

export interface RunnerModeSpec {
  id: RunnerMode
  /** People tracked = engine maxPlayers = avatars on screen. */
  players: number
  emoji: string
  labelKey: I18nKey
  hintKey: I18nKey
}

export const RUNNER_MODES: RunnerModeSpec[] = [
  { id: 'solo', players: 1, emoji: '🏃', labelKey: 'runner.mode.solo', hintKey: 'runner.mode.soloHint' },
  { id: 'duel', players: 2, emoji: '⚔️', labelKey: 'runner.mode.duel', hintKey: 'runner.mode.duelHint' },
  { id: 'squad', players: 3, emoji: '👥', labelKey: 'runner.mode.squad', hintKey: 'runner.mode.squadHint' },
]

export function runnerModeSpec(mode: RunnerMode): RunnerModeSpec {
  return RUNNER_MODES.find((m) => m.id === mode) ?? RUNNER_MODES[0]
}
