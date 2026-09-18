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

// Pages are code-split (see App.tsx).  An update rebuilds dist/ and deletes
// the previous chunk files, so a tab opened before the update fails to fetch
// any page it had not visited yet.  Reload to pick up the new index.html; the
// timestamp guard stops a reload loop when a chunk is genuinely missing.
window.addEventListener('vite:preloadError', () => {
  const key = 'arkmaniagest.chunkReloadAt'
  try {
    if (Date.now() - (Number(window.sessionStorage.getItem(key)) || 0) < 10_000) return
    window.sessionStorage.setItem(key, String(Date.now()))
  } catch {
    return
  }
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
