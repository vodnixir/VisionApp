import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_HUD } from '../cv/draw'
// Type-only imports keep the heavy TFJS chunk OUT of the menu bundle — the
// engine module is loaded on demand inside start() (and idle-prefetched).
import type { EngineConfig, EngineFrame, PoseEngine } from '../cv/engine'

export type EngineStatus = 'idle' | 'starting' | 'running' | 'error'

/**
 * Hard ceiling on how long "starting" may show. Camera permission prompts,
 * GPU backend probing and model loading are all normally well under this —
 * if it's not done by here, something is stuck, and a silent infinite
 * loading screen is worse than a wrong-but-visible error the player can act
 * on (retry, or go check camera permissions).
 */
const CAMERA_START_TIMEOUT_MS = 10000

/** Fire-and-forget warm-up of the engine chunk while the user reads the menu. */
export function prefetchEngine(): void {
  const idle =
    typeof requestIdleCallback === 'function'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 3000 })
      : (cb: () => void) => setTimeout(cb, 1500)
  idle(() => {
    void import('../cv/engine')
  })
}

/**
 * React lifecycle wrapper around PoseEngine.
 *
 * - The engine is created lazily inside start() (a user gesture), never in an
 *   effect — so React Strict Mode's double mount/unmount cycle can't double-open
 *   the webcam or double-load TensorFlow.
 * - Config changes go through a mutable ref (configure()), so the running rAF
 *   loops never need to be torn down on re-render.
 */
export function usePoseDetection(onFrame: (frame: EngineFrame) => void) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PoseEngine | null>(null)
  const configRef = useRef<EngineConfig>({
    mirror: true,
    names: ['PLAYER 1', 'PLAYER 2'],
    scoring: false,
    drawOverlays: true,
    rolesLocked: false,
    hud: { ...DEFAULT_HUD },
    mask: false,
  })
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  const [status, setStatus] = useState<EngineStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async (cameraId?: string | null) => {
    console.log('[Camera] Mounting stream, cameraId:', cameraId ?? '(default)')
    if (engineRef.current) {
      console.warn('[Camera] start() called while an engine is already active — ignoring.')
      return
    }
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) {
      console.error('[Camera] Initialization failed: video/canvas ref not mounted yet', {
        video: !!video,
        canvas: !!canvas,
      })
      return
    }

    setStatus('starting')
    setError(null)

    let EngineClass: typeof PoseEngine
    try {
      EngineClass = (await import('../cv/engine')).PoseEngine
    } catch (err) {
      console.error('[Camera] Initialization failed: could not load the vision engine module', err)
      setStatus('error')
      setError('Could not load the vision engine. Check the connection and retry.')
      return
    }

    const engine = new EngineClass(
      video,
      canvas,
      () => configRef.current,
      (frame) => onFrameRef.current(frame),
      // Mid-game fatalities (camera unplugged, GPU pipeline dead) surface as
      // the regular error overlay instead of a silent freeze.
      (message) => {
        if (engineRef.current !== engine) return
        engine.destroy()
        engineRef.current = null
        setStatus('error')
        setError(message)
      },
    )
    engineRef.current = engine
    try {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Camera took too long to start. Check camera permissions and try again.')),
          CAMERA_START_TIMEOUT_MS,
        )
      })
      try {
        await Promise.race([engine.start(cameraId), timeout])
      } finally {
        clearTimeout(timeoutId)
      }
      if (engineRef.current !== engine) {
        console.warn('[Camera] Engine destroyed while booting — discarding this start() result.')
        return
      }
      console.log('[Camera] Stream active. Video resolution:', video.videoWidth, 'x', video.videoHeight)
      setStatus('running')
    } catch (err) {
      console.error('[Camera] Initialization failed:', err)
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to start the camera engine.')
    }
  }, [])

  const stop = useCallback(() => {
    if (engineRef.current) console.log('[Camera] Stopping stream and tearing down engine.')
    engineRef.current?.destroy()
    engineRef.current = null
    setStatus('idle')
  }, [])

  /** Patch live engine config (mirror, names, scoring…) without restarting anything. */
  const configure = useCallback((patch: Partial<EngineConfig>) => {
    Object.assign(configRef.current, patch)
  }, [])

  // Teardown on unmount (Strict Mode safe: the engine only exists after a click).
  useEffect(() => {
    return () => {
      engineRef.current?.destroy()
      engineRef.current = null
    }
  }, [])

  return { videoRef, canvasRef, status, error, start, stop, configure }
}
