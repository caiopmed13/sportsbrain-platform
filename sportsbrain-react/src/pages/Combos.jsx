// ═══════════════════════════════════════════════════════════════════════════
// Combos.jsx — Combos (parlays) estilo FAIXA VIP — separado por esporte
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Sparkles, Copy, Check, Share2 } from 'lucide-react'
import { marketToPT, directionToPT } from '../utils/marketLabels'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://sportsbrain-api.sportsbrain-api.workers.dev'

const TIER_INFO = {
  safe:               { label: '🛡️ Safe',          desc: 'odd 3-8',                color: 'var(--blue)' },
  medium:             { label: '⚖️ Medium',        desc: 'odd 5-20',               color: 'var(--green)' },
  longshot:           { label: '🚀 Longshot',      desc: 'odd 15-60',              color: 'var(--amber)' },
  faixavip_simples:   { label: '🥷 Simples (FAIXA)', desc: 'odd 8-30 individual', color: 'var(--accent)' },
  faixavip_dupla:     { label: '🥷 Dupla (FAIXA)',   desc: 'odd 50-250 (2 legs)', color: 'var(--accent)' },
  jackpot:            { label: '💎 Jackpot',       desc: 'odd 100-1000',           color: 'var(--accent)' },
  godmode:            { label: '⚡ Godmode',       desc: 'odd 1000+',              color: 'var(--red)' },
}

function ComboCard({ c, copied, setCopied }) {
  function copyText() {
    navigator.clipboard.writeText(c.sale_template || JSON.stringify(c.legs.map(l => `${l.match} ${l.market} @${l.odd}`)))
    setCopied(c.combined_odd + c.sport)
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <div style={{
      background: 'var(--bg-2)',
      border: `1px solid ${TIER_INFO[c.tier]?.color || 'var(--border)'}`,
      borderRadius: 10, padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        {c.tier && (
          <span style={{
            background: TIER_INFO[c.tier]?.color || 'var(--bg-3)', color: '#fff',
            fontSize: 11, padding: '3px 8px', borderRadius: 12, fontWeight: 600,
          }}>{TIER_INFO[c.tier]?.label || c.tier}</span>
        )}
        {!c.tier && (
          <span style={{
            background: 'var(--accent)', color: '#fff',
            fontSize: 11, padding: '3px 8px', borderRadius: 12, fontWeight: 600,
          }}>🥷 FAIXA Style</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--t3)' }}>{c.n_legs} legs</span>
        {c.tipster_pattern_score > 5 && (
          <span style={{ fontSize: 11, padding: '2px 6px', background: 'rgba(34,212,160,.15)', color: 'var(--green)', borderRadius: 4 }}>
            🎯 Pattern {c.tipster_pattern_score}
          </span>
        )}
        {c.similarity_score > 30 && (
          <span style={{ fontSize: 11, padding: '2px 6px', background: 'rgba(120,90,255,.15)', color: 'var(--accent)', borderRadius: 4 }}>
            🥷 Similar {c.similarity_score}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--t3)' }}>Odd</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{c.combined_odd}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--t3)' }}>Prob</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{c.combined_prob}%</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--t3)' }}>EV</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>+{c.ev_pct}%</div>
          </div>
          <button onClick={copyText} style={{
            padding: '8px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 6, cursor: 'pointer', color: 'var(--t1)',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
          }}>
            {copied === c.combined_odd + c.sport ? <Check size={14} /> : <Share2 size={14} />}
            {copied === c.combined_odd + c.sport ? 'Copiado' : 'Pra postar'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {c.legs.map((l, j) => (
          <div key={j} style={{
            background: 'var(--bg-1)', border: '1px solid var(--border)',
            borderRadius: 6, padding: 8, display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 12, flexWrap: 'wrap',
          }}>
            <span style={{ color: 'var(--t3)', minWidth: 20 }}>#{j + 1}</span>
            <strong style={{ color: 'var(--t1)' }}>{l.match}</strong>
            <span style={{ color: 'var(--t3)' }}>·</span>
            <span style={{ color: 'var(--t2)' }}>{marketToPT(l.market)}</span>
            <span style={{ background: 'var(--bg-3)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              {l.selection || directionToPT(l) || 'Pick'}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ color: 'var(--t3)', fontSize: 11 }}>conf {Math.round(l.conf || 0)}%</span>
              <span style={{ color: 'var(--green)', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>@{l.odd}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Combos() {
  const [mode, setMode] = useState('builder')        // builder | faixa
  const [faixaMode, setFaixaMode] = useState('hybrid') // safe | longshot | hybrid | faixa_only
  const [data, setData] = useState(null)
  const [faixaData, setFaixaData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tier, setTier] = useState('all')
  const [sport, setSport] = useState('football')
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    if (mode === 'builder') {
      setLoading(true)
      fetch(`${API_BASE}/v1/picks/combos?tier=${tier}`)
        .then(r => r.json())
        .then(j => { setData(j.data); setLoading(false) })
        .catch(e => { console.error(e); setLoading(false) })
    } else if (mode === 'faixa') {
      setLoading(true)
      fetch(`${API_BASE}/v1/picks/combos-faixa-style?sport=${sport}&mode=${faixaMode}`)
        .then(r => r.json())
        .then(j => { setFaixaData(j); setLoading(false) })
        .catch(e => { console.error(e); setLoading(false) })
    }
  }, [tier, mode, sport, faixaMode])

  const sportData = data?.[sport] || { combos: {}, top_overall: [], tiers: [] }
  const combos = mode === 'faixa'
    ? (faixaData?.top_combos || [])
    : (sportData.top_overall || [])
  const tiers = sportData.tiers || []
  const tipsterPatterns = data?.tipster_patterns || {}

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Sparkles size={24} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0, fontSize: 22 }}>Combos — Estilo FAIXA VIP</h1>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t3)' }}>
          Padrões aprendidos: {tipsterPatterns.sample || 0} tips de tipsters · {tipsterPatterns.hot_markets || 0} hot markets
        </span>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'builder', label: '🎲 Combo Builder' },
          { id: 'faixa',   label: '🥷 FAIXA-Style (IA)' },
        ].map(t => (
          <button key={t.id} onClick={() => setMode(t.id)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none',
              borderBottom: mode === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: mode === t.id ? 'var(--t1)' : 'var(--t3)',
              cursor: 'pointer', fontWeight: mode === t.id ? 600 : 400, fontSize: 14,
            }}>{t.label}</button>
        ))}
      </div>

      {mode === 'builder' && (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 20, fontSize: 13, color: 'var(--t3)' }}>
          <strong style={{ color: 'var(--t1)' }}>💡 Como funciona:</strong> combina picks de high confidence (sempre <strong>diferentes jogos</strong>),
          ranqueado por EV + pattern matching. Template pronto pra <strong>postar/vender</strong>.
        </div>
      )}

      {mode === 'faixa' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { id: 'safe',       label: '🛡️ Safe',     desc: 'odd combinada 5-20' },
            { id: 'longshot',   label: '🚀 Longshot', desc: 'nossos picks odd 4+, combinada 50+' },
            { id: 'hybrid',     label: '🥷 Hybrid',   desc: 'nossos + tips reais FAIXA' },
            { id: 'faixa_only', label: '🔥 FAIXA Real', desc: 'só tips reais do tipster' },
          ].map(m => (
            <button key={m.id} onClick={() => setFaixaMode(m.id)} style={{
              padding: '8px 14px',
              background: faixaMode === m.id ? 'var(--bg-3)' : 'var(--bg-2)',
              border: `1px solid ${faixaMode === m.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 8, cursor: 'pointer', fontSize: 13,
              color: faixaMode === m.id ? 'var(--t1)' : 'var(--t3)',
              fontWeight: faixaMode === m.id ? 600 : 400,
            }} title={m.desc}>{m.label}</button>
          ))}
        </div>
      )}

      {mode === 'faixa' && faixaData && (
        <div style={{ background: 'rgba(120, 90, 255, 0.05)', border: '1px solid var(--accent)', borderRadius: 10, padding: 14, marginBottom: 20, fontSize: 13 }}>
          <strong style={{ color: 'var(--accent)' }}>🥷 IA aprendeu do FAIXA VIP:</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginTop: 10, fontSize: 12, color: 'var(--t2)' }}>
            <div>📊 <strong>{faixaData.patterns?.modal_legs}</strong> legs por combo (modal)</div>
            <div>🎯 Avg odd individual: <strong>{faixaData.patterns?.avg_leg_odd}</strong></div>
            <div>✅ Combos W aprendidos: <strong>{faixaData.patterns?.sample?.winning_combos}</strong></div>
            <div>🔥 Combos gerados: <strong>{faixaData.total_combos_generated}</strong></div>
          </div>
          {faixaData.patterns?.top_markets && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--t3)' }}>
              <strong>Mercados favoritos:</strong>{' '}
              {faixaData.patterns.top_markets.map(m => `${m.market} (${m.freq}%)`).join(' · ')}
            </div>
          )}
          {faixaData.faixa_recent_tips > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)' }}>
              ✨ <strong>{faixaData.faixa_recent_tips}</strong> tips reais do FAIXA VIP nas últimas 24h estão sendo usadas
            </div>
          )}
        </div>
      )}

      {/* Sport tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'football',   label: '⚽ Futebol' },
          { id: 'basketball', label: '🏀 Basquete' },
        ].map(s => (
          <button key={s.id} onClick={() => setSport(s.id)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none',
              borderBottom: sport === s.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: sport === s.id ? 'var(--t1)' : 'var(--t3)',
              cursor: 'pointer', fontWeight: sport === s.id ? 600 : 400, fontSize: 14,
            }}>{s.label}</button>
        ))}
      </div>

      {/* Tier filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['all', ...Object.keys(TIER_INFO)].map(t => (
          <button key={t} onClick={() => setTier(t)} style={{
            padding: '7px 12px',
            background: tier === t ? 'var(--bg-3)' : 'var(--bg-2)',
            border: `1px solid ${tier === t ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 8, cursor: 'pointer', fontSize: 12,
            color: tier === t ? 'var(--t1)' : 'var(--t3)',
            fontWeight: tier === t ? 600 : 400,
          }}>
            {t === 'all' ? '🌐 Todos' : TIER_INFO[t]?.label}
            {t !== 'all' && TIER_INFO[t] && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--t3)' }}>· {TIER_INFO[t].desc}</span>}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--t3)', padding: 20 }}>Calculando combos…</div>}

      {!loading && combos.length === 0 && (
        <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 30, textAlign: 'center', color: 'var(--t3)' }}>
          Nenhum combo de {sport === 'football' ? 'futebol' : 'basquete'} disponível agora.
          <br/><span style={{ fontSize: 12 }}>Pool: {sportData.candidates_pool || 0} picks · Total combos: {sportData.total_combos || 0}</span>
        </div>
      )}

      {/* Tier summary */}
      {tiers.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
          {tiers.map(t => (
            <div key={t.name} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TIER_INFO[t.name]?.color || 'var(--t1)' }}>
                {TIER_INFO[t.name]?.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{t.count} combos</div>
              {t.best_ev != null && (
                <div style={{ fontSize: 11, color: 'var(--green)' }}>Best EV: +{t.best_ev}%</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Combos */}
      <div style={{ display: 'grid', gap: 12 }}>
        {combos.slice(0, 15).map((c, i) => (
          <ComboCard key={i} c={c} copied={copied} setCopied={setCopied} />
        ))}
      </div>
    </div>
  )
}
