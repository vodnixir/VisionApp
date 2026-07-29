/**
 * Ensures the app can rotate freely, on every platform it runs on.
 *
 * Android already ships unlocked: AndroidManifest.xml sets no
 * `android:screenOrientation` on the activity (so it follows the device's own
 * rotation/auto-rotate setting) and `android:configChanges` keeps the WebView
 * alive across a rotation instead of restarting the activity and losing game
 * state. This call is what makes that explicit and future-proof — if a lock
 * ever gets added back to the manifest, or a future OEM WebView defaults to
 * locking, this still unlocks it at runtime — and it's what covers plain
 * browsers that expose the Screen Orientation API (desktop Chrome, most
 * Android WebViews) since the web build has no manifest at all.
 *
 * Failures are expected and silent: iOS Safari has no unlock() at all, and
 * most desktop browsers only allow it inside a fullscreen context. Neither
 * matters here — those platforms were never locked to begin with, so a failed
 * unlock() call changes nothing.
 */
export async function unlockOrientation(): Promise<void> {
  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation')
    await ScreenOrientation.unlock()
  } catch {
    /* not supported on this platform — rotation already works without it */
  }
}
