// ═══════════════════════════════════════════════════════════════════════════
// Bet365 Matches — lista de jogos do dia com odds 1/X/2 + flag de boost
// ═══════════════════════════════════════════════════════════════════════════
// Lê /v1/bet365/matches/latest. Mostra cada match com:
//  - times, hora
//  - odds 1/X/2
//  - badge se tem aumentadas disponíveis
//  - implied % e fair odd (no-vig)
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'

const MATCHES_URL = 'https://sportsbrain-api.sportsbrain-api.workers.dev/v1/bet365/matches/latest'

function impliedFromOdd(odd) {
  if (!odd || odd <= 1) return null
  return 1 / odd
}

// No-vig: normaliza implied 1/X/2 pra somar 100% (margem da casa removida)
function novigProbs(odds) {
  if (!odds) return null
  const i1 = impliedFromOdd(odds.home)
  const ix = impliedFromOdd(odds.draw)
  const i2 = impliedFromOdd(odds.away)
  if (i1 == null || ix == null || i2 == null) return null
  const sum = i1 + ix + i2
  return { home: i1 / sum, draw: ix / sum, away: i2 / sum, vig: sum - 1 }
}

function fmtPct(v) {
  if (v == null) return '—'
  return (v * 100).toFixed(1) + '%'
}

export default function Bet365Matches() {
  const [data, setData] = useState({ matches: [], capturedAt: null, loading: true, error: null })
  const [filter, setFilter] = useState('all') // all | with-boost | live

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(MATCHES_URL, { signal: AbortSignal.timeout(10000) })
        const j = await res.json()
        if (cancelled) return
        setData({
          matches: j.matches || [],
          capturedAt: j.capturedAt,
          loading: false,
          error: null,
        })
      } catch (e) {
        if (!cancelled) setData({ matches: [], capturedAt: null, loading: false, error: e.message })
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    let list = data.matches
    if (filter === 'with-boost') list = list.filter(m => m.hasBoostBadge)
    if (filter === 'live') list = list.filter(m => /^\d{2,3}:\d{2}$/.test(m.startTime || ''))
    return list.sort((a, b) => {
      // Boost first, depois por hora
      if (a.hasBoostBadge !== b.hasBoostBadge) return a.hasBoostBadge ? -1 : 1
      return (a.startTime || '').localeCompare(b.startTime || '')
    })
  }, [data.matches, filter])

  const withBoost = data.matches.filter(m => m.hasBoostBadge).length

  return (
    <div className="page page-padded">
      <PageHeader
        icon="🎯"
        title="Bet365 — Jogos do Dia"
        subtitle={data.capturedAt
          ? `${data.matches.length} jogos · atualizado ${new Date(data.capturedAt).toLocaleString('pt-BR')}`
          : data.loading ? 'Carregando...' : 'Sem dados ainda'}
      />

      {data.error && (
        <div style={{ padding: 14, background: 'rgba(255,79,106,.08)', border: '1px solid rgba(255,79,106,.3)', borderRadius: 8, marginBottom: 12, color: 'var(--red)', fontSize: 13 }}>
          ❌ {data.error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: 1 }}>FILTROS:</span>
        <button onClick={() => setFilter('all')} className={`btn ${filter === 'all' ? 'btn-active' : ''}`} style={{ padding: '5px 12px', fontSize: 11 }}>
          Todos ({data.matches.length})
        </button>
        <button onClick={() => setFilter('with-boost')} className={`btn ${filter === 'with-boost' ? 'btn-active' : ''}`} style={{ padding: '5px 12px', fontSize: 11 }}>
          🚀 Com Aumentada ({withBoost})
        </button>
      </div>

      {data.loading ? (
        <EmptyState icon="⏳" title="Carregando..." subtitle="Buscando dados do worker" />
      ) : filtered.length === 0 ? (
        <EmptyState icon="📭" title="Nenhum jogo" subtitle={data.matches.length === 0 ? 'Cron ainda não rodou hoje. Use o runner local.' : 'Sem jogos com esse filtro'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((m, i) => (
            <MatchRow key={`${m.home}-${m.away}-${i}`} match={m} />
          ))}
        </div>
      )}
    </div>
  )
}

function MatchRow({ match }) {
  const probs = useMemo(() => novigProbs(match.odds), [match.odds])
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        background: match.hasBoostBadge ? 'rgba(43,217,151,.05)' : 'var(--card)',
        border: `1px solid ${match.hasBoostBadge ? 'var(--green)' : 'var(--border)'}40`,
        borderRadius: 'var(--r1)',
        padding: '10px 14px',
        cursor: 'pointer',
        transition: 'background .15s',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center' }}>
        {/* Times + hora */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {match.home} <span style={{ color: 'var(--mute)', fontWeight: 400 }}>vs</span> {match.away}
          </div>
          <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 2 }}>
            {match.startTime || '—'}
            {match.hasBoostBadge && (
              <span style={{ marginLeft: 8, color: 'var(--green)', fontWeight: 600 }}>
                🚀 {match.badgeCount}+ aumentadas
              </span>
            )}
          </div>
        </div>

        {/* Odds 1/X/2 */}
        <div style={{ display: 'flex', gap: 6 }}>
          {['home', 'draw', 'away'].map((k, idx) => (
            <div key={k} style={{ minWidth: 56, textAlign: 'center', padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r0)' }}>
              <div style={{ fontSize: 9, color: 'var(--mute)', textTransform: 'uppercase' }}>{['1', 'X', '2'][idx]}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)' }}>{match.odds?.[k]?.toFixed(2) || '—'}</div>
            </div>
          ))}
        </div>

        {/* Vig */}
        <div style={{ minWidth: 50, textAlign: 'right', fontSize: 10, color: 'var(--mute)' }}>
          {probs && (
            <>
              <div>vig {(probs.vig * 100).toFixed(1)}%</div>
            </>
          )}
        </div>
      </div>

      {expanded && probs && (
        <div style={{ marginTop: 10, padding: 8, background: 'var(--bg)', borderRadius: 'var(--r0)', fontSize: 11 }}>
          <div style={{ color: 'var(--mute)', marginBottom: 4 }}>Probabilidades sem vig (fair):</div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div><b>{match.home}:</b> {fmtPct(probs.home)} (fair {(1 / probs.home).toFixed(2)})</div>
            <div><b>Empate:</b> {fmtPct(probs.draw)} (fair {(1 / probs.draw).toFixed(2)})</div>
            <div><b>{match.away}:</b> {fmtPct(probs.away)} (fair {(1 / probs.away).toFixed(2)})</div>
          </div>
        </div>
      )}
    </div>
  )
}
