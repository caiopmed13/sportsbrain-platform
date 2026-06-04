import { useState, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'

const SK = 'sb_v10'
const MARKETS = ['result','over_under','btts','handicap','corners','ht','player_props','dnb','dc']

function loadPicks() { try { return JSON.parse(localStorage.getItem(SK)||'[]') } catch { return [] } }

export default function Stats() {
  const [picks] = useState(loadPicks)
  const [sport, setSport] = useState('all')

  const filtered = sport==='all' ? picks : picks.filter(p=>p.sport===sport)
  const resolved = filtered.filter(p=>p.result&&p.result!=='V')

  const byMarket = useMemo(() => {
    const map = {}
    resolved.forEach(p => {
      const m = p.market||'Outros'
      if (!map[m]) map[m] = { w:0, t:0, conf:[], ev:[] }
      map[m].t++
      if (p.result==='W') map[m].w++
      if (p.conf) map[m].conf.push(p.conf)
      if (p.ev) map[m].ev.push(p.ev)
    })
    return Object.entries(map).map(([m,v])=>({
      market: m,
      w: v.w, t: v.t,
      wr: v.t ? (v.w/v.t*100) : null,
      avgConf: v.conf.length ? v.conf.reduce((a,b)=>a+b,0)/v.conf.length : null,
      avgEv: v.ev.length ? v.ev.reduce((a,b)=>a+b,0)/v.ev.length : null,
    })).sort((a,b)=>b.t-a.t)
  }, [resolved])

  const bySport = useMemo(() => {
    const map = {}
    resolved.forEach(p => {
      const s = p.sport||'football'
      if (!map[s]) map[s] = { w:0, t:0 }
      map[s].t++; if (p.result==='W') map[s].w++
    })
    return map
  }, [resolved])

  const byOddBand = useMemo(() => {
    const bands = [
      { label:'1.10 – 1.50', min:1.10, max:1.50 },
      { label:'1.50 – 1.80', min:1.50, max:1.80 },
      { label:'1.80 – 2.20', min:1.80, max:2.20 },
      { label:'2.20 – 3.00', min:2.20, max:3.00 },
      { label:'3.00+',       min:3.00, max:99 },
    ]
    return bands.map(b => {
      const inBand = resolved.filter(p=>p.odd>=b.min&&p.odd<b.max)
      const wins = inBand.filter(p=>p.result==='W')
      return { ...b, t:inBand.length, w:wins.length, wr:inBand.length?(wins.length/inBand.length*100):null }
    })
  }, [resolved])

  const totalWr = resolved.length ? (resolved.filter(p=>p.result==='W').length/resolved.length*100).toFixed(1) : null

  const sports = [...new Set(picks.map(p=>p.sport||'football'))]

  return (
    <div className="page">
      <PageHeader icon="📈" title="Estatísticas Avançadas" subtitle={`${picks.length} picks registrados · ${resolved.length} resolvidos`}/>

      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        {['all',...sports].map(s=>(
          <button key={s} onClick={()=>setSport(s)} style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,padding:'4px 12px',borderRadius:20,border:`1px solid ${sport===s?'rgba(59,158,255,.5)':'rgba(255,255,255,.1)'}`,background:sport===s?'rgba(59,158,255,.15)':'transparent',color:sport===s?'var(--blue)':'var(--mute)',cursor:'pointer'}}>
            {s==='all'?'Todos':s==='football'?'⚽ Futebol':s==='basketball'?'🏀 Basquete':s}
          </button>
        ))}
      </div>

      <KpiRow>
        <Kpi value={filtered.length} label="Total" color="var(--soft)"/>
        <Kpi value={resolved.length} label="Resolvidos" color="var(--blue)"/>
        <Kpi value={totalWr?`${totalWr}%`:'-'} label="Win Rate Global" color={Number(totalWr)>=55?'var(--green)':Number(totalWr)>=45?'var(--amber)':'var(--red)'}/>
        <Kpi value={byMarket.length} label="Mercados" color="var(--purple)"/>
      </KpiRow>

      {resolved.length===0 && <EmptyState icon="📈" title="Sem dados suficientes" subtitle="Registre e marque resultados de picks para ver estatísticas"/>}

      {byMarket.length>0 && (
        <>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:10}}>Win Rate por Mercado</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:20}}>
            {byMarket.map((m,i)=>{
              const wr = m.wr?.toFixed(1)
              const color = Number(wr)>=55?'var(--green)':Number(wr)>=45?'var(--amber)':'var(--red)'
              return (
                <div key={i} style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r)',padding:'8px 12px',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{flex:1,minWidth:100}}>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--white)'}}>{m.market}</span>
                  </div>
                  {/* Barra visual */}
                  <div style={{flex:2,display:'flex',alignItems:'center',gap:8}}>
                    <div style={{flex:1,height:4,borderRadius:2,background:'var(--line)',overflow:'hidden'}}>
                      <div style={{width:`${m.wr||0}%`,height:'100%',background:color,borderRadius:2,transition:'width .3s ease'}}/>
                    </div>
                    <span style={{fontFamily:"'JetBrains Mono', monospace",fontSize:16,fontWeight:800,color,minWidth:48}}>{wr?`${wr}%`:'-'}</span>
                  </div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--dim)',textAlign:'right',minWidth:50}}>{m.w}/{m.t}</div>
                </div>
              )
            })}
          </div>

          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:10}}>Desempenho por Faixa de Odd</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:8,marginBottom:20}}>
            {byOddBand.filter(b=>b.t>0).map((b,i)=>(
              <div key={i} style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r)',padding:'10px 12px',textAlign:'center'}}>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginBottom:6}}>{b.label}</div>
                <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:20,fontWeight:800,color:Number(b.wr?.toFixed(1))>=55?'var(--green)':Number(b.wr?.toFixed(1))>=45?'var(--amber)':'var(--red)'}}>{b.wr?`${b.wr.toFixed(0)}%`:'-'}</div>
                <div style={{fontSize: 11,color:'var(--dim)',marginTop:2}}>{b.w}/{b.t}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
