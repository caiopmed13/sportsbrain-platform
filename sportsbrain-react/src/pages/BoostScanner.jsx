// ═══════════════════════════════════════════════════════════════════════════
// Boost Scanner — Avalia "Apostas Aumentadas" da Bet365
// ═══════════════════════════════════════════════════════════════════════════
// Modo queue: lista todos os jogos do dia com boosts. Para cada jogo,
// usuário cola o texto das aumentadas. Sistema parseia, calcula EV real,
// classifica em OURO / VALUE / FAIR / TRAP, sugere combos similares.
// Cross-match: painel global ordena os melhores boosts entre TODOS os jogos.
// Persistência localStorage — refresh não perde nada.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { fetchMatches } from '../api/client'
import {
  parseBoostText, analyzeBoost, suggestSimilarCombos,
} from '../utils/boostBuilder'

const STORAGE_KEY = 'sb_boost_queue_v1'

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveQueue(q) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(q)) } catch {}
}

function todayBR() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

const SAMPLE_BLOCK = `- Resultado Final: Roma
- Donyell Malen: 2+ Chutes ao Gol
- Matias Soule: 2+ Chutes ao Gol
11.00 >> 12.00`

function verdictColor(v) {
  if (v === 'gold')  return 'var(--green)'
  if (v === 'value') return '#5ecbff'
  if (v === 'fair')  return 'var(--amber)'
  if (v === 'trap')  return 'var(--red)'
  return 'var(--mute)'
}
function verdictTag(v) {
  if (v === 'gold')  return '🏆 OURO'
  if (v === 'value') return '💎 VALUE'
  if (v === 'fair')  return '➖ FAIR'
  if (v === 'trap')  return '🪤 TRAP'
  return '?'
}

function fmtTime(t) {
  if (!t) return ''
  try { return new Date(t).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) } catch { return '' }
}

function MatchBoostCard({ matchKey, match, text, onChange, onRemove, expanded, onToggle }) {
  // Pre-pend match name na primeira linha pra parser saber a partida
  const fullText = useMemo(() => {
    if (!text) return ''
    if (text.toLowerCase().includes(` v ${match.away.toLowerCase()}`)
        || text.toLowerCase().includes(` × ${match.away.toLowerCase()}`)
        || text.toLowerCase().includes(` x ${match.away.toLowerCase()}`)) return text
    return `${match.home} v ${match.away}\n${text}`
  }, [text, match])

  const boosts = useMemo(() => parseBoostText(fullText), [fullText])
  const analyzed = useMemo(() => boosts.map(b => analyzeBoost(b)).filter(Boolean), [boosts])

  const stats = analyzed.reduce((acc, a) => {
    if (!a?.verdict) return acc
    acc[a.verdict] = (acc[a.verdict] || 0) + 1
    return acc
  }, {})
  const bestEV = analyzed.length ? Math.max(...analyzed.map(a => a.ev)) : null

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: `1px solid ${analyzed.length ? `${verdictColor(analyzed.find(a => a.verdict==='gold') ? 'gold' : analyzed.find(a=>a.verdict==='value') ? 'value' : 'fair')}40` : 'var(--card-border)'}`,
      borderRadius:'var(--r2)', padding:'10px 12px',
    }}>
      {/* Header com match e botões */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        gap: 8, flexWrap:'wrap', marginBottom: expanded ? 8 : 0 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8, minWidth: 0, flex:1 }}>
          <button onClick={onToggle} style={{
            background:'none', border:'none', color:'var(--mute)', cursor:'pointer',
            fontSize: 14, padding: 0,
          }}>{expanded ? '▼' : '▶'}</button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color:'var(--white)',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {match.home} <span style={{color:'var(--mute)'}}>×</span> {match.away}
            </div>
            <div style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)',
              display:'flex', gap: 6, marginTop: 1 }}>
              {match.league && <span>{match.league}</span>}
              {match.time && <span>· {fmtTime(match.time)}</span>}
              {analyzed.length > 0 && (
                <>
                  <span>· {analyzed.length} boost{analyzed.length>1?'s':''}</span>
                  {bestEV != null && (
                    <span style={{ color: bestEV > 3 ? 'var(--green)' : bestEV < -3 ? 'var(--red)' : 'var(--amber)', fontWeight: 700 }}>
                      · best {bestEV > 0 ? '+' : ''}{bestEV}% EV
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap: 4 }}>
          {stats.gold  && <span style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace", padding:'2px 5px', background:'rgba(0,214,143,.12)', color:'var(--green)', borderRadius: 3, fontWeight:800 }}>🏆 {stats.gold}</span>}
          {stats.value && <span style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace", padding:'2px 5px', background:'rgba(94,203,255,.12)', color:'#5ecbff', borderRadius: 3, fontWeight:800 }}>💎 {stats.value}</span>}
          {stats.fair  && <span style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace", padding:'2px 5px', background:'rgba(255,184,48,.12)', color:'var(--amber)', borderRadius: 3, fontWeight:800 }}>➖ {stats.fair}</span>}
          {stats.trap  && <span style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace", padding:'2px 5px', background:'rgba(255,79,106,.12)', color:'var(--red)', borderRadius: 3, fontWeight:800 }}>🪤 {stats.trap}</span>}
          <button onClick={onRemove} title="Remover" style={{
            background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:12,
          }}>🗑</button>
        </div>
      </div>

      {expanded && (
        <>
          <textarea
            value={text}
            onChange={e => onChange(matchKey, e.target.value)}
            placeholder={`Cole as aumentadas DESTE jogo. Cada bloco termina com a odd "11.00 >> 12.00".\n\nExemplo:\n${SAMPLE_BLOCK}`}
            rows={5}
            style={{
              width: '100%', fontFamily:"'JetBrains Mono',monospace", fontSize: 10,
              padding:'8px 10px', borderRadius: 4, border:'1px solid var(--line)',
              background:'var(--ink2)', color:'var(--white)', outline:'none',
              marginTop: 8, marginBottom: 8, resize:'vertical',
            }}
          />

          {analyzed.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
              {analyzed.map((a, i) => <BoostMini key={i} a={a}/>)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BoostMini({ a }) {
  const [showSugg, setShowSugg] = useState(false)
  const suggestions = useMemo(() => suggestSimilarCombos(a), [a])
  return (
    <div style={{
      background:'rgba(255,255,255,.02)',
      border:`1px solid ${verdictColor(a.verdict)}30`,
      borderRadius: 4, padding:'8px 10px',
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap: 8, flexWrap:'wrap' }}>
        <div style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace",
          color: verdictColor(a.verdict), fontWeight: 800, letterSpacing:'.04em' }}>
          {verdictTag(a.verdict)}
        </div>
        <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)' }}>
          {a.legs.length}L · prob <b style={{color:'var(--white)'}}>{a.jointPct}%</b> · fair {a.fairOdd} · {a.originalOdd && <span style={{textDecoration:'line-through'}}>{a.originalOdd} </span>}<b style={{color:'var(--green)'}}>{a.boostedOdd}</b>
          {' · '}<span style={{ color: verdictColor(a.verdict), fontWeight:800 }}>{a.ev > 0 ? '+' : ''}{a.ev}% EV</span>
        </div>
      </div>
      <div style={{ display:'flex', gap: 4, marginTop: 4, flexWrap:'wrap' }}>
        {a.legs.map((l, i) => (
          <span key={i} title={l.text} style={{
            fontSize: 9, fontFamily:"'JetBrains Mono',monospace",
            padding:'2px 5px', borderRadius: 3,
            color: l.prob >= 0.6 ? 'var(--green)' : l.prob >= 0.4 ? 'var(--amber)' : 'var(--red)',
            background:'rgba(255,255,255,.04)',
            border: '1px solid currentColor',
          }}>{l.code} {l.probPct}%</span>
        ))}
      </div>
      {suggestions.length > 0 && (
        <button onClick={() => setShowSugg(s => !s)} style={{
          background:'none', border:'none', color:'#5ecbff', cursor:'pointer',
          fontSize: 9, fontFamily:"'JetBrains Mono',monospace", padding: 0, marginTop: 4,
        }}>
          💡 {showSugg ? 'esconder' : `${suggestions.length} sugestões`}
        </button>
      )}
      {showSugg && (
        <div style={{ marginTop: 4, display:'flex', flexDirection:'column', gap: 3 }}>
          {suggestions.slice(0, 3).map((s, i) => (
            <div key={i} style={{
              fontSize: 10, padding:'4px 6px', borderRadius: 3,
              background: s.ev > a.ev ? 'rgba(0,214,143,.06)' : 'rgba(255,255,255,.02)',
            }}>
              <div style={{ display:'flex', justifyContent:'space-between', gap: 6 }}>
                <span style={{ color:'var(--white)' }}>{s.label}</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace",
                  color: s.ev > a.ev ? 'var(--green)' : 'var(--mute)', fontWeight: 700 }}>
                  {s.jointPct}% · {s.ev > 0 ? '+' : ''}{s.ev}%
                </span>
              </div>
              <div style={{ fontSize: 9, color:'var(--mute)' }}>{s.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BoostScanner() {
  // Queue: { matchKey: { match: {home,away,league,time}, text } }
  const [queue, setQueue] = useState(loadQueue)
  const [expandedKey, setExpandedKey] = useState(null)
  const [importing, setImporting] = useState(false)
  const [manualHome, setManualHome] = useState('')
  const [manualAway, setManualAway] = useState('')
  const [megaText, setMegaText] = useState('')
  const [showMega, setShowMega] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => { saveQueue(queue) }, [queue])

  function updateText(key, value) {
    setQueue(q => ({ ...q, [key]: { ...q[key], text: value } }))
  }
  function removeMatch(key) {
    setQueue(q => {
      const n = { ...q }; delete n[key]; return n
    })
    if (expandedKey === key) setExpandedKey(null)
  }
  function addManual() {
    if (!manualHome.trim() || !manualAway.trim()) return
    const key = `${manualHome.trim()}|${manualAway.trim()}`.toLowerCase()
    setQueue(q => ({ ...q, [key]: {
      match: { home: manualHome.trim(), away: manualAway.trim(), league: 'manual', time: null },
      text: '',
    }}))
    setExpandedKey(key)
    setManualHome(''); setManualAway('')
  }

  // Mega Paste: 1 textarea com TODOS os boosts → auto-distribui nos jogos
  function processMegaPaste() {
    if (!megaText.trim()) return
    const boosts = parseBoostText(megaText)
    if (!boosts.length) {
      alert('Nenhum boost detectado no texto. Verifica se tem o formato:\n\nTime A v Time B\n- Leg 1\n- Leg 2\n11.00 >> 12.00')
      return
    }
    // Agrupa por match
    const byMatch = {}
    for (const b of boosts) {
      const home = b.match?.home || 'desconhecido'
      const away = b.match?.away || '?'
      const key = `${home}|${away}`.toLowerCase()
      if (!byMatch[key]) byMatch[key] = { home, away, blocks: [] }
      const lines = []
      for (const l of b.legs) lines.push(`- ${l.text}`)
      if (b.originalOdd && b.boostedOdd) lines.push(`${b.originalOdd} >> ${b.boostedOdd}`)
      else if (b.boostedOdd) lines.push(`${b.boostedOdd}`)
      byMatch[key].blocks.push(lines.join('\n'))
    }
    setQueue(q => {
      const next = { ...q }
      for (const [key, info] of Object.entries(byMatch)) {
        const existingMatch = next[key]?.match
        next[key] = {
          match: existingMatch || { home: info.home, away: info.away, league: 'imported', time: null },
          text: info.blocks.join('\n\n'),
        }
      }
      return next
    })
    const n = Object.keys(byMatch).length
    alert(`✓ ${boosts.length} boost${boosts.length>1?'s':''} distribuído${boosts.length>1?'s':''} em ${n} jogo${n>1?'s':''}!`)
    setMegaText('')
    setShowMega(false)
  }

  function downloadBookmarklet() {
    fetch('/bet365-boost-bookmarklet.txt')
      .then(r => r.text())
      .then(content => {
        navigator.clipboard.writeText(content).then(() => {
          alert(`✓ Bookmarklet copiado pro clipboard!\n\n1. Cria um novo favorito no Chrome (Ctrl+D em qualquer página)\n2. Edita o favorito (botão direito → Editar)\n3. No campo URL, cola (Ctrl+V) o conteúdo que está no clipboard\n4. Renomeia pra "📋 Bet365 Boosts"\n5. Abre Bet365 → Apostas Aumentadas → clica no favorito\n6. Volta aqui no Mega Paste e Ctrl+V`)
        }).catch(() => alert('Erro ao copiar. Abre /bet365-boost-bookmarklet.txt manualmente.'))
      })
      .catch(() => alert('Bookmarklet não encontrado. Faz deploy primeiro.'))
  }

  // Importar jogos do Palpites do dia (que têm boosts disponíveis = todos)
  async function importFromPalpites() {
    setImporting(true)
    try {
      const date = todayBR()
      const matches = await fetchMatches(date).catch(() => [])
      const fresh = {}
      for (const m of (matches || []).slice(0, 30)) {
        const home = m.home_team || m.teams?.home?.name || m.home
        const away = m.away_team || m.teams?.away?.name || m.away
        if (!home || !away) continue
        const key = `${home}|${away}`.toLowerCase()
        const league = m.league_name || (typeof m.league === 'string' ? m.league : m.league?.name) || ''
        const time = m.match_time || m.time || m.fixture?.date || null
        fresh[key] = {
          match: { home, away, league, time },
          text: queue[key]?.text || '',
        }
      }
      // Mantém manuais que já estão na queue
      for (const k of Object.keys(queue)) {
        if (queue[k]?.match?.league === 'manual') fresh[k] = queue[k]
      }
      setQueue(fresh)
    } catch (e) {
      console.warn('[boost] import failed', e)
    }
    setImporting(false)
  }

  // Cross-match: ordena TODOS os boosts de todos jogos por EV
  const allAnalyzed = useMemo(() => {
    const out = []
    for (const [key, entry] of Object.entries(queue)) {
      if (!entry?.text) continue
      const fullText = entry.text.toLowerCase().includes(entry.match.away.toLowerCase())
        ? entry.text
        : `${entry.match.home} v ${entry.match.away}\n${entry.text}`
      const boosts = parseBoostText(fullText)
      for (const b of boosts) {
        const a = analyzeBoost(b)
        if (a) out.push({ ...a, _matchKey: key, _league: entry.match.league })
      }
    }
    return out.sort((a, b) => b.ev - a.ev)
  }, [queue])

  const goldList = allAnalyzed.filter(a => a.verdict === 'gold')
  const valueList = allAnalyzed.filter(a => a.verdict === 'value')
  const trapList = allAnalyzed.filter(a => a.verdict === 'trap')

  const matchEntries = Object.entries(queue).sort((a, b) => {
    const ta = a[1]?.match?.time ? new Date(a[1].match.time).getTime() : 0
    const tb = b[1]?.match?.time ? new Date(b[1].match.time).getTime() : 0
    return ta - tb
  })

  return (
    <div className="page">
      <PageHeader icon="🚀" title="Boost Scanner"
        subtitle="Cola as aumentadas da Bet365 por jogo → analisa EV real e ranqueia globalmente"
      />

      <div style={{
        background:'linear-gradient(135deg,rgba(0,214,143,.08),rgba(94,203,255,.04))',
        border:'1px solid rgba(0,214,143,.25)', borderRadius:'var(--r2)',
        padding:'12px 14px', marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color:'var(--white)',
          marginBottom: 6, display:'flex', alignItems:'center', gap: 8 }}>
          ⚡ MODO AUTOMÁTICO · Bookmarklet Bet365
          <button onClick={() => setShowHelp(s => !s)} style={{
            background:'none', border:'1px solid var(--line)', color:'var(--mute)',
            cursor:'pointer', fontSize: 10, padding:'2px 8px', borderRadius: 3,
          }}>{showHelp ? 'esconder' : 'como instalar?'}</button>
        </div>
        <div style={{ fontSize: 11, color:'var(--soft)', lineHeight: 1.5 }}>
          1 clique no Bet365 → scrapeia <b style={{color:'var(--white)'}}>todos os boosts visíveis</b> →
          copia formatado pro clipboard. Volta aqui → "📋 Mega Paste" → Ctrl+V.
          Em ~10s todos os jogos com boost aparecem analisados.
        </div>
        {showHelp && (
          <div style={{ marginTop: 10, padding:'10px 12px', background:'rgba(0,0,0,.25)',
            borderRadius: 4, fontSize: 11, color:'var(--soft)', lineHeight: 1.6 }}>
            <b style={{color:'var(--white)'}}>Setup (1 vez só):</b><br/>
            1. Clica em <b>"⬇ Copiar bookmarklet"</b> abaixo<br/>
            2. No Chrome: <code>Ctrl+Shift+B</code> pra mostrar a barra de favoritos<br/>
            3. <code>Ctrl+D</code> em qualquer página → Editar → cola no campo URL → renomeia "📋 Bet365 Boosts"<br/>
            <br/>
            <b style={{color:'var(--white)'}}>Uso diário:</b><br/>
            1. Abre <code>bet365.com</code> → Apostas Aumentadas / Partidas em Destaque<br/>
            2. Clica no favorito "📋 Bet365 Boosts" → alert confirma quantos boosts copiou<br/>
            3. Volta aqui → clica <b>"📋 Mega Paste"</b> → <code>Ctrl+V</code> → Processar
          </div>
        )}
      </div>

      <KpiRow>
        <Kpi value={matchEntries.length} label="Jogos na queue" color="var(--soft)"/>
        <Kpi value={allAnalyzed.length} label="Boosts analisados" color="var(--blue)"/>
        <Kpi value={goldList.length}  label="🏆 Ouro" color="var(--green)"/>
        <Kpi value={valueList.length} label="💎 Value" color="#5ecbff"/>
        <Kpi value={trapList.length}  label="🪤 Trap" color="var(--red)"/>
      </KpiRow>

      <div style={{ display:'flex', gap: 8, marginTop: 14, marginBottom: 14, flexWrap:'wrap', alignItems:'center' }}>
        <button onClick={() => setShowMega(s => !s)}
          className="btn btn-primary" style={{padding:'6px 12px',fontSize:11,
            background: showMega ? 'var(--green)' : 'rgba(0,214,143,.15)',
            color: showMega ? 'var(--bg)' : 'var(--green)',
            border: '1px solid var(--green)' }}>
          📋 Mega Paste
        </button>
        <button onClick={downloadBookmarklet} className="btn"
          style={{padding:'6px 12px',fontSize:11}}>
          ⬇ Copiar bookmarklet
        </button>
        <button onClick={importFromPalpites} disabled={importing}
          className="btn" style={{padding:'6px 12px',fontSize:11}}>
          {importing ? '⏳ Importando...' : '⬇ Importar jogos do dia'}
        </button>
        <input value={manualHome} onChange={e => setManualHome(e.target.value)} placeholder="Casa"
          style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, padding:'6px 10px',
            borderRadius: 4, border:'1px solid var(--line)', background:'var(--ink2)',
            color:'var(--white)', outline:'none', width: 130 }}/>
        <span style={{ color:'var(--mute)' }}>×</span>
        <input value={manualAway} onChange={e => setManualAway(e.target.value)} placeholder="Fora"
          style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, padding:'6px 10px',
            borderRadius: 4, border:'1px solid var(--line)', background:'var(--ink2)',
            color:'var(--white)', outline:'none', width: 130 }}/>
        <button onClick={addManual} className="btn" style={{padding:'6px 12px',fontSize:11}}>
          + Adicionar manualmente
        </button>
        <button onClick={() => { if (confirm('Limpar TODA a queue?')) setQueue({}) }}
          className="btn" style={{padding:'6px 12px',fontSize:11,color:'var(--red)',marginLeft:'auto'}}>
          🗑 Limpar tudo
        </button>
      </div>

      {/* Mega Paste */}
      {showMega && (
        <div style={{
          background:'var(--card-bg)', border:'1px solid var(--green)',
          borderRadius:'var(--r2)', padding:'14px 16px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color:'var(--white)', marginBottom: 6 }}>
            📋 Mega Paste — cola TUDO de uma vez
          </div>
          <div style={{ fontSize: 11, color:'var(--soft)', marginBottom: 8 }}>
            Cola aqui o output do bookmarklet (ou texto multi-jogo). Sistema parseia,
            agrupa por jogo e popula a queue automaticamente.
          </div>
          <textarea
            value={megaText}
            onChange={e => setMegaText(e.target.value)}
            placeholder={`Bologna v Roma\n- Resultado Final: Roma\n- Donyell Malen: 2+ Chutes ao Gol\n11.00 >> 12.00\n\nArsenal v Newcastle\n- Resultado Final: Arsenal\n...\n19.00 >> 21.00\n\n(repete pra cada jogo)`}
            rows={10}
            style={{
              width: '100%', fontFamily:"'JetBrains Mono',monospace", fontSize: 11,
              padding:'10px 12px', borderRadius: 4, border:'1px solid var(--line)',
              background:'var(--ink2)', color:'var(--white)', outline:'none',
              marginBottom: 8, resize:'vertical',
            }}
          />
          <div style={{ display:'flex', gap: 8 }}>
            <button onClick={processMegaPaste}
              className="btn btn-primary" style={{padding:'6px 14px',fontSize:11}}>
              ⚡ Processar e distribuir
            </button>
            <button onClick={() => { setMegaText(''); setShowMega(false) }}
              className="btn" style={{padding:'6px 14px',fontSize:11}}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Top global cross-match */}
      {goldList.length + valueList.length > 0 && (
        <div style={{
          background:'linear-gradient(135deg,rgba(0,214,143,.08),rgba(94,203,255,.04))',
          border:'1px solid rgba(0,214,143,.25)', borderRadius:'var(--r2)',
          padding:'12px 14px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color:'var(--white)',
            fontFamily:"'JetBrains Mono',monospace", letterSpacing:'.04em', marginBottom: 8 }}>
            🏆 RANKING GLOBAL · MELHORES BOOSTS DO DIA
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
            {[...goldList, ...valueList].slice(0, 8).map((a, i) => (
              <div key={i} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between', gap: 10,
                padding:'6px 10px', background:'rgba(0,0,0,.2)', borderRadius: 4, fontSize: 11,
                cursor: 'pointer',
              }} onClick={() => setExpandedKey(a._matchKey)}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, color:'var(--white)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {a.match.home} <span style={{color:'var(--mute)'}}>×</span> {a.match.away}
                  </div>
                  <div style={{ fontSize: 9, color:'var(--mute)',
                    fontFamily:"'JetBrains Mono',monospace", marginTop: 1 }}>
                    {a.legs.map(l => l.code).join(' + ')} @ <b style={{color:'var(--green)'}}>{a.boostedOdd}</b>
                  </div>
                </div>
                <div style={{ textAlign:'right', fontFamily:"'JetBrains Mono',monospace" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: verdictColor(a.verdict) }}>
                    {a.ev > 0 ? '+' : ''}{a.ev}% EV
                  </div>
                  <div style={{ fontSize: 9, color:'var(--mute)' }}>prob {a.jointPct}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de jogos */}
      {matchEntries.length === 0 ? (
        <EmptyState icon="🚀" title="Queue vazia"
          subtitle='Clique "Importar jogos do dia" pra começar, ou adicione manualmente'/>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap: 8 }}>
          {matchEntries.map(([key, entry]) => (
            <MatchBoostCard
              key={key}
              matchKey={key}
              match={entry.match}
              text={entry.text || ''}
              onChange={updateText}
              onRemove={() => removeMatch(key)}
              expanded={expandedKey === key}
              onToggle={() => setExpandedKey(k => k === key ? null : key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
