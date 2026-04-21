import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// Initialise i18next early — must run before any component that uses
// useTranslation() is rendered.
import './i18n'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
