import { useState, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'

const SK       = 'sb_v10'
const TXN_KEY  = 'sb_banca_txns'   // [{ id, ts, type, amount, note, balAfter }]

const RESULT_MAP = {
  W: { c: 'var(--green)', bg: 'var(--g3)', l: 'WIN' },
  L: { c: 'var(--red)',   bg: 'var(--r3)', l: 'LOSS' },
  V: { c: 'var(--amber)', bg: 'var(--a3)', l: 'VOID' },
  P: { c: 'var(--blue)',  bg: 'var(--b3)', l: 'PUSH' },
}
function ResultBadge({ r }) {
  const s = RESULT_MAP[r] || RESULT_MAP.L
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, fontWeight: 700,
      color: s.c, background: s.bg,
      padding: '2px 7px', borderRadius: 3, whiteSpace: 'nowrap',
    }}>{s.l}</span>
  )
}

const FILTERS = [
  { id: 'all',     label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'W',       label: '✅ Win' },
  { id: 'L',       label: '❌ Loss' },
]

function loadTxns() {
  try { return JSON.parse(localStorage.getItem(TXN_KEY) || '[]') } catch { return [] }
}
function saveTxns(arr) {
  try { localStorage.setItem(TXN_KEY, JSON.stringify(arr.slice(-200))) } catch {}
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' })
}
function fmtBRL(v) {
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 })}`
}

// ─── Painel de Banca Integrada ────────────────────────────────────────────────
function BancaPanel({ banca: bancaInit }) {
  const [banca,   setBancaState] = useState(bancaInit)
  const [txns,    setTxns]       = useState(loadTxns)
  const [mode,    setMode]       = useState(null)   // null | 'deposit' | 'withdraw' | 'adjust'
  const [amount,  setAmount]     = useState('')
  const [note,    setNote]       = useState('')
  const [showAll, setShowAll]    = useState(false)

  function persistBanca(v) {
    setBancaState(v)
    localStorage.setItem('sb_banca', String(v))
  }

  function commit() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return
    let newBal = banca
    if (mode === 'deposit')  newBal = banca + amt
    if (mode === 'withdraw') newBal = Math.max(0, banca - amt)
    if (mode === 'adjust')   newBal = amt
    const tx = { id: Date.now(), ts: Date.now(), type: mode, amount: amt, note, balAfter: newBal }
    const updated = [...txns, tx]
    setTxns(updated); saveTxns(updated)
    persistBanca(newBal)
    setMode(null); setAmount(''); setNote('')
  }

  function deleteTxn(id) {
    const updated = txns.filter(t => t.id !== id)
    setTxns(updated); saveTxns(updated)
  }

  const totalDeposited  = txns.filter(t => t.type === 'deposit').reduce((a, t) => a + t.amount, 0)
  const totalWithdrawn  = txns.filter(t => t.type === 'withdraw').reduce((a, t) => a + t.amount, 0)
  const netFlow         = totalDeposited - totalWithdrawn
  const profit          = netFlow > 0 ? banca - netFlow : null   // null if no tracked txns
  const profitColor     = profit == null ? 'var(--mute)' : profit > 0 ? 'var(--green)' : profit < 0 ? 'var(--red)' : 'var(--mute)'

  const displayed = showAll ? txns : txns.slice(-5)

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Saldo + ações */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: 'var(--r2)', padding: '14px 16px',
      }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
          {/* lado esquerdo: saldo */}
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)', letterSpacing:'.5px', textTransform:'uppercase', marginBottom:4 }}>
              Saldo Atual
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:28, fontWeight:900, color:'var(--green)', lineHeight:1 }}>
              {fmtBRL(banca)}
            </div>
            {netFlow > 0 && (
              <div style={{ display:'flex', gap:12, marginTop:6, flexWrap:'wrap' }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
                  Dep: <span style={{ color:'var(--blue)' }}>{fmtBRL(totalDeposited)}</span>
                </span>
                {totalWithdrawn > 0 && (
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
                    Ret: <span style={{ color:'var(--amber)' }}>{fmtBRL(totalWithdrawn)}</span>
                  </span>
                )}
                {profit != null && (
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
                    Lucro: <span style={{ color: profitColor, fontWeight:700 }}>{profit > 0 ? '+' : ''}{fmtBRL(profit)}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* lado direito: botões */}
          <div style={{ display:'flex', gap:6, flexShrink:0, flexWrap:'wrap', justifyContent:'flex-end' }}>
            {[
              { id:'deposit',  label:'+ Depósito',  c:'var(--green)',  bc:'rgba(34,212,160,.35)', bg:'rgba(34,212,160,.1)' },
              { id:'withdraw', label:'− Retirada',   c:'var(--amber)',  bc:'rgba(245,158,11,.35)', bg:'rgba(245,158,11,.08)' },
              { id:'adjust',   label:'✏ Ajustar',    c:'var(--blue)',   bc:'rgba(59,130,246,.35)', bg:'rgba(59,130,246,.08)' },
            ].map(b => (
              <button key={b.id} onClick={() => setMode(mode === b.id ? null : b.id)} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                padding:'5px 12px', borderRadius:6, cursor:'pointer',
                border:`1px solid ${mode===b.id ? b.bc : 'rgba(255,255,255,.12)'}`,
                background: mode===b.id ? b.bg : 'transparent',
                color: mode===b.id ? b.c : 'var(--mute)',
                transition:'all .15s',
              }}>{b.label}</button>
            ))}
          </div>
        </div>

        {/* Form inline */}
        {mode && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--line)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)', minWidth:70 }}>
              {mode === 'deposit' ? 'Valor dep.' : mode === 'withdraw' ? 'Valor ret.' : 'Novo saldo'}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--soft)' }}>R$</span>
              <input
                autoFocus type="number" min="0" step="0.01"
                value={amount} onChange={e => setAmount(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && commit()}
                placeholder="0,00"
                style={{
                  fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700,
                  width:100, padding:'4px 6px', borderRadius:4,
                  border:'1px solid var(--line)', background:'rgba(255,255,255,.05)',
                  color:'var(--white)', outline:'none',
                }}
              />
            </div>
            <input
              type="text" value={note} onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && commit()}
              placeholder="Nota (opcional)"
              style={{
                fontFamily:"'Inter',sans-serif", fontSize:11,
                flex:1, minWidth:120, padding:'4px 8px', borderRadius:4,
                border:'1px solid var(--line)', background:'rgba(255,255,255,.05)',
                color:'var(--soft)', outline:'none',
              }}
            />
            <button onClick={commit} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
              padding:'5px 14px', borderRadius:6, cursor:'pointer',
              background:'rgba(34,212,160,.15)', border:'1px solid rgba(34,212,160,.4)',
              color:'var(--green)',
            }}>Confirmar</button>
            <button onClick={() => { setMode(null); setAmount(''); setNote('') }} style={{
              background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:16,
            }}>✕</button>
          </div>
        )}
      </div>

      {/* Histórico de transações */}
      {txns.length > 0 && (
        <div style={{ marginTop:10 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', letterSpacing:'.5px', textTransform:'uppercase' }}>
              Histórico de Transações
            </div>
            {txns.length > 5 && (
              <button onClick={() => setShowAll(v => !v)} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--blue)',
                background:'none', border:'none', cursor:'pointer',
              }}>{showAll ? 'Mostrar menos' : `Ver todas (${txns.length})`}</button>
            )}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {[...displayed].reverse().map(tx => {
              const isDeposit  = tx.type === 'deposit'
              const isWithdraw = tx.type === 'withdraw'
              const isAdjust   = tx.type === 'adjust'
              const c = isDeposit ? 'var(--green)' : isWithdraw ? 'var(--amber)' : 'var(--blue)'
              const icon = isDeposit ? '↑' : isWithdraw ? '↓' : '✏'
              const label = isDeposit ? 'Depósito' : isWithdraw ? 'Retirada' : 'Ajuste'
              return (
                <div key={tx.id} style={{
                  display:'flex', alignItems:'center', gap:10,
                  background:'rgba(255,255,255,.025)', borderRadius:6,
                  padding:'7px 10px', fontSize:11,
                }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, color:c, width:14, textAlign:'center' }}>{icon}</span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)', minWidth:55 }}>{fmtDate(tx.ts)}</span>
                  <span style={{ color:'var(--soft)', minWidth:60 }}>{label}</span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, color:c }}>
                    {isDeposit ? '+' : isWithdraw ? '−' : ''}{fmtBRL(tx.amount)}
                  </span>
                  {tx.note && <span style={{ color:'var(--dim)', fontSize:10, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.note}</span>}
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', marginLeft:'auto' }}>
                    → {fmtBRL(tx.balAfter)}
                  </span>
                  <button onClick={() => deleteTxn(tx.id)} style={{
                    background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:11, padding:'0 2px',
                  }} title="Remover">✕</button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── helper: build grouped stats (market or league) ──────────────────────────
function buildGroupStats(picks, keyFn) {
  const map = {}
  picks.forEach(p => {
    const k = keyFn(p) || 'Outros'
    if (!map[k]) map[k] = { w:0, l:0, t:0, staked:0, returns:0, confs:[] }
    const stake = parseFloat(p.stake) || 1
    const odd   = parseFloat(p.odd) || 2
    map[k].t++
    map[k].staked += stake
    if (p.conf) map[k].confs.push(parseFloat(p.conf))
    if (p.result === 'W') { map[k].w++; map[k].returns += stake * odd }
    if (p.result === 'L') { map[k].l++ }
  })
  return Object.entries(map)
    .map(([name, v]) => {
      const wr  = v.t ? (v.w / v.t * 100) : null
      const roi = v.staked ? ((v.returns - v.staked) / v.staked * 100) : null
      const avgConf = v.confs.length ? v.confs.reduce((a,b) => a+b, 0) / v.confs.length : null
      return { name, ...v, wr, roi, avgConf }
    })
    .sort((a, b) => (b.roi ?? -999) - (a.roi ?? -999))
}

// ─── StatRows: shared renderer for market / league lists ─────────────────────
function StatRows({ rows }) {
  if (!rows.length) return (
    <div style={{ fontSize:11, color:'var(--mute)', textAlign:'center', padding:'16px 0' }}>
      Sem dados suficientes ainda.
    </div>
  )
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {rows.map(m => {
        const roiColor = m.roi == null ? 'var(--mute)' : m.roi > 0 ? 'var(--green)' : m.roi > -10 ? 'var(--amber)' : 'var(--red)'
        const wrColor  = m.wr == null ? 'var(--mute)' : m.wr >= 55 ? 'var(--green)' : m.wr >= 45 ? 'var(--amber)' : 'var(--red)'
        const barPct   = m.wr != null ? Math.min(m.wr, 100) : 0
        return (
          <div key={m.name} style={{
            background:'var(--card-bg)', border:'1px solid var(--card-border)',
            borderRadius:'var(--r)', padding:'10px 12px',
            position:'relative', overflow:'hidden',
          }}>
            <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${barPct}%`, background:'rgba(59,130,246,.06)', transition:'width .4s' }} />
            <div style={{ position:'relative', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--white)', minWidth:100, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {m.name}
              </div>
              <div style={{ display:'flex', gap:12, alignItems:'baseline', flexShrink:0, flexWrap:'wrap' }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)' }}>{m.w}/{m.t}</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:800, color:wrColor, minWidth:38, textAlign:'right' }}>
                  {m.wr != null ? `${m.wr.toFixed(0)}%` : '—'}
                </span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:800, color:roiColor, minWidth:52, textAlign:'right' }}>
                  {m.roi != null ? `${m.roi > 0 ? '+' : ''}${m.roi.toFixed(1)}%` : '—'}
                </span>
                {m.avgConf != null && (
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--dim)', minWidth:40 }}>
                    ⌀{m.avgConf.toFixed(0)}% cf
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
      <div style={{ display:'flex', gap:16, marginTop:4, fontSize:10, color:'var(--dim)', fontFamily:"'JetBrains Mono',monospace" }}>
        <span>W/T = picks</span><span>% = win rate</span><span>ROI% = retorno</span>
      </div>
    </div>
  )
}

// ─── B3: Calibração de Confiança ─────────────────────────────────────────────
function CalibrationChart({ picks }) {
  const BUCKETS = [
    { min:60, max:65, label:'60-65%' },
    { min:65, max:70, label:'65-70%' },
    { min:70, max:75, label:'70-75%' },
    { min:75, max:80, label:'75-80%' },
    { min:80, max:85, label:'80-85%' },
    { min:85, max:90, label:'85-90%' },
    { min:90, max:101,label:'90%+'   },
  ]

  const resolved = picks.filter(p => p.result === 'W' || p.result === 'L')

  const data = useMemo(() => BUCKETS.map(b => {
    const bucket = resolved.filter(p => {
      const c = parseFloat(p.conf) || 0
      return c >= b.min && c < b.max
    })
    const wins = bucket.filter(p => p.result === 'W').length
    const n    = bucket.length
    const actualWr  = n ? +(wins / n * 100).toFixed(1) : null
    const expectedWr = (b.min + (b.max === 101 ? 95 : b.max)) / 2
    const diff = actualWr != null ? +(actualWr - expectedWr).toFixed(1) : null
    return { ...b, n, wins, actualWr, expectedWr, diff }
  }), [resolved])

  const hasSomeData = data.some(d => d.n > 0)

  if (!hasSomeData) return (
    <div style={{ fontSize:11, color:'var(--mute)', textAlign:'center', padding:'20px 0' }}>
      Registre resultados de picks para ver a calibração de confiança.
    </div>
  )

  // Brier score simples
  const brierItems = resolved.filter(p => p.conf)
  const brierScore = brierItems.length
    ? +(brierItems.reduce((sum, p) => {
        const prob = parseFloat(p.conf) / 100
        const out  = p.result === 'W' ? 1 : 0
        return sum + (prob - out) ** 2
      }, 0) / brierItems.length).toFixed(4)
    : null

  return (
    <div>
      {/* Brier Score */}
      {brierScore != null && (
        <div style={{
          display:'flex', alignItems:'center', gap:10, marginBottom:14,
          background:'rgba(184,125,255,.07)', border:'1px solid rgba(184,125,255,.2)',
          borderRadius:8, padding:'8px 12px',
        }}>
          <span style={{ fontSize:14 }}>🎯</span>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700, color:'var(--purple)' }}>
              Brier Score: {brierScore} <span style={{ fontWeight:400, color:'var(--mute)' }}>(menor = melhor · 0 = perfeito)</span>
            </div>
            <div style={{ fontSize:10, color:'var(--dim)', marginTop:2 }}>
              {brierScore < 0.15 ? '✅ Excelente calibração' : brierScore < 0.25 ? '🟡 Calibração razoável' : '⚠ Modelo pode estar superconfiante'}
            </div>
          </div>
        </div>
      )}

      {/* Barras por bucket */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {data.map(b => {
          if (b.n === 0) return (
            <div key={b.label} style={{ display:'flex', alignItems:'center', gap:8, opacity:.35 }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', minWidth:52 }}>{b.label}</span>
              <div style={{ flex:1, height:18, background:'rgba(255,255,255,.03)', borderRadius:3 }} />
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--dim)', minWidth:30 }}>—</span>
              <span style={{ fontSize:10, color:'var(--dim)', minWidth:28 }}>0 picks</span>
            </div>
          )
          const diffColor = b.diff == null ? 'var(--mute)' : Math.abs(b.diff) <= 5 ? 'var(--green)' : b.diff > 0 ? 'var(--blue)' : 'var(--red)'
          return (
            <div key={b.label}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--soft)', minWidth:52 }}>{b.label}</span>
                {/* barra: esperado (cinza) */}
                <div style={{ flex:1, height:18, background:'rgba(255,255,255,.05)', borderRadius:3, position:'relative', overflow:'hidden' }}>
                  {/* esperado */}
                  <div style={{
                    position:'absolute', left:0, top:0, bottom:0,
                    width:`${b.expectedWr}%`, background:'rgba(255,255,255,.1)',
                    borderRadius:3,
                  }} />
                  {/* real */}
                  {b.actualWr != null && (
                    <div style={{
                      position:'absolute', left:0, top:0, bottom:0,
                      width:`${b.actualWr}%`,
                      background: b.diff > 5 ? 'rgba(59,130,246,.55)' : b.diff < -5 ? 'rgba(255,79,106,.55)' : 'rgba(34,212,160,.55)',
                      borderRadius:3, transition:'width .4s',
                    }} />
                  )}
                </div>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700, color: b.actualWr != null && b.actualWr >= 50 ? 'var(--green)' : 'var(--red)', minWidth:36, textAlign:'right' }}>
                  {b.actualWr != null ? `${b.actualWr}%` : '—'}
                </span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color: diffColor, minWidth:38, textAlign:'right' }}>
                  {b.diff != null ? `${b.diff > 0 ? '+' : ''}${b.diff}pp` : ''}
                </span>
                <span style={{ fontSize:10, color:'var(--dim)', minWidth:32 }}>{b.n}p</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* legenda */}
      <div style={{ display:'flex', gap:14, marginTop:10, fontSize:10, color:'var(--dim)', flexWrap:'wrap' }}>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ display:'inline-block', width:10, height:10, background:'rgba(255,255,255,.1)', borderRadius:2 }}/> Esperado
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ display:'inline-block', width:10, height:10, background:'rgba(34,212,160,.55)', borderRadius:2 }}/> Real (±5pp)
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ display:'inline-block', width:10, height:10, background:'rgba(59,130,246,.55)', borderRadius:2 }}/> Acima (superperformance)
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ display:'inline-block', width:10, height:10, background:'rgba(255,79,106,.55)', borderRadius:2 }}/> Abaixo
        </span>
      </div>
    </div>
  )
}

// ─── ROI Dashboard ────────────────────────────────────────────────────────────
function RoiDashboard({ picks, byMarket }) {
  const [view, setView] = useState('market')   // 'market' | 'league' | 'timeline' | 'calib'

  // ── P&L acumulado por data ────────────────────────────────────────────────
  const timeline = useMemo(() => {
    const byDate = {}
    picks.forEach(p => {
      const d = p.date || '??'
      if (!byDate[d]) byDate[d] = { pl: 0, n: 0 }
      const stake = parseFloat(p.stake) || 1
      if (p.result === 'W') byDate[d].pl += stake * (parseFloat(p.odd) || 2) - stake
      if (p.result === 'L') byDate[d].pl -= stake
      byDate[d].n++
    })
    const dates = Object.keys(byDate).sort()
    let running = 0
    return dates.map(d => { running += byDate[d].pl; return { date: d, pl: byDate[d].pl, cum: running, n: byDate[d].n } })
  }, [picks])

  const mktStats    = useMemo(() => buildGroupStats(picks, p => p.market), [picks])
  const leagueStats = useMemo(() => buildGroupStats(picks, p => p.league), [picks])

  const maxAbs = Math.max(...timeline.map(t => Math.abs(t.cum)), 1)

  const TABS = [
    { id:'market',   l:'Mercado' },
    { id:'league',   l:'Liga' },
    { id:'timeline', l:'P&L' },
    { id:'calib',    l:'Calibração' },
  ]

  return (
    <div style={{ marginTop:22 }}>
      {/* header + tabs */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
        <div className="section-label" style={{ margin:0 }}>📈 Dashboard de ROI</div>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:10, padding:'3px 10px',
              borderRadius:20, cursor:'pointer',
              background: view===t.id ? 'rgba(59,130,246,.2)' : 'transparent',
              border:`1px solid ${view===t.id ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.1)'}`,
              color: view===t.id ? 'var(--blue)' : 'var(--mute)',
            }}>{t.l}</button>
          ))}
        </div>
      </div>

      {/* ── VIEW: Por Mercado ── */}
      {view === 'market' && <StatRows rows={mktStats} />}

      {/* ── VIEW: Por Liga (C6) ── */}
      {view === 'league' && <StatRows rows={leagueStats} />}

      {/* ── VIEW: P&L Timeline ── */}
      {view === 'timeline' && (
        <div>
          {timeline.length === 0 ? (
            <div style={{ fontSize:11, color:'var(--mute)', textAlign:'center', padding:'20px 0' }}>Nenhum pick com resultado registrado ainda.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
              {timeline.map(t => {
                const barW = Math.abs(t.cum) / maxAbs * 100
                const isPos = t.cum >= 0
                return (
                  <div key={t.date} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', minWidth:50 }}>{t.date.slice(5)}</span>
                    <div style={{ flex:1, height:16, background:'rgba(255,255,255,.04)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{
                        height:'100%',
                        width:`${barW}%`,
                        background: isPos ? 'rgba(34,212,160,.5)' : 'rgba(255,79,106,.5)',
                        borderRadius:3,
                        transition:'width .3s',
                      }} />
                    </div>
                    <span style={{
                      fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
                      color: isPos ? 'var(--green)' : 'var(--red)', minWidth:52, textAlign:'right',
                    }}>{isPos ? '+' : ''}{t.cum.toFixed(1)}u</span>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--dim)', minWidth:28 }}>({t.n})</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── VIEW: Calibração (B3) ── */}
      {view === 'calib' && <CalibrationChart picks={picks} />}
    </div>
  )
}

export default function Performance() {
  const [picks, setPicks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SK) || '[]') } catch { return [] }
  })
  const bancaInit = parseFloat(localStorage.getItem('sb_banca') || '1000')
  const [filter, setFilter] = useState('all')

  function deletePick(i) {
    const updated = picks.filter((_, j) => j !== i)
    setPicks(updated); localStorage.setItem(SK, JSON.stringify(updated))
  }
  function setResult(i, r) {
    const updated = picks.map((p, j) => j === i ? { ...p, result: r } : p)
    setPicks(updated); localStorage.setItem(SK, JSON.stringify(updated))
  }

  const stats = useMemo(() => {
    const resolved    = picks.filter(p => p.result && p.result !== 'P' && p.result !== 'V')
    const wins        = resolved.filter(p => p.result === 'W')
    const wr          = resolved.length ? (wins.length / resolved.length * 100).toFixed(1) : null
    const totalStaked = picks.reduce((a, p) => a + (parseFloat(p.stake) || 1), 0)
    const returns     = picks.reduce((a, p) => {
      if (p.result === 'W') return a + (parseFloat(p.stake) || 1) * (parseFloat(p.odd) || 2) - (parseFloat(p.stake) || 1)
      if (p.result === 'L') return a - (parseFloat(p.stake) || 1)
      return a
    }, 0)
    const roi = totalStaked ? (returns / totalStaked * 100).toFixed(1) : null
    const byMarket = {}
    picks.forEach(p => {
      const m = p.market || 'Outros'
      if (!byMarket[m]) byMarket[m] = { w: 0, t: 0 }
      if (p.result === 'W') byMarket[m].w++
      if (p.result && p.result !== 'V') byMarket[m].t++
    })
    return { total: picks.length, wins: wins.length, resolved: resolved.length, wr, roi, returns, byMarket }
  }, [picks])

  const filtered = filter === 'all' ? picks
    : picks.filter(p => p.result === filter || (!p.result && filter === 'pending'))

  return (
    <div className="page">
      <PageHeader
        icon="💰"
        title="Performance & Banca"
        subtitle={`${picks.length} picks registrados`}
      />

      {/* Banca Integrada */}
      <BancaPanel banca={bancaInit} />

      {/* KPIs */}
      <KpiRow>
        <Kpi value={stats.total}                                                                label="Total Picks"   color="var(--soft)" />
        <Kpi value={stats.wins}                                                                 label="Wins"          color="var(--green)" />
        <Kpi value={stats.wr ? `${stats.wr}%` : '—'}                                           label="Win Rate"      color={Number(stats.wr) >= 55 ? 'var(--green)' : Number(stats.wr) >= 45 ? 'var(--amber)' : 'var(--red)'} />
        <Kpi value={stats.roi ? `${Number(stats.roi) > 0 ? '+' : ''}${stats.roi}%` : '—'}     label="ROI"           color={Number(stats.roi) > 0 ? 'var(--green)' : Number(stats.roi) < 0 ? 'var(--red)' : 'var(--mute)'} />
        <Kpi value={stats.returns ? `${Number(stats.returns) > 0 ? '+' : ''}${stats.returns.toFixed(0)}u` : '—'} label="P&L (u)" color={Number(stats.returns) > 0 ? 'var(--green)' : 'var(--red)'} />
      </KpiRow>

      {/* Filtros */}
      <div className="filter-bar">
        {FILTERS.map(f => (
          <button key={f.id} className={`filter-chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <span style={{ marginLeft:'auto', fontSize:11, color:'var(--mute)', fontFamily:"'JetBrains Mono', monospace", alignSelf:'center' }}>
          {filtered.length} picks
        </span>
      </div>

      {/* Empty state */}
      {picks.length === 0 && (
        <EmptyState
          icon="📊"
          title="Nenhum pick registrado"
          subtitle="Vá para Backup & Dados para registrar seus palpites e acompanhar sua evolução"
        />
      )}

      {/* Lista de picks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((p, i) => (
          <div key={i} className="list-row">
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:'var(--dim)', marginBottom:3 }}>
                {p.match || '—'} · {p.market || '—'}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--white)', marginBottom: 2 }}>
                {p.pick || p.tip || '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mute)', fontFamily:"'JetBrains Mono', monospace" }}>
                {p.conf || '—'}% conf · Odd {p.odd || '—'} · {p.stake || '1'}u
              </div>
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', flexShrink:0 }}>
              {p.result ? (
                <ResultBadge r={p.result} />
              ) : (
                <div style={{ display:'flex', gap:4 }}>
                  {['W','L','V'].map(r => (
                    <button key={r} onClick={() => setResult(i, r)} style={{
                      fontFamily:"'JetBrains Mono', monospace",
                      fontSize:11, padding:'3px 9px', borderRadius:4,
                      border:`1px solid ${r==='W'?'rgba(0,214,143,.4)':r==='L'?'rgba(255,79,106,.4)':'rgba(255,184,48,.3)'}`,
                      background:'transparent',
                      color:r==='W'?'var(--green)':r==='L'?'var(--red)':'var(--amber)',
                      cursor:'pointer', transition:'all var(--transition-fast)',
                    }}>{r}</button>
                  ))}
                </div>
              )}
              <button onClick={() => deletePick(i)} style={{
                background:'none', border:'none', color:'var(--mute)',
                cursor:'pointer', fontSize:12, padding:'2px 4px',
                transition:'color var(--transition-fast)',
              }}
                onMouseEnter={e => e.currentTarget.style.color='var(--red)'}
                onMouseLeave={e => e.currentTarget.style.color='var(--mute)'}
              >🗑</button>
            </div>
          </div>
        ))}
      </div>

      {/* Dashboard ROI */}
      {picks.length > 0 && (
        <RoiDashboard picks={picks} byMarket={stats.byMarket} />
      )}
    </div>
  )
}
