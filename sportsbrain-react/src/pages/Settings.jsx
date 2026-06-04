import { useState, useEffect } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import { useUIStore, usePerfStore } from '../store'

// ─── Seções ──────────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }) {
  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--card-border)',
      borderRadius: 'var(--r2)',
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid var(--line)',
        background: 'rgba(255,255,255,.02)',
      }}>
        <span>{icon}</span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13, fontWeight: 700,
          color: 'var(--soft)', letterSpacing: '.5px', textTransform: 'uppercase',
        }}>{title}</span>
      </div>
      <div style={{ padding: '14px' }}>{children}</div>
    </div>
  )
}

function SettingRow({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '9px 0',
      borderBottom: '1px solid var(--line)',
    }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--soft)', fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 38, height: 20, borderRadius: 10,
        background: value ? 'var(--green)' : 'var(--line)',
        position: 'relative', cursor: 'pointer',
        transition: 'background .2s',
      }}
    >
      <div style={{
        position: 'absolute',
        top: 2, left: value ? 20 : 2,
        width: 16, height: 16,
        borderRadius: '50%',
        background: 'var(--white)',
        transition: 'left .2s',
        boxShadow: '0 1px 3px rgba(0,0,0,.4)',
      }} />
    </div>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text', mono = false }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
        fontSize: 11,
        background: 'var(--ink1)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        color: 'var(--soft)',
        padding: '5px 10px',
        width: 240,
        outline: 'none',
      }}
    />
  )
}

function Btn({ onClick, children, color = 'var(--blue)', danger = false }) {
  const bg = danger ? 'rgba(255,80,80,.12)' : 'rgba(59,158,255,.12)'
  const border = danger ? 'rgba(255,80,80,.3)' : 'rgba(59,158,255,.3)'
  const col = danger ? '#FF5050' : color
  return (
    <button onClick={onClick} style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, fontWeight: 700,
      background: bg, border: `1px solid ${border}`, color: col,
      padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
    }}>
      {children}
    </button>
  )
}

// ─── C3: Sync Cross-Device ────────────────────────────────────────────────────
const SYNC_KEYS = ['sb_v10','sb_banca','sb_banca_txns','sb_alerts_cfg','sb_clv_v1','sb_prints_v2','sb_settings_v1','sb_accus','sb_notif_cfg']

function buildSyncPayload() {
  const obj = {}
  SYNC_KEYS.forEach(k => {
    const v = localStorage.getItem(k)
    if (v && v !== 'null') obj[k] = v
  })
  const json = JSON.stringify(obj)
  return btoa(unescape(encodeURIComponent(json)))
}

function applySyncPayload(code) {
  const json = decodeURIComponent(escape(atob(code.trim())))
  const obj  = JSON.parse(json)
  Object.entries(obj).forEach(([k, v]) => {
    if (SYNC_KEYS.includes(k)) localStorage.setItem(k, v)
  })
  return Object.keys(obj).length
}

function SyncPanel() {
  const [code,    setCode]    = useState('')
  const [importV, setImportV] = useState('')
  const [copied,  setCopied]  = useState(false)
  const [msg,     setMsg]     = useState(null)

  function generate() {
    const c = buildSyncPayload()
    setCode(c)
    navigator.clipboard.writeText(c).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }

  function applyImport() {
    if (!importV.trim()) return
    try {
      const n = applySyncPayload(importV.trim())
      setMsg({ ok: true, text: `✓ ${n} chaves importadas. Recarregue a página para aplicar.` })
      setTimeout(() => window.location.reload(), 2000)
    } catch {
      setMsg({ ok: false, text: '⚠ Código inválido. Verifique se copiou corretamente.' })
    }
  }

  return (
    <SectionCard title="Sync Entre Dispositivos" icon="🔄">
      <div style={{ fontSize: 11, color: 'var(--mute)', marginBottom: 10, lineHeight: 1.5 }}>
        Gere um código para transferir seus dados (picks, banca, alertas) para outro dispositivo ou navegador. O código contém todos os seus dados em texto.
      </div>

      {/* Gerar código */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--dim)', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:6 }}>
          1. GERAR CÓDIGO DE SAÍDA
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
          <button onClick={generate} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
            padding:'6px 14px', borderRadius:6, cursor:'pointer', flexShrink:0,
            background: copied ? 'rgba(34,212,160,.15)' : 'rgba(59,130,246,.12)',
            border: `1px solid ${copied ? 'rgba(34,212,160,.4)' : 'rgba(59,130,246,.3)'}`,
            color: copied ? 'var(--green)' : 'var(--blue)',
          }}>{copied ? '✓ COPIADO!' : '📋 GERAR E COPIAR'}</button>
          {code && (
            <textarea readOnly value={code} onClick={e => e.target.select()} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:9,
              flex:1, height:56, padding:'6px 8px', borderRadius:6,
              border:'1px solid var(--line)', background:'rgba(255,255,255,.04)',
              color:'var(--dim)', resize:'vertical', outline:'none',
            }} />
          )}
        </div>
        {code && (
          <div style={{ fontSize:10, color:'var(--dim)', marginTop:4 }}>
            Código gerado: {code.length} chars · Copie e cole no outro dispositivo
          </div>
        )}
      </div>

      {/* Importar código */}
      <div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--dim)', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:6 }}>
          2. IMPORTAR CÓDIGO (NESTE DISPOSITIVO)
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
          <textarea
            value={importV} onChange={e => setImportV(e.target.value)}
            placeholder="Cole aqui o código gerado no outro dispositivo..."
            style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:9,
              flex:1, height:56, padding:'6px 8px', borderRadius:6,
              border:'1px solid var(--line)', background:'rgba(255,255,255,.04)',
              color:'var(--soft)', resize:'vertical', outline:'none',
            }}
          />
          <button onClick={applyImport} disabled={!importV.trim()} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
            padding:'6px 14px', borderRadius:6, cursor: importV.trim() ? 'pointer' : 'not-allowed',
            background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.3)',
            color:'var(--amber)', flexShrink:0, opacity: importV.trim() ? 1 : .5,
          }}>⬆ APLICAR</button>
        </div>
        {msg && (
          <div style={{ marginTop:6, fontSize:11, color: msg.ok ? 'var(--green)' : 'var(--amber)',
            fontFamily:"'JetBrains Mono',monospace" }}>
            {msg.text}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ─── Calculadora de Odds ─────────────────────────────────────────────────────
function OddsCalculator({ banca }) {
  const [odd,  setOdd]  = useState('')
  const [conf, setConf] = useState('')
  const [b,    setB]    = useState(banca || 1000)

  const odd_n  = parseFloat(odd)
  const conf_n = parseFloat(conf)
  const valid  = odd_n > 1 && conf_n > 0 && conf_n <= 100

  const p    = conf_n / 100
  const ev   = valid ? +((p * odd_n - 1) * 100).toFixed(2) : null
  const full = valid ? Math.max(0, (p * odd_n - 1) / (odd_n - 1)) : null
  const qk   = full != null ? +(full / 4 * b).toFixed(2) : null
  const hk   = full != null ? +(full / 2 * b).toFixed(2) : null
  const payout = valid && qk ? +(qk * odd_n).toFixed(2) : null
  const evColor = ev == null ? 'var(--mute)' : ev > 5 ? 'var(--green)' : ev > 0 ? 'var(--amber)' : 'var(--red)'

  return (
    <SectionCard title="Calculadora de Odds" icon="🧮">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: "'JetBrains Mono',monospace", marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>Odd decimal</div>
          <input type="number" min="1.01" step="0.01" value={odd} onChange={e => setOdd(e.target.value)} placeholder="ex: 1.85"
            style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, width:90, padding:'6px 8px', background:'var(--ink1)', border:'1px solid var(--line)', borderRadius:6, color:'var(--white)', outline:'none' }} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: "'JetBrains Mono',monospace", marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>Confiança %</div>
          <input type="number" min="1" max="100" step="1" value={conf} onChange={e => setConf(e.target.value)} placeholder="ex: 72"
            style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, width:80, padding:'6px 8px', background:'var(--ink1)', border:'1px solid var(--line)', borderRadius:6, color:'var(--white)', outline:'none' }} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: "'JetBrains Mono',monospace", marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>Banca R$</div>
          <input type="number" min="1" step="1" value={b} onChange={e => setB(+e.target.value)} placeholder="1000"
            style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700, width:90, padding:'6px 8px', background:'var(--ink1)', border:'1px solid var(--line)', borderRadius:6, color:'var(--white)', outline:'none' }} />
        </div>
      </div>

      {valid ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          {[
            { label: 'Expected Value', value: `${ev > 0 ? '+' : ''}${ev}%`, color: evColor },
            { label: '¼ Kelly (recomendado)', value: `R$ ${qk?.toLocaleString('pt-BR', { minimumFractionDigits:2 })}`, color: 'var(--amber)' },
            { label: '½ Kelly (agressivo)', value: `R$ ${hk?.toLocaleString('pt-BR', { minimumFractionDigits:2 })}`, color: 'var(--blue)' },
            { label: 'Retorno bruto (¼K)', value: `R$ ${payout?.toLocaleString('pt-BR', { minimumFractionDigits:2 })}`, color: 'var(--soft)' },
            { label: 'Prob. implícita da odd', value: `${(1/odd_n*100).toFixed(1)}%`, color: 'var(--mute)' },
            { label: 'Margem de valor', value: `${(conf_n - 1/odd_n*100).toFixed(1)}pp`, color: (conf_n - 1/odd_n*100) > 0 ? 'var(--green)' : 'var(--red)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:'var(--ink1)', borderRadius:6, padding:'9px 11px' }}>
              <div style={{ fontSize:10, color:'var(--mute)', marginBottom:4, lineHeight:1.3 }}>{label}</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:800, color }}>{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize:11, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>
          Digite odd e confiança para calcular EV e Kelly stake.
        </div>
      )}
    </SectionCard>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  workerUrl:    'https://sportsbrain-api.sportsbrain-api.workers.dev',
  anthropicKey: '',
  refreshRate:  '90',
  autoRefresh:  true,
  compactMode:  false,
  showConf:     true,
  minConf:      55,
  currency:     'BRL',
  bancaLabel:   'Banca Principal',
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('sb_settings_v1')
    const result = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    // Se não tem a chave Anthropic no settings, tenta pegar da chave dedicada
    if (!result.anthropicKey) result.anthropicKey = localStorage.getItem('sb_claude_key_365') || ''
    return result
  } catch { return { ...DEFAULTS } }
}

function saveSettings(s) {
  localStorage.setItem('sb_settings_v1', JSON.stringify(s))
}

export default function Settings() {
  const { theme, toggleTheme } = useUIStore()
  const { banca, setBanca } = usePerfStore()

  const [cfg, setCfg] = useState(loadSettings)
  const [saved, setSaved] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)

  function update(key, val) {
    setCfg(prev => ({ ...prev, [key]: val }))
    setSaved(false)
    // Apply compact mode immediately without needing to save
    if (key === 'compactMode') {
      if (val) document.documentElement.setAttribute('data-compact', '')
      else     document.documentElement.removeAttribute('data-compact')
      // Persist immediately
      try {
        const current = JSON.parse(localStorage.getItem('sb_settings_v1') || '{}')
        localStorage.setItem('sb_settings_v1', JSON.stringify({ ...current, compactMode: val }))
      } catch {}
    }
  }

  function handleSave() {
    saveSettings(cfg)
    // Sincroniza chave Claude com Analise365/Garantido
    if (cfg.anthropicKey) localStorage.setItem('sb_claude_key_365', cfg.anthropicKey.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleResetBanca() {
    if (!resetConfirm) { setResetConfirm(true); return }
    setBanca(0)
    localStorage.removeItem('sb_v10')
    localStorage.removeItem('sb_banca')
    setResetConfirm(false)
  }

  function handleExportAll() {
    const data = {
      version: '4.7',
      exportedAt: new Date().toISOString(),
      settings: cfg,
      picks: JSON.parse(localStorage.getItem('sb_v10') || '[]'),
      banca: localStorage.getItem('sb_banca'),
      alerts: JSON.parse(localStorage.getItem('sb_alerts_cfg') || '[]'),
      outPlayers: JSON.parse(localStorage.getItem('sb_out_players') || '[]'),
      clv: JSON.parse(localStorage.getItem('sb_clv_v1') || '[]'),
      prints: JSON.parse(localStorage.getItem('sb_prints_v2') || '[]'),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `sportsbrain-backup-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportAll(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result)
        if (data.picks) localStorage.setItem('sb_v10', JSON.stringify(data.picks))
        if (data.banca) localStorage.setItem('sb_banca', data.banca)
        if (data.alerts) localStorage.setItem('sb_alerts_cfg', JSON.stringify(data.alerts))
        if (data.outPlayers) localStorage.setItem('sb_out_players', JSON.stringify(data.outPlayers))
        if (data.clv) localStorage.setItem('sb_clv_v1', JSON.stringify(data.clv))
        if (data.prints) localStorage.setItem('sb_prints_v2', JSON.stringify(data.prints))
        if (data.settings) {
          setCfg({ ...DEFAULTS, ...data.settings })
          saveSettings({ ...DEFAULTS, ...data.settings })
        }
        alert('Backup importado com sucesso! Recarregue para aplicar.')
      } catch {
        alert('Arquivo inválido.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleClearAll() {
    if (!window.confirm('Apagar TODOS os dados locais? Esta ação não pode ser desfeita.')) return
    const keys = ['sb_v10','sb_banca','sb_alerts_cfg','sb_out_players','sb_clv_v1','sb_prints_v2','sb_settings_v1','sb_theme']
    keys.forEach(k => localStorage.removeItem(k))
    window.location.reload()
  }

  // storage usage
  const storageKB = (() => {
    try {
      let total = 0
      for (const k of Object.keys(localStorage)) {
        total += (localStorage.getItem(k) || '').length
      }
      return (total / 1024).toFixed(1)
    } catch { return '?' }
  })()

  const picksCount  = (() => { try { return JSON.parse(localStorage.getItem('sb_v10') || '[]').length } catch { return 0 } })()
  const alertsCount = (() => { try { return JSON.parse(localStorage.getItem('sb_alerts_cfg') || '[]').length } catch { return 0 } })()

  return (
    <div>
      <PageHeader
        icon="⚙"
        title="Configurações"
        subtitle="Preferências, API keys, portfólio e sistema"
        actions={
          <Btn onClick={handleSave} color={saved ? 'var(--green)' : 'var(--blue)'}>
            {saved ? '✓ SALVO' : '💾 SALVAR'}
          </Btn>
        }
      />

      <KpiRow>
        <Kpi value={picksCount}  label="Picks salvos"       color="var(--blue)" />
        <Kpi value={alertsCount} label="Alertas config."    color="var(--amber)" />
        <Kpi value={`${storageKB} KB`} label="Storage local" color="var(--purple)" />
        <Kpi value={banca > 0 ? `R$${banca}` : '—'} label={cfg.bancaLabel} color="var(--green)" />
      </KpiRow>

      {/* Aparência */}
      <SectionCard title="Aparência" icon="🎨">
        <SettingRow label="Tema" hint="Dark ou Light mode">
          <div style={{ display: 'flex', gap: 6 }}>
            {['dark','light'].map(t => (
              <button
                key={t}
                onClick={() => { if (theme !== t) toggleTheme() }}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11, fontWeight: 700,
                  padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                  background: theme === t ? 'rgba(59,158,255,.2)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${theme === t ? 'rgba(59,158,255,.5)' : 'rgba(255,255,255,.1)'}`,
                  color: theme === t ? 'var(--blue)' : 'var(--dim)',
                }}
              >{t === 'dark' ? '🌙 Dark' : '☀️ Light'}</button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label="Modo Compacto" hint="Reduz padding e tamanho de fonte nas listas">
          <Toggle value={cfg.compactMode} onChange={v => update('compactMode', v)} />
        </SettingRow>
        <SettingRow label="Mostrar Confiança" hint="Exibe a barra de % de confiança nos cards">
          <Toggle value={cfg.showConf} onChange={v => update('showConf', v)} />
        </SettingRow>
        <SettingRow label="Confiança Mínima" hint={`Filtro global: ${cfg.minConf}%`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={40} max={85} value={cfg.minConf}
              onChange={e => update('minConf', +e.target.value)}
              style={{ width: 100, accentColor: 'var(--blue)' }}
            />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--blue)', minWidth: 32 }}>
              {cfg.minConf}%
            </span>
          </div>
        </SettingRow>
      </SectionCard>

      {/* API & Conexões */}
      <SectionCard title="API & Conexões" icon="🔌">
        <SettingRow label="Worker URL" hint="Endpoint do Cloudflare Worker (backend)">
          <TextInput
            value={cfg.workerUrl}
            onChange={v => update('workerUrl', v)}
            placeholder="https://..."
            mono
          />
        </SettingRow>
        <SettingRow label="Anthropic API Key" hint="Para análise IA local (optional, use Worker se disponível)">
          <TextInput
            value={cfg.anthropicKey}
            onChange={v => update('anthropicKey', v)}
            placeholder="sk-ant-••••••••"
            type="password"
            mono
          />
        </SettingRow>
        <SettingRow
          label="API-Football Key (api-sports.io)"
          hint={<span>Copa do Brasil + 700 ligas. <a href="https://dashboard.api-football.com/profile?access" target="_blank" rel="noreferrer" style={{color:'var(--blue)'}}>Grátis 100 req/dia →</a></span>}
        >
          <TextInput
            value={cfg.apiFootballKey || ''}
            onChange={v => update('apiFootballKey', v)}
            placeholder="chave-api-sports"
            type="password"
            mono
          />
        </SettingRow>
        <SettingRow label="Auto-refresh" hint="Atualizar dados automaticamente">
          <Toggle value={cfg.autoRefresh} onChange={v => update('autoRefresh', v)} />
        </SettingRow>
        <SettingRow label="Intervalo de refresh" hint={`A cada ${cfg.refreshRate}s`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={30} max={300} step={30} value={cfg.refreshRate}
              onChange={e => update('refreshRate', e.target.value)}
              style={{ width: 100, accentColor: 'var(--blue)' }}
            />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--blue)', minWidth: 36 }}>
              {cfg.refreshRate}s
            </span>
          </div>
        </SettingRow>
      </SectionCard>

      {/* Portfólio */}
      <SectionCard title="Portfólio & Banca" icon="💰">
        <SettingRow label="Label da Banca" hint="Nome exibido nos KPIs">
          <TextInput
            value={cfg.bancaLabel}
            onChange={v => update('bancaLabel', v)}
            placeholder="Banca Principal"
          />
        </SettingRow>
        <SettingRow label="Moeda" hint="Moeda padrão para cálculos">
          <div style={{ display: 'flex', gap: 6 }}>
            {['BRL','USD','EUR'].map(c => (
              <button
                key={c}
                onClick={() => update('currency', c)}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11, fontWeight: 700,
                  padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                  background: cfg.currency === c ? 'rgba(0,214,143,.15)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${cfg.currency === c ? 'rgba(0,214,143,.4)' : 'rgba(255,255,255,.1)'}`,
                  color: cfg.currency === c ? 'var(--green)' : 'var(--dim)',
                }}
              >{c}</button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label="Valor da Banca" hint="Sincronizado com a página Performance">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number" min={0} value={banca}
              onChange={e => setBanca(+e.target.value)}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, width: 100,
                background: 'var(--ink1)', border: '1px solid var(--line)',
                borderRadius: 6, color: 'var(--soft)', padding: '5px 10px',
              }}
            />
            <Btn onClick={handleResetBanca} danger>
              {resetConfirm ? 'CONFIRMAR?' : '🗑 ZERAR'}
            </Btn>
          </div>
        </SettingRow>
      </SectionCard>

      {/* Backup & Dados */}
      <SectionCard title="Backup & Dados" icon="💾">
        <SettingRow label="Exportar tudo" hint="Picks, alertas, CLV, prints, configurações">
          <Btn onClick={handleExportAll}>⬇ EXPORTAR JSON</Btn>
        </SettingRow>
        <SettingRow label="Importar backup" hint="Restaurar de um arquivo exportado anteriormente">
          <label style={{ cursor: 'pointer' }}>
            <Btn onClick={() => {}}>⬆ IMPORTAR JSON</Btn>
            <input
              type="file" accept=".json" onChange={handleImportAll}
              style={{ display: 'none' }}
            />
          </label>
        </SettingRow>
        <SettingRow
          label="Limpar todos os dados"
          hint="IRREVERSÍVEL — apaga picks, banca, alertas, prints e CLV"
        >
          <Btn onClick={handleClearAll} danger>🔥 LIMPAR TUDO</Btn>
        </SettingRow>
      </SectionCard>

      {/* C3: Sync Cross-Device */}
      <SyncPanel />

      {/* Calculadora de Odds */}
      <OddsCalculator banca={banca} />

      {/* Sobre */}
      <SectionCard title="Sobre" icon="ℹ">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['Versão', 'SportsBrain v4.7'],
            ['Frontend', 'Vite 5 + React 18'],
            ['State', 'Zustand 4'],
            ['Backend', 'Cloudflare Workers'],
            ['IA Engine', 'Claude claude-opus-4-5'],
            ['Charts', 'Chart.js 4.4'],
          ].map(([k, v]) => (
            <div key={k} style={{
              background: 'var(--ink1)', borderRadius: 6,
              padding: '8px 10px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, color: 'var(--mute)' }}>{k}</span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, color: 'var(--soft)', fontWeight: 700,
              }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: 'rgba(59,158,255,.06)',
          border: '1px solid rgba(59,158,255,.15)',
          borderRadius: 6, fontSize: 11, color: 'var(--mute)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          💡 Keys de API são salvas apenas localmente (localStorage). Nunca são enviadas a terceiros.
        </div>
      </SectionCard>
    </div>
  )
}
