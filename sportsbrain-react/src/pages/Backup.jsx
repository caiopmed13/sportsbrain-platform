import { useState } from 'react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import { PickTierBadge } from '../components/ui/PickBadges'

const SK = 'sb_v10'

function loadPicks() { try { return JSON.parse(localStorage.getItem(SK)||'[]') } catch { return [] } }
function savePicks(p) { localStorage.setItem(SK, JSON.stringify(p)) }

export default function Backup() {
  const [picks, setPicks] = useState(loadPicks)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ match:'', pick:'', market:'', conf:'', odd:'', stake:'1', sport:'football' })
  const [exported, setExported] = useState(false)

  function addPick() {
    if (!form.pick.trim()) return
    const newPick = { ...form, conf:Number(form.conf)||60, odd:Number(form.odd)||0, stake:Number(form.stake)||1, ts:new Date().toISOString() }
    const updated = [newPick, ...picks]
    setPicks(updated); savePicks(updated)
    setForm({ match:'',pick:'',market:'',conf:'',odd:'',stake:'1',sport:'football' })
    setShowForm(false)
  }

  function deletePick(i) {
    const updated = picks.filter((_,j)=>j!==i)
    setPicks(updated); savePicks(updated)
  }

  function setResult(i, r) {
    const updated = picks.map((p,j)=>j===i?{...p,result:r}:p)
    setPicks(updated); savePicks(updated)
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(picks,null,2)],{type:'application/json'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='sportsbrain_backup.json'; a.click()
    setExported(true); setTimeout(()=>setExported(false),2000)
  }

  function importJSON(e) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try { const data=JSON.parse(ev.target.result); if(Array.isArray(data)){setPicks(data);savePicks(data)} } catch{}
    }
    reader.readAsText(file)
  }

  const F = ({label,k,type='text',opts})=>(
    <div style={{display:'flex',flexDirection:'column',gap:3}}>
      <label style={{fontSize: 11,color:'var(--mute)',fontFamily:"'JetBrains Mono',monospace",textTransform:'uppercase',letterSpacing:'.5px'}}>{label}</label>
      {opts ? (
        <select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:'5px 8px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none'}}>
          {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      ) : (
        <input type={type} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:'5px 8px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none'}}/>
      )}
    </div>
  )

  return (
    <div className="page">
      <PageHeader icon="💾" title="Backup & Dados"
        subtitle={`${picks.length} picks armazenados localmente`}
        actions={
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <button onClick={()=>setShowForm(v=>!v)} className="btn btn-primary" style={{padding:'4px 10px',fontSize:11}}>+ Registrar Pick</button>
            <button onClick={exportJSON} className="btn" style={{padding:'4px 10px',fontSize:11}}>{exported?'✅ Exportado!':'📤 Exportar JSON'}</button>
            <label className="btn" style={{padding:'4px 10px',fontSize:11,cursor:'pointer'}}>
              📥 Importar <input type="file" accept=".json" onChange={importJSON} style={{display:'none'}}/>
            </label>
          </div>
        }
      />

      {/* Form rápido */}
      {showForm && (
        <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',padding:'14px',marginBottom:14}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1px',marginBottom:12,textTransform:'uppercase'}}>Registrar Novo Pick</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:12}}>
            <F label="Partida" k="match"/>
            <F label="Pick / Palpite" k="pick"/>
            <F label="Mercado" k="market"/>
            <F label="Confiança %" k="conf" type="number"/>
            <F label="Odd" k="odd" type="number"/>
            <F label="Stake (u)" k="stake" type="number"/>
            <F label="Esporte" k="sport" opts={[{v:'football',l:'⚽ Futebol'},{v:'basketball',l:'🏀 Basquete'},{v:'american_football',l:'🏈 NFL'}]}/>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={addPick} className="btn btn-primary" style={{padding:'6px 14px',fontSize:11}}>💾 Salvar Pick</button>
            <button onClick={()=>setShowForm(false)} className="btn" style={{padding:'6px 14px',fontSize:11}}>Cancelar</button>
          </div>
        </div>
      )}

      {picks.length===0 && (
        <EmptyState icon="💾" title="Nenhum pick registrado" subtitle='Use "Registrar Pick" para começar a acompanhar seus palpites'/>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {picks.map((p,i)=>(
          <div key={i} style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',padding:'10px 12px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <div style={{flex:1,minWidth:180}}>
              <div style={{fontSize: 11,color:'var(--dim)',fontFamily:"'JetBrains Mono',monospace",marginBottom:2}}>
                {p.match||'—'} · {p.market||'—'}
                {p.ts && <span style={{marginLeft:6,opacity:.6}}>{new Date(p.ts).toLocaleDateString('pt-BR')}</span>}
              </div>
              <div style={{fontSize:13,fontWeight:600,color:'var(--white)',marginBottom:3}}>{p.pick||'—'}</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                <PickTierBadge conf={p.conf} ev={0}/>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--soft)'}}>Conf: {p.conf}%</span>
                {p.odd>0 && <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--blue)'}}>@{p.odd}</span>}
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)'}}>{p.stake}u</span>
              </div>
            </div>
            <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
              {p.result ? (
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,fontWeight:700,
                  color:p.result==='W'?'var(--green)':p.result==='L'?'var(--red)':'var(--amber)',
                  background:p.result==='W'?'var(--g3)':p.result==='L'?'var(--r3)':'var(--a3)',
                  padding:'2px 8px',borderRadius:3,
                }}>{p.result==='W'?'✅ WIN':p.result==='L'?'❌ LOSS':'♻ VOID'}</span>
              ) : (
                <>
                  {['W','L','V'].map(r=>(
                    <button key={r} onClick={()=>setResult(i,r)} style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,padding:'3px 8px',borderRadius:4,border:`1px solid ${r==='W'?'rgba(0,214,143,.4)':r==='L'?'rgba(255,79,106,.4)':'rgba(255,184,48,.3)'}`,background:'transparent',color:r==='W'?'var(--green)':r==='L'?'var(--red)':'var(--amber)',cursor:'pointer'}}>{r}</button>
                  ))}
                </>
              )}
              <button onClick={()=>deletePick(i)} style={{background:'none',border:'none',color:'var(--mute)',cursor:'pointer',padding:'3px 6px',fontSize:13}}>🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
