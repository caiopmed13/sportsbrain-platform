import { useState, useEffect } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { ConfBar, EdgeBadge } from '../components/ui/PickBadges'
import { fetchPlayerBoxscores, fetchPropsRadarSequence } from '../api/client'

function SeqBar({ values, threshold, label }) {
  if (!values?.length) return null
  const max = Math.max(...values, threshold)
  return (
    <div style={{marginBottom:12}}>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>{label}</div>
      <div style={{display:'flex',gap:3,alignItems:'flex-end',height:50}}>
        {values.map((v,i)=>{
          const h = Math.round((v/max)*46)+4
          const hit = v>=threshold
          return (
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <div style={{width:'100%',height:h,background:hit?'var(--green)':'rgba(255,79,106,.6)',borderRadius:'2px 2px 0 0',minHeight:4,position:'relative'}}>
                <div style={{position:'absolute',bottom:'100%',left:'50%',transform:'translateX(-50%)',fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'var(--white)',whiteSpace:'nowrap',marginBottom:1}}>{v}</div>
              </div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'var(--mute)'}}>L{values.length-i}</div>
            </div>
          )
        })}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
        <div style={{height:1,flex:1,background:'var(--line)',position:'relative'}}>
          <div style={{position:'absolute',left:0,top:-4,fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'var(--amber)'}}>——— Linha: {threshold}</div>
        </div>
      </div>
    </div>
  )
}

const DEMO_PLAYERS = ['LeBron James','Stephen Curry','Giannis Antetokounmpo','Nikola Jokic','Jayson Tatum','Luka Doncic','Kevin Durant','Joel Embiid']
const DEMO_PROPS = [
  { stat:'Points', line:22.5, seq:[28,19,33,25,21,30,27,24,22,29], avg:25.8, hitRate:.70 },
  { stat:'Rebounds', line:7.5, seq:[8,6,11,9,7,10,8,6,9,7], avg:8.1, hitRate:.70 },
  { stat:'Assists', line:6.5, seq:[9,5,7,8,4,6,10,7,5,8], avg:6.9, hitRate:.60 },
]

export default function Radar() {
  const [player, setPlayer] = useState('')
  const [opponent, setOpponent] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState(null)

  async function analyze() {
    if (!player.trim()) return
    setLoading(true); setError(null); setAnalysis(null)
    try {
      // Tenta API real, cai em demo se falhar
      let data = null
      try {
        data = await fetchPlayerBoxscores(player)
      } catch(_) {}
      if (data) {
        setAnalysis(data)
      } else {
        // Demo mode
        setAnalysis({
          player: player || DEMO_PLAYERS[0],
          opponent: opponent || 'TBD',
          props: DEMO_PROPS.map(p=>({
            ...p,
            conf: Math.round(55+p.hitRate*30+Math.random()*5),
            ev: Number((p.hitRate*10-4).toFixed(1)),
            recommendation: p.hitRate>=0.7 ? `Over ${p.line}` : `Under ${p.line}`,
          }))
        })
      }
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div className="page">
      <PageHeader icon="🎯" title="Player Radar" subtitle="Análise individual de jogador com sequência de props"/>

      {/* Input */}
      <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',padding:'14px',marginBottom:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:10,alignItems:'flex-end'}}>
          <div>
            <label style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',textTransform:'uppercase',letterSpacing:'.5px',display:'block',marginBottom:4}}>Jogador</label>
            <input
              value={player}
              onChange={e=>setPlayer(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&analyze()}
              list="player-list"
              placeholder="Ex: LeBron James"
              style={{width:'100%',fontFamily:"'JetBrains Mono',monospace",fontSize:11,padding:'7px 10px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none'}}
            />
            <datalist id="player-list">
              {DEMO_PLAYERS.map(p=><option key={p} value={p}/>)}
            </datalist>
          </div>
          <div>
            <label style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',textTransform:'uppercase',letterSpacing:'.5px',display:'block',marginBottom:4}}>Adversário (opcional)</label>
            <input
              value={opponent}
              onChange={e=>setOpponent(e.target.value)}
              placeholder="Ex: Miami Heat"
              style={{width:'100%',fontFamily:"'JetBrains Mono',monospace",fontSize:11,padding:'7px 10px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none'}}
            />
          </div>
          <button onClick={analyze} className="btn btn-primary" style={{padding:'7px 18px',fontSize:12,fontFamily:"'JetBrains Mono', monospace",fontWeight:700}} disabled={loading}>
            {loading?'Analisando...':'🎯 Analisar'}
          </button>
        </div>
      </div>

      {loading && <div className="loading-center"><div className="spinner"/><span>Buscando dados do jogador...</span></div>}
      {error && <div style={{padding:'20px',textAlign:'center',color:'var(--red)',fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{error}</div>}

      {analysis && (
        <div>
          <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:22,fontWeight:800,color:'var(--white)',marginBottom:4}}>
            {analysis.player}
            {analysis.opponent && <span style={{fontSize:14,fontWeight:400,color:'var(--dim)',marginLeft:10}}>vs {analysis.opponent}</span>}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:16,marginTop:16}}>
            {(analysis.props||[]).map((prop,i)=>(
              <div key={i} style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',padding:'14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:18,fontWeight:800,color:'var(--white)'}}>{prop.stat}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--blue)',fontWeight:700}}>Linha: {prop.line}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    {prop.recommendation && (
                      <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:16,fontWeight:800,color:prop.hitRate>=.7?'var(--green)':'var(--amber)',marginBottom:4}}>
                        ✅ {prop.recommendation}
                      </div>
                    )}
                    {prop.conf && <ConfBar conf={prop.conf}/>}
                  </div>
                </div>
                {prop.seq?.length>0 && (
                  <SeqBar values={[...prop.seq].reverse()} threshold={prop.line} label={`Últimos ${prop.seq.length} jogos`}/>
                )}
                <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:8}}>
                  {prop.avg && <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--soft)'}}>Média: <b style={{color:'var(--white)'}}>{prop.avg}</b></span>}
                  {prop.hitRate && <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--soft)'}}>Hit rate: <b style={{color:prop.hitRate>=.7?'var(--green)':prop.hitRate>=.5?'var(--amber)':'var(--red)'}}>{(prop.hitRate*100).toFixed(0)}%</b></span>}
                  <EdgeBadge ev={prop.ev}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !analysis && !error && (
        <div style={{textAlign:'center',padding:'60px 20px',color:'var(--dim)'}}>
          <div style={{fontSize:40,marginBottom:12}}>🎯</div>
          <div style={{fontFamily:"'JetBrains Mono', monospace",fontSize:18,fontWeight:700,color:'var(--soft)',marginBottom:6}}>Digite o nome de um jogador</div>
          <div style={{fontSize:11,color:'var(--mute)'}}>Análise de props com sequência dos últimos jogos</div>
        </div>
      )}
    </div>
  )
}
