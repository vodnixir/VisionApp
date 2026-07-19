import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GroupMatchScreen } from './components/GroupMatchScreen.tsx'
import { OnlineBattleScreen } from './components/OnlineBattleScreen.tsx'
import { RunnerGameScreen } from './components/RunnerGameScreen.tsx'
import { RunnerSpikeScreen } from './components/RunnerSpikeScreen.tsx'
import { ShowScreen } from './components/ShowScreen.tsx'
import { isShowPage } from './show.ts'

// #runner-spike → the gesture detection spike (lane/jump/crouch tuning tool).
// #runner-demo  → the runner game with an auto-player, no camera (attract/demo).
// #runner       → the single-player runner game itself.
// #online       → the two-phone WebRTC battle (shared-seed runner race).
const hash = window.location.hash
const online = hash.startsWith('#online')
// #group → the 3–4 player free-for-all (classic scoring, each their own bar).
const group = hash.startsWith('#group')
// #online?j=<code> → opened from a shared invite link: prefill the guest flow.
const inviteMatch = hash.match(/[?&]j=([^&]+)/)
const invite = inviteMatch ? decodeURIComponent(inviteMatch[1]) : undefined
const runnerRoute = hash.startsWith('#runner-spike')
  ? 'spike'
  : hash.startsWith('#runner-demo')
    ? 'demo'
    : hash.startsWith('#runner')
      ? 'game'
      : null

// #show → this instance is the TV side (Chromecast receiver or the fallback
// second window): no camera, no menus — just the arena picture / scoreboard.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isShowPage() ? (
      <ShowScreen />
    ) : online ? (
      <OnlineBattleScreen initialInvite={invite} />
    ) : group ? (
      <GroupMatchScreen />
    ) : runnerRoute === 'spike' ? (
      <RunnerSpikeScreen />
    ) : runnerRoute === 'demo' ? (
      <RunnerGameScreen demo />
    ) : runnerRoute === 'game' ? (
      <RunnerGameScreen />
    ) : (
      <App />
    )}
  </StrictMode>,
)
