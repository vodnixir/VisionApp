import { useSyncExternalStore } from 'react'

/**
 * Optional extra identity guard for Speed Battle (2/3/4p): each player slot
 * only accepts bodies from its own screen zone (left half for P1, right half
 * for P2, thirds/quarters for 3p/4p). Makes a colour swap or a bystander
 * stealing a slot structurally impossible, at the cost of forbidding players
 * from crossing sides during a round — off by default since crossing is
 * normal party-game movement for most groups.
 */
const STORAGE_KEY = 'sb.strictSideLock'

function detectStrictSideLock(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let current = detectStrictSideLock()
const listeners = new Set<() => void>()

export function getStrictSideLock(): boolean {
  return current
}

export function setStrictSideLock(value: boolean): void {
  if (value === current) return
  current = value
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React binding: re-renders the component when the setting changes. */
export function useStrictSideLock() {
  const strictSideLock = useSyncExternalStore(subscribe, getStrictSideLock)
  return { strictSideLock, setStrictSideLock }
}
