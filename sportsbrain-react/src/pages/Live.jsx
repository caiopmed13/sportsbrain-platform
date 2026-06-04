import { useEffect, useState, useRef, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import SportTabs from '../components/ui/SportTabs'
import EmptyState from '../components/ui/EmptyState'
import { fetchLive } from '../api/client'

const SPORT_ICONS = { football:'⚽', basketball:'🏀', american_football:'🏈', baseball:'⚾', hockey:'🏒', tennis:'🎾', mma:'🥊', esports:'🎮' }

function LiveCard({ ev }) {
  const sport = ev.sport||'football'
  const scoreH = ev.score?.home??ev.goals?.home??null
  const scoreA = ev.score?.away??ev.goals?.away??null
  const min = ev.minute||ev.elapsed||null
  const isHT = (ev.status||'').toUpperCase()==='HT'||(ev.status||'').toUpperCase()==='HALFTIME'

  return (
    <div style={{
      background:'var(--card-bg)',
      border:`1px solid ${isHT?'rgba(255,184,48,.25)':'rgba(255,79,106,.2)'}`,
      borderRadius:'var(--r2)',
      padding:'12px 14px',
      position:'relative',
      overflow:'hidden',
    }}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:isHT?'var(--amber)':'var(--red)',opacity:.7}}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span>{SPORT_ICONS[sport]||'🏟'}</span>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--dim)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:150}}>
            {ev.league?.name||ev.competition?.name||'Liga'}
          </span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          {!isHT && <span style={{width:5,height:5,borderRadius:'50%',background:'var(--red)',display:'inline-block',animation:'pulse 1s infinite'}}/>}
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,fontWeight:700,color:isHT?'var(--amber)':'var(--red)'}}>
            {isHT?'INTERVALO':min?`${min}'`:'AO VIVO'}
          </span>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:10,alignItems:'center'}}>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--white)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {ev.teams?.home?.name||ev.homeTeam?.name||ev.home||'Casa'}
          </div>
        </div>
        <div style={{textAlign:'center',background:'rgba(0,0,0,.3)',borderRadius:'var(--r)',padding:'6px 12px'}}>
          {scoreH!==null && scoreA!==null ? (
            <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:22,fontWeight:900,color:isHT?'var(--amber)':'var(--red)',lineHeight:1,letterSpacing:2}}>
              {scoreH} – {scoreA}
            </div>
          ) : (
            <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:14,fontWeight:700,color:'var(--mute)'}}>— —</div>
          )}
        </div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:'var(--white)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {ev.teams?.away?.name||ev.awayTeam?.name||ev.away||'Fora'}
          </div>
        </div>
      </div>
      {ev.events?.length>0 && (
        <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--line)',display:'flex',gap:4,flexWrap:'wrap'}}>
          {ev.events.slice(-3).map((e,i)=>(
            <span key={i} style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--soft)',background:'rgba(255,255,255,.05)',padding:'1px 5px',borderRadius:3}}>
              {e.time}' {e.type==='goal'?'⚽':e.type==='yellowcard'?'🟨':e.type==='redcard'?'🟥':'•'} {e.player||''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Live() {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(false)
  const [sport, setSport] = useState('all')
  const [refreshRate, setRefreshRate] = useState(30)
  const [countdown, setCountdown] = useState(30)
  const [lastUpdate, setLastUpdate] = useState(null)
  const timerRef = useRef(null)
  const countRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchLive()
      const raw = res.events||res.matches||res.data||res||[]
      setGames(Array.isArray(raw)?raw:[])
      setLastUpdate(new Date().toLocaleTimeString('pt-BR'))
    } catch(e) {
      console.warn('[Live]',e.message)
      setGames([])
    }
    setLoading(false)
    setCountdown(refreshRate)
  }, [refreshRate])

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, refreshRate*1000)
    countRef.current = setInterval(()=>setCountdown(c=>c>0?c-1:refreshRate), 1000)
    return () => { clearInterval(timerRef.current); clearInterval(countRef.current) }
  }, [refreshRate])

  const filtered = sport==='all' ? games : games.filter(g=>(g.sport||'football')===sport)
  const available = [...new Set(games.map(g=>g.sport||'football'))]

  const kpis = {
    total: games.length,
    football: games.filter(g=>g.sport==='football').length,
    basket: games.filter(g=>g.sport==='basketball').length,
    other: games.filter(g=>!['football','basketball'].includes(g.sport)).length,
  }

  return (
    <div className="page">
      <PageHeader icon="🔴" title="Ao Vivo"
        subtitle={lastUpdate?`Atualizado às ${lastUpdate} · próximo em ${countdown}s`:'Carregando...'}
        actions={
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)'}}>Auto:</span>
            <select value={refreshRate} onChange={e=>setRefreshRate(Number(e.target.value))}
              style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:'3px 6px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--soft)',cursor:'pointer'}}>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>2min</option>
            </select>
            <button onClick={load} className="btn" style={{padding:'4px 10px',fontSize:11}}>↺ Atualizar</button>
          </div>
        }
      />

      <KpiRow>
        <Kpi value={kpis.total} label="🔴 Total AV" color="var(--red)" pulse={kpis.total>0}/>
        <Kpi value={kpis.football} label="⚽ Futebol" color="var(--green)"/>
        <Kpi value={kpis.basket} label="🏀 Basquete" color="var(--blue)"/>
        <Kpi value={kpis.other} label="🎮 Outros" color="var(--amber)"/>
      </KpiRow>

      {available.length>1 && <SportTabs value={sport} onChange={setSport} available={available} compact/>}

      {loading && games.length===0 && (
        <div className="loading-center"><div className="spinner"/><span>Buscando jogos ao vivo...</span></div>
      )}

      {!loading && filtered.length===0 && (
        <EmptyState icon="🔴" title="Nenhum jogo ao vivo" subtitle="Não há partidas em andamento no momento" action={<button onClick={load} className="btn btn-primary" style={{marginTop:8}}>↺ Verificar</button>}/>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(100%,480px),1fr))',gap:10}}>
        {filtered.map((ev,i)=><LiveCard key={ev.id||i} ev={ev}/>)}
      </div>
    </div>
  )
}
