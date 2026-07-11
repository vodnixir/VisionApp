import { useSyncExternalStore } from 'react'

/**
 * Interface layout — a second switchable axis, independent of the color theme.
 * The theme decides how things look; the layout decides where they sit. Home
 * renders a different arrangement per id; both compose freely (3 × 3).
 *
 *  - stack: the classic vertical list — a big primary CTA over stacked rows
 *  - grid:  compact tiles in a 2-column grid
 *  - hero:  one oversized primary action, secondary actions as an icon row
 *
 * Layout is DOM-only (menus), so unlike the theme it never touches the canvas.
 */
export type LayoutId = 'stack' | 'grid' | 'hero'

export const LAYOUT_IDS: LayoutId[] = ['stack', 'grid', 'hero']

const STORAGE_KEY = 'sb.layout'
const DEFAULT_LAYOUT: LayoutId = 'stack'

function isLayoutId(v: unknown): v is LayoutId {
  return v === 'stack' || v === 'grid' || v === 'hero'
}

function detectLayout(): LayoutId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLayoutId(saved)) return saved
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LAYOUT
}

let currentLayout: LayoutId = detectLayout()
const listeners = new Set<() => void>()

export function getLayout(): LayoutId {
  return currentLayout
}

export function setLayout(id: LayoutId): void {
  if (id === currentLayout) return
  currentLayout = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** React binding: re-renders the component when the layout changes. */
export function useLayout() {
  const layout = useSyncExternalStore(subscribe, getLayout)
  return { layout, setLayout }
}
