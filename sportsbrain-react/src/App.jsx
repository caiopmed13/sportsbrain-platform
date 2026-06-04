import { useEffect, useState, lazy, Suspense } from 'react'
import { useUIStore } from './store'
import { checkHealth } from './api/client'
import Sidebar, { PAGE_TITLES } from './components/Layout/Sidebar'
import TopBar from './components/Layout/TopBar'

// ─── C5: Onboarding Tour ─────────────────────────────────────────────────────
const TOUR_KEY = 'sb_onboarding_done_v1'
const TOUR_STEPS = [
  { icon:'🧠', title:'Bem-vindo ao SportsBrain PRO!', body:'Sua central de análise de apostas com IA. Vamos ver o que você pode fazer aqui em 4 passos rápidos.' },
  { icon:'🔒', title:'Jogos Garantidos', body:'A aba "Garantido" traz os picks do dia com confiança ≥60%, EV calculado e odds comparadas entre casas. Selecione picks e monte acumuladores com Kelly automático.' },
  { icon:'💰', title:'Banca & Performance', body:'Em "Performance" você registra sua banca, acompanha seu ROI por mercado e liga, e vê a calibração da confiança vs resultado real.' },
  { icon:'🔔', title:'Alertas & Configurações', body:'Configure alertas inteligentes para receber push notifications quando novos picks de alta confiança aparecerem. Em Configurações, ajuste sua banca, API key e modo compacto.' },
]

function OnboardingTour({ onDone }) {
  const [step, setStep] = useState(0)
  const cur = TOUR_STEPS[step]
  const isLast = step === TOUR_STEPS.length - 1

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9999,
      background:'rgba(0,0,0,.75)', backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center',
      padding:20,
    }}>
      <div style={{
        background:'var(--card-bg)', border:'1px solid rgba(59,130,246,.35)',
        borderRadius:16, padding:'28px 28px 22px',
        maxWidth:400, width:'100%',
        boxShadow:'0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(59,130,246,.15)',
        animation:'pageIn .25s ease',
      }}>
        {/* Progress dots */}
        <div style={{ display:'flex', gap:6, marginBottom:20, justifyContent:'center' }}>
          {TOUR_STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 8, height:8, borderRadius:4,
              background: i === step ? 'var(--blue)' : i < step ? 'rgba(34,212,160,.5)' : 'rgba(255,255,255,.12)',
              transition:'all .25s',
            }} />
          ))}
        </div>

        <div style={{ fontSize:40, textAlign:'center', marginBottom:12, lineHeight:1 }}>{cur.icon}</div>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:800, color:'var(--white)', textAlign:'center', marginBottom:10 }}>
          {cur.title}
        </div>
        <div style={{ fontSize:13, color:'var(--soft)', textAlign:'center', lineHeight:1.6, marginBottom:24 }}>
          {cur.body}
        </div>

        <div style={{ display:'flex', gap:8 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s-1)} style={{
              flex:1, fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
              padding:'9px', borderRadius:8, cursor:'pointer',
              background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.12)',
              color:'var(--soft)',
            }}>← Voltar</button>
          )}
          <button onClick={() => isLast ? onDone() : setStep(s => s+1)} style={{
            flex:2, fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
            padding:'9px', borderRadius:8, cursor:'pointer',
            background: isLast ? 'rgba(34,212,160,.2)' : 'rgba(59,130,246,.2)',
            border:`1px solid ${isLast ? 'rgba(34,212,160,.5)' : 'rgba(59,130,246,.5)'}`,
            color: isLast ? 'var(--green)' : 'var(--blue)',
          }}>{isLast ? '🚀 Começar!' : 'Próximo →'}</button>
        </div>

        <button onClick={onDone} style={{
          display:'block', margin:'12px auto 0', background:'none', border:'none',
          color:'var(--dim)', fontSize:11, cursor:'pointer',
        }}>Pular tour</button>
      </div>
    </div>
  )
}

// Lazy load de todas as páginas — melhora performance inicial
const Hub          = lazy(() => import('./pages/Hub'))
const Hoje         = lazy(() => import('./pages/Hoje'))
const Standings    = lazy(() => import('./pages/Standings'))
const Alerts       = lazy(() => import('./pages/Alerts'))
const BkProps      = lazy(() => import('./pages/BkProps'))
const FtProps      = lazy(() => import('./pages/FtProps'))
const Radar        = lazy(() => import('./pages/Radar'))
const Dashboard    = lazy(() => import('./pages/Dashboard'))
const Performance  = lazy(() => import('./pages/Performance'))
const Stats        = lazy(() => import('./pages/Stats'))
const Learn        = lazy(() => import('./pages/Learn'))
const Prints       = lazy(() => import('./pages/Prints'))
const Backup       = lazy(() => import('./pages/Backup'))
const Log          = lazy(() => import('./pages/Log'))
const ValueScanner = lazy(() => import('./pages/ValueScanner'))
const CLVTracker   = lazy(() => import('./pages/CLVTracker'))
const Analise365   = lazy(() => import('./pages/Analise365'))
const Garantido    = lazy(() => import('./pages/Garantido'))
const Settings     = lazy(() => import('./pages/Settings'))
const Banca365     = lazy(() => import('./pages/Banca365'))
const Boletim      = lazy(() => import('./pages/Boletim'))
const Palpites     = lazy(() => import('./pages/Palpites'))
const Arbitrage    = lazy(() => import('./pages/Arbitrage'))
const Middles      = lazy(() => import('./pages/Middles'))
const SteamRadar   = lazy(() => import('./pages/SteamRadar'))
const MarketRadar  = lazy(() => import('./pages/MarketRadar'))
const OddsCompare  = lazy(() => import('./pages/OddsCompare'))
const MLQuality    = lazy(() => import('./pages/MLQuality'))
const ShadowMonitor = lazy(() => import('./pages/ShadowMonitor'))
const BoostScanner = lazy(() => import('./pages/BoostScanner'))
const Aumentadas  = lazy(() => import('./pages/Aumentadas'))
const Bet365Matches = lazy(() => import('./pages/Bet365Matches'))
const Markets365   = lazy(() => import('./pages/Markets365'))
const Picks365     = lazy(() => import('./pages/Picks365'))
const Bet365Pro    = lazy(() => import('./pages/Bet365'))
const Analise      = lazy(() => import('./pages/Analise'))
const JogosStats   = lazy(() => import('./pages/JogosStats'))
const PerformancePro = lazy(() => import('./pages/PerformancePro'))
const Tipsters = lazy(() => import('./pages/Tipsters'))
const Combos = lazy(() => import('./pages/Combos'))
const Premium = lazy(() => import('./pages/Premium'))
import OnboardingLeigo from './components/ui/OnboardingLeigo'

const PAGE_MAP = {
  mktradar:  MarketRadar,
  hub:       Hub,
  hoje:      Hoje,
  standings: Standings,
  alerts:    Alerts,
  bkprops:   BkProps,
  ftprops:   FtProps,
  radar:     Radar,
  dash:      Dashboard,
  perf:      Performance,
  stats:     Stats,
  lrn:       Learn,
  prints:    Prints,
  bk:        Backup,
  log:       Log,
  value:     ValueScanner,
  clv:       CLVTracker,
  a365:      Analise365,
  garantido: Garantido,
  settings:  Settings,
  banca365:  Banca365,
  boletim:   Boletim,
  palpites:  Palpites,
  arb:       Arbitrage,
  mids:      Middles,
  steam:     SteamRadar,
  compare:   OddsCompare,
  mlq:       MLQuality,
  shadowmon: ShadowMonitor,
  boost:     BoostScanner,
  aument:    Aumentadas,
  bet365m:   Bet365Matches,
  markets365: Markets365,
  picks365:   Picks365,
  bet365pro:  Bet365Pro,
  analise:    Analise,
  jogosstats: JogosStats,
  perfpro:    PerformancePro,
  tipsters:   Tipsters,
  combos:     Combos,
  premium:    Premium,
}

function PageFallback() {
  return (
    <div className="loading-center">
      <div className="spinner" />
    </div>
  )
}

export default function App() {
  const { currentPage, setPage, setApiStatus } = useUIStore()
  const [showTour, setShowTour] = useState(() => !localStorage.getItem(TOUR_KEY))

  function dismissTour() {
    localStorage.setItem(TOUR_KEY, '1')
    setShowTour(false)
  }

  // Aplicar tema e modo compacto salvos na inicialização
  useEffect(() => {
    const saved = localStorage.getItem('sb_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : '')
    try {
      const settings = JSON.parse(localStorage.getItem('sb_settings_v1') || '{}')
      if (settings.compactMode) document.documentElement.setAttribute('data-compact', '')
    } catch {}
  }, [])

  // Listener de navegação via CustomEvent (Dashboard quick actions, etc.)
  useEffect(() => {
    function onSbNavigate(e) {
      const pageId = e.detail
      if (pageId && PAGE_MAP[pageId]) {
        setPage(pageId, PAGE_TITLES[pageId] || pageId)
      }
    }
    window.addEventListener('sb-navigate', onSbNavigate)
    return () => window.removeEventListener('sb-navigate', onSbNavigate)
  }, [])

  // Health check na inicialização
  useEffect(() => {
    setApiStatus('loading', 'Conectando...')
    checkHealth().then(({ ok, label }) => {
      setApiStatus(ok ? 'ok' : 'err', label)
    })
    // Re-check a cada 60s
    const interval = setInterval(() => {
      checkHealth().then(({ ok, label }) => setApiStatus(ok ? 'ok' : 'err', label))
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  function handleNavigate(pageId) {
    setPage(pageId, PAGE_TITLES[pageId] || pageId)
  }

  const PageComponent = PAGE_MAP[currentPage] || Hoje

  // Badge: count de picks +EV (≥3%) — atualiza a cada 60s
  const [picksEvCount, setPicksEvCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function fetchCount() {
      try {
        const r = await fetch('https://sportsbrain-api.sportsbrain-api.workers.dev/v1/bet365/markets/analyzed?minEdge=3', {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        })
        const j = await r.json()
        if (cancelled) return
        if (j.ok) setPicksEvCount(j.totalMarkets || 0)
      } catch {}
    }
    fetchCount()
    const id = setInterval(fetchCount, 60000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div className="app">
      <Sidebar onNavigate={handleNavigate} badges={{ nbPicksEV: picksEvCount }} />
      <div className="main">
        <TopBar />
        <div className="content">
          <Suspense fallback={<PageFallback />}>
            <PageComponent />
          </Suspense>
        </div>
      </div>
      {showTour && <OnboardingTour onDone={dismissTour} />}
      <OnboardingLeigo />
    </div>
  )
}
