import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './styles/pages.v8.css'   // ★ design v8 "Aragão" page-level overlay
import './styles/polish.v8.css'  // ★ microinterações, motion, a11y
import './styles/humanize.v8.css'  // ★ profundidade, surfaces, serif moments, brand voice
import './styles/humanize-strip.js'  // ★ remove emoji decorativo de headings/tabs

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register Service Worker (PWA) — com auto-update
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Quando há SW novo esperando, pede pra ativar imediatamente
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
    }).catch(() => {})

    // Quando SW novo assume controle, recarrega a página pra pegar bundle novo
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  })
}

