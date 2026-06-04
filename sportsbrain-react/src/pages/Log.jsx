import { useState, useEffect, useRef } from 'react'
import PageHeader from '../components/ui/PageHeader'

// Bus de logs global — componentes podem chamar window.sbLog()
if (typeof window !== 'undefined') {
  window._sbLogs = window._sbLogs || []
  window.sbLog = (msg, type='inf') => {
    const entry = { msg, type, ts: new Date().toISOString() }
    window._sbLogs.unshift(entry)
    if (window._sbLogs.length > 500) window._sbLogs.pop()
    window.dispatchEvent(new Event('sb-log'))
  }
}

const TYPE_STYLE = {
  ok:  { color:'var(--green)', prefix:'✓' },
  er:  { color:'var(--red)',   prefix:'✗' },
  wa:  { color:'var(--amber)', prefix:'⚠' },
  inf: { color:'var(--dim)',   prefix:'·' },
  pu:  { color:'var(--purple)',prefix:'◈' },
  ld:  { color:'var(--blue)',  prefix:'⟳' },
}

export default function Log() {
  const [logs, setLogs] = useState(()=>window._sbLogs||[])
  const [intLogs, setIntLogs] = useState([])
  const [filter, setFilter] = useState('all')
  const [reqCount, setReqCount] = useState(0)
  const boxRef = useRef()

  useEffect(() => {
    const h = () => setLogs([...window._sbLogs])
    window.addEventListener('sb-log', h)
    return () => window.removeEventListener('sb-log', h)
  }, [])

  const filtered = filter==='all' ? logs : logs.filter(l=>l.type===filter)

  function clearLogs() { window._sbLogs=[]; setLogs([]) }

  return (
    <div className="page">
      <PageHeader icon="📡" title="Log & Auditoria"
        subtitle={`${logs.length} eventos registrados`}
        actions={
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)'}}>Req: <b style={{color:'var(--blue)'}}>{reqCount}</b></span>
            {['all','ok','er','wa','pu'].map(t=>(
              <button key={t} onClick={()=>setFilter(t)} style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,padding:'3px 8px',borderRadius:4,border:`1px solid ${filter===t?'rgba(59,158,255,.4)':'rgba(255,255,255,.1)'}`,background:filter===t?'rgba(59,158,255,.12)':'transparent',color:filter===t?'var(--blue)':'var(--mute)',cursor:'pointer'}}>
                {t==='all'?'Todos':t.toUpperCase()}
              </button>
            ))}
            <button onClick={clearLogs} className="btn" style={{padding:'3px 8px',fontSize:10}}>🗑 Limpar</button>
          </div>
        }
      />

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        {/* Sistema */}
        <div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:6}}>Sistema / API</div>
          <div ref={boxRef} style={{background:'var(--ink1)',border:'1px solid var(--line)',borderRadius:'var(--r2)',padding:'10px',fontFamily:"'JetBrains Mono',monospace",fontSize: 11.5,height:400,overflowY:'auto',lineHeight:1.9}}>
            {filtered.length===0 ? (
              <span style={{color:'var(--line)'}}>// Aguardando eventos...</span>
            ) : filtered.map((l,i)=>{
              const s=TYPE_STYLE[l.type]||TYPE_STYLE.inf
              return (
                <div key={i} style={{display:'flex',gap:6,borderBottom:'1px solid rgba(255,255,255,.03)',padding:'1px 0'}}>
                  <span style={{color:'var(--mute)',flexShrink:0}}>{l.ts?.slice(11,19)||''}</span>
                  <span style={{color:s.color,flexShrink:0}}>{s.prefix}</span>
                  <span style={{color:l.type==='er'?'var(--red)':l.type==='ok'?'var(--green)':l.type==='wa'?'var(--amber)':'var(--soft)',flex:1}}>{l.msg}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Integridade */}
        <div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:6}}>
            Integridade de Dados ({intLogs.length} eventos)
          </div>
          <div style={{background:'var(--ink1)',border:'1px solid rgba(255,184,48,.15)',borderRadius:'var(--r2)',padding:'10px',fontFamily:"'JetBrains Mono',monospace",fontSize: 11,height:400,overflowY:'auto',lineHeight:1.8}}>
            {intLogs.length===0 ? (
              <span style={{color:'var(--green)'}}>✅ Feed limpo — sem eventos de integridade</span>
            ) : intLogs.map((e,i)=>(
              <div key={i} style={{display:'flex',gap:6,borderBottom:'1px solid rgba(255,255,255,.04)',padding:'3px 0'}}>
                <span style={{color:'var(--mute)',flexShrink:0}}>{e.ts?.slice(11,19)}</span>
                <span style={{color:e.reason?.includes('Removido')?'var(--red)':e.reason?.includes('Oculto')?'var(--amber)':'var(--mute)',flex:1}}>{e.reason}</span>
                {e.match && <span style={{color:'var(--soft)',maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.match}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
