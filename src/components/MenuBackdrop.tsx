/**
 * Immersive party/club backdrop for the menu screens: a looping background
 * video under a theme-aware scrim, with two slow-drifting neon glows on top.
 *
 * The scrim tints toward the active theme's page colour (see --menu-scrim in
 * index.css), so text contrast holds up in light, dark and neon alike — the
 * video peeks through most in neon and stays a subtle wash in light.
 *
 * The video source is a PLACEHOLDER. Drop a short, silent, looping clip at the
 * path below (public/video/) to bring the club to life; until then the glows
 * carry the vibe on their own and a missing file degrades gracefully to the
 * scrim + glows with no broken-poster flash.
 */

// Placeholder — replace with a real looping club/party clip in public/video/.
const PLACEHOLDER_VIDEO = '/video/club-loop.mp4'

export function MenuBackdrop() {
  return (
    <div className="menu-backdrop" aria-hidden>
      <video
        className="menu-backdrop-video"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        // A load failure leaves the element transparent — the scrim/glows cover it.
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      >
        <source src={PLACEHOLDER_VIDEO} type="video/mp4" />
      </video>
      <div className="menu-backdrop-scrim" />
      <div className="menu-backdrop-glow menu-backdrop-glow-a" />
      <div className="menu-backdrop-glow menu-backdrop-glow-b" />
    </div>
  )
}
