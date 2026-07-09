/**
 * Pro / "Host" tier boundaries — WHAT is premium is decided here, but billing
 * is not wired yet: PRO_UNLOCKED keeps everything free until IAP lands.
 * Monetization principle (PLAN.md §3): the paying side is the adult host;
 * kids' core duel, handicap and privacy features stay free forever.
 */
import type { MatchMode } from './types'

/** TODO(billing): replace with the real entitlement check (Play Billing). */
export const PRO_UNLOCKED = true

/** Modes beyond the free trio (classic / rhythm / endurance) are Pro. */
export const PRO_MODES: readonly MatchMode[] = ['traffic', 'boss']

/** Free tournaments cap at this many entrants; 9–16 is Pro. */
export const FREE_BRACKET_MAX = 8

export function isProMode(mode: MatchMode): boolean {
  return PRO_MODES.includes(mode)
}

/** Can the host actually use this mode right now? */
export function modeUnlocked(mode: MatchMode): boolean {
  return PRO_UNLOCKED || !isProMode(mode)
}

export function bracketSizeUnlocked(entrants: number): boolean {
  return PRO_UNLOCKED || entrants <= FREE_BRACKET_MAX
}
