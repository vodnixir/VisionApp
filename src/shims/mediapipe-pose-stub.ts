/**
 * Bundler stub for '@mediapipe/pose'.
 *
 * @tensorflow-models/pose-detection statically imports { Pose } from
 * '@mediapipe/pose' for its BlazePose-MediaPipe runtime, but that package ships
 * a UMD script with no ES named exports, which breaks Vite's production build.
 * This game only uses the MoveNet runtime, so the import is dead code — the
 * stub just satisfies the bundler. Anything accidentally touching it throws.
 */
export const Pose = new Proxy(function () {}, {
  construct(): never {
    throw new Error('@mediapipe/pose is stubbed out — only the MoveNet runtime is available.')
  },
}) as unknown
