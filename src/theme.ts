import { useSyncExternalStore } from 'react'

/**
 * Three visual identities, one component tree:
 *  - neon:  the original arcade cyberpunk (Orbitron, glows, arena grid)
 *  - dark:  graphite minimal (near-black, lime accent, no glow)
 *  - light: paper minimal (warm white, lime accent) — the default
 *
 * DOM styling flows through CSS variables under [data-theme] (see index.css).
 * Everything painted on <canvas> (HUD, TV scoreboard, clip wordmark) reads the
 * CanvasTheme spec below at draw time, so a switch applies live everywhere.
 */
export type ThemeId = 'neon' | 'dark' | 'light'

export const THEME_IDS: ThemeId[] = ['light', 'dark', 'neon']

export interface CanvasTheme {
  /** Canvas font stack (Orbitron for neon, system for the rest). */
  font: string
  /** Neon glows + colored accents on the canvas HUD. */
  glow: boolean
  /** Frosted HUD panel / timer chip fill. */
  panelBg: string
  /** Primary text on panels. */
  ink: string
  /** Secondary text (victory splash labels). */
  inkMuted: string
  /** Progress bar track on panels. */
  trackBg: string
  /** Soft halo behind free-floating text for readability over video. */
  halo: string
  /** Victory splash backdrop. */
  scrim: string
  /** Timer color in the last seconds / overtime. */
  urgent: string
  /** Center banners (OVERTIME / STOP / GO / FREEZE). White in minimal themes. */
  banner: { ot: string; stop: string; go: string; freeze: string }
  /** Face-mask disc fill. */
  maskBg: string
  /** Player identity ON the canvas (over live video). */
  players: readonly [string, string]
  /** Player identity on themed DOM surfaces (menus, results). */
  playersUI: readonly [string, string]
  /** TV scoreboard: background (two stops = vertical gradient) and text. */
  board: { bg: [string, string]; ink: string; muted: string; vs: string }
}

const SYSTEM_FONT = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif"
const NEON_FONT = `Orbitron, ${SYSTEM_FONT}`

const CANVAS_THEMES: Record<ThemeId, CanvasTheme> = {
  light: {
    font: SYSTEM_FONT,
    glow: false,
    panelBg: 'rgba(255, 255, 255, 0.92)',
    ink: '#18181b',
    inkMuted: 'rgba(24, 24, 27, 0.55)',
    trackBg: 'rgba(24, 24, 27, 0.1)',
    halo: 'rgba(0, 0, 0, 0.45)',
    scrim: 'rgba(247, 247, 245, 0.82)',
    urgent: '#dc2626',
    banner: { ot: '#ffffff', stop: '#ffffff', go: '#ffffff', freeze: '#ffffff' },
    maskBg: '#fafafa',
    players: ['#3b82f6', '#ef4444'],
    playersUI: ['#2563eb', '#dc2626'],
    board: {
      bg: ['#f7f7f5', '#f7f7f5'],
      ink: '#18181b',
      muted: 'rgba(24,24,27,0.5)',
      vs: 'rgba(24,24,27,0.35)',
    },
  },
  dark: {
    font: SYSTEM_FONT,
    glow: false,
    panelBg: 'rgba(12, 12, 12, 0.78)',
    ink: '#fafafa',
    inkMuted: 'rgba(255, 255, 255, 0.55)',
    trackBg: 'rgba(255, 255, 255, 0.15)',
    halo: 'rgba(0, 0, 0, 0.5)',
    scrim: 'rgba(10, 10, 10, 0.8)',
    urgent: '#f87171',
    banner: { ot: '#ffffff', stop: '#ffffff', go: '#ffffff', freeze: '#ffffff' },
    maskBg: '#1a1a1a',
    players: ['#3b82f6', '#ef4444'],
    playersUI: ['#60a5fa', '#f87171'],
    board: {
      bg: ['#0a0a0a', '#0a0a0a'],
      ink: '#fafafa',
      muted: 'rgba(255,255,255,0.5)',
      vs: 'rgba(255,255,255,0.35)',
    },
  },
  neon: {
    font: NEON_FONT,
    glow: true,
    panelBg: 'rgba(5, 8, 18, 0.66)',
    ink: '#ffffff',
    inkMuted: 'rgba(255, 255, 255, 0.85)',
    trackBg: 'rgba(255, 255, 255, 0.13)',
    halo: 'rgba(0, 0, 0, 0.45)',
    scrim: 'rgba(3, 4, 10, 0.55)',
    urgent: '#ffe600',
    banner: { ot: '#ffe600', stop: '#ff2e63', go: '#39ff88', freeze: '#aef1ff' },
    maskBg: '#0b1020',
    players: ['#00c3ff', '#ff2e63'],
    playersUI: ['#00c3ff', '#ff2e63'],
    board: {
      bg: ['#0b1226', '#05060f'],
      ink: '#ffffff',
      muted: 'rgba(255,255,255,0.55)',
      vs: 'rgba(255,255,255,0.35)',
    },
  },
}

const THEME_STORAGE_KEY = 'sb.theme'
const DEFAULT_THEME: ThemeId = 'light'

function isThemeId(v: unknown): v is ThemeId {
  return v === 'neon' || v === 'dark' || v === 'light'
}

function detectTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeId(saved)) return saved
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME
}

let currentTheme: ThemeId = detectTheme()
const listeners = new Set<() => void>()

function apply(id: ThemeId): void {
  // Guard so the module is import-safe in a non-DOM context (the Node test
  // harness pulls this in transitively via recorder.ts → theme.ts).
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = id
}
apply(currentTheme)

export function getTheme(): ThemeId {
  return currentTheme
}

/** The canvas-side palette of the active theme (read at draw time — live). */
export function canvasTheme(): CanvasTheme {
  return CANVAS_THEMES[currentTheme]
}

export function playerColors(): readonly [string, string] {
  return CANVAS_THEMES[currentTheme].players
}

export function playerColorsUI(): readonly [string, string] {
  return CANVAS_THEMES[currentTheme].playersUI
}

/**
 * Switch the theme. persist=false is for the TV receiver, which mirrors the
 * host's choice from cast state messages without adopting it as its own.
 */
export function setTheme(id: ThemeId, opts?: { persist?: boolean }): void {
  if (id === currentTheme) return
  currentTheme = id
  apply(id)
  if (opts?.persist !== false) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id)
    } catch {
      /* storage unavailable */
    }
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React binding: re-renders the component when the theme changes. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme)
  return { theme, setTheme }
}
