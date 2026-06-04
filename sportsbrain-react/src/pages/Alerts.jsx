import { useState, useEffect } from 'react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import {
  notifSupported, notifPermission, requestNotifPermission,
  loadNotifCfg, saveNotifCfg, sendTestNotif,
} from '../utils/notifications'

const CFG_KEY = 'sb_alerts_cfg'
const DEFAULT_CONFIGS = {
  high_conf:   { enabled:true,  label:'🔥 Alta Confiança (≥80%)',     desc:'Pick com confiança acima de 80%',             threshold:80  },
  positive_ev: { enabled:true,  label:'💹 EV Positivo (≥5%)',         desc:'Expected Value acima de 5%',                  threshold:5   },
  live_goal:   { enabled:false, label:'⚽ Gol ao Vivo',                desc:'Gol detectado em partida ao vivo',            threshold:0   },
  btts:        { enabled:true,  label:'🎯 BTTS Alta Taxa (≥70%)',      desc:'Ambas marcam com taxa ≥70%',                  threshold:70  },
  over25:      { enabled:true,  label:'📊 Over 2.5 Forte',             desc:'Over 2.5 com conf ≥65%',                      threshold:65  },
  corners:     { enabled:false, label:'📐 Escanteios >10',             desc:'Média de escanteios acima de 10',             threshold:10  },
  ht_signal:   { enabled:true,  label:'🕐 Sinal 1T Forte',             desc:'Pick de 1º tempo com alta confiança',         threshold:72  },
  value_bet:   { enabled:true,  label:'💎 EV teórico identificado',    desc:'Sinal teórico com EV significativamente positivo (LAB)',      threshold:4   },
  acum_ev:     { enabled:true,  label:'🎰 Acumulador EV teórico (≥10%)', desc:'Acumulador com EV combinado teórico acima de 10% (LAB)',    threshold:10  },
  acum_odd:    { enabled:false, label:'📦 Acumulador Odd Alta (≥3.0)', desc:'Acumulador com odd combinada acima de 3.0',   threshold:300 },
  kelly_big:   { enabled:true,  label:'📐 Exposição teórica ≥ 3%',     desc:'Pick com exposição teórica simulada acima de 3% (LAB)', threshold:3   },
}

function loadCfg() {
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY)||'{}')
    const merged = {}
    Object.entries(DEFAULT_CONFIGS).forEach(([k,v])=>{ merged[k]={...v,...(saved[k]||{})} })
    return merged
  } catch { return DEFAULT_CONFIGS }
}

function AlertConfigRow({ id, config, onChange }) {
  return (
    <div style={{
      background:'var(--card-bg)',
      border:`1px solid ${config.enabled?'rgba(59,158,255,.2)':'var(--card-border)'}`,
      borderRadius:'var(--r2)',
      padding:'12px 14px',
      display:'flex',
      alignItems:'flex-start',
      gap:12,
      transition:'all var(--transition-fast)',
    }}>
      <div
        onClick={()=>onChange(id,{...config,enabled:!config.enabled})}
        style={{
          width:36,height:20,borderRadius:20,
          background:config.enabled?'var(--green)':'var(--line)',
          position:'relative',cursor:'pointer',
          transition:'background .2s ease',
          flexShrink:0,
          marginTop:1,
        }}
      >
        <div style={{
          position:'absolute',top:2,
          left:config.enabled?16:2,
          width:16,height:16,
          borderRadius:'50%',
          background:'#fff',
          transition:'left .2s ease',
          boxShadow:'0 1px 3px rgba(0,0,0,.3)',
        }}/>
      </div>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:600,color:config.enabled?'var(--white)':'var(--soft)',marginBottom:3}}>
          {config.label}
        </div>
        <div style={{fontSize:11,color:'var(--dim)'}}>{config.desc}</div>
      </div>
      {config.threshold>0 && (
        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)'}}>Limite:</span>
          <input
            type="number"
            value={config.threshold}
            onChange={e=>onChange(id,{...config,threshold:Number(e.target.value)})}
            style={{width:52,fontFamily:"'JetBrains Mono',monospace",fontSize:11,padding:'3px 6px',borderRadius:4,border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none',textAlign:'center'}}
          />
        </div>
      )}
    </div>
  )
}

// ─── Painel de Push Notifications ────────────────────────────────────────────
function PushPanel() {
  const [perm,    setPerm]    = useState(notifPermission)
  const [cfg,     setCfg]     = useState(loadNotifCfg)
  const [testing, setTesting] = useState(false)

  useEffect(() => { setPerm(notifPermission()) }, [])

  async function handleEnable() {
    const result = await requestNotifPermission()
    setPerm(result)
    if (result === 'granted') {
      const next = { ...cfg, enabled: true }
      setCfg(next); saveNotifCfg(next)
    }
  }

  function toggle() {
    const next = { ...cfg, enabled: !cfg.enabled }
    setCfg(next); saveNotifCfg(next)
  }

  function update(key, val) {
    const next = { ...cfg, [key]: val }
    setCfg(next); saveNotifCfg(next)
  }

  function handleTest() {
    setTesting(true)
    sendTestNotif()
    setTimeout(() => setTesting(false), 1500)
  }

  const denied = perm === 'denied'
  const unsupported = perm === 'unsupported'
  const granted = perm === 'granted'

  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: 'var(--r2)', padding: '14px', marginBottom: 16,
    }}>
      {/* header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>🔔</span>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700, color:'var(--white)', letterSpacing:'.4px' }}>
              PUSH NOTIFICATIONS
            </div>
            <div style={{ fontSize:11, color:'var(--mute)', marginTop:1 }}>
              Alerta quando sair pick ≥{cfg.minConf}% conf · jogo em &lt;{cfg.maxHoursToKickoff}h
            </div>
          </div>
        </div>

        {/* status badge */}
        <span style={{
          fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
          padding:'2px 8px', borderRadius:20,
          background: granted && cfg.enabled ? 'rgba(34,212,160,.15)' : denied ? 'rgba(255,61,90,.12)' : 'rgba(255,255,255,.06)',
          border: `1px solid ${granted && cfg.enabled ? 'rgba(34,212,160,.35)' : denied ? 'rgba(255,61,90,.3)' : 'rgba(255,255,255,.12)'}`,
          color: granted && cfg.enabled ? 'var(--green)' : denied ? 'var(--red)' : 'var(--mute)',
        }}>
          {unsupported ? '⛔ NÃO SUPORTADO' : denied ? '⛔ BLOQUEADO' : granted && cfg.enabled ? '✓ ATIVO' : '○ INATIVO'}
        </span>
      </div>

      {unsupported && (
        <div style={{ fontSize:11, color:'var(--mute)', background:'rgba(255,255,255,.04)', borderRadius:6, padding:'8px 10px' }}>
          Seu navegador não suporta notificações push. Use Chrome ou Firefox.
        </div>
      )}

      {denied && (
        <div style={{ fontSize:11, color:'var(--amber)', background:'rgba(245,166,35,.08)', border:'1px solid rgba(245,166,35,.2)', borderRadius:6, padding:'8px 10px' }}>
          ⚠ Notificações bloqueadas. Para ativar: Configurações do Chrome → Privacidade → Notificações → Permitir para sportsbrain.pages.dev
        </div>
      )}

      {!unsupported && !denied && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* linha 1: ativar/desativar */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--line)' }}>
            <div style={{ fontSize:12, color:'var(--soft)', fontWeight:600 }}>Ativar notificações push</div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              {granted ? (
                <div onClick={toggle} style={{
                  width:36, height:20, borderRadius:20,
                  background: cfg.enabled ? 'var(--green)' : 'var(--line)',
                  position:'relative', cursor:'pointer', transition:'background .2s',
                }}>
                  <div style={{
                    position:'absolute', top:2, left: cfg.enabled ? 16 : 2,
                    width:16, height:16, borderRadius:'50%',
                    background:'#fff', transition:'left .2s',
                    boxShadow:'0 1px 3px rgba(0,0,0,.3)',
                  }}/>
                </div>
              ) : (
                <button onClick={handleEnable} style={{
                  fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                  background:'rgba(59,158,255,.15)', border:'1px solid rgba(59,158,255,.4)',
                  color:'var(--blue)', padding:'4px 12px', borderRadius:6, cursor:'pointer',
                }}>
                  Permitir
                </button>
              )}
            </div>
          </div>

          {/* linha 2: conf mínima */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--line)' }}>
            <div>
              <div style={{ fontSize:12, color:'var(--soft)', fontWeight:600 }}>Confiança mínima</div>
              <div style={{ fontSize:11, color:'var(--mute)', marginTop:1 }}>Só notifica picks acima deste nível</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {[75,80,85,90].map(v => (
                <button key={v} onClick={() => update('minConf', v)} style={{
                  fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                  padding:'3px 9px', borderRadius:4,
                  background: cfg.minConf===v ? 'rgba(34,212,160,.2)' : 'transparent',
                  border: `1px solid ${cfg.minConf===v ? 'rgba(34,212,160,.5)' : 'rgba(255,255,255,.1)'}`,
                  color: cfg.minConf===v ? 'var(--green)' : 'var(--mute)', cursor:'pointer',
                }}>{v}%</button>
              ))}
            </div>
          </div>

          {/* linha 3: janela de tempo */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--line)' }}>
            <div>
              <div style={{ fontSize:12, color:'var(--soft)', fontWeight:600 }}>Janela antes do jogo</div>
              <div style={{ fontSize:11, color:'var(--mute)', marginTop:1 }}>Notifica só se o jogo começa em menos de X horas</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {[1,2,3,6].map(v => (
                <button key={v} onClick={() => update('maxHoursToKickoff', v)} style={{
                  fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                  padding:'3px 9px', borderRadius:4,
                  background: cfg.maxHoursToKickoff===v ? 'rgba(59,130,246,.2)' : 'transparent',
                  border: `1px solid ${cfg.maxHoursToKickoff===v ? 'rgba(59,130,246,.5)' : 'rgba(255,255,255,.1)'}`,
                  color: cfg.maxHoursToKickoff===v ? 'var(--blue)' : 'var(--mute)', cursor:'pointer',
                }}>{v}h</button>
              ))}
            </div>
          </div>

          {/* linha 4: testar */}
          {granted && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:4 }}>
              <div style={{ fontSize:11, color:'var(--mute)' }}>
                Verifique se as notificações chegam corretamente
              </div>
              <button onClick={handleTest} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
                background: testing ? 'rgba(34,212,160,.15)' : 'rgba(255,255,255,.06)',
                border:`1px solid ${testing ? 'rgba(34,212,160,.4)' : 'rgba(255,255,255,.15)'}`,
                color: testing ? 'var(--green)' : 'var(--soft)',
                padding:'4px 12px', borderRadius:6, cursor:'pointer', transition:'all .2s',
              }}>
                {testing ? '✓ Enviada!' : '🔔 Testar'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Alerts() {
  const [configs, setConfigs] = useState(loadCfg)
  const [filter, setFilter] = useState('all')

  function updateConfig(id, updated) {
    const next = {...configs,[id]:updated}
    setConfigs(next)
    localStorage.setItem(CFG_KEY, JSON.stringify(next))
  }

  const enabledCount = Object.values(configs).filter(c=>c.enabled).length
  const filtered = Object.entries(configs).filter(([,c])=>
    filter==='all' || (filter==='active'&&c.enabled) || (filter==='inactive'&&!c.enabled)
  )

  return (
    <div className="page">
      <PageHeader icon="🔔" title="Alertas Inteligentes"
        subtitle={`${enabledCount} de ${Object.keys(configs).length} alertas ativos`}
        actions={
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>{const all={};Object.entries(configs).forEach(([k,v])=>all[k]={...v,enabled:true});setConfigs(all);localStorage.setItem(CFG_KEY,JSON.stringify(all))}} className="btn" style={{padding:'4px 10px',fontSize:11}}>✅ Todos</button>
            <button onClick={()=>{const none={};Object.entries(configs).forEach(([k,v])=>none[k]={...v,enabled:false});setConfigs(none);localStorage.setItem(CFG_KEY,JSON.stringify(none))}} className="btn" style={{padding:'4px 10px',fontSize:11}}>⬜ Nenhum</button>
          </div>
        }
      />

      {/* Push Notifications */}
      <PushPanel />

      <div style={{background:'linear-gradient(135deg,rgba(59,158,255,.08),rgba(184,125,255,.06))',border:'1px solid rgba(59,158,255,.2)',borderRadius:'var(--r2)',padding:'10px 14px',marginBottom:14,fontSize:11,color:'var(--soft)'}}>
        💡 Configure quais tipos de sinais você quer monitorar. Os alertas são aplicados durante a análise de jogos em <b style={{color:'var(--white)'}}>Jogos do Dia</b> e <b style={{color:'var(--white)'}}>Props</b>.
      </div>

      <div style={{display:'flex',gap:6,marginBottom:12}}>
        {[{id:'all',l:`Todos (${Object.keys(configs).length})`},{id:'active',l:`Ativos (${enabledCount})`},{id:'inactive',l:`Inativos (${Object.keys(configs).length-enabledCount})`}].map(f=>(
          <button key={f.id} onClick={()=>setFilter(f.id)} style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,padding:'4px 12px',borderRadius:20,border:`1px solid ${filter===f.id?'rgba(59,158,255,.5)':'rgba(255,255,255,.1)'}`,background:filter===f.id?'rgba(59,158,255,.15)':'transparent',color:filter===f.id?'var(--blue)':'var(--mute)',cursor:'pointer'}}>{f.l}</button>
        ))}
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map(([id,cfg])=>(
          <AlertConfigRow key={id} id={id} config={cfg} onChange={updateConfig}/>
        ))}
      </div>
    </div>
  )
}
