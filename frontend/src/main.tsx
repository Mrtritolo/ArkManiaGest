import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// Initialise i18next early — must run before any component that uses
// useTranslation() is rendered.
import './i18n'
// Apply the persisted theme BEFORE React paints, so the first frame
// already has the correct palette (no flash of the opposite theme).
import { initTheme } from './theme'
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
