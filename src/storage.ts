import type { Tournament } from './bracket'
import type { GameSettings, PlayerProfile, PlayerSlot } from './types'

/**
 * All persistence is local (localStorage) by design: kids' data never leaves
 * the device (COPPA/GDPR-K), and the app must work fully offline at a party.
 */
const KEY = 'sb.v1'

export const MAX_PROFILES = 24

interface PersistedState {
  profiles?: PlayerProfile[]
  settings?: Partial<GameSettings>
  lastPlayers?: [PlayerSlot, PlayerSlot]
  tournament?: Tournament | null
}

/**
 * Single-tab app → the parsed state is cached in memory: reads never touch
 * JSON.parse twice, and writes are debounced so typing a name doesn't
 * stringify the whole store on every keystroke. flush() runs on pagehide /
 * hidden so backgrounding the app never loses the last change.
 */
let cache: PersistedState | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function read(): PersistedState {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    cache = typeof parsed === 'object' && parsed !== null ? (parsed as PersistedState) : {}
  } catch {
    cache = {}
  }
  return cache
}

function write(patch: Partial<PersistedState>): void {
  cache = { ...read(), ...patch }
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, 250)
  }
}

export function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (cache === null) return
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* quota / private mode — the game still works, just without persistence */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

/* ---------------- Profiles (roster) ---------------- */

export function loadProfiles(): PlayerProfile[] {
  const profiles = read().profiles
  if (!Array.isArray(profiles)) return []
  return profiles.filter(
    (p): p is PlayerProfile =>
      typeof p === 'object' &&
      p !== null &&
      typeof p.id === 'string' &&
      typeof p.name === 'string' &&
      typeof p.wins === 'number' &&
      typeof p.matches === 'number',
  )
}

export function saveProfiles(profiles: PlayerProfile[]): void {
  write({ profiles: profiles.slice(0, MAX_PROFILES) })
}

export function createProfile(name: string): PlayerProfile {
  return {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    wins: 0,
    matches: 0,
    bestSpeed: 0,
    createdAt: Date.now(),
  }
}

export interface MatchResultEntry {
  profileId: string | null
  won: boolean
  /** Peak smoothed activity this match, 0..1. */
  maxSpeed: number
}

/** Apply a finished match to the roster: wins, match count, personal speed record. */
export function recordMatchResult(entries: MatchResultEntry[]): void {
  const profiles = loadProfiles()
  let changed = false
  for (const entry of entries) {
    if (!entry.profileId) continue
    const p = profiles.find((x) => x.id === entry.profileId)
    if (!p) continue
    if (entry.won) p.wins += 1
    p.matches += 1
    if (entry.maxSpeed > (p.bestSpeed ?? 0)) p.bestSpeed = entry.maxSpeed
    changed = true
  }
  if (changed) saveProfiles(profiles)
}

/* ---------------- Settings ---------------- */

export function loadSettingsPatch(): Partial<GameSettings> {
  const s = read().settings
  return typeof s === 'object' && s !== null ? s : {}
}

export function saveSettings(settings: GameSettings): void {
  write({ settings })
}

/* ---------------- Active tournament ---------------- */

export function loadTournament(): Tournament | null {
  const t = read().tournament
  if (!t || typeof t !== 'object' || !Array.isArray(t.rounds)) return null
  return t
}

export function saveTournament(tournament: Tournament | null): void {
  write({ tournament })
}

/* ---------------- Last selected players ---------------- */

export function loadLastPlayers(): [PlayerSlot, PlayerSlot] | null {
  const last = read().lastPlayers
  if (!Array.isArray(last) || last.length !== 2) return null
  const ok = last.every(
    (s) => typeof s === 'object' && s !== null && typeof s.name === 'string',
  )
  return ok ? (last as [PlayerSlot, PlayerSlot]) : null
}

export function saveLastPlayers(players: [PlayerSlot, PlayerSlot]): void {
  write({ lastPlayers: players })
}
