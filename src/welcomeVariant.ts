import { useSyncExternalStore } from 'react'

/**
 * Temporary dev switch between the three welcome-screen redesign candidates
 * — lets the host compare all three live, on the actual phone, from a real
 * viewing distance, and pick one. Delete this module (and the losing
 * variants) once a direction is chosen.
 */
export type WelcomeVariant = 'camera' | 'scoreboard' | 'pictogram'

export const WELCOME_VARIANTS: WelcomeVariant[] = ['camera', 'scoreboard', 'pictogram']

const STORAGE_KEY = 'sb.welcomeVariant'
const DEFAULT_VARIANT: WelcomeVariant = 'camera'

function isVariant(v: unknown): v is WelcomeVariant {
  return v === 'camera' || v === 'scoreboard' || v === 'pictogram'
}

function detect(): WelcomeVariant {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('welcome')
    if (isVariant(fromQuery)) return fromQuery
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isVariant(saved)) return saved
  } catch {
    /* storage/URL unavailable */
  }
  return DEFAULT_VARIANT
}

let current: WelcomeVariant = detect()
const listeners = new Set<() => void>()

export function getWelcomeVariant(): WelcomeVariant {
  return current
}

export function setWelcomeVariant(v: WelcomeVariant): void {
  if (v === current) return
  current = v
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn())
}

export function cycleWelcomeVariant(): void {
  const i = WELCOME_VARIANTS.indexOf(current)
  setWelcomeVariant(WELCOME_VARIANTS[(i + 1) % WELCOME_VARIANTS.length])
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useWelcomeVariant() {
  const variant = useSyncExternalStore(subscribe, getWelcomeVariant)
  return { variant, setWelcomeVariant, cycleWelcomeVariant }
}
