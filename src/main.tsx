import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RunnerGameScreen } from './components/RunnerGameScreen.tsx'
import { RunnerSpikeScreen } from './components/RunnerSpikeScreen.tsx'
import { ShowScreen } from './components/ShowScreen.tsx'
import { isShowPage } from './show.ts'

// #runner-spike → the gesture detection spike (lane/jump/crouch tuning tool).
// #runner-demo  → the runner game with an auto-player, no camera (attract/demo).
// #runner       → the single-player runner game itself.
const hash = window.location.hash
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
