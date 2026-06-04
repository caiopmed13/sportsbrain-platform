// ══════════════════════════════════════════════════════════
// Jogos de Hoje — implementação completa com melhorias
// Melhorias: skeleton loading, hero zone React, filtros
// reativos, auto-refresh inteligente, OUT players
// ══════════════════════════════════════════════════════════
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useHojeStore, useUIStore } from '../store'
import { fetchMatches } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import SportTabs from '../components/ui/SportTabs'
import EmptyState from '../components/ui/EmptyState'
import { matchPriority, fetchFeaturedMatches } from '../utils/featured'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function localDateOf(isoStr) {
  if (!isoStr) return null
  const d = new Date(isoStr)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtTime(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
}
function normStatus(s = '') {
  const u = (s || '').toUpperCase()
  if (['1H','2H','LIVE','IN_PLAY','ACTIVE','IN_PROGRESS','RUNNING','STATUS_IN_PROGRESS','STATUS_FIRST_HALF','STATUS_SECOND_HALF'].includes(u)) return 'LIVE'
  if (['HT','HALFTIME','PAUSED','BREAK','STATUS_HALFTIME'].includes(u)) return 'HT'
  if (['FT','FINISHED','COMPLETE','COMPLETED','FULL_TIME','POST','POSTGAME','ENDED','FT_PEN','FT_OT','FT_AET','AET','PEN','AWARDED','STATUS_FINAL','STATUS_FULL_TIME','STATUS_FULL','CLOSED'].includes(u)) return 'FT'
  if (u.startsWith('STATUS_FINAL') || u.startsWith('FT')) return 'FT'
  return 'NS'
}
// Detector robusto de jogo encerrado — usa status + heurística (placar final + tempo passou)
function isMatchFinished(ev) {
  const status = normStatus(ev.status || ev.state || ev.fixture?.status?.short || '')
  if (status === 'FT') return true
  if (status === 'LIVE' || status === 'HT') return false
  // Heurística: tem score E kickoff foi há mais de 2.5h (jogo de futebol = 90+15+15 = ~2h max)
  const hasScore = (ev.score?.home != null && ev.score?.away != null)
                || (ev.home_score != null && ev.away_score != null)
                || (ev.fixture?.score?.fulltime?.home != null)
  if (!hasScore) return false
  const ko = ev.kickoff || ev.match_time || ev.time || ev.fixture?.date
  if (!ko) return false
  const koMs = typeof ko === 'string' ? Date.parse(ko) : (ko instanceof Date ? ko.getTime() : null)
  if (!koMs || Number.isNaN(koMs)) return false
  const elapsedH = (Date.now() - koMs) / 3600_000
  return elapsedH >= 2.5
}
function groupBySport(data) {
  if (Array.isArray(data)) {
    const g = {}
    data.forEach(ev => { const s = ev.sport || 'football'; if (!g[s]) g[s] = []; g[s].push(ev) })
    return g
  }
  return data || {}
}
function groupByLeague(events) {
  const g = {}
  events.forEach(ev => {
    const k = ev.league?.name || (typeof ev.league === 'string' ? ev.league : null) || ev.competition?.name || 'Outros'
    if (!g[k]) g[k] = []
    g[k].push(ev)
  })
  return g
}

const SPORT_ICONS = { football:'⚽', basketball:'🏀', american_football:'🏈', baseball:'⚾', hockey:'🏒', tennis:'🎾', mma:'🥊', esports:'🎮' }

function Skeleton() {
  return (
    <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',padding:'10px 12px',marginBottom:6}}>
      {[1,2].map(r=>(
        <div key={r} style={{display:'flex',gap:8,alignItems:'center',marginBottom:r===1?6:0}}>
          <div style={{width:40,height:8,borderRadius:4,background:'var(--line)',animation:'pulse 1.5s infinite'}}/>
          <div style={{flex:1,height:10,borderRadius:4,background:'var(--line)',animation:'pulse 1.5s infinite'}}/>
          <div style={{width:50,height:8,borderRadius:4,background:'var(--line)',animation:'pulse 1.5s infinite'}}/>
        </div>
      ))}
    </div>
  )
}

function MatchCard({ ev, sport }) {
  const status = normStatus(ev.status || ev.state)
  const isLive = status === 'LIVE'
  const isHT   = status === 'HT'
  const isFT   = status === 'FT'
  const scoreH = ev.score?.home ?? ev.goals?.home ?? ev.ft_goals_home ?? null
  const scoreA = ev.score?.away ?? ev.goals?.away ?? ev.ft_goals_away ?? null
  const hasScore = scoreH !== null && scoreA !== null
  const min = ev.minute || ev.elapsed || null
  const id  = ev.id || ev.fixture?.id || Math.random()
  const homeTeam = ev.teams?.home?.name || ev.homeTeam?.name || ev.home_team || ev.home_team_name || ev.home || '—'
  const awayTeam = ev.teams?.away?.name || ev.awayTeam?.name || ev.away_team || ev.away_team_name || ev.away || '—'

  return (
    <div
      style={{
        background: isLive
          ? 'linear-gradient(135deg, rgba(255,79,106,.06), rgba(11,17,32,.95))'
          : 'var(--card-bg)',
        border: `1px solid ${isLive ? 'rgba(255,79,106,.25)' : isHT ? 'rgba(255,184,48,.2)' : 'var(--card-border)'}`,
        borderRadius: 'var(--r)',
        marginBottom: 4,
        overflow: 'hidden',
        transition: 'border-color var(--transition-fast)',
      }}
    >
      {/* Linha vermelha topo para jogos live */}
      {(isLive || isHT) && (
        <div style={{
          height: 2,
          background: isHT ? 'var(--amber)' : 'var(--red)',
          opacity: .8,
        }} />
      )}

      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* Coluna esquerda: status/tempo — largura fixa */}
        <div style={{ width: 46, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          {isLive ? (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(255,79,106,.18)', border: '1px solid rgba(255,79,106,.35)',
                borderRadius: 4, padding: '2px 5px',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', animation: 'pulse 1s infinite', flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--font-sans, 'Inter', sans-serif)", fontSize: 11, color: 'var(--red)', fontWeight: 800, letterSpacing: '.5px' }}>AO VIVO</span>
              </div>
              {min && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: 'var(--red)', fontWeight: 700 }}>{min}'</span>}
            </>
          ) : isHT ? (
            <div style={{
              background: 'rgba(255,184,48,.15)', border: '1px solid rgba(255,184,48,.3)',
              borderRadius: 4, padding: '2px 5px',
            }}>
              <span style={{ fontFamily: "var(--font-sans, 'Inter', sans-serif)", fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>INTER.</span>
            </div>
          ) : isFT ? (
            <div style={{
              background: 'rgba(90,126,168,.1)', border: '1px solid rgba(90,126,168,.2)',
              borderRadius: 4, padding: '2px 5px',
            }}>
              <span style={{ fontFamily: "var(--font-sans, 'Inter', sans-serif)", fontSize: 11, color: 'var(--dim)', fontWeight: 600 }}>FIM</span>
            </div>
          ) : (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: 'var(--soft)', fontWeight: 600, textAlign: 'center', lineHeight: 1 }}>
              {fmtTime(ev.date || ev.fixture?.date)}
            </span>
          )}
        </div>

        {/* Centro: times */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: isFT ? 'var(--soft)' : 'var(--white)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 5,
          }}>{homeTeam}</div>
          <div style={{
            fontSize: 14, fontWeight: 500, color: isFT ? 'var(--dim)' : 'var(--soft)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{awayTeam}</div>
        </div>

        {/* Direita: placar horizontal */}
        {hasScore && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 800,
            fontSize: 18,
            color: isLive ? 'var(--red)' : isFT ? 'var(--t3)' : 'var(--t1)',
            letterSpacing: '-0.02em', lineHeight: 1,
          }}>
            <span>{scoreH}</span>
            <span style={{ color: 'var(--t3)', fontWeight: 400, fontSize: 14 }}>–</span>
            <span>{scoreA}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Hoje() {
  const { data, loaded, loading, setData, setLoading } = useHojeStore()
  const searchQuery = useUIStore(s => s.searchQuery)
  const [sport, setSport] = useState('all')
  const [featuredList, setFeaturedList] = useState([])
  const [showFt, setShowFt] = useState(false)
  const [outPlayer, setOutPlayer] = useState('')
  const [outPlayers, setOutPlayers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sb_out_players')||'[]') } catch { return [] }
  })
  const refreshRef = useRef(null)

  const loadingRef = useRef(false)
  const load = useCallback(async (force=false) => {
    if (loadingRef.current && !force) return
    loadingRef.current = true
    setLoading(true)
    try {
      const todayLocal = today()
      const res = await fetchMatches({ date: todayLocal, per_page: 200 })
      const all = res.matches || res.data || res || []
      // Filtrar somente jogos cujo horário local pertence a hoje
      const forToday = all.filter(g => {
        const d = g.date || g.date_utc || g.utcDate
        return !d || localDateOf(d) === todayLocal
      })
      setData(groupBySport(forToday))
    } catch(e) { console.warn('[Hoje]',e.message) } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!loaded) load()
    refreshRef.current = setInterval(()=>load(true), 90_000)
    return () => clearInterval(refreshRef.current)
  }, [])
  useEffect(() => { fetchFeaturedMatches().then(setFeaturedList).catch(()=>{}) }, [])

  const kpis = useMemo(() => {
    const all = Object.values(data).flat()
    const ss = all.map(e=>normStatus(e.status||e.state))
    return {
      total: all.length,
      live: ss.filter(s=>s==='LIVE'||s==='HT').length,
      ns: ss.filter(s=>s==='NS').length,
      ft: ss.filter(s=>s==='FT').length,
      sports: new Set(Object.keys(data).filter(s=>(data[s]||[]).length>0)).size,
      leagues: new Set(all.map(e=>e.league?.name||(typeof e.league==='string'?e.league:null)||e.competition?.name).filter(Boolean)).size,
    }
  }, [data])

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    const bySport = sport==='all' ? data : { [sport]: data[sport]||[] }
    const out = {}
    Object.entries(bySport).forEach(([s,evs]) => {
      let arr = evs||[]
      if (!showFt) arr = arr.filter(e => !isMatchFinished(e))
      if (q) arr = arr.filter(e => {
        const home = (e.teams?.home?.name||e.home_team||e.home||'').toLowerCase()
        const away = (e.teams?.away?.name||e.away_team||e.away||'').toLowerCase()
        const league = (e.league?.name||e.competition?.name||'').toLowerCase()
        return home.includes(q)||away.includes(q)||league.includes(q)
      })
      // Ordena: Bet365 em destaque → Brasil → ligas top → resto
      arr = arr.slice().sort((a, b) => {
        const lg  = e => e.league?.name||(typeof e.league==='string'?e.league:null)||e.competition?.name||''
        const hn  = e => e.teams?.home?.name||e.home_team||e.home||''
        const an  = e => e.teams?.away?.name||e.away_team||e.away||''
        return matchPriority(hn(a), an(a), lg(a), featuredList) - matchPriority(hn(b), an(b), lg(b), featuredList)
      })
      if (arr.length>0) out[s]=arr
    })
    return out
  }, [data, sport, featuredList, showFt, searchQuery])

  const available = useMemo(()=>Object.keys(data).filter(s=>(data[s]||[]).length>0), [data])
  const total = Object.values(filtered).reduce((a,v)=>a+(v?.length||0),0)

  function addOut(n) {
    if (!n.trim()) return
    const u = [...new Set([...outPlayers,n.trim()])]
    setOutPlayers(u); localStorage.setItem('sb_out_players',JSON.stringify(u)); setOutPlayer('')
  }
  function removeOut(n) {
    const u=outPlayers.filter(p=>p!==n); setOutPlayers(u); localStorage.setItem('sb_out_players',JSON.stringify(u))
  }

  return (
    <div className="page">
      <PageHeader icon="📅" title="Jogos do Dia"
        subtitle={loaded?`${kpis.total} jogos · ${kpis.live} ao vivo · auto-refresh 90s`:undefined}
        actions={
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{fontSize:12,color:'var(--mute)',fontWeight:600}}>🚫 OUT</span>
              {outPlayers.map(p=>(
                <span key={p} onClick={()=>removeOut(p)} style={{fontSize:12,background:'rgba(255,79,106,.15)',color:'var(--red)',border:'1px solid rgba(255,79,106,.3)',borderRadius:5,padding:'2px 7px',cursor:'pointer',fontWeight:600}}>
                  {p} ✕
                </span>
              ))}
              <input value={outPlayer} onChange={e=>setOutPlayer(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addOut(outPlayer)} placeholder="+ jogador..."
                style={{fontFamily:"'Inter', sans-serif",fontSize:13,padding:'4px 10px',borderRadius:6,border:'1px solid rgba(255,80,80,.35)',background:'rgba(255,80,80,.07)',color:'var(--white)',width:120,outline:'none'}}
              />
            </div>
            <button onClick={()=>setShowFt(v=>!v)} className="btn" style={{padding:'6px 12px',fontSize:13,...(showFt?{borderColor:'rgba(255,184,48,.5)',color:'var(--amber)',background:'rgba(255,184,48,.08)'}:{opacity:.55})}}>🏁 Encerrados</button>
            <button onClick={()=>load(true)} className="btn" style={{padding:'6px 12px',fontSize:13}}>↺ Atualizar</button>
          </div>
        }
      />

      {(loaded||loading) && (
        <KpiRow>
          <Kpi value={kpis.total} label="Total Jogos" color="var(--soft)"/>
          <Kpi value={kpis.live} label="🔴 Ao Vivo" color="var(--red)" pulse={kpis.live>0}/>
          <Kpi value={kpis.ns} label="⏳ Agendados" color="var(--blue)"/>
          <Kpi value={kpis.ft} label="✅ Encerrados" color="var(--green)"/>
          <Kpi value={kpis.sports} label="Esportes" color="var(--amber)"/>
          <Kpi value={kpis.leagues} label="Ligas" color="var(--purple)"/>
        </KpiRow>
      )}

      {loaded && available.length>1 && (
        <SportTabs value={sport} onChange={setSport} available={available} compact/>
      )}

      {loading && !loaded && Array.from({length:8},(_,i)=><Skeleton key={i}/>)}

      {/* ── Live section pinned at top ── */}
      {loaded && (() => {
        const liveEvs = Object.entries(filtered).flatMap(([s,evs]) =>
          (evs||[]).filter(e => { const st = normStatus(e.status||e.state); return st==='LIVE'||st==='HT' })
            .map(e => ({ ...e, _sport: s }))
        )
        if (!liveEvs.length) return null
        return (
          <div style={{marginBottom:16}}>
            <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:13,fontWeight:800,color:'var(--red)',
              marginBottom:8,display:'flex',alignItems:'center',gap:7,paddingBottom:6,
              borderBottom:'1px solid rgba(255,79,106,.2)'}}>
              <span style={{width:7,height:7,borderRadius:'50%',background:'var(--red)',display:'inline-block',animation:'pulse 1s infinite'}}/>
              AO VIVO · {liveEvs.length}
            </div>
            {liveEvs.map(ev => (
              <MatchCard key={ev.id||`${ev.home_team||ev.home}-${ev.away_team||ev.away}-live`} ev={ev} sport={ev._sport} />
            ))}
          </div>
        )
      })()}

      {loaded && total===0 && (
        <EmptyState icon="📭" title="Nenhum jogo encontrado"
          subtitle={sport!=='all'?'Tente outro esporte ou habilite encerrados':'Sem jogos para hoje nesta fonte'}
          action={<button onClick={()=>load(true)} className="btn btn-primary" style={{marginTop:8}}>↺ Atualizar</button>}
        />
      )}

      {loaded && Object.entries(filtered).map(([sportKey,evs])=>{
        const groups = groupByLeague(evs)
        return (
          <div key={sportKey} style={{marginBottom:20}}>
            {Object.keys(filtered).length>1 && (
              <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:16,fontWeight:800,color:'var(--white)',marginBottom:10,display:'flex',alignItems:'center',gap:7,paddingBottom:6,borderBottom:'1px solid var(--line)'}}>
                <span style={{fontSize:18}}>{SPORT_ICONS[sportKey]||'🏟'}</span>
                <span style={{textTransform:'uppercase',letterSpacing:'.5px'}}>{sportKey}</span>
                <span style={{color:'var(--mute)',fontFamily:"'Inter', sans-serif",fontSize:13,fontWeight:500}}>({evs.length})</span>
              </div>
            )}
            {Object.entries(groups).map(([league,items])=>(
              <div key={league} style={{marginBottom:10}}>
                <div style={{fontFamily:"'Inter', sans-serif",fontSize:12,fontWeight:600,color:'var(--dim)',letterSpacing:'.03em',textTransform:'uppercase',marginBottom:5,paddingLeft:8,borderLeft:'2px solid var(--blue)',display:'flex',alignItems:'center',gap:6}}>
                  {league} <span style={{opacity:.6}}>({items.length})</span>
                </div>
                {items.map(ev=>(
                  <MatchCard key={ev.id||ev.fixture?.id||`${ev.home_team||ev.home}-${ev.away_team||ev.away}-${ev.date}`} ev={ev} sport={sportKey} />
                ))}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
