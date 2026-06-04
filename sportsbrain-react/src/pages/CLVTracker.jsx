// ══════════════════════════════════════════════════════════
// CLV Tracker — NOVA PÁGINA
// Tracking de Closing Line Value — métrica profissional
// para medir a qualidade dos picks antes do jogo fechar
// ══════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import {
  getDiary, computeRollingClv, computeRoiByMarket, computeBrierByMarket,
  exportDiary, clearDiary, updateClose, markResult,
} from '../utils/clvTracker'
import { getBlacklist, getDegradedMarkets, getMarketHealthSummary } from '../utils/marketBlacklist'

const CLV_KEY = 'sb_clv_v1'
function loadCLV() { try { return JSON.parse(localStorage.getItem(CLV_KEY)||'[]') } catch { return [] } }
function saveCLV(d) { localStorage.setItem(CLV_KEY, JSON.stringify(d)) }

function clvColor(clv) {
  if (clv>3) return 'var(--green)'
  if (clv>0) return '#90EE90'
  if (clv<-3) return 'var(--red)'
  if (clv<0) return '#FFB3B3'
  return 'var(--mute)'
}

function CLVCard({ entry, onDelete }) {
  const clvPct = entry.closingOdd ? ((entry.openOdd/entry.closingOdd-1)*100) : null
  return (
    <div style={{background:'var(--card-bg)',border:`1px solid ${clvPct>0?'rgba(0,214,143,.2)':clvPct<0?'rgba(255,79,106,.15)':'var(--card-border)'}`,borderRadius:'var(--r2)',padding:'12px 14px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--dim)',marginBottom:2}}>{entry.date}</div>
          <div style={{fontSize:13,fontWeight:700,color:'var(--white)',overflow:'hidden',textOverflow:'ellipsis'}}>{entry.match}</div>
          <div style={{fontSize:11,color:'var(--soft)',marginTop:1}}>{entry.pick}</div>
        </div>
        {clvPct!==null && (
          <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
            <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:22,fontWeight:900,color:clvColor(clvPct)}}>{clvPct>0?'+':''}{clvPct.toFixed(1)}%</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)'}}>CLV</div>
          </div>
        )}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
        <div style={{background:'rgba(255,255,255,.04)',borderRadius:6,padding:'6px 8px',textAlign:'center'}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginBottom:2}}>Odd Abertura</div>
          <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:16,fontWeight:800,color:'var(--white)'}}>{entry.openOdd}</div>
        </div>
        <div style={{background:'rgba(255,255,255,.04)',borderRadius:6,padding:'6px 8px',textAlign:'center'}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginBottom:2}}>Odd Fechamento</div>
          <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:16,fontWeight:800,color:clvPct>0?'var(--green)':clvPct<0?'var(--red)':'var(--white)'}}>{entry.closingOdd||'—'}</div>
        </div>
        <div style={{background:'rgba(255,255,255,.04)',borderRadius:6,padding:'6px 8px',textAlign:'center'}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginBottom:2}}>Resultado</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:entry.result==='W'?'var(--green)':entry.result==='L'?'var(--red)':'var(--mute)'}}>{entry.result||'—'}</div>
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button onClick={()=>onDelete(entry.id)} style={{background:'none',border:'none',color:'var(--mute)',cursor:'pointer',fontSize:11}}>🗑</button>
      </div>
    </div>
  )
}

// ─── Auto-Diary: dados auto-logados do Top Pick ────────────────────────
function reliabilityBins(diary) {
  // Buckets de prob_model em decis: 50–60, 60–70, 70–80, 80–100
  const settled = diary.filter(p => p.result === 'W' || p.result === 'L')
  if (!settled.length) return []
  const bins = [
    { lo: 0.50, hi: 0.60, label: '50-60%' },
    { lo: 0.60, hi: 0.70, label: '60-70%' },
    { lo: 0.70, hi: 0.80, label: '70-80%' },
    { lo: 0.80, hi: 1.01, label: '80%+'   },
  ]
  return bins.map(b => {
    const inBin = settled.filter(p => p.prob_model >= b.lo && p.prob_model < b.hi)
    if (!inBin.length) return { ...b, n: 0, expected: null, actual: null, gap: null }
    const expected = inBin.reduce((a, p) => a + p.prob_model, 0) / inBin.length
    const actual = inBin.filter(p => p.result === 'W').length / inBin.length
    return {
      ...b,
      n: inBin.length,
      expected: +(expected * 100).toFixed(1),
      actual: +(actual * 100).toFixed(1),
      gap: +((actual - expected) * 100).toFixed(1),
    }
  })
}

function AutoDiarySection() {
  const [tick, setTick] = useState(0)
  const refresh = () => setTick(t => t + 1)

  const diary    = useMemo(() => getDiary(), [tick])
  const rolling  = useMemo(() => computeRollingClv(30), [tick])
  const roi      = useMemo(() => computeRoiByMarket(), [tick])
  const brier    = useMemo(() => computeBrierByMarket(60), [tick])
  const blackset = useMemo(() => getBlacklist(), [tick])
  const degraded = useMemo(() => getDegradedMarkets(), [tick])
  const health   = useMemo(() => getMarketHealthSummary(), [tick])
  const reliab   = useMemo(() => reliabilityBins(diary), [tick, diary])

  const settled  = diary.filter(p => p.result && p.result !== 'P').length
  const pending  = diary.filter(p => !p.result || p.result === 'P').length
  const premium  = diary.filter(p => p.premium).length

  function handleExport() {
    const csv = exportDiary()
    if (!csv) return
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `sb-diary-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleClose(id) {
    const v = prompt('Odd de fechamento (ex: 1.85):')
    const odd = parseFloat(v)
    if (!odd || odd <= 1) return
    updateClose(id, odd)
    refresh()
  }
  function handleResult(id, r) { markResult(id, r); refresh() }
  function handleClear() {
    if (!confirm('Limpar TODO o diário auto? (irreversível)')) return
    clearDiary(); refresh()
  }

  if (diary.length === 0) {
    return (
      <div style={{
        background:'rgba(255,184,48,.06)', border:'1px solid rgba(255,184,48,.2)',
        borderRadius:'var(--r2)', padding:'12px 14px', marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color:'var(--amber)', marginBottom: 4 }}>
          ⚙ Auto-Diary vazio
        </div>
        <div style={{ fontSize: 11, color:'var(--soft)' }}>
          Picks Premium da página <b style={{color:'var(--white)'}}>Palpites</b> são logados automaticamente aqui com odd de abertura.
          Volte aqui pra registrar odd de fechamento e calcular CLV real.
        </div>
      </div>
    )
  }

  const gateClvOk    = rolling.sample >= 200 && rolling.avgClv >= 1.5
  const gateBrierOk  = brier.length > 0 && brier.every(b => b.brier == null || b.brier < 0.22)
  const gateSettled  = settled >= 200

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        gap: 8, marginBottom: 10, flexWrap:'wrap',
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color:'var(--white)',
          fontFamily:"'JetBrains Mono',monospace", letterSpacing:'.04em' }}>
          ⚙ AUTO-DIARY · TOP PICKS LOGADOS
        </div>
        <div style={{ display:'flex', gap: 6 }}>
          <button onClick={refresh} className="btn" style={{padding:'4px 10px',fontSize:10}}>↻ Atualizar</button>
          <button onClick={handleExport} className="btn" style={{padding:'4px 10px',fontSize:10}}>⬇ CSV</button>
          <button onClick={handleClear} className="btn" style={{padding:'4px 10px',fontSize:10,color:'var(--red)'}}>🗑 Limpar</button>
        </div>
      </div>

      {/* KPIs Auto */}
      <KpiRow>
        <Kpi value={diary.length} label="Total picks" color="var(--soft)"/>
        <Kpi value={premium} label="💎 Premium" color="var(--green)"/>
        <Kpi value={pending} label="Pendentes" color="var(--amber)"/>
        <Kpi value={settled} label="Fechados" color="var(--blue)"/>
        <Kpi
          value={rolling.sample > 0 ? `${rolling.avgClv >= 0 ? '+' : ''}${rolling.avgClv}%` : '—'}
          label={`CLV 30d (n=${rolling.sample})`}
          color={rolling.avgClv >= 1.5 ? 'var(--green)' : rolling.avgClv > 0 ? '#5ecbff' : 'var(--red)'}
        />
      </KpiRow>

      {/* Gate da Fase 3 */}
      <div style={{
        background: gateClvOk && gateBrierOk && gateSettled
          ? 'linear-gradient(135deg,rgba(0,214,143,.12),rgba(0,214,143,.04))'
          : 'rgba(255,184,48,.06)',
        border: `1px solid ${gateClvOk && gateBrierOk && gateSettled ? 'rgba(0,214,143,.3)' : 'rgba(255,184,48,.2)'}`,
        borderRadius:'var(--r2)', padding:'10px 14px', marginTop: 10, marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color:'var(--white)',
          fontFamily:"'JetBrains Mono',monospace", marginBottom: 6, letterSpacing:'.04em' }}>
          🚦 GATE DE PRODUÇÃO (FASE 3) {gateClvOk && gateBrierOk && gateSettled ? '· DESTRAVADO ✓' : '· BLOQUEADO'}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap: 8, fontSize: 10 }}>
          <div style={{ color: gateSettled ? 'var(--green)' : 'var(--amber)' }}>
            {gateSettled ? '✓' : '○'} 200 picks fechados <b>({settled}/200)</b>
          </div>
          <div style={{ color: gateClvOk ? 'var(--green)' : 'var(--amber)' }}>
            {gateClvOk ? '✓' : '○'} CLV 30d ≥ +1.5% <b>({rolling.avgClv}%)</b>
          </div>
          <div style={{ color: gateBrierOk ? 'var(--green)' : 'var(--amber)' }}>
            {gateBrierOk ? '✓' : '○'} Brier &lt; 0.22 todos mercados
          </div>
        </div>
      </div>

      {/* ROI por mercado × liga */}
      {roi.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
            color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6 }}>
            📊 ROI por mercado × liga (n≥1)
          </div>
          <div style={{ background:'var(--card-bg)', border:'1px solid var(--card-border)',
            borderRadius:'var(--r2)', overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 80px 70px 70px 70px',
              gap: 4, padding:'6px 10px', fontSize: 10, color:'var(--mute)',
              fontFamily:"'JetBrains Mono',monospace", borderBottom:'1px solid var(--line)',
              textTransform:'uppercase' }}>
              <div>Liga</div><div>Mercado</div><div style={{textAlign:'right'}}>n</div>
              <div style={{textAlign:'right'}}>Win%</div>
              <div style={{textAlign:'right'}}>ROI%</div>
              <div style={{textAlign:'right'}}>CLV%</div>
            </div>
            {roi.slice(0, 12).map((r, i) => {
              const isBlack = blackset.has(`${r.league || 'unknown'}__${r.market}`)
              return (
                <div key={i} style={{
                  display:'grid', gridTemplateColumns:'2fr 1fr 80px 70px 70px 70px',
                  gap: 4, padding:'5px 10px', fontSize: 11,
                  fontFamily:"'JetBrains Mono',monospace",
                  borderBottom:'1px dashed var(--line)',
                  background: isBlack ? 'rgba(255,79,106,.06)' : 'transparent',
                }}>
                  <div style={{ color: isBlack ? 'var(--red)' : 'var(--soft)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {isBlack ? '🚫 ' : ''}{r.league || '—'}
                  </div>
                  <div style={{ color:'var(--white)' }}>{r.market}</div>
                  <div style={{ textAlign:'right', color:'var(--mute)' }}>{r.n}</div>
                  <div style={{ textAlign:'right' }}>{r.winRate}%</div>
                  <div style={{ textAlign:'right',
                    color: r.roi > 0 ? 'var(--green)' : r.roi < 0 ? 'var(--red)' : 'var(--mute)',
                    fontWeight: 700,
                  }}>{r.roi > 0 ? '+' : ''}{r.roi}%</div>
                  <div style={{ textAlign:'right',
                    color: r.avgClv == null ? 'var(--mute)' : r.avgClv > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {r.avgClv == null ? '—' : `${r.avgClv > 0 ? '+' : ''}${r.avgClv}%`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Brier por mercado */}
      {brier.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
            color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6 }}>
            🎯 Brier score por mercado (60d) · menor = melhor calibrado
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
            {brier.map(b => {
              const baseline = { '1X2':0.21, 'BTTS':0.22, 'Over':0.23, 'Combo':0.20, 'DC':0.18 }[b.market] || 0.22
              const drift = b.brier > baseline * 1.15
              return (
                <div key={b.market} style={{
                  background:'var(--card-bg)', border:`1px solid ${drift ? 'rgba(255,79,106,.4)' : 'var(--card-border)'}`,
                  borderRadius:6, padding:'6px 10px',
                }}>
                  <div style={{ fontSize: 10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>{b.market}</div>
                  <div style={{ fontSize: 14, fontWeight:800,
                    color: drift ? 'var(--red)' : b.brier < baseline ? 'var(--green)' : 'var(--amber)',
                    fontFamily:"'JetBrains Mono',monospace" }}>
                    {b.brier?.toFixed(3) ?? '—'}
                  </div>
                  <div style={{ fontSize: 9, color:'var(--mute)' }}>n={b.n} · base {baseline}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Reliability diagram (texto) */}
      {reliab.some(r => r.n > 0) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
            color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6 }}>
            📈 Reliability — quando o modelo diz X%, fechamos em quanto?
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap: 8 }}>
            {reliab.map(r => (
              <div key={r.label} style={{
                background:'var(--card-bg)', border:'1px solid var(--card-border)',
                borderRadius:6, padding:'8px 10px', textAlign:'center', opacity: r.n ? 1 : .35,
              }}>
                <div style={{ fontSize: 10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>{r.label}</div>
                <div style={{ fontSize: 16, fontWeight:800, color:'var(--white)',
                  fontFamily:"'JetBrains Mono',monospace" }}>
                  {r.n > 0 ? `${r.actual}%` : '—'}
                </div>
                <div style={{ fontSize: 9,
                  color: Math.abs(r.gap || 0) <= 5 ? 'var(--green)'
                       : Math.abs(r.gap || 0) <= 10 ? 'var(--amber)' : 'var(--red)' }}>
                  {r.n > 0 ? `gap ${r.gap >= 0 ? '+' : ''}${r.gap}pp · n=${r.n}` : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mercados banidos / degradados */}
      {(blackset.size > 0 || degraded.length > 0) && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
            color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6 }}>
            🚫 Auto-Blacklist (ROI ≤ -3% ou CLV ≤ -1% em n≥30)
          </div>
          <div style={{ display:'flex', gap: 6, flexWrap:'wrap' }}>
            {[...blackset].map(k => (
              <span key={k} style={{
                fontSize: 10, fontFamily:"'JetBrains Mono',monospace",
                color:'var(--red)', background:'rgba(255,79,106,.1)',
                border:'1px solid rgba(255,79,106,.3)', padding:'3px 7px', borderRadius:4,
              }}>BAN · {k.replace('__', ' / ')}</span>
            ))}
            {degraded.map((d, i) => (
              <span key={i} title={d.reason} style={{
                fontSize: 10, fontFamily:"'JetBrains Mono',monospace",
                color:'var(--amber)', background:'rgba(255,184,48,.1)',
                border:'1px solid rgba(255,184,48,.3)', padding:'3px 7px', borderRadius:4,
              }}>⚠ {d.league || '—'} / {d.market} · {d.reason}</span>
            ))}
          </div>
        </div>
      )}

      {/* Picks pendentes (input rápido odd_close + resultado) */}
      {pending > 0 && (
        <div>
          <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
            color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6 }}>
            ⏳ Picks pendentes ({pending}) — clique pra fechar
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap: 8 }}>
            {diary.filter(p => !p.result || p.result === 'P').slice(-12).reverse().map(p => (
              <div key={p.id} style={{
                background:'var(--card-bg)', border:'1px solid var(--card-border)',
                borderRadius: 6, padding:'8px 10px', fontSize: 11,
              }}>
                <div style={{ fontSize: 10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace", marginBottom: 2 }}>
                  {p.league || '—'} · {p.market}
                </div>
                <div style={{ fontWeight:700, color:'var(--white)', marginBottom: 2 }}>{p.home} × {p.away}</div>
                <div style={{ color:'var(--soft)', marginBottom: 4 }}>{p.label}</div>
                <div style={{ display:'flex', gap: 4, alignItems:'center', fontSize: 10, fontFamily:"'JetBrains Mono',monospace" }}>
                  <span style={{ color:'var(--mute)' }}>open {p.odd_open}</span>
                  {p.odd_close && <span style={{ color: p.clv > 0 ? 'var(--green)' : 'var(--red)' }}>· clv {p.clv > 0 ? '+' : ''}{p.clv}%</span>}
                </div>
                <div style={{ display:'flex', gap: 4, marginTop: 6 }}>
                  {!p.odd_close && (
                    <button onClick={() => handleClose(p.id)} className="btn" style={{padding:'2px 8px',fontSize:9}}>+ close</button>
                  )}
                  <button onClick={() => handleResult(p.id, 'W')} className="btn" style={{padding:'2px 8px',fontSize:9,color:'var(--green)'}}>W</button>
                  <button onClick={() => handleResult(p.id, 'L')} className="btn" style={{padding:'2px 8px',fontSize:9,color:'var(--red)'}}>L</button>
                  <button onClick={() => handleResult(p.id, 'V')} className="btn" style={{padding:'2px 8px',fontSize:9,color:'var(--mute)'}}>V</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CLVTracker() {
  const [entries, setEntries] = useState(loadCLV)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ match:'', pick:'', openOdd:'', closingOdd:'', result:'', date:new Date().toLocaleDateString('pt-BR') })

  function addEntry() {
    if (!form.match||!form.openOdd) return
    const entry = { ...form, id:Date.now(), openOdd:parseFloat(form.openOdd), closingOdd:parseFloat(form.closingOdd)||null }
    const updated = [entry,...entries]
    setEntries(updated); saveCLV(updated)
    setForm({ match:'',pick:'',openOdd:'',closingOdd:'',result:'',date:new Date().toLocaleDateString('pt-BR') })
    setShowForm(false)
  }

  function deleteEntry(id) {
    const updated = entries.filter(e=>e.id!==id)
    setEntries(updated); saveCLV(updated)
  }

  function updateClosing(id, odd) {
    const updated = entries.map(e=>e.id===id?{...e,closingOdd:parseFloat(odd)||null}:e)
    setEntries(updated); saveCLV(updated)
  }

  const stats = useMemo(() => {
    const withCLV = entries.filter(e=>e.closingOdd)
    const clvValues = withCLV.map(e=>(e.openOdd/e.closingOdd-1)*100)
    const positive = clvValues.filter(c=>c>0).length
    const avgCLV = clvValues.length ? clvValues.reduce((a,b)=>a+b,0)/clvValues.length : null
    return { total:entries.length, withCLV:withCLV.length, positive, avgCLV }
  }, [entries])

  const F = ({label,k,type='text'})=>(
    <div style={{display:'flex',flexDirection:'column',gap:3}}>
      <label style={{fontSize: 11,color:'var(--mute)',fontFamily:"'JetBrains Mono',monospace",textTransform:'uppercase',letterSpacing:'.5px'}}>{label}</label>
      <input type={type} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:'5px 8px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none'}}/>
    </div>
  )

  return (
    <div className="page">
      <PageHeader icon="📉" title="CLV Tracker"
        subtitle="Closing Line Value — mede a qualidade das suas apostas antes do fechamento"
        actions={<button onClick={()=>setShowForm(v=>!v)} className="btn btn-primary" style={{padding:'4px 10px',fontSize:11}}>+ Registrar</button>}
      />

      <div style={{background:'linear-gradient(135deg,rgba(59,158,255,.08),rgba(0,214,143,.06))',border:'1px solid rgba(59,158,255,.2)',borderRadius:'var(--r2)',padding:'10px 14px',marginBottom:14,fontSize:11,color:'var(--soft)'}}>
        💡 <b style={{color:'var(--white)'}}>O que é CLV?</b> Se você consegue sistematicamente apostas com odds acima do fechamento (CLV positivo), você está apostando melhor que o mercado — indicador mais confiável de edge a longo prazo.
      </div>

      <AutoDiarySection/>

      <div style={{ fontSize: 13, fontWeight: 800, color:'var(--white)',
        fontFamily:"'JetBrains Mono',monospace", letterSpacing:'.04em',
        margin: '8px 0 10px', display:'flex', alignItems:'center', gap: 8 }}>
        ✍ MANUAL · REGISTROS DE CLV
      </div>
      <KpiRow>
        <Kpi value={stats.total} label="Registros" color="var(--soft)"/>
        <Kpi value={stats.withCLV} label="Com CLV" color="var(--blue)"/>
        <Kpi value={stats.positive} label="CLV Positivo" color="var(--green)"/>
        <Kpi value={stats.avgCLV!==null?`${stats.avgCLV>0?'+':''}${stats.avgCLV.toFixed(1)}%`:'-'} label="CLV Médio" color={stats.avgCLV>0?'var(--green)':stats.avgCLV<0?'var(--red)':'var(--mute)'}/>
      </KpiRow>

      {showForm && (
        <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',padding:'14px',marginBottom:14}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1px',marginBottom:12,textTransform:'uppercase'}}>Novo Registro CLV</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:12}}>
            <F label="Partida" k="match"/>
            <F label="Pick" k="pick"/>
            <F label="Odd Abertura" k="openOdd" type="number"/>
            <F label="Odd Fechamento" k="closingOdd" type="number"/>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              <label style={{fontSize: 11,color:'var(--mute)',fontFamily:"'JetBrains Mono',monospace",textTransform:'uppercase',letterSpacing:'.5px'}}>Resultado</label>
              <select value={form.result} onChange={e=>setForm(f=>({...f,result:e.target.value}))} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:'5px 8px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none'}}>
                <option value="">Pendente</option>
                <option value="W">WIN</option>
                <option value="L">LOSS</option>
                <option value="V">VOID</option>
              </select>
            </div>
            <F label="Data" k="date"/>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={addEntry} className="btn btn-primary" style={{padding:'6px 14px',fontSize:11}}>Salvar</button>
            <button onClick={()=>setShowForm(false)} className="btn" style={{padding:'6px 14px',fontSize:11}}>Cancelar</button>
          </div>
        </div>
      )}

      {entries.length===0 && (
        <EmptyState icon="📉" title="Nenhum registro ainda" subtitle='Use "+ Registrar" para começar a trackear seu CLV'/>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:10}}>
        {entries.map(e=><CLVCard key={e.id} entry={e} onDelete={deleteEntry}/>)}
      </div>
    </div>
  )
}
