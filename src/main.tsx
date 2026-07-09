import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ShowScreen } from './components/ShowScreen.tsx'
import { isShowPage } from './show.ts'

// #show → this instance is the TV side (Chromecast receiver or the fallback
// second window): no camera, no menus — just the arena picture / scoreboard.
createRoot(document.getElementById('root')!).render(
  <StrictMode>{isShowPage() ? <ShowScreen /> : <App />}</StrictMode>,
)
