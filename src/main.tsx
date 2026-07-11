import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RunnerSpikeScreen } from './components/RunnerSpikeScreen.tsx'
import { ShowScreen } from './components/ShowScreen.tsx'
import { isShowPage } from './show.ts'

// #runner → the single-player runner detection spike (lane/jump/crouch tuning).
const isRunnerPage = window.location.hash.startsWith('#runner')

// #show → this instance is the TV side (Chromecast receiver or the fallback
// second window): no camera, no menus — just the arena picture / scoreboard.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isShowPage() ? <ShowScreen /> : isRunnerPage ? <RunnerSpikeScreen /> : <App />}
  </StrictMode>,
)
