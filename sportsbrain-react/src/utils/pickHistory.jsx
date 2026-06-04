// ─── Shared Pick History Utility ─────────────────────────────────────────────
// Used by FtProps, BkProps, and Garantido for tracking pick history with W/L
import { useState, useMemo } from 'react'

export const WORKER_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'
export const HIST_MAX    = 800

export function normPick(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function makePickId(date, match, stat, extra = '') {
  const base = `${date}|${normPick(match)}|${normPick(stat)}`
  return extra ? `${base}|${normPick(extra)}` : base
}

export function loadHistory(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}

export function saveHistory(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr.slice(-HIST_MAX))) } catch {}
}

export function groupByDate(items) {
  const map = new Map()
  ;[...items].reverse().forEach(h => {
    if (!map.has(h.date)) map.set(h.date, [])
    map.get(h.date).push(h)
  })
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, picks]) => ({ date, picks }))
}

// ── Server sync with D1 ────────────────────────────────────────────────────────
export async function serverSyncHistory(histKey, sport) {
  try {
    const url = sport
      ? `${WORKER_BASE}/v1/picks/history?sport=${sport}`
      : `${WORKER_BASE}/v1/picks/history`
    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return loadHistory(histKey)
    const data = await res.json()
    const serverPicks = (data.picks || []).map(p => ({
      id: p.id, date: p.pick_date, match: p.match, league: p.league || '',
      sport: p.sport || 'football', stat: p.stat, conf: p.conf || 0,
      tier: p.tier || 'aggressive', realOdd: p.real_odd ?? null,
      evReal: p.ev_real ?? null, result: p.result ?? null,
      autoVerified: !!p.auto_verified,
      savedAt: p.saved_at ? new Date(p.saved_at).getTime() : Date.now(),
    }))
    const localPicks = loadHistory(histKey)
    const localById  = Object.fromEntries(localPicks.map(h => [h.id, h]))
    const merged = serverPicks.map(sp => {
      const local = localById[sp.id]
      if (local?.result && !local.autoVerified) return { ...sp, result: local.result, autoVerified: false }
      return sp
    })
    const serverIds = new Set(serverPicks.map(p => p.id))
    const onlyLocal = localPicks.filter(h => !serverIds.has(h.id))
    const final = [...merged, ...onlyLocal]
    saveHistory(histKey, final)
    if (onlyLocal.length > 0) serverSavePicks(onlyLocal)
    return final
  } catch (e) {
    console.warn('[PickHistory] sync failed:', e.message)
    return loadHistory(histKey)
  }
}

export async function serverSavePicks(picks) {
  try {
    await fetch(`${WORKER_BASE}/v1/picks/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ picks: picks.map(p => ({
        id: p.id, pick_date: p.date, match: p.match, league: p.league,
        sport: p.sport, stat: p.stat, conf: p.conf, tier: p.tier,
        real_odd: p.realOdd ?? null, ev_real: p.evReal ?? null,
        result: p.result ?? null, auto_verified: p.autoVerified ? 1 : 0,
      })) }),
      signal: AbortSignal.timeout(10000),
    })
  } catch (e) { console.warn('[PickHistory] server save failed:', e.message) }
}

export async function serverUpdateResult(id, result) {
  try {
    await fetch(`${WORKER_BASE}/v1/picks/result`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, result }),
      signal: AbortSignal.timeout(8000),
    })
  } catch (e) { console.warn('[PickHistory] server update failed:', e.message) }
}

export function autoSavePicks(picks, date, histKey, sport) {
  const hist     = loadHistory(histKey)
  const existIds = new Set(hist.map(h => h.id))
  const toAdd    = []
  picks.forEach(p => {
    if (!existIds.has(p.id)) {
      toAdd.push({
        id: p.id, date,
        match: p.match || '—', league: p.league || '', sport,
        stat: p.stat || '—', conf: p.conf || 0,
        tier: p.tier || 'aggressive',
        realOdd: null, evReal: null, result: null,
        autoVerified: false, savedAt: Date.now(),
      })
    }
  })
  if (toAdd.length > 0) {
    const updated = [...hist, ...toAdd]
    saveHistory(histKey, updated)
    serverSavePicks(toAdd)
    return updated
  }
  return hist
}

export function updateHistResult(id, result, histKey) {
  const hist    = loadHistory(histKey)
  const updated = hist.map(h => h.id === id ? { ...h, result, autoVerified: false } : h)
  saveHistory(histKey, updated)
  serverUpdateResult(id, result)
  return updated
}

// ── Result colors for W/L/V/P buttons ─────────────────────────────────────────
export const RESULT_COLORS = {
  W: { bg: 'rgba(0,214,143,.85)',  border: 'var(--green)', text: '#fff', label: '✓ Win' },
  L: { bg: 'rgba(255,79,106,.85)', border: 'var(--red)',   text: '#fff', label: '✕ Loss' },
  V: { bg: 'rgba(255,255,255,.1)', border: 'var(--mute)',  text: 'var(--t2)', label: '○ Void' },
  P: { bg: 'rgba(255,184,48,.7)', border: 'var(--amber)', text: '#fff', label: '= Push' },
}

// ── Calibração stats ────────────────────────────────────────────────────────
export function calcHistStats(history) {
  const resolved = history.filter(h => h.result === 'W' || h.result === 'L')
  const wins     = resolved.filter(h => h.result === 'W')
  const pending  = history.filter(h => !h.result)
  const wr       = resolved.length ? (wins.length / resolved.length * 100) : null
  const withOdds = resolved.filter(h => h.realOdd && h.realOdd > 1)
  let roi = null
  if (withOdds.length) {
    const profit = withOdds.reduce((acc, h) => h.result === 'W' ? acc + (h.realOdd - 1) : acc - 1, 0)
    roi = (profit / withOdds.length * 100).toFixed(1)
  }
  const brackets = [
    { label: '≥85%',   min: 85, max: 100 },
    { label: '80–84%', min: 80, max: 84  },
    { label: '75–79%', min: 75, max: 79  },
    { label: '70–74%', min: 70, max: 74  },
    { label: '60–69%', min: 60, max: 69  },
    { label: '<60%',   min: 0,  max: 59  },
  ]
  const calibration = brackets.map(({ label, min, max }) => {
    const all    = history.filter(h => h.conf >= min && h.conf <= max)
    const res    = all.filter(h => h.result === 'W' || h.result === 'L')
    const wCount = res.filter(h => h.result === 'W').length
    const avgConf = all.length ? Math.round(all.reduce((a, h) => a + h.conf, 0) / all.length) : Math.round((min + max) / 2)
    return {
      label, total: all.length, resolved: res.length, wins: wCount, avgConf,
      wr: res.length ? +(wCount / res.length * 100).toFixed(0) : null,
      expected: avgConf,
    }
  }).filter(c => c.total > 0)
  return {
    total: history.length, wins: wins.length,
    losses: resolved.length - wins.length,
    pending: pending.length, wr, roi, calibration,
    byDate: groupByDate(history),
  }
}

// ── CSV Export ─────────────────────────────────────────────────────────────────
export function exportHistoryCSV(history, filename = 'sportsbrain_historico.csv') {
  const header = ['Data','Partida','Liga','Esporte','Stat','Conf%','Tier','Odd Real','EV%','Resultado','Auto']
  const rows = history.map(h => [
    h.date || '',
    (h.match || '').replace(/,/g, ';'),
    (h.league || '').replace(/,/g, ';'),
    h.sport || 'football',
    (h.stat || '').replace(/,/g, ';'),
    h.conf || 0,
    h.tier || '',
    h.realOdd ?? '',
    h.evReal != null ? h.evReal.toFixed(2) : '',
    h.result || 'Pendente',
    h.autoVerified ? 'Sim' : 'Não',
  ])
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── HistoricoView component ────────────────────────────────────────────────────
export function HistoricoView({ history, histStats, onSetResult, sport, emptyTitle, emptySubtitle }) {
  const [histFilter, setHistFilter] = useState('all')
  const [histDate,   setHistDate]   = useState('all')

  const allDates = useMemo(() => ['all', ...histStats.byDate.map(d => d.date)], [histStats])

  const filtered = useMemo(() => {
    let items = history
    if (histDate !== 'all')         items = items.filter(h => h.date === histDate)
    if (histFilter === 'W')         items = items.filter(h => h.result === 'W')
    else if (histFilter === 'L')    items = items.filter(h => h.result === 'L')
    else if (histFilter === 'pending') items = items.filter(h => !h.result)
    return [...items].sort((a, b) => b.savedAt - a.savedAt)
  }, [history, histFilter, histDate])

  const fmtDate = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00')
    const td = new Date().toISOString().slice(0, 10)
    const yd = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    if (dateStr === td) return 'Hoje'
    if (dateStr === yd) return 'Ontem'
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  if (history.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--mute)', fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>{emptyTitle || 'Histórico vazio'}</div>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>{emptySubtitle || 'Os picks gerados são salvos automaticamente. Marque os resultados (Win/Loss) para ver sua taxa de acerto real.'}</div>
      </div>
    )
  }

  const { wr, roi, calibration, wins, losses, pending, total } = histStats

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',       value: total,  color: 'var(--t1)' },
          { label: '✅ Win',      value: wins,   color: 'var(--green)' },
          { label: '❌ Loss',     value: losses, color: 'var(--red)' },
          { label: '⏳ Pendente', value: pending, color: 'var(--amber)' },
          { label: 'Win Rate',    value: wr != null ? `${wr.toFixed(0)}%` : '—', color: wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : wr != null ? 'var(--red)' : 'var(--t3)' },
          { label: 'ROI (c/odds)', value: roi != null ? `${+roi >= 0 ? '+' : ''}${roi}%` : '—', color: roi != null && +roi >= 0 ? 'var(--green)' : roi != null ? 'var(--red)' : 'var(--t3)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 80px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Calibração */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.10em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono',monospace", marginBottom: 10 }}>
          🎯 Calibração do Modelo — Confiança vs Acerto Real
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {calibration.map(c => {
            const accurate = c.wr != null && Math.abs(c.wr - c.expected) <= 10
            const overconf = c.wr != null && c.wr < c.expected - 10
            return (
              <div key={c.label} style={{
                background: c.wr != null ? (accurate ? 'rgba(34,197,94,.06)' : overconf ? 'rgba(239,68,68,.06)' : 'rgba(245,158,11,.06)') : 'transparent',
                border: `1px solid ${c.wr != null ? (accurate ? 'rgba(34,197,94,.2)' : overconf ? 'rgba(239,68,68,.2)' : 'rgba(245,158,11,.2)') : 'var(--border)'}`,
                borderRadius: 6, padding: '10px', textAlign: 'center',
              }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1,
                  color: c.wr != null ? (accurate ? 'var(--green)' : overconf ? 'var(--red)' : 'var(--amber)') : 'var(--t3)',
                }}>
                  {c.wr != null ? `${c.wr}%` : '—'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 3 }}>acerto · esp: ~{c.expected}%</div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>{c.resolved}/{c.total} picks</div>
                {c.wr != null && (
                  <div style={{ fontSize: 9, marginTop: 4, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
                    color: accurate ? 'var(--green)' : overconf ? 'var(--red)' : 'var(--amber)',
                  }}>
                    {accurate ? '✓ calibrado' : overconf ? '⚠ superestimado' : '↑ conservador'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 10, fontFamily: "'Inter',sans-serif", lineHeight: 1.5 }}>
          Modelo bem calibrado: faixa ≥85% deve acertar ≥75% das vezes. Marque os resultados para calibrar o modelo ao longo do tempo.
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[
          { key: 'all',     label: `Todos (${total})` },
          { key: 'pending', label: `⏳ Pendente (${pending})` },
          { key: 'W',       label: `✅ Win (${wins})` },
          { key: 'L',       label: `❌ Loss (${losses})` },
        ].map(f => (
          <button key={f.key} onClick={() => setHistFilter(f.key)} style={{
            fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 10px',
            background: histFilter === f.key ? 'rgba(59,158,255,.15)' : 'transparent',
            border: `1px solid ${histFilter === f.key ? 'rgba(59,158,255,.5)' : 'var(--border)'}`,
            borderRadius: 'var(--r-pill)', color: histFilter === f.key ? 'var(--blue)' : 'var(--t3)',
            cursor: 'pointer', fontWeight: histFilter === f.key ? 700 : 400,
          }}>{f.label}</button>
        ))}
        <select value={histDate} onChange={e => setHistDate(e.target.value)} style={{
          fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 8px',
          background: 'var(--ink2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)',
          color: histDate !== 'all' ? 'var(--blue)' : 'var(--t3)', cursor: 'pointer',
        }}>
          <option value="all">📅 Todas as datas</option>
          {allDates.filter(d => d !== 'all').map(d => <option key={d} value={d}>{fmtDate(d)} ({d})</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)' }}>{filtered.length} picks</span>
        <button
          onClick={() => exportHistoryCSV(filtered, `sportsbrain_${sport || 'historico'}_${new Date().toISOString().slice(0,10)}.csv`)}
          title={`Baixar ${filtered.length} picks como CSV`}
          style={{
            fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700,
            background: 'rgba(34,212,160,.10)', border: '1px solid rgba(34,212,160,.3)',
            color: 'var(--green)', padding: '4px 10px', borderRadius: 'var(--r-pill)',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >⬇ CSV</button>
      </div>

      {/* Pick list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(h => {
          const rc = h.result ? RESULT_COLORS[h.result] : null
          return (
            <div key={h.id} style={{
              background: 'var(--card-bg)',
              border: `1px solid ${rc ? rc.border : 'var(--border)'}`,
              borderRadius: 'var(--r2)', padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: h.result === 'L' ? 0.75 : 1,
            }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700,
                color: h.conf >= 80 ? 'var(--green)' : h.conf >= 70 ? 'var(--amber)' : 'var(--t3)',
                minWidth: 34, textAlign: 'center' }}>
                {h.conf}%
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)', marginBottom: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.stat}
                  {h.autoVerified && (
                    <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--mute)', fontFamily: "'JetBrains Mono',monospace",
                      background: 'rgba(255,255,255,.06)', padding: '1px 5px', borderRadius: 3 }}>🤖 auto</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.match} · <span style={{ color: 'var(--mute)', fontSize: 10 }}>{h.league}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 1 }}>{fmtDate(h.date)}</div>
              </div>
              {onSetResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {['W', 'L', 'V', 'P'].map(r => {
                    const rc2 = RESULT_COLORS[r]
                    const active = h.result === r
                    return (
                      <button key={r} onClick={() => onSetResult(h.id, active ? null : r)} style={{
                        fontFamily: "'JetBrains Mono',monospace", fontSize: 9, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
                        background: active ? rc2.bg : 'transparent',
                        border: `1px solid ${active ? rc2.border : 'var(--border)'}`,
                        color: active ? rc2.text : 'var(--t3)',
                        minWidth: 40, textAlign: 'center',
                      }}>{rc2.label}</button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
