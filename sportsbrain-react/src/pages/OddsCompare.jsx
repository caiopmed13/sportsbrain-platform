// ══════════════════════════════════════════════════════════════════════
// Odds Compare — grid multi-casa por jogo (todos os books lado a lado)
// ══════════════════════════════════════════════════════════════════════
// Mostra cada evento com as odds de cada casa. Destaca a MELHOR odd por
// outcome. Click no evento → expande e mostra line movement (última 24h).
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { sbOddsAll, sbOddsMovement } from '../api/client'

const BOOK_LABELS = {
  bet365br:  'Bet365 BR',
  superbet:  'Superbet',
  kto:       'KTO',
  pinnacle:  'Pinnacle',
  bovada:    'Bovada',
  betfair:   'Betfair',
  betano:    'Betano',
}

const BOOK_COLORS = {
  bet365br:  '#ffe400',
  superbet:  '#e32020',
  kto:       '#00c48c',
  pinnacle:  '#ff6b35',
  bovada:    '#d10f1f',
  betfair:   '#ffb700',
  betano:    '#ff6f00',
}

// Outcomes que mostramos por esporte/mercado
const H2H_SOCCER  = ['home', 'draw', 'away']
const H2H_BASKET  = ['home', 'away']

function flattenH2H(bookmakers = []) {
  // Retorna: { home: {bet365br: 1.85, superbet:1.9,...}, draw: {...}, away: {...} }
  const out = { home: {}, draw: {}, away: {} }
  for (const bk of bookmakers) {
    const h2h = (bk.markets || []).find(m => m.key === 'h2h')
    if (!h2h) continue
    for (const oc of (h2h.outcomes || [])) {
      if (!['home','draw','away'].includes(oc.name)) continue
      out[oc.name][bk.key] = oc.price
    }
  }
  return out
}

function formatCommence(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
    const isTomorrow = d.toDateString() === tomorrow.toDateString()
    const hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    if (sameDay)    return `Hoje ${hm}`
    if (isTomorrow) return `Amanhã ${hm}`
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${hm}`
  } catch { return '' }
}

// Linha horizontal de bolinhas representando movimento da odd (sem Chart.js)
function MovementSpark({ points }) {
  if (!points || points.length < 2) return <div style={{color:'var(--dim)', fontSize:11}}>sem histórico</div>
  const prices = points.map(p => p.price)
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 0.01
  const w = 220, h = 40
  const pts = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w
    const y = h - ((p.price - min) / range) * (h - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const first = points[0].price, last = points[points.length-1].price
  const delta = last - first
  const color = delta > 0 ? '#22d4a0' : delta < 0 ? '#ef4444' : '#94a3b8'
  return (
    <div style={{display:'flex', alignItems:'center', gap:8}}>
      <svg width={w} height={h} style={{overflow:'visible'}}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
      </svg>
      <div style={{fontSize:11, color:'var(--dim)', minWidth:65}}>
        {first.toFixed(2)} → {last.toFixed(2)}
        <div style={{color, fontWeight:700}}>{delta >= 0 ? '+' : ''}{delta.toFixed(2)}</div>
      </div>
    </div>
  )
}

function EventRow({ ev, sport }) {
  const [expanded, setExpanded] = useState(false)
  const [movement, setMovement] = useState(null)
  const [movLoading, setMovLoading] = useState(false)
  const [selOutcome, setSelOutcome] = useState('home')

  const odds = useMemo(() => flattenH2H(ev.bookmakers || []), [ev])
  const outcomes = sport === 'basketball' ? H2H_BASKET : H2H_SOCCER

  // Junta todas as casas que têm pelo menos uma odd H2H
  const books = useMemo(() => {
    const s = new Set()
    outcomes.forEach(oc => Object.keys(odds[oc] || {}).forEach(b => s.add(b)))
    return [...s].sort()
  }, [odds, outcomes])

  async function loadMovement(outcome) {
    setMovLoading(true)
    setSelOutcome(outcome)
    try {
      const r = await sbOddsMovement(ev.id, 'h2h', outcome, 24)
      setMovement(r)
    } catch { setMovement(null) }
    setMovLoading(false)
  }

  function toggleExpand() {
    const wasExpanded = expanded
    setExpanded(!wasExpanded)
    if (!wasExpanded && !movement) loadMovement('home')
  }

  // Melhor odd por outcome
  const bestByOutcome = {}
  outcomes.forEach(oc => {
    const entries = Object.entries(odds[oc] || {})
    if (!entries.length) return
    entries.sort((a, b) => b[1] - a[1])
    bestByOutcome[oc] = { book: entries[0][0], price: entries[0][1] }
  })

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer'}} onClick={toggleExpand}>
        <div>
          <div style={{fontSize:15, fontWeight:700, color:'var(--white)'}}>
            {ev.home_team} <span style={{color:'var(--dim)'}}>vs</span> {ev.away_team}
          </div>
          <div style={{fontSize:11, color:'var(--dim)', marginTop:3}}>
            {ev.sport_title} · {formatCommence(ev.commence_time)} · {books.length} {books.length === 1 ? 'casa' : 'casas'}
          </div>
        </div>
        <div style={{fontSize:20, color:'var(--dim)'}}>{expanded ? '▾' : '▸'}</div>
      </div>

      {/* Grade odds */}
      {books.length > 0 && (
        <div style={{
          marginTop: 10,
          display: 'grid',
          gridTemplateColumns: `80px repeat(${books.length}, 1fr)`,
          gap: 4,
          fontSize: 13,
        }}>
          <div></div>
          {books.map(b => (
            <div key={b} style={{
              textAlign:'center', padding:6, fontSize:10, fontWeight:700,
              color: BOOK_COLORS[b] || 'var(--dim)',
            }}>{BOOK_LABELS[b] || b}</div>
          ))}

          {outcomes.map(oc => (
            <Row key={oc} label={oc === 'home' ? 'Casa (1)' : oc === 'away' ? 'Fora (2)' : 'Empate (X)'}
                 books={books} bookOdds={odds[oc]} best={bestByOutcome[oc]}
                 onClickOutcome={() => expanded && loadMovement(oc)} />
          ))}
        </div>
      )}

      {expanded && (
        <div style={{marginTop:14, paddingTop:10, borderTop:'1px solid rgba(255,255,255,.06)'}}>
          <div style={{display:'flex', gap:8, marginBottom:10, alignItems:'center'}}>
            <span style={{fontSize:12, color:'var(--dim)'}}>Line movement 24h:</span>
            {outcomes.map(oc => (
              <button key={oc}
                onClick={() => loadMovement(oc)}
                style={{
                  fontSize:11, padding:'4px 10px', borderRadius:6, cursor:'pointer',
                  background: selOutcome === oc ? 'rgba(59,130,246,.25)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${selOutcome === oc ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.1)'}`,
                  color:'var(--white)',
                }}>{oc}</button>
            ))}
          </div>
          {movLoading && <div style={{color:'var(--dim)', fontSize:12}}>carregando...</div>}
          {!movLoading && <MovementSpark points={movement?.points || movement?.series || movement?.snapshots || []} />}
        </div>
      )}
    </div>
  )
}

function Row({ label, books, bookOdds, best, onClickOutcome }) {
  return (
    <>
      <div style={{padding:6, fontSize:11, color:'var(--soft)', cursor:'pointer'}} onClick={onClickOutcome}>{label}</div>
      {books.map(b => {
        const price = bookOdds[b]
        const isBest = best && best.book === b
        return (
          <div key={b} style={{
            padding:'6px 4px', textAlign:'center', fontWeight: isBest ? 800 : 500,
            background: isBest ? 'rgba(34,212,160,.12)' : 'rgba(255,255,255,.02)',
            border: isBest ? '1px solid rgba(34,212,160,.35)' : '1px solid transparent',
            borderRadius: 6,
            color: price ? (isBest ? 'var(--green)' : 'var(--white)') : 'var(--dim)',
            cursor: onClickOutcome ? 'pointer' : 'default',
          }} onClick={onClickOutcome}>
            {price ? price.toFixed(2) : '—'}
          </div>
        )
      })}
    </>
  )
}

export default function OddsCompare() {
  const [sport, setSport] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [minBooks, setMinBooks] = useState(2)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await sbOddsAll(sport)
      setEvents(Array.isArray(r?.events) ? r.events : [])
    } catch { setEvents([]) }
    setLoading(false)
  }, [sport])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events
      .filter(ev => !q || (ev.home_team + ' ' + ev.away_team).toLowerCase().includes(q))
      .filter(ev => (ev.bookmakers || []).length >= minBooks)
      .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
  }, [events, search, minBooks])

  const totalBooks = useMemo(() => {
    const s = new Set()
    events.forEach(e => (e.bookmakers || []).forEach(b => s.add(b.key)))
    return s.size
  }, [events])

  return (
    <div>
      <PageHeader title="Comparar Odds" subtitle="Multi-casa lado a lado, melhor odd destacada. Click no jogo pra ver movimento." />

      <KpiRow>
        <Kpi label="Eventos" value={filtered.length} />
        <Kpi label="Casas distintas" value={totalBooks} />
        <Kpi label="Status" value={loading ? '…' : 'live'} />
      </KpiRow>

      <div style={{display:'flex', gap:8, margin:'14px 0', flexWrap:'wrap', alignItems:'center'}}>
        {[{k:null,l:'Todos'},{k:'soccer',l:'Futebol'},{k:'basketball',l:'NBA'}].map(s => (
          <button key={s.k || 'all'} onClick={() => setSport(s.k)} style={{
            padding:'6px 14px', borderRadius:8, cursor:'pointer', fontSize:12,
            background: sport === s.k ? 'rgba(59,130,246,.25)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${sport === s.k ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.1)'}`,
            color:'var(--white)',
          }}>{s.l}</button>
        ))}

        <input placeholder="Buscar time..." value={search} onChange={e => setSearch(e.target.value)} style={{
          flex:1, minWidth:150, padding:'6px 10px', borderRadius:8, fontSize:12,
          background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.1)', color:'var(--white)',
        }} />

        <label style={{fontSize:12, color:'var(--dim)', display:'flex', alignItems:'center', gap:6}}>
          Mín. casas:
          <select value={minBooks} onChange={e => setMinBooks(+e.target.value)} style={{
            padding:'4px 8px', borderRadius:6, fontSize:12,
            background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.1)', color:'var(--white)',
          }}>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {loading && <div style={{color:'var(--dim)'}}>carregando...</div>}
      {!loading && !filtered.length && (
        <EmptyState title="Nenhum evento" sub={`Ajuste filtros ou aumente os books ingerindo. ${events.length} eventos no total.`} />
      )}
      {!loading && filtered.map(ev => (
        <EventRow key={ev.id} ev={ev} sport={ev.sport_key?.startsWith('basketball') ? 'basketball' : 'soccer'} />
      ))}
    </div>
  )
}
