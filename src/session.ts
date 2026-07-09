/**
 * The host's CURRENT session (one party / one lesson): how many matches ran
 * and who is winning tonight. Lives in sessionStorage — survives a reload
 * mid-party, resets when the animator opens the app for the next group.
 */

const KEY = 'sb.session.v1'

export interface SessionStats {
  matches: number
  /** Wins per display name during this session. */
  wins: Record<string, number>
}

export function loadSession(): SessionStats {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SessionStats
      if (typeof parsed.matches === 'number' && parsed.wins) return parsed
    }
  } catch {
    /* unavailable or corrupt — start fresh */
  }
  return { matches: 0, wins: {} }
}

/** Record a finished match; `winners` holds 1 name (duel) or 2 (co-op team). */
export function recordSessionMatch(winners: string[]): void {
  const s = loadSession()
  s.matches++
  for (const name of winners) {
    if (name) s.wins[name] = (s.wins[name] ?? 0) + 1
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable — session stats are best-effort */
  }
}

/** Tonight's leader (most session wins), null while nobody has won. */
export function sessionLeader(s: SessionStats): { name: string; wins: number } | null {
  let best: { name: string; wins: number } | null = null
  for (const [name, wins] of Object.entries(s.wins)) {
    if (!best || wins > best.wins) best = { name, wins }
  }
  return best
}
