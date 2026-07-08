import { useCallback, useEffect, useRef, useState } from 'react'
import { PoseEngine, type EngineConfig, type EngineFrame } from '../cv/engine'

export type EngineStatus = 'idle' | 'starting' | 'running' | 'error'

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
  })
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  const [status, setStatus] = useState<EngineStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    if (engineRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const engine = new PoseEngine(
      video,
      canvas,
      () => configRef.current,
      (frame) => onFrameRef.current(frame),
    )
    engineRef.current = engine
    setStatus('starting')
    setError(null)
    try {
      await engine.start()
      if (engineRef.current !== engine) return // destroyed while booting
      setStatus('running')
    } catch (err) {
      engine.destroy()
      if (engineRef.current === engine) engineRef.current = null
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to start the camera engine.')
    }
  }, [])

  const stop = useCallback(() => {
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
