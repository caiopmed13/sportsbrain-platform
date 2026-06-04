// ═══════════════════════════════════════════════════════════════════════════
// NotifyBell — Sino de notificações + alertas in-app
// ═══════════════════════════════════════════════════════════════════════════
// Polling no /v1/bet365/markets/analyzed?minEdge=5 a cada 60s.
// Quando aparece pick novo com EV ≥ 5%, mostra notificação:
//   - Browser Notification (se permitido)
//   - Toast in-app
//   - Badge no sino
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react'

const ANALYZED_URL = 'https://sportsbrain-api.sportsbrain-api.workers.dev/v1/bet365/markets/analyzed?minEdge=5'
const MISPRICED_URL = 'https://sportsbrain-api.sportsbrain-api.workers.dev/v1/bet365/markets/mispriced?minEdge=3&steamPct=8'
const SEEN_KEY = 'sb_notify_seen_v1'
const SEEN_MISPRICED_KEY = 'sb_mispriced_seen_v1'

function loadSeen(key = SEEN_KEY) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}
function saveSeen(set, key = SEEN_KEY) {
  try { localStorage.setItem(key, JSON.stringify(Array.from(set).slice(-200))) } catch {}
}
function pickKey(p) {
  return `${p.fixtureId}|${p.market}|${p.selection || p.player || p.line}`
}
function alertKey(a) {
  return `${a.type}|${a.fixtureId}|${a.market}|${a.selection || ''}|${a.line ?? ''}|${(a.currentOdd || 0).toFixed(2)}`
}

export default function NotifyBell() {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState([])
  const [mispriced, setMispriced] = useState([])
  const [tab, setTab] = useState('alerts')  // 'alerts' | 'mispriced'
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'default')
  const seen = useRef(loadSeen())
  const seenMispriced = useRef(loadSeen(SEEN_MISPRICED_KEY))

  // Pede permissão browser na 1a vez
  function requestPermission() {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then(p => setPermission(p))
  }

  // Polling
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const r = await fetch(ANALYZED_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        const j = await r.json()
        if (!j.ok || cancelled) return
        const news = []
        for (const M of j.matches || []) {
          for (const arr of Object.values(M.markets || {})) {
            for (const r of arr) {
              const evOver = r.overEV
              const evUnder = r.underEV
              const evSingle = r.ev
              if (evOver != null && evOver >= 5) {
                const p = { fixtureId: M.fixtureId, market: 'O/U', selection: `Over ${r.line}`, ev: evOver, home: M.home, away: M.away }
                if (!seen.current.has(pickKey(p))) news.push(p)
              }
              if (evUnder != null && evUnder >= 5) {
                const p = { fixtureId: M.fixtureId, market: 'O/U', selection: `Under ${r.line}`, ev: evUnder, home: M.home, away: M.away }
                if (!seen.current.has(pickKey(p))) news.push(p)
              }
              if (evSingle != null && evSingle >= 5) {
                const p = { fixtureId: M.fixtureId, market: '1X2', selection: r.selection, ev: evSingle, home: M.home, away: M.away }
                if (!seen.current.has(pickKey(p))) news.push(p)
              }
            }
          }
        }
        if (news.length) {
          setUnread(prev => [...news, ...prev].slice(0, 20))
          // Browser notification (se permitido)
          if (permission === 'granted' && typeof Notification !== 'undefined') {
            try {
              new Notification('🎯 Picks +EV no Bet365', {
                body: `${news.length} novo${news.length > 1 ? 's' : ''} pick${news.length > 1 ? 's' : ''}: ${news[0].home} v ${news[0].away} (${news[0].selection})`,
                icon: '/favicon.ico',
                tag: 'sb-picks-ev',
              })
            } catch {}
          }
          for (const p of news) seen.current.add(pickKey(p))
          saveSeen(seen.current)
        }
      } catch {}
    }
    check()
    const id = setInterval(check, 60000)
    return () => { cancelled = true; clearInterval(id) }
  }, [permission])

  // Polling 2: mispriced detector (steam moves + cross-book)
  useEffect(() => {
    let cancelled = false
    async function checkMispriced() {
      try {
        const r = await fetch(MISPRICED_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        const j = await r.json()
        if (!j.ok || cancelled) return
        const newAlerts = []
        for (const a of j.alerts || []) {
          const k = alertKey(a)
          if (!seenMispriced.current.has(k)) {
            newAlerts.push(a)
          }
        }
        if (newAlerts.length) {
          setMispriced(prev => [...newAlerts, ...prev].slice(0, 50))
          // Browser notification só pra alta severidade
          const high = newAlerts.find(a => a.severity === 'high')
          if (high && permission === 'granted' && typeof Notification !== 'undefined') {
            try {
              const emoji = high.type === 'STEAM' ? '🔥' : '💎'
              new Notification(`${emoji} Odd Desajustada Bet365`, {
                body: `${high.home} v ${high.away} · ${high.message}`,
                icon: '/favicon.ico',
                tag: 'sb-mispriced',
              })
            } catch {}
          }
          for (const a of newAlerts) seenMispriced.current.add(alertKey(a))
          saveSeen(seenMispriced.current, SEEN_MISPRICED_KEY)
        }
      } catch {}
    }
    checkMispriced()
    const id = setInterval(checkMispriced, 90000)  // 90s
    return () => { cancelled = true; clearInterval(id) }
  }, [permission])

  function clearAll() {
    if (tab === 'mispriced') setMispriced([])
    else setUnread([])
  }
  const totalBadge = unread.length + mispriced.length

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notificações"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 6, position: 'relative', color: 'var(--soft)',
          fontSize: 16,
        }}
      >
        🔔
        {totalBadge > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 0,
            background: mispriced.some(a => a.severity === 'high') ? 'var(--red)' : 'var(--amber)',
            color: 'white',
            borderRadius: 10, padding: '0 5px',
            fontSize: 9, fontWeight: 700,
            minWidth: 14, textAlign: 'center',
          }}>{totalBadge}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0,
          width: 360, maxHeight: 480, overflowY: 'auto',
          background: 'rgba(244,235,224,.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--border)',
          borderRadius: 6, padding: 8, zIndex: 1000,
          boxShadow: '0 8px 32px rgba(26,20,16,.22)',
          marginTop: 4,
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => setTab('alerts')} style={{
              flex: 1, padding: '6px 8px', fontSize: 11,
              background: tab === 'alerts' ? 'rgba(200,70,46,.10)' : 'transparent',
              border: 'none', borderBottom: tab === 'alerts' ? '2px solid #c8462e' : '2px solid transparent',
              color: tab === 'alerts' ? '#c8462e' : 'var(--soft)',
              cursor: 'pointer', fontWeight: 600,
              fontFamily: "'DM Mono', monospace", letterSpacing: '.05em',
            }}>
              🔔 Picks +EV {unread.length > 0 && `(${unread.length})`}
            </button>
            <button onClick={() => setTab('mispriced')} style={{
              flex: 1, padding: '6px 8px', fontSize: 11,
              background: tab === 'mispriced' ? 'rgba(200,70,46,.10)' : 'transparent',
              border: 'none', borderBottom: tab === 'mispriced' ? '2px solid #c8462e' : '2px solid transparent',
              color: tab === 'mispriced' ? '#c8462e' : 'var(--soft)',
              cursor: 'pointer', fontWeight: 600,
              fontFamily: "'DM Mono', monospace", letterSpacing: '.05em',
            }}>
              💎 Desajustadas {mispriced.length > 0 && `(${mispriced.length})`}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 4 }}>
            {permission !== 'granted' && (
              <button onClick={requestPermission} style={{ fontSize: 9, padding: '2px 6px', background: 'var(--blue)', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
                🔔 Ativar push
              </button>
            )}
            <button onClick={clearAll} style={{ fontSize: 9, padding: '2px 6px', background: 'transparent', color: 'var(--soft)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
              Limpar
            </button>
          </div>

          {tab === 'alerts' ? (
            unread.length === 0 ? (
              <div style={{ color: 'var(--mute)', fontSize: 11, padding: 12, textAlign: 'center' }}>
                Nenhum pick +EV novo. Continuamos buscando...
              </div>
            ) : unread.map((p, i) => (
              <div key={i} style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{p.home} × {p.away}</strong>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>+{p.ev?.toFixed(1)}%</span>
                </div>
                <div style={{ color: 'var(--mute)', fontSize: 10, marginTop: 2 }}>{p.market} · {p.selection}</div>
              </div>
            ))
          ) : (
            mispriced.length === 0 ? (
              <div style={{ color: 'var(--mute)', fontSize: 11, padding: 12, textAlign: 'center' }}>
                Nenhum mispricing detectado.<br/>Monitora steam moves + cross-book a cada 90s.
              </div>
            ) : mispriced.map((a, i) => {
              const sevColor = a.severity === 'high' ? 'var(--red)' : a.severity === 'medium' ? 'var(--amber)' : 'var(--mute)'
              const typeIcon = a.type === 'STEAM' ? '🔥' : '💎'
              const typeLabel = a.type === 'STEAM' ? 'STEAM' : 'CROSS-BOOK'
              return (
                <div key={i} style={{ padding: 8, borderBottom: '1px solid var(--border)', fontSize: 11, borderLeft: `3px solid ${sevColor}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: sevColor, fontSize: 9, fontWeight: 700 }}>{typeIcon} {typeLabel}</span>
                    {a.ev != null && <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 11 }}>+{a.ev}%</span>}
                    {a.movePct != null && <span style={{ color: a.movePct > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontSize: 11 }}>{a.movePct > 0 ? '↑' : '↓'} {Math.abs(a.movePct)}%</span>}
                  </div>
                  <div style={{ marginTop: 3, fontWeight: 600 }}>{a.home} × {a.away}</div>
                  <div style={{ color: 'var(--mute)', fontSize: 10, marginTop: 2 }}>{a.market} · {a.selection || '?'}{a.line != null ? ` (${a.line})` : ''} · odd <strong style={{ color: 'var(--white)' }}>{a.currentOdd?.toFixed(2)}</strong></div>
                  <div style={{ color: 'var(--soft)', fontSize: 9, marginTop: 3, fontStyle: 'italic' }}>{a.message}</div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
