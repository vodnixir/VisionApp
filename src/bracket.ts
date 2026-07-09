import type { PlayerSlot } from './types'

/**
 * Single-elimination bracket. 3–16 entrants; the bracket is the smallest power
 * of two that fits, missing slots become byes (auto-advance). Seeding order is
 * the order the host picked the kids — predictable at a party.
 */

export interface BracketMatch {
  /** A side is null while undecided (feeder not played) or empty (bye branch). */
  players: [PlayerSlot | null, PlayerSlot | null]
  winner: 0 | 1 | null
}

export interface Tournament {
  size: number
  rounds: BracketMatch[][]
  createdAt: number
}

export const MIN_ENTRANTS = 3
export const MAX_ENTRANTS = 16

export function createTournament(entrants: PlayerSlot[]): Tournament {
  const size = Math.max(4, 2 ** Math.ceil(Math.log2(entrants.length)))
  const roundsCount = Math.log2(size)
  const rounds: BracketMatch[][] = []
  for (let r = 0; r < roundsCount; r++) {
    const matches = size / 2 ** (r + 1)
    rounds.push(
      Array.from({ length: matches }, (): BracketMatch => ({ players: [null, null], winner: null })),
    )
  }
  // At most ONE bye per first-round match (top seeds get them), so nobody can
  // skip two rounds: entrant count is always > size/2, hence byes ≤ size/2.
  let byes = size - entrants.length
  let e = 0
  for (const match of rounds[0]) {
    match.players[0] = entrants[e++] ?? null
    if (byes > 0) {
      byes--
    } else {
      match.players[1] = entrants[e++] ?? null
    }
  }
  const tournament: Tournament = { size, rounds, createdAt: Date.now() }
  resolveByes(tournament)
  return tournament
}

/** Is this side's feeder decided (round 0 seeds always are)? */
function slotFinal(t: Tournament, round: number, index: number, side: 0 | 1): boolean {
  if (round === 0) return true
  return t.rounds[round - 1][index * 2 + side].winner !== null
}

function advance(t: Tournament, round: number, index: number, side: 0 | 1): void {
  const match = t.rounds[round][index]
  match.winner = side
  if (round + 1 < t.rounds.length) {
    t.rounds[round + 1][Math.floor(index / 2)].players[index % 2] = match.players[side]
  }
}

/** Auto-resolve matches that have at most one real player once both feeders are decided. */
function resolveByes(t: Tournament): void {
  let changed = true
  while (changed) {
    changed = false
    for (let r = 0; r < t.rounds.length; r++) {
      for (let i = 0; i < t.rounds[r].length; i++) {
        const m = t.rounds[r][i]
        if (m.winner !== null) continue
        if (!slotFinal(t, r, i, 0) || !slotFinal(t, r, i, 1)) continue
        const [a, b] = m.players
        if (a && b) continue // a real match — the kids play it
        advance(t, r, i, a ? 0 : b ? 1 : 0)
        changed = true
      }
    }
  }
}

/** The next playable match (both sides real, no winner yet), in bracket order. */
export function nextMatch(t: Tournament): { round: number; index: number } | null {
  for (let r = 0; r < t.rounds.length; r++) {
    for (let i = 0; i < t.rounds[r].length; i++) {
      const m = t.rounds[r][i]
      if (m.winner === null && m.players[0] && m.players[1]) return { round: r, index: i }
    }
  }
  return null
}

/** Record a played match's winner; returns a new Tournament (input untouched). */
export function reportWinner(
  t: Tournament,
  round: number,
  index: number,
  side: 0 | 1,
): Tournament {
  const next: Tournament = structuredClone(t)
  advance(next, round, index, side)
  resolveByes(next)
  return next
}

export function champion(t: Tournament): PlayerSlot | null {
  const final = t.rounds[t.rounds.length - 1][0]
  return final.winner === null ? null : final.players[final.winner]
}
