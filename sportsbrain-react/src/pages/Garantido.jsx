// ══════════════════════════════════════════════════════════
// Garantido — Palpites com ≥ 75% de confiança
// Integrado com Análise 365 AI: chaves compartilhadas,
// odds reais e análise IA aplicada aos picks garantidos.
// ══════════════════════════════════════════════════════════
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { ftpTeamProps } from './FtProps'
import { fetchMatches, fetchTeamStats } from '../api/client'
import { callClaude, mdToHtml } from '../utils/ai'
import { matchPriority, fetchFeaturedMatches } from '../utils/featured'
import { KellyBadge, kellyFraction } from '../components/ui/PickBadges'
import { usePerfStore } from '../store'
import { checkAndNotifyPicks } from '../utils/notifications'
import { TeamForm, H2HPanel } from '../components/ui/TeamFormH2H'

const WORKER_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'
const CONF_MIN = 75

// ─── Chaves compartilhadas com Análise 365 ────────────────────────────────────
const CLAUDE_KEY_SK   = 'sb_claude_key_365'
function getClaudeKey()  { try { return localStorage.getItem(CLAUDE_KEY_SK)   || '' } catch { return '' } }
function saveClaudeKey(k){ try { localStorage.setItem(CLAUDE_KEY_SK,   (k||'').trim()) } catch {} }

// Busca odds reais via Worker proxy — sem chave no browser
async function fetchRealOddsMap() {
  const map = {}
  const now = Date.now()
  try {
    const resp = await fetch(`${WORKER_BASE}/v1/odds/all`, { signal: AbortSignal.timeout(20000) })
    if (!resp.ok) return map
    const data = await resp.json()
    const TARGET_BOOKS = { bet365:'Bet365', betano:'Betano', betano_br:'Betano', pinnacle:'Pinnacle' }
    const events = Array.isArray(data.events) ? data.events : []
    events.forEach(ev => {
      const t = ev.commence_time ? new Date(ev.commence_time).getTime() : 0
      if (t < now - 2 * 3600000 || t > now + 36 * 3600000) return
      const key = norm(ev.home_team) + '|' + norm(ev.away_team)
      const bks = ev.bookmakers || []
      const h2h = {}, tots = {}, byBook = {}
      bks.forEach(bk => {
        const label = TARGET_BOOKS[bk.key]
        ;(bk.markets || []).forEach(mkt => {
          if (mkt.key === 'h2h') {
            ;(mkt.outcomes || []).forEach(o => {
              if (o.name === ev.home_team  && (!h2h.home || o.price > h2h.home)) h2h.home = o.price
              if (o.name === ev.away_team  && (!h2h.away || o.price > h2h.away)) h2h.away = o.price
              if (o.name === 'Draw'        && (!h2h.draw || o.price > h2h.draw)) h2h.draw = o.price
              if (label) {
                if (!byBook[label]) byBook[label] = { h2h:{}, tots:{} }
                if (o.name === ev.home_team) byBook[label].h2h.home = o.price
                if (o.name === ev.away_team) byBook[label].h2h.away = o.price
                if (o.name === 'Draw')       byBook[label].h2h.draw = o.price
              }
            })
          }
          if (mkt.key === 'totals') {
            ;(mkt.outcomes || []).forEach(o => {
              if (o.point === 2.5) {
                if ((o.name||'').toLowerCase()==='over'  && (!tots.over  || o.price > tots.over))  tots.over  = o.price
                if ((o.name||'').toLowerCase()==='under' && (!tots.under || o.price > tots.under)) tots.under = o.price
                if (label) {
                  if (!byBook[label]) byBook[label] = { h2h:{}, tots:{} }
                  if ((o.name||'').toLowerCase()==='over')  byBook[label].tots.over  = o.price
                  if ((o.name||'').toLowerCase()==='under') byBook[label].tots.under = o.price
                }
              }
            })
          }
        })
      })
      map[key] = { h2h, tots, books: bks.length, sport: ev.sport_key, byBook }
    })
  } catch(e) {
    console.warn('[Garantido] fetchRealOddsMap:', e.message)
  }
  return map
}

function norm(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim() }

// Tenta mapear um pick (match + marketLabel) para odds reais
function lookupOdds(pick, oddsMap) {
  if (!pick.match || !oddsMap) return null
  // tenta home|away e away|home
  const parts = pick.match.split(' vs ')
  if (parts.length < 2) return null
  const k1 = norm(parts[0]) + '|' + norm(parts[1])
  const k2 = norm(parts[1]) + '|' + norm(parts[0])
  const entry = oddsMap[k1] || oddsMap[k2]
  if (!entry) return null
  const ml = (pick.marketLabel || pick.stat || '').toLowerCase()

  let odds = null, type = null, mktKey = null, subKey = null
  if (ml.includes('casa') || ml.includes('home'))         { odds = entry.h2h?.home;  type = 'h2h_home'; mktKey = 'h2h';  subKey = 'home' }
  else if (ml.includes('fora') || ml.includes('away'))    { odds = entry.h2h?.away;  type = 'h2h_away'; mktKey = 'h2h';  subKey = 'away' }
  else if (ml.includes('empate') || ml.includes('draw'))  { odds = entry.h2h?.draw;  type = 'h2h_draw'; mktKey = 'h2h';  subKey = 'draw' }
  else if (ml.includes('over')  || ml.includes('mais'))   { odds = entry.tots?.over;  type = 'over25';   mktKey = 'tots'; subKey = 'over' }
  else if (ml.includes('under') || ml.includes('menos'))  { odds = entry.tots?.under; type = 'under25';  mktKey = 'tots'; subKey = 'under' }
  if (!type) return null

  // per-bookmaker breakdown
  const byBook = {}
  if (entry.byBook && mktKey && subKey) {
    Object.entries(entry.byBook).forEach(([label, bkData]) => {
      const v = bkData[mktKey]?.[subKey]
      if (v) byBook[label] = v
    })
  }

  return { odds, type, byBook: Object.keys(byBook).length > 0 ? byBook : null }
}

function sharePick(prop, realOdds) {
  const conf = prop.conf ?? prop.confidence ?? 0
  const stat = prop.stat || prop.market || '—'
  const line = prop.line != null ? ` ${prop.direction === 'under' ? 'U' : 'O'}${prop.line}` : ''
  const odd  = realOdds?.odds
  const ev   = odd ? calcEvRaw(conf, odd) : (prop.ev ?? null)
  const lines = [
    `🔒 ${conf}% conf · ${stat}${line}`,
    `${prop.sport === 'basketball' ? '🏀' : '⚽'} ${prop.match || '—'}`,
    prop.league ? `🏆 ${prop.league}` : null,
    odd ? `💰 @${odd}` : null,
    ev != null && ev > 0 ? `📈 EV: +${typeof ev === 'number' ? ev.toFixed(1) : ev}%` : null,
    prop.reason ? `💬 ${String(prop.reason).slice(0, 120)}` : null,
    '',
    '🧠 SportsBrain · sportsbrain.pages.dev',
  ].filter(l => l !== null).join('\n')
  try {
    if (navigator.share) navigator.share({ title: 'Pick SportsBrain', text: lines })
    else navigator.clipboard.writeText(lines)
  } catch { navigator.clipboard.writeText(lines) }
}
function calcEvRaw(conf, odd) { return +((conf / 100 * odd - 1) * 100).toFixed(1) }

function calcEV(conf, odd) {
  const p = conf / 100
  const ev = +((p * odd - 1) * 100).toFixed(1)
  return ev
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const todayStr = today()
  if (dateStr === todayStr) return 'Hoje'
  if (dateStr === addDays(todayStr, -1)) return 'Ontem'
  if (dateStr === addDays(todayStr, 1)) return 'Amanhã'
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

// ─── Histórico de picks — localStorage (cache local) + D1 (server) ────────────
const HIST_SK  = 'sb_garantido_history'
const HIST_MAX = 800

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_SK) || '[]') } catch { return [] }
}
function saveHistory(arr) {
  try { localStorage.setItem(HIST_SK, JSON.stringify(arr.slice(-HIST_MAX))) } catch {}
}
function makePickId(date, match, stat) {
  return `${date}|${norm(match || '')}|${norm(stat || '')}`
}

// ── Sync com servidor (D1) ────────────────────────────────────────────────────
async function serverSyncHistory() {
  // Puxa histórico do servidor e faz merge com localStorage
  try {
    const res  = await fetch(`${WORKER_BASE}/v1/picks/history`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return loadHistory()
    const data = await res.json()
    const serverPicks = (data.picks || []).map(p => ({
      id:           p.id,
      date:         p.pick_date,
      match:        p.match,
      league:       p.league || '',
      sport:        p.sport  || 'football',
      stat:         p.stat,
      conf:         p.conf   || 0,
      tier:         p.tier   || 'aggressive',
      realOdd:      p.real_odd  ?? null,
      evReal:       p.ev_real   ?? null,
      result:       p.result    ?? null,
      autoVerified: !!p.auto_verified,
      savedAt:      p.saved_at  ? new Date(p.saved_at).getTime() : Date.now(),
    }))
    // Merge: servidor tem prioridade para result (cron pode ter atualizado)
    const localPicks = loadHistory()
    const localById  = Object.fromEntries(localPicks.map(h => [h.id, h]))
    const merged     = serverPicks.map(sp => {
      const local = localById[sp.id]
      // Se o usuário marcou manualmente (autoVerified=false), preserva resultado local
      if (local?.result && !local.autoVerified) return { ...sp, result: local.result, autoVerified: false }
      return sp
    })
    // Adiciona picks locais que o servidor ainda não tem
    const serverIds = new Set(serverPicks.map(p => p.id))
    const onlyLocal = localPicks.filter(h => !serverIds.has(h.id))
    const final     = [...merged, ...onlyLocal]
    saveHistory(final)
    // Sobe picks locais para o servidor em background
    if (onlyLocal.length > 0) {
      serverSavePicks(onlyLocal)
    }
    return final
  } catch (e) {
    console.warn('[Histórico] sync falhou, usando localStorage:', e.message)
    return loadHistory()
  }
}

async function serverSavePicks(picks) {
  // Salva picks novos no servidor em background (não bloqueia UI)
  try {
    await fetch(`${WORKER_BASE}/v1/picks/save`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ picks: picks.map(p => ({
        id:       p.id,
        pick_date: p.date,
        match:    p.match,
        league:   p.league,
        sport:    p.sport,
        stat:     p.stat,
        conf:     p.conf,
        tier:     p.tier,
        real_odd: p.realOdd,
        ev_real:  p.evReal,
      })) }),
      signal:  AbortSignal.timeout(10000),
    })
  } catch (e) {
    console.warn('[Histórico] server save falhou:', e.message)
  }
}

async function serverUpdateResult(id, result) {
  try {
    await fetch(`${WORKER_BASE}/v1/picks/result`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, result }),
      signal:  AbortSignal.timeout(8000),
    })
  } catch (e) {
    console.warn('[Histórico] server update falhou:', e.message)
  }
}

function autoSavePicks(picks, date, oddsMap) {
  const hist     = loadHistory()
  const existIds = new Set(hist.map(h => h.id))
  const toAdd    = []
  picks.forEach(p => {
    const id = makePickId(date, p.match || '', p.stat || p.market || '')
    if (!existIds.has(id)) {
      const real = oddsMap ? lookupOdds(p, oddsMap) : null
      const conf = p.conf ?? p.confidence ?? 0
      toAdd.push({
        id, date,
        match:        p.match   || '—',
        league:       p.league  || '',
        sport:        p.sport   || 'football',
        stat:         p.stat    || p.market || '—',
        conf,
        tier:         p.tier    || 'aggressive',
        realOdd:      real?.odds  ?? null,
        evReal:       real?.odds  ? calcEV(conf, real.odds) : null,
        result:       null,
        autoVerified: false,
        savedAt:      Date.now(),
      })
    }
  })
  if (toAdd.length > 0) {
    const updated = [...hist, ...toAdd]
    saveHistory(updated)
    // Persiste no servidor em background
    serverSavePicks(toAdd)
    return updated
  }
  return hist
}

function updateHistResult(id, result) {
  const hist    = loadHistory()
  const updated = hist.map(h => h.id === id ? { ...h, result, autoVerified: false } : h)
  saveHistory(updated)
  // Persiste no servidor em background
  serverUpdateResult(id, result)
  return updated
}
function groupByDate(items) {
  const map = new Map()
  ;[...items].reverse().forEach(h => {
    if (!map.has(h.date)) map.set(h.date, [])
    map.get(h.date).push(h)
  })
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, picks]) => ({ date, picks }))
}

// ─── Auto-verificação de resultados ───────────────────────────────────────────
async function buildResultsMap(date) {
  // Busca todos os jogos do dia pela ESPN e filtra apenas os encerrados
  const res     = await fetchMatches({ date, sport: 'football' })
  const matches = res.matches || []
  const map     = {}
  matches.forEach(m => {
    if (!m.status_meta?.isFin) return
    const hs = m.score?.home
    const as = m.score?.away
    if (hs == null || as == null) return
    const k = norm(m.home_team) + '|' + norm(m.away_team)
    map[k] = { home: hs, away: as }
  })
  return map
}

function resolveMarket(stat, scores) {
  const s     = (stat || '').toLowerCase()
  const total = scores.home + scores.away
  const homeWon = scores.home > scores.away
  const awayWon = scores.away > scores.home
  const draw    = scores.home === scores.away
  const btts    = scores.home > 0 && scores.away > 0

  // Resultado H2H
  if ((s.includes('vitória') || s.includes('vit')) && (s.includes('casa') || s.includes('home') || s.includes('mandante'))) return homeWon ? 'W' : 'L'
  if ((s.includes('vitória') || s.includes('vit')) && (s.includes('fora') || s.includes('away') || s.includes('visitante'))) return awayWon ? 'W' : 'L'
  if (s.includes('empate') || s.includes('draw')) return draw ? 'W' : 'L'

  // Over/Under total de gols
  const overM  = s.match(/over\s+([\d.]+)/)
  if (overM)  return total > parseFloat(overM[1])  ? 'W' : 'L'
  const underM = s.match(/under\s+([\d.]+)/)
  if (underM) return total < parseFloat(underM[1]) ? 'W' : 'L'
  // Gols acima/abaixo com linha no stat separado
  if (s.includes('mais de') || s.includes('acima de')) {
    const m2 = s.match(/([\d.]+)/)
    if (m2) return total > parseFloat(m2[1]) ? 'W' : 'L'
  }
  if (s.includes('menos de') || s.includes('abaixo de')) {
    const m2 = s.match(/([\d.]+)/)
    if (m2) return total < parseFloat(m2[1]) ? 'W' : 'L'
  }

  // BTTS
  if (s.includes('btts') || s.includes('ambos marcam') || s.includes('ambas equipes')) return btts ? 'W' : 'L'

  // Não verificável automaticamente (SOT, Escanteios, Cartões, etc.)
  return null
}

async function autoVerifyPending(historyArr) {
  const pending = historyArr.filter(h => !h.result && h.sport === 'football')
  if (!pending.length) return null

  // Datas únicas com picks pendentes
  const dates = [...new Set(pending.map(h => h.date))]

  // Busca resultados de cada data em paralelo
  const resultsMaps = {}
  await Promise.allSettled(
    dates.map(async date => {
      try { resultsMaps[date] = await buildResultsMap(date) } catch {}
    })
  )

  let updated = [...historyArr]
  let changed = 0

  pending.forEach(pick => {
    const rmap = resultsMaps[pick.date]
    if (!rmap || !Object.keys(rmap).length) return

    const parts = (pick.match || '').split(' vs ')
    if (parts.length < 2) return

    const k1 = norm(parts[0]) + '|' + norm(parts[1])
    const k2 = norm(parts[1]) + '|' + norm(parts[0])

    let scores = null
    if (rmap[k1])      scores = { home: rmap[k1].home, away: rmap[k1].away }
    else if (rmap[k2]) scores = { home: rmap[k2].away, away: rmap[k2].home } // inverte para perspectiva do pick
    if (!scores) return

    const verdict = resolveMarket(pick.stat, scores)
    if (!verdict) return

    const idx = updated.findIndex(h => h.id === pick.id)
    if (idx >= 0 && !updated[idx].result) {
      updated[idx] = { ...updated[idx], result: verdict, autoVerified: true }
      changed++
    }
  })

  if (changed > 0) {
    saveHistory(updated)
    return { updated, changed }
  }
  return null
}

const RESULT_COLORS = {
  W: { c: '#4ade80', bg: 'rgba(34,197,94,.18)',  border: 'rgba(34,197,94,.45)',  label: '✅ Win'  },
  L: { c: '#f87171', bg: 'rgba(239,68,68,.18)',   border: 'rgba(239,68,68,.45)',   label: '❌ Loss' },
  V: { c: '#fbbf24', bg: 'rgba(245,158,11,.18)', border: 'rgba(245,158,11,.45)', label: '○ Void' },
  P: { c: '#60a5fa', bg: 'rgba(59,130,246,.18)',  border: 'rgba(59,130,246,.45)',  label: '≈ Push' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
}

function shouldSkipGame(g) {
  if (g.status_meta?.isFin || g.status_meta?.isLive || g.status_meta?.isHT || g.status_meta?.isActive) return true
  const s = (g.status || g.state || g.fixture?.status?.short || '').toLowerCase()
  const skip = ['ft','finished','complete','completed','full_time','fim','ended','post','closed',
    'live','1h','2h','ht','in_play','active','in_progress','running','in','halftime','paused','break']
  return skip.some(d => s === d || s.startsWith(d))
}

function normLeague(g) {
  const l = (typeof g.league === 'string' ? g.league : g.league?.name)
         || g.competition?.name || g.league_name || ''
  const bad = ['Liga','liga','','Sem Liga']
  return (l && !bad.includes(l) && l.length > 1) ? l : 'Outros'
}

function normCountry(g) {
  const c = g.league_country || g.country
         || (typeof g.league === 'object' ? g.league?.country : null)
         || g.competition?.country || ''
  const bad = ['World','world','']
  return (c && !bad.includes(c) && c.length > 1) ? c : ''
}

// ─── Conf color ───────────────────────────────────────────────────────────────
function confColor(c) {
  if (c >= 85) return '#22c55e'   // verde forte
  if (c >= 78) return '#86efac'   // verde médio
  return '#fde68a'                 // amarelo (75-77)
}

// ─── Card de palpite ──────────────────────────────────────────────────────────
// ─── Acumuladores Salvos ───────────────────────────────────────────────────────
function SavedAccumulators({ accus, onDelete }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 14, marginTop: 6 }}>
      <button onClick={() => setOpen(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.25)',
        borderRadius: 'var(--r2)', padding: '7px 12px', cursor: 'pointer', width: '100%',
        fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#c4b5fd',
      }}>
        <span>📋 Acumuladores Salvos</span>
        <span style={{ fontWeight: 700, color: '#a78bfa' }}>({accus.length})</span>
        <span style={{ marginLeft: 'auto', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {accus.map(a => (
            <div key={a.id} style={{
              background: 'rgba(139,92,246,.05)', border: '1px solid rgba(139,92,246,.2)',
              borderRadius: 8, padding: '9px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color: '#c4b5fd', fontWeight: 700 }}>{a.name}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {a.combOdd && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color: '#a78bfa' }}>@{a.combOdd.toFixed(2)}</span>}
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)' }}>{a.combProb}%</span>
                  <button onClick={() => onDelete(a.id)} style={{ background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:12 }}>✕</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {a.entries.map((e, i) => (
                  <span key={i} style={{
                    fontFamily:"'JetBrains Mono',monospace", fontSize: 10,
                    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
                    borderRadius: 4, padding: '2px 6px', color: 'var(--soft)',
                  }}>
                    {e.conf}% · {e.stat}{e.line != null ? ` ${e.direction==='under'?'U':'O'}${e.line}` : ''}{e.odd ? ` @${e.odd}` : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Acumulador Builder (floating panel) ──────────────────────────────────────
function AcumuladorPanel({ picks, banca, onClear, onSave }) {
  const [copied, setCopied] = useState(false)
  const entries = Array.from(picks.entries()) // [ [pid, {prop, realOdds}], ... ]
  const n = entries.length
  if (n < 2) return null

  // Cálculos
  const probs    = entries.map(([, { prop, realOdds }]) => {
    // Usa odd real se disponível para calcular prob implícita, senão conf/100
    if (realOdds?.odds) return 1 / realOdds.odds
    return (prop.conf ?? prop.confidence ?? 75) / 100
  })
  const odds     = entries.map(([, { prop, realOdds }]) => realOdds?.odds ?? null)
  const hasAllOdds = odds.every(o => o != null)

  const combProb = probs.reduce((a, b) => a * b, 1)
  const combConf = Math.round(combProb * 100)
  const combOdd  = hasAllOdds ? odds.reduce((a, b) => a * b, 1) : null
  const ev       = combOdd != null ? +((combProb * combOdd - 1) * 100).toFixed(1) : null
  // Quarter Kelly para acumulador
  const kellyStake = combOdd != null
    ? Math.max(0, ((combProb * combOdd - 1) / (combOdd - 1)) / 4) * (banca || 1000)
    : null

  const confColor = combConf >= 25 ? 'var(--green)' : combConf >= 10 ? 'var(--amber)' : 'var(--red)'

  function copyText() {
    const lines = ['🎯 Acumulador SportsBrain', '']
    entries.forEach(([, { prop, realOdds }]) => {
      const c = prop.conf ?? prop.confidence ?? 0
      const odd = realOdds?.odds
      lines.push(`✅ ${prop.match || '—'} — ${prop.stat || prop.market || '—'}${prop.line != null ? ` ${prop.direction==='under'?'U':'O'}${prop.line}` : ''}${odd ? ` @${odd}` : ''} (${c}%)`)
    })
    lines.push('')
    if (combOdd) lines.push(`🎰 Odd combinada: ${combOdd.toFixed(2)}`)
    lines.push(`📊 Prob. combinada: ${combConf}%`)
    if (ev != null) lines.push(`💹 EV: ${ev > 0 ? '+' : ''}${ev}%`)
    if (kellyStake) lines.push(`💰 Stake sugerida (¼ Kelly): R$ ${kellyStake.toFixed(2)}`)
    lines.push('', '🔒 gerado por SportsBrain')
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      width: 'min(480px, calc(100vw - 32px))',
      background: 'rgba(18,18,30,.97)',
      border: '1px solid rgba(139,92,246,.5)',
      borderRadius: 12,
      padding: '12px 14px',
      zIndex: 999,
      boxShadow: '0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(139,92,246,.15)',
      backdropFilter: 'blur(16px)',
    }}>
      {/* header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700, color:'#c4b5fd', letterSpacing:'.5px' }}>
            🎯 ACUMULADOR ({n} picks)
          </span>
        </div>
        <button onClick={onClear} style={{
          background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:14, padding:'0 4px',
        }}>✕</button>
      </div>

      {/* picks list */}
      <div style={{ display:'flex', flexDirection:'column', gap:3, marginBottom:10 }}>
        {entries.map(([pid, { prop, realOdds }]) => {
          const c = prop.conf ?? prop.confidence ?? 0
          const odd = realOdds?.odds
          return (
            <div key={pid} style={{
              display:'flex', alignItems:'center', gap:6,
              fontSize:11, fontFamily:"'JetBrains Mono',monospace",
            }}>
              <span style={{ color:'#c4b5fd', fontWeight:700, minWidth:30 }}>{c}%</span>
              <span style={{ color:'var(--soft)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {prop.stat || prop.market || '—'}{prop.line != null ? ` ${prop.direction==='under'?'U':'O'}${prop.line}` : ''}
                <span style={{ color:'var(--mute)', marginLeft:4 }}>· {prop.match?.split(' vs ')?.[0] || prop.match || ''}</span>
              </span>
              {odd && <span style={{ color:'var(--blue)', fontWeight:700, flexShrink:0 }}>@{odd}</span>}
            </div>
          )
        })}
      </div>

      {/* resultados */}
      <div style={{
        display:'flex', gap:10, flexWrap:'wrap',
        borderTop:'1px solid rgba(139,92,246,.2)', paddingTop:10,
        alignItems:'center',
      }}>
        {combOdd && (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:900, color:'#a78bfa', lineHeight:1 }}>
              {combOdd.toFixed(2)}
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)', textTransform:'uppercase' }}>odd total</div>
          </div>
        )}
        <div style={{ textAlign:'center' }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:900, color:confColor, lineHeight:1 }}>
            {combConf}%
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)', textTransform:'uppercase' }}>prob. comb.</div>
        </div>
        {ev != null && (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:900, color: ev>=0?'var(--green)':'var(--red)', lineHeight:1 }}>
              {ev>=0?'+':''}{ev}%
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)', textTransform:'uppercase' }}>EV</div>
          </div>
        )}
        {kellyStake != null && kellyStake > 0 && (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:800, color:'var(--amber)', lineHeight:1 }}>
              R${kellyStake.toFixed(2)}
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)', textTransform:'uppercase' }}>¼ Kelly</div>
          </div>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:6, flexShrink:0 }}>
          {onSave && (
            <button onClick={() => onSave(picks)} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
              padding:'6px 14px', borderRadius:6, cursor:'pointer',
              background:'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.4)',
              color:'var(--amber)', transition:'all .2s',
            }}>💾 Salvar</button>
          )}
          <button onClick={copyText} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
            padding:'6px 14px', borderRadius:6, cursor:'pointer',
            background: copied ? 'rgba(34,212,160,.15)' : 'rgba(139,92,246,.2)',
            border: `1px solid ${copied ? 'rgba(34,212,160,.4)' : 'rgba(139,92,246,.5)'}`,
            color: copied ? 'var(--green)' : '#c4b5fd',
            transition:'all .2s',
          }}>{copied ? '✓ Copiado!' : '📋 Copiar'}</button>
        </div>
      </div>

      {combConf < 10 && (
        <div style={{ marginTop:8, fontSize:10, color:'var(--mute)', fontFamily:"'Inter',sans-serif", lineHeight:1.4 }}>
          ⚠ Probabilidade combinada muito baixa. Acumuladores com muitos picks têm EV negativo em média.
        </div>
      )}
    </div>
  )
}

// ─── Odds por bookmaker ────────────────────────────────────────────────────────
function OddsCompareRow({ byBook, bestOdd }) {
  if (!byBook || Object.keys(byBook).length === 0) return null
  const max = Math.max(...Object.values(byBook))
  const BOOK_ORDER = ['Bet365','Betano','Pinnacle']
  const entries = BOOK_ORDER.filter(b => byBook[b]).map(b => [b, byBook[b]])
  if (entries.length === 0) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      marginTop: 6, flexWrap: 'wrap',
    }}>
      <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', letterSpacing:'.4px' }}>ODDS</span>
      {entries.map(([label, odd]) => {
        const isBest = odd >= max
        return (
          <span key={label} style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 11, fontWeight: isBest ? 800 : 500,
            padding: '2px 7px', borderRadius: 4,
            background: isBest ? 'rgba(34,212,160,.12)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${isBest ? 'rgba(34,212,160,.35)' : 'rgba(255,255,255,.1)'}`,
            color: isBest ? 'var(--green)' : 'var(--mute)',
            whiteSpace: 'nowrap',
          }}>
            {label} <span style={{ color: isBest ? 'var(--green)' : 'var(--soft)' }}>{odd.toFixed(2)}</span>
            {isBest && <span style={{ marginLeft: 2, fontSize: 9 }}>★</span>}
          </span>
        )
      })}
    </div>
  )
}

function GuaranteedCard({ prop, rank, realOdds, pickId, onSetResult, histResult, isSelected, onToggleSelect }) {
  const conf = prop.conf ?? prop.confidence ?? 0
  const realEV = realOdds?.odds ? calcEV(conf, realOdds.odds) : null
  const { banca } = usePerfStore()
  const ev   = prop.ev  ?? prop.ev_pct ?? null
  const tier = prop.tier || (conf >= 82 ? 'safe' : conf >= 76 ? 'median' : 'aggressive')
  const color = confColor(conf)
  const needsVerify = !!prop.needsVerify

  const tierLabel = tier === 'safe' ? 'SÓLIDO' : tier === 'median' ? 'BOM' : 'ARROJADO'
  const tierBg    = tier === 'safe' ? 'rgba(34,197,94,.12)' : tier === 'median' ? 'rgba(59,130,246,.12)' : 'rgba(245,158,11,.12)'
  const tierBorder= isSelected ? 'rgba(139,92,246,.6)'
    : needsVerify ? 'rgba(255,176,32,.35)'
    : tier === 'safe' ? 'rgba(34,197,94,.35)'
    : tier === 'median' ? 'rgba(59,130,246,.35)'
    : 'rgba(245,158,11,.35)'

  return (
    <div style={{
      background: isSelected ? 'rgba(139,92,246,.06)' : 'var(--card-bg)',
      border: `1px solid ${tierBorder}`,
      borderRadius: 'var(--r2)',
      padding: '12px 14px',
      marginBottom: 6,
      position: 'relative',
      overflow: 'hidden',
      transition: 'all var(--transition-fast)',
    }}>
      {/* barra lateral de confiança */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: 3,
        background: color,
        borderRadius: '4px 0 0 4px',
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingLeft: 6 }}>

        {/* rank + conf */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 42, flexShrink: 0 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 22, fontWeight: 900,
            color, lineHeight: 1,
          }}>{conf}%</div>
          <div style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 11, color: 'var(--mute)',
            textTransform: 'uppercase', marginTop: 2,
          }}>conf</div>
          <div style={{
            marginTop: 5,
            background: tierBg, border: `1px solid ${tierBorder}`,
            borderRadius: 4, padding: '1px 5px',
            fontFamily: "'Inter', sans-serif",
            fontSize: 11, fontWeight: 700,
            color: tier === 'safe' ? '#4ade80' : tier === 'median' ? '#60a5fa' : '#fbbf24',
            letterSpacing: '.3px',
          }}>{tierLabel}</div>
          {needsVerify && (
            <div style={{
              marginTop: 4, fontSize: 10, fontWeight: 700,
              color: 'var(--amber)', fontFamily: "'JetBrains Mono',monospace",
              background: 'rgba(255,176,32,.12)', border: '1px solid rgba(255,176,32,.3)',
              borderRadius: 4, padding: '1px 5px', textAlign: 'center', lineHeight: 1.3,
            }}>⚠ VER 365</div>
          )}
        </div>

        {/* conteúdo */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 14, fontWeight: 700,
              color: 'var(--white)',
            }}>{prop.stat || prop.market || '—'}</span>

            {prop.line != null && (
              <span style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12, color: 'var(--blue)',
                background: 'rgba(59,130,246,.12)',
                border: '1px solid rgba(59,130,246,.25)',
                borderRadius: 4, padding: '1px 6px',
                fontWeight: 700,
              }}>
                {prop.direction === 'over' ? 'Over' : prop.direction === 'under' ? 'Under' : ''} {prop.line}
              </span>
            )}

            {prop.recommendation && !prop.line && (
              <span style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12, color: 'var(--amber)',
                background: 'rgba(245,158,11,.1)',
                border: '1px solid rgba(245,158,11,.25)',
                borderRadius: 4, padding: '1px 6px',
                fontWeight: 700,
              }}>{prop.recommendation}</span>
            )}

            {ev != null && ev > 0 && (
              <span style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11, color: '#4ade80',
                background: 'rgba(34,197,94,.08)',
                border: '1px solid rgba(34,197,94,.2)',
                borderRadius: 4, padding: '1px 5px',
              }}>+{typeof ev === 'number' ? ev.toFixed(1) : ev}% EV</span>
            )}

            {/* EV real com odds do mercado */}
            {realOdds?.odds && (
              <span style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11,
                color: realEV >= 5 ? 'var(--green)' : realEV >= 0 ? 'var(--amber)' : 'var(--red)',
                background: realEV >= 5 ? 'rgba(0,229,160,.1)' : realEV >= 0 ? 'rgba(255,176,32,.1)' : 'rgba(255,61,90,.08)',
                border: `1px solid ${realEV >= 5 ? 'rgba(0,229,160,.3)' : realEV >= 0 ? 'rgba(255,176,32,.3)' : 'rgba(255,61,90,.2)'}`,
                borderRadius: 4, padding: '1px 5px', fontWeight: 700,
              }}>
                {realEV >= 0 ? '+' : ''}{realEV?.toFixed(1)}% EV Real · @{realOdds.odds}
              </span>
            )}

            {/* Kelly stake */}
            {realOdds?.odds && (
              <KellyBadge conf={conf} odd={realOdds.odds} banca={banca} />
            )}
          </div>

          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 12, color: 'var(--soft)',
            marginBottom: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {prop.team && prop.team !== prop.match
              ? <><span style={{ color: 'var(--blue)', fontWeight: 600 }}>{prop.team}</span> · {prop.match}</>
              : prop.match || '—'
            }
          </div>

          {prop.reason && (
            <div style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 11, color: 'var(--mute)',
              lineHeight: 1.4,
              marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            }}>{prop.reason}</div>
          )}

          {/* Odds comparadas por bookmaker */}
          <OddsCompareRow byBook={realOdds?.byBook} bestOdd={realOdds?.odds} />

          {/* B1: Forma recente (só futebol) */}
          {prop.sport !== 'basketball' && prop.home && (
            <div style={{ display:'flex', gap:12, marginTop:5, flexWrap:'wrap' }}>
              <TeamForm teamName={prop.home} league={prop.league} />
              {prop.away && <TeamForm teamName={prop.away} league={prop.league} />}
            </div>
          )}

          {/* B5: H2H (só futebol) */}
          {prop.sport !== 'basketball' && prop.home && prop.away && (
            <H2HPanel homeTeam={prop.home} awayTeam={prop.away} league={prop.league} />
          )}
        </div>

        {/* resultado rápido */}
        {onSetResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, alignItems: 'flex-end' }}>
            {['W','L','V','P'].map(r => {
              const rc = RESULT_COLORS[r]
              const active = histResult === r
              return (
                <button key={r} onClick={() => onSetResult(pickId, active ? null : r)}
                  title={r === 'W' ? 'Win' : r === 'L' ? 'Loss' : r === 'V' ? 'Void' : 'Push'}
                  style={{
                    padding: '2px 7px', fontSize: 10, fontWeight: 700,
                    fontFamily: "'JetBrains Mono',monospace",
                    background: active ? rc.bg : 'transparent',
                    border: `1px solid ${active ? rc.border : 'var(--border)'}`,
                    borderRadius: 4, color: active ? rc.c : 'var(--t3)',
                    cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.6,
                    transition: 'all .15s',
                  }}
                >{rc.label}</button>
              )
            })}
            {/* Acumulador checkbox */}
            {onToggleSelect && (
              <button onClick={onToggleSelect} title={isSelected ? 'Remover do acumulador' : 'Adicionar ao acumulador'} style={{
                marginTop: 4,
                width: 22, height: 22, borderRadius: 4,
                border: `1.5px solid ${isSelected ? 'rgba(139,92,246,.7)' : 'rgba(255,255,255,.15)'}`,
                background: isSelected ? 'rgba(139,92,246,.25)' : 'transparent',
                color: isSelected ? '#c4b5fd' : 'var(--t3)',
                cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
              }}>{isSelected ? '✓' : '+'}</button>
            )}
            {/* Share */}
            <button onClick={() => sharePick(prop, realOdds)} title="Compartilhar pick" style={{
              marginTop: 4,
              width: 22, height: 22, borderRadius: 4,
              border: '1px solid rgba(255,255,255,.1)',
              background: 'transparent',
              color: 'var(--mute)', cursor: 'pointer', fontSize: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color .15s',
            }}>📤</button>
          </div>
        )}

        {/* avg */}
        {!onSetResult && prop.avg != null && prop.avg > 0 && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 13, fontWeight: 700,
              color: 'var(--soft)', lineHeight: 1,
            }}>{typeof prop.avg === 'number' ? prop.avg.toFixed(1) : prop.avg}</div>
            <div style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11, color: 'var(--mute)', textTransform: 'uppercase',
            }}>média</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Market Summary — pills com todos mercados (visível quando fechado) ────────
function MarketSummary({ props: matchProps, oddsMap }) {
  if (!matchProps || matchProps.length === 0) return null
  const confColor = (c) => c >= 82 ? 'var(--green)' : c >= 76 ? 'var(--amber)' : 'var(--t2)'

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 5,
      padding: '6px 10px 8px',
      background: 'rgba(255,255,255,.015)',
      borderLeft: '1px solid var(--border)',
      borderRight: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      borderRadius: '0 0 6px 6px',
      marginBottom: 2,
    }}>
      {matchProps.map((p, i) => {
        const conf   = p.conf ?? p.confidence ?? 0
        const stat   = p.stat || p.market || '—'
        const line   = p.line != null ? ` ${p.direction === 'under' ? 'U' : 'O'}${p.line}` : ''
        const realOd = lookupOdds(p, oddsMap)
        const ev     = p.ev ?? null
        const cc     = confColor(conf)

        return (
          <div key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px',
            background: 'rgba(255,255,255,.04)',
            border: `1px solid rgba(255,255,255,.1)`,
            borderRadius: 20,
            fontSize: 11,
            fontFamily: "'JetBrains Mono',monospace",
            whiteSpace: 'nowrap',
          }}>
            <span style={{ fontWeight: 900, color: cc }}>{conf}%</span>
            <span style={{ color: 'var(--t2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {stat}{line}
            </span>
            {realOd?.odds && (
              <span style={{ color: 'var(--blue)', fontWeight: 700 }}>@{realOd.odds}</span>
            )}
            {!realOd?.odds && ev != null && ev > 0 && (
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>+{typeof ev === 'number' ? ev.toFixed(0) : ev}%</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Match header ──────────────────────────────────────────────────────────────
function MatchHeader({ match, league, country, count, kickoff, isOpen, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', marginBottom: isOpen ? 6 : 0, marginTop: 14,
        background: isOpen ? 'rgba(59,130,246,.06)' : 'rgba(255,255,255,.025)',
        border: `1px solid ${isOpen ? 'rgba(59,130,246,.20)' : 'var(--border)'}`,
        borderRadius: isOpen ? '6px 6px 0 0' : 6,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background var(--transition-fast), border-color var(--transition-fast)',
      }}
    >
      <span style={{
        fontSize: 10, color: isOpen ? 'var(--blue)' : 'var(--t3)',
        fontFamily: "'JetBrains Mono',monospace", flexShrink: 0,
        transition: 'transform var(--transition-fast)',
        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
        display: 'inline-block',
      }}>▶</span>
      <span style={{ fontSize: 13 }}>⚽</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13, fontWeight: 700,
          color: 'var(--white)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{match}</div>
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 11, color: 'var(--mute)',
        }}>
          {league && <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{league}</span>}
          {country && <span> · {country}</span>}
          {kickoff && <span> · {fmtTime(kickoff)}</span>}
        </div>
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 11, fontWeight: 700,
        color: 'var(--green)',
        background: 'rgba(34,197,94,.12)',
        border: '1px solid rgba(34,197,94,.25)',
        borderRadius: 4, padding: '2px 7px',
        flexShrink: 0,
      }}>{count} pick{count !== 1 ? 's' : ''}</div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: 'var(--r2)', padding: '12px 14px', marginBottom: 6,
    }}>
      {[1, 2].map(r => (
        <div key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: r === 1 ? 6 : 0 }}>
          <div style={{ width: 42, height: 10, borderRadius: 4, background: 'var(--line)', animation: 'pulse 1.5s infinite' }} />
          <div style={{ flex: 1, height: 10, borderRadius: 4, background: 'var(--line)', animation: 'pulse 1.5s infinite' }} />
          <div style={{ width: 35, height: 10, borderRadius: 4, background: 'var(--line)', animation: 'pulse 1.5s infinite' }} />
        </div>
      ))}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Garantido() {
  const { banca } = usePerfStore()
  const [picks,       setPicks]       = useState([])
  const [loading,     setLoading]     = useState(false)
  const [loaded,      setLoaded]      = useState(false)
  const [tab,         setTab]         = useState('picks')   // 'picks' | 'historico'
  const [history,     setHistory]     = useState(() => loadHistory())
  const [selectedDate, setSelectedDate] = useState(today())
  const [sport,       setSport]       = useState('all')
  const [filterLeague,   setFilterLeague]   = useState('all')
  const [featuredList,   setFeaturedList]   = useState([])
  const [favLeagues,   setFavLeagues]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('sb_fav_leagues') || '[]')) } catch { return new Set() }
  })
  const [filterMarket, setFilterMarket] = useState('all')
  const [filterEV,     setFilterEV]     = useState(false)
  const [filterTier,   setFilterTier]   = useState('all')
  const [filterHour,   setFilterHour]   = useState('all') // 'all'|'manha'|'tarde'|'noite'
  const [savedAccus,   setSavedAccus]   = useState(() => { try { return JSON.parse(localStorage.getItem('sb_accus')||'[]') } catch { return [] } })
  const [minConf,     setMinConf]     = useState(CONF_MIN)
  const [collapsed,     setCollapsed]     = useState({})   // { [matchKey]: true } — todos fechados
  const [selectedPicks, setSelectedPicks] = useState(new Map()) // Map<pickId, {prop, realOdds}>
  const [oddsMap,     setOddsMap]     = useState(null)
  const [oddsLoading, setOddsLoading] = useState(false)
  const [aiLoading,   setAiLoading]   = useState(false)
  const [aiContent,   setAiContent]   = useState('')
  const [configOpen,  setConfigOpen]  = useState(false)
  const [claudeKey,   setClaudeKeyState] = useState(() => getClaudeKey())
  const [aiStatus,    setAiStatus]    = useState('')
  const autoAiRanRef = useRef(false)

  function handleClaudeKey(v) { setClaudeKeyState(v); saveClaudeKey(v) }

  function handleSetResult(id, result) {
    const updated = updateHistResult(id, result)
    setHistory(updated)
  }

  function toggleFavLeague(league) {
    setFavLeagues(prev => {
      const next = new Set(prev)
      if (next.has(league)) next.delete(league)
      else next.add(league)
      localStorage.setItem('sb_fav_leagues', JSON.stringify([...next]))
      return next
    })
  }

  function togglePickSelect(pid, prop, realOdds) {
    setSelectedPicks(prev => {
      const next = new Map(prev)
      if (next.has(pid)) next.delete(pid)
      else next.set(pid, { prop, realOdds })
      return next
    })
  }
  function clearSelection() { setSelectedPicks(new Map()) }

  function saveAccumulator(picks) {
    const entries = Array.from(picks.entries()).map(([pid, { prop, realOdds }]) => ({
      pid,
      stat: prop.stat || prop.market || '—',
      match: prop.match || '—',
      conf: prop.conf ?? prop.confidence ?? 0,
      odd: realOdds?.odds ?? null,
      line: prop.line ?? null,
      direction: prop.direction ?? null,
    }))
    const combOdd = entries.every(e => e.odd) ? entries.reduce((a, e) => a * e.odd, 1) : null
    const combProb = entries.reduce((a, e) => a * ((e.odd ? 1/e.odd : e.conf/100)), 1)
    const name = `${new Date().toLocaleDateString('pt-BR')} · ${picks.size} picks`
    const entry = { id: Date.now(), ts: Date.now(), name, entries, combOdd, combProb: +(combProb * 100).toFixed(1) }
    const updated = [entry, ...savedAccus].slice(0, 20)
    setSavedAccus(updated)
    localStorage.setItem('sb_accus', JSON.stringify(updated))
    clearSelection()
  }

  function deleteAccu(id) {
    const updated = savedAccus.filter(a => a.id !== id)
    setSavedAccus(updated)
    localStorage.setItem('sb_accus', JSON.stringify(updated))
  }

  function toggleMatch(key) {
    setCollapsed(c => ({ ...c, [key]: !c[key] }))
  }
  // collapsed[key]=true → aberto; undefined → fechado
  function expandAll()   { setCollapsed(c => { const m = {...c}; grouped.forEach(g => { m[g.match] = true }); return m }) }
  function collapseAll() { setCollapsed({}) }

  // ── Carrega picks de futebol via engine do frontend ─────────────────────────
  async function loadFootball(date) {
    try {
      const res  = await fetchMatches({ date: date || selectedDate, sport: 'football' })
      const raw  = res.matches || res.data || []

      const games = raw
        .filter(g => !shouldSkipGame(g))
        .map(g => ({
          home:    g.home_team || g.home_team_name || g.teams?.home?.name || g.home || 'Casa',
          away:    g.away_team || g.away_team_name || g.teams?.away?.name || g.away || 'Fora',
          league:  normLeague(g),
          country: normCountry(g),
          kickoff: g.date || g.fixture?.date || g.datetime || null,
        }))
        .filter(g => !(g.home === 'Casa' && g.away === 'Fora'))

      // Stats reais em paralelo
      const teamNames = [...new Set(games.flatMap(g => [g.home, g.away]))]
      const statsMap  = {}
      await Promise.allSettled(
        teamNames.map(async name => {
          const s = await fetchTeamStats(name, 'football', 'all')
          if (s) statsMap[name] = s
        })
      )

      const all = []
      games.forEach(({ home, away, league, country, kickoff }) => {
        const match     = `${home} vs ${away}`
        const homeStats = statsMap[home] || null
        const awayStats = statsMap[away] || null
        const props     = ftpTeamProps(home, away, league, country, match, homeStats, awayStats)
        props.forEach(p => {
          all.push({ ...p, sport: 'football', kickoff })
        })
      })

      return all
    } catch (e) {
      console.warn('[Garantido/football]', e.message)
      return []
    }
  }

  // ── Carrega picks de basketball via Worker API ────────────────────────────────
  async function loadBasketball() {
    try {
      const res  = await fetch(`${WORKER_BASE}/v1/basketball/props/today`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return []
      const json = await res.json()
      const raw  = json?.data?.all_props || json?.data?.top_props || []
      return raw.map(p => ({
        sport:      'basketball',
        match:      p.match_label || `${p.home_team || ''} vs ${p.away_team || ''}`.trim() || p.player || '—',
        team:       p.player || p.team || '',
        stat:       p.stat || p.market || '—',
        line:       p.line,
        direction:  p.direction || 'over',
        conf:       p.confidence || p.conf || 0,
        ev:         p.ev_pct || p.ev || null,
        avg:        p.avg || null,
        tier:       p.tier || 'aggressive',
        reason:     p.reason || p.rationale || '',
        league:     'NBA',
        country:    'USA',
        kickoff:    null,
      }))
    } catch (e) {
      console.warn('[Garantido/basketball]', e.message)
      return []
    }
  }

  const load = useCallback(async (date) => {
    const d = date || selectedDate
    setLoading(true)
    setPicks([])
    autoAiRanRef.current = false
    try {
      const [ftPicks, bkPicks] = await Promise.all([loadFootball(d), loadBasketball()])
      const merged = [...ftPicks, ...bkPicks]
      setPicks(merged)
      // auto-busca odds via Worker (sem chave necessária)
      setOddsLoading(true)
      let currentOddsMap = null
      try {
        currentOddsMap = await fetchRealOddsMap()
        setOddsMap(currentOddsMap)
      } catch {}
      setOddsLoading(false)
      // auto-salva picks com ≥CONF_MIN no histórico
      const toSave = merged.filter(x => (x.conf ?? x.confidence ?? 0) >= CONF_MIN)
      if (toSave.length > 0) {
        const updated = autoSavePicks(toSave, d, currentOddsMap)
        setHistory(updated)
      }
      // push notifications para picks de alto conf em jogos próximos
      if (d === today()) {
        const kickoffMap = {}
        merged.forEach(p => {
          if (p.id && p.kickoff) kickoffMap[p.id] = p.kickoff
        })
        checkAndNotifyPicks(merged, kickoffMap)
      }
    } catch (e) {
      console.warn('[Garantido]', e.message)
    }
    setLoading(false)
    setLoaded(true)
  }, [selectedDate])

  function goDate(n) {
    const newDate = addDays(selectedDate, n)
    setSelectedDate(newDate)
    load(newDate)
  }

  // Busca odds manualmente (atualiza)
  const loadOdds = useCallback(async () => {
    setOddsLoading(true)
    try {
      const map = await fetchRealOddsMap()
      setOddsMap(map)
    } catch {}
    setOddsLoading(false)
  }, [])

  // Análise IA com os picks garantidos
  const runAI = useCallback(async (g) => {
    const ck = getClaudeKey()
    if (!ck) { setConfigOpen(true); return }
    if (!g.length) return
    setAiLoading(true); setAiContent(''); setAiStatus('Analisando com IA…')

    const today = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' })
    const hasOdds = !!oddsMap

    const lines = g.slice(0, 30).map((p, i) => {
      const real = lookupOdds(p, oddsMap)
      const evPart = real?.odds
        ? ` | Odd 365: ${real.odds} | EV: ${calcEV(p.conf??p.confidence??0, real.odds) >= 0 ? '+' : ''}${calcEV(p.conf??p.confidence??0, real.odds).toFixed(1)}%`
        : ''
      const verifyPart = p.needsVerify ? ' | ⚠ verificar disponibilidade 365' : ''
      return `${i+1}. ${p.match} [${p.league||''}] | ${p.stat||p.marketLabel} ${p.line!=null?`(${p.line})`:''}| Conf: ${p.conf??p.confidence??0}%${evPart}${verifyPart}`
    }).join('\n')

    const prompt = `Você é um analista quantitativo revisando observações internas de modelo (modo LAB · não validado em produção). Os sinais a seguir vêm do modelo SportsBrain e devem ser tratados como análise teórica, sem promessa de lucro nem recomendação de aposta real.

DATA: ${today}
SINAIS DE ALTA CONFIANÇA TEÓRICA (≥${minConf}% conf. pelo modelo SportsBrain):
${hasOdds ? `Odds de referência (Bet365) incluídas quando disponíveis — apenas para comparação.` : `Odds de referência não disponíveis no momento.`}

${lines}

INSTRUÇÕES:
1. **Top 3-5 sinais** — os melhores do dia com justificativa técnica e odd de referência
2. **EV teórico** — para os que têm odd, calcule o EV teórico (EV > 0 = sinal positivo, ainda não validado)
3. **Sinais para verificar (⚠)** — confirme se o mercado existe na referência
4. **Exposição teórica** — métrica interna por sinal (sem recomendação de stake real; produto em modo LAB)
5. **Resumo** — em 2 frases o veredicto técnico do dia

Lembrete: relatório de análise LAB, não recomendação de aposta. Seja direto, técnico, em português. Use markdown.`

    try {
      const text = await callClaude(ck, prompt, 2500)
      setAiContent(mdToHtml(text))
      setAiStatus('✅ Análise concluída')
    } catch(e) {
      const msg = e.message || 'Erro'
      setAiContent(`<span style="color:var(--red)">❌ ${msg}</span>`)
      setAiStatus('❌ Erro')
      if (msg.includes('401') || msg.toLowerCase().includes('auth')) setConfigOpen(true)
    }
    setAiLoading(false)
  }, [oddsMap, minConf])

  useEffect(() => { load() }, [])
  useEffect(() => { fetchFeaturedMatches().then(setFeaturedList).catch(()=>{}) }, [])

  // ── Sync com servidor na inicialização e ao voltar para a aba ─────────────────
  useEffect(() => {
    async function syncFromServer() {
      const synced = await serverSyncHistory()
      setHistory(synced)
    }

    // Sync inicial — puxa do servidor (cron pode ter marcado resultados)
    syncFromServer()

    // Re-sync ao voltar para a aba (busca atualizações do cron)
    function onVisible() { if (!document.hidden) syncFromServer() }
    document.addEventListener('visibilitychange', onVisible)

    // Re-sync a cada 10 minutos (fallback se aba ficar aberta muito tempo)
    const interval = setInterval(syncFromServer, 10 * 60 * 1000)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // ── Auto-IA após picks carregarem ─────────────────────────────────────────────
  useEffect(() => {
    if (!loaded || !picks.length || autoAiRanRef.current) return
    const ck = getClaudeKey()
    if (!ck) return
    autoAiRanRef.current = true
    // guaranteed é calculado do picks, então recalcular inline
    const g = picks.filter(x => (x.conf ?? x.confidence ?? 0) >= minConf)
    g.sort((a, b) => (b.conf ?? b.confidence ?? 0) - (a.conf ?? a.confidence ?? 0))
    if (g.length) runAI(g)
  }, [loaded, picks])

  // ── Ligas e mercados disponíveis (dinâmicos) ──────────────────────────────────
  const availableLeagues = useMemo(() => {
    const s = new Set(picks.map(x => x.league).filter(Boolean))
    return ['all', ...Array.from(s).sort()]
  }, [picks])

  const availableMarkets = useMemo(() => {
    const normalize = s => {
      const l = (s || '').toLowerCase()
      if (l.includes('escanteio') || l.includes('corner')) return 'Escanteios'
      if (l.includes('cartão') || l.includes('cartao') || l.includes('card')) return 'Cartões'
      if (l.includes('over') || l.includes('gol') || l.includes('under')) return 'Over/Under'
      if (l.includes('casa') || l.includes('fora') || l.includes('empate') || l.includes('vitória') || l.includes('resultado')) return 'Resultado'
      if (l.includes('btts') || l.includes('ambos')) return 'Ambos Marcam'
      return 'Outros'
    }
    const s = new Set(picks.map(x => normalize(x.stat || x.market || '')))
    return ['all', ...Array.from(s).sort()]
  }, [picks])

  function matchMarket(pick, fm) {
    if (fm === 'all') return true
    const l = (pick.stat || pick.market || '').toLowerCase()
    if (fm === 'Escanteios') return l.includes('escanteio') || l.includes('corner')
    if (fm === 'Cartões')    return l.includes('cartão') || l.includes('cartao') || l.includes('card')
    if (fm === 'Over/Under') return l.includes('over') || l.includes('gol') || l.includes('under')
    if (fm === 'Resultado')  return l.includes('casa') || l.includes('fora') || l.includes('empate') || l.includes('vitória') || l.includes('resultado')
    if (fm === 'Ambos Marcam') return l.includes('btts') || l.includes('ambos')
    return true
  }

  // ── Filtragem ─────────────────────────────────────────────────────────────────
  const guaranteed = useMemo(() => {
    let p = picks.filter(x => (x.conf ?? x.confidence ?? 0) >= minConf)
    if (sport !== 'all')          p = p.filter(x => x.sport === sport)
    if (filterLeague === '__favorites__') p = p.filter(x => favLeagues.has(x.league))
    else if (filterLeague !== 'all')      p = p.filter(x => x.league === filterLeague)
    if (filterMarket !== 'all')   p = p.filter(x => matchMarket(x, filterMarket))
    if (filterTier !== 'all')     p = p.filter(x => (x.tier || '') === filterTier)
    if (filterEV)                 p = p.filter(x => {
      const real = lookupOdds(x, oddsMap)
      if (real?.odds) return calcEV(x.conf ?? x.confidence ?? 0, real.odds) > 0
      return (x.ev ?? 0) > 0
    })
    if (filterHour !== 'all') p = p.filter(x => {
      if (!x.kickoff) return true
      const h = new Date(x.kickoff).getHours()
      if (filterHour === 'manha') return h < 12
      if (filterHour === 'tarde') return h >= 12 && h < 18
      if (filterHour === 'noite') return h >= 18
      return true
    })
    p.sort((a, b) => (b.conf ?? b.confidence ?? 0) - (a.conf ?? a.confidence ?? 0))
    return p
  }, [picks, minConf, sport, filterLeague, filterMarket, filterTier, filterEV, filterHour, oddsMap])

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const g = guaranteed
    return {
      total:      g.length,
      acima80:    g.filter(x => (x.conf ?? x.confidence ?? 0) >= 80).length,
      acima85:    g.filter(x => (x.conf ?? x.confidence ?? 0) >= 85).length,
      jogos:      new Set(g.map(x => x.match)).size,
      avgConf:    g.length ? Math.round(g.reduce((a, x) => a + (x.conf ?? x.confidence ?? 0), 0) / g.length) : 0,
      football:   g.filter(x => x.sport === 'football').length,
      basketball: g.filter(x => x.sport === 'basketball').length,
    }
  }, [guaranteed])

  // ── Agrupa por jogo ────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map()
    guaranteed.forEach(p => {
      const key = p.match || '—'
      if (!map.has(key)) map.set(key, { match: key, league: p.league, country: p.country, kickoff: p.kickoff, props: [] })
      map.get(key).props.push(p)
    })
    return [...map.values()].sort((a, b) => {
      // Prioridade: Bet365 em destaque → Brasil → ligas top → resto
      const [aH, aA] = (a.match||'').split(' vs ')
      const [bH, bA] = (b.match||'').split(' vs ')
      const pa = matchPriority(aH, aA, a.league||'', featuredList)
      const pb = matchPriority(bH, bA, b.league||'', featuredList)
      if (pa !== pb) return pa - pb
      // Dentro do mesmo grupo: melhor conf primeiro
      const aMax = Math.max(...a.props.map(x => x.conf ?? x.confidence ?? 0))
      const bMax = Math.max(...b.props.map(x => x.conf ?? x.confidence ?? 0))
      return bMax - aMax
    })
  }, [guaranteed, featuredList])

  // ── Histórico stats ───────────────────────────────────────────────────────────
  const histStats = useMemo(() => {
    const resolved  = history.filter(h => h.result === 'W' || h.result === 'L')
    const wins      = resolved.filter(h => h.result === 'W')
    const pending   = history.filter(h => !h.result)
    const wr        = resolved.length ? (wins.length / resolved.length * 100) : null
    // ROI com odds reais
    const withOdds  = resolved.filter(h => h.realOdd && h.realOdd > 1)
    let roi = null
    if (withOdds.length) {
      const profit = withOdds.reduce((acc, h) => {
        if (h.result === 'W') return acc + (h.realOdd - 1)
        return acc - 1
      }, 0)
      roi = (profit / withOdds.length * 100).toFixed(1)
    }
    // Calibração por faixa de confiança
    const brackets = [
      { label: '≥85%', min: 85, max: 100 },
      { label: '80–84%', min: 80, max: 84 },
      { label: '75–79%', min: 75, max: 79 },
      { label: '70–74%', min: 70, max: 74 },
    ]
    const calibration = brackets.map(({ label, min, max }) => {
      const all    = history.filter(h => h.conf >= min && h.conf <= max)
      const res    = all.filter(h => h.result === 'W' || h.result === 'L')
      const wCount = res.filter(h => h.result === 'W').length
      const avgConf = all.length ? Math.round(all.reduce((a, h) => a + h.conf, 0) / all.length) : min
      return {
        label, total: all.length, resolved: res.length, wins: wCount, avgConf,
        wr: res.length ? +(wCount / res.length * 100).toFixed(0) : null,
        expected: avgConf,
      }
    })
    // Streak atual
    const sortedResolved = [...resolved].sort((a, b) => (b.savedAt||0) - (a.savedAt||0))
    let streakN = 0, streakType = null
    if (sortedResolved.length) {
      streakType = sortedResolved[0].result
      for (const h of sortedResolved) {
        if (h.result === streakType) streakN++
        else break
      }
    }
    return {
      total: history.length, wins: wins.length,
      losses: resolved.length - wins.length,
      pending: pending.length,
      wr, roi, calibration,
      byDate: groupByDate(history),
      streak: { n: streakN, type: streakType },
    }
  }, [history])

  // lookup histResult for a pick (by pickId)
  const histById = useMemo(() => {
    const m = {}
    history.forEach(h => { m[h.id] = h.result })
    return m
  }, [history])

  return (
    <div className="page">
      <PageHeader
        icon="🔒"
        title="Garantido"
        subtitle={loaded
          ? `${kpis.total} picks ≥${minConf}% · ${kpis.jogos} jogos · ${kpis.avgConf}% média${oddsMap ? ' · odds ativas' : ''}`
          : 'Picks com alta confiança'}
        actions={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Min conf slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--mute)' }}>mín:</span>
              <input
                type="range" min={70} max={95} step={1}
                value={minConf}
                onChange={e => setMinConf(+e.target.value)}
                style={{ width: 80, accentColor: 'var(--green)', cursor: 'pointer' }}
              />
              <span style={{
                fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700,
                color: confColor(minConf), minWidth: 32,
              }}>{minConf}%</span>
            </div>

            {['all','football','basketball'].map(s => (
              <button key={s} onClick={() => setSport(s)} className="btn" style={{
                padding: '5px 11px', fontSize: 12,
                ...(sport === s ? { borderColor: 'rgba(59,130,246,.5)', color: 'var(--blue)', background: 'rgba(59,130,246,.08)' } : { opacity: .55 }),
              }}>{s === 'all' ? '🌍 Todos' : s === 'football' ? '⚽ Futebol' : '🏀 NBA'}</button>
            ))}

            {loaded && grouped.length > 0 && (
              <>
                <button onClick={expandAll} className="btn" style={{ padding: '5px 10px', fontSize: 11 }} title="Expandir todos">⊞</button>
                <button onClick={collapseAll} className="btn" style={{ padding: '5px 10px', fontSize: 11 }} title="Colapsar todos">⊟</button>
              </>
            )}

            {/* Odds reais */}
            <button onClick={loadOdds} disabled={oddsLoading} className="btn"
              style={{ padding:'5px 11px', fontSize:12,
                ...(oddsMap ? { color:'var(--green)', borderColor:'rgba(0,229,160,.35)', background:'rgba(0,229,160,.07)' } : {}) }}
              title={oddsMap ? 'Odds reais carregadas — clique para atualizar' : 'Buscar odds reais (Odds API)'}>
              {oddsLoading ? '⏳' : oddsMap ? '● Odds' : '📡 Odds'}
            </button>

            {/* IA Analisar */}
            <button onClick={() => runAI(guaranteed)} disabled={aiLoading || !loaded}
              className="btn"
              style={{ padding:'5px 12px', fontSize:12, background:'rgba(0,214,143,.1)', borderColor:'rgba(0,214,143,.3)', color:'var(--green)' }}>
              {aiLoading ? '⏳ IA…' : '🎯 IA Analisar'}
            </button>

            <button onClick={() => setConfigOpen(v => !v)} className="btn"
              style={{ padding:'5px 10px', fontSize:12,
                ...(configOpen ? { color:'var(--amber)', borderColor:'rgba(255,176,32,.35)' } : {}) }}>
              ⚙
            </button>
            <button onClick={() => load()} className="btn" style={{ padding: '5px 11px', fontSize: 12 }}>↺</button>
          </div>
        }
      />

      {/* ── Seletor de data ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0,
        marginBottom: 14,
      }}>
        <button onClick={() => goDate(-1)} className="btn" style={{
          padding: '7px 16px', fontSize: 18, borderRadius: 'var(--r-pill) 0 0 var(--r-pill)',
          borderRight: 'none', color: 'var(--blue)', fontWeight: 700,
        }}>‹</button>
        <div style={{
          padding: '7px 24px', fontFamily: "'Space Grotesk',sans-serif",
          fontSize: 14, fontWeight: 700, color: 'var(--t1)',
          border: '1px solid var(--border)', borderLeft: 'none', borderRight: 'none',
          background: 'var(--card-bg)', minWidth: 130, textAlign: 'center',
          letterSpacing: '-.01em',
        }}>
          {fmtDate(selectedDate)}
          {selectedDate !== today() && (
            <span
              onClick={() => { setSelectedDate(today()); load(today()) }}
              style={{ marginLeft: 8, fontSize: 10, color: 'var(--blue)', cursor: 'pointer', fontWeight: 500 }}
            >
              Hoje
            </span>
          )}
        </div>
        <button
          onClick={() => goDate(1)}
          className="btn"
          disabled={selectedDate >= addDays(today(), 5)}
          style={{
            padding: '7px 16px', fontSize: 18, borderRadius: '0 var(--r-pill) var(--r-pill) 0',
            borderLeft: 'none', color: 'var(--blue)', fontWeight: 700,
            opacity: selectedDate >= addDays(today(), 5) ? 0.3 : 1,
          }}
        >›</button>
      </div>

      {/* ── Tabs: Picks / Histórico ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[
          { id: 'picks',     label: '🔒 Picks',     badge: null },
          { id: 'historico', label: '📊 Histórico',  badge: histStats.total > 0 ? histStats.total : null },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 16px', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
            background: 'none', border: 'none',
            borderBottom: `2px solid ${tab === t.id ? 'var(--blue)' : 'transparent'}`,
            color: tab === t.id ? 'var(--blue)' : 'var(--t3)',
            cursor: 'pointer', marginBottom: -1, transition: 'all .15s',
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: "'Inter',sans-serif",
          }}>
            {t.label}
            {t.badge != null && (
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
                background: tab === t.id ? 'rgba(59,130,246,.15)' : 'var(--ink2)',
                border: `1px solid ${tab === t.id ? 'rgba(59,130,246,.35)' : 'var(--border)'}`,
                color: tab === t.id ? 'var(--blue)' : 'var(--t3)',
                borderRadius: 10, padding: '1px 6px',
              }}>{t.badge}</span>
            )}
          </button>
        ))}

        {/* ROI rápido na tab bar */}
        {histStats.wr != null && (
          <span style={{
            marginLeft: 'auto', alignSelf: 'center', marginBottom: 3,
            fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
            color: histStats.wr >= 55 ? 'var(--green)' : histStats.wr >= 45 ? 'var(--amber)' : 'var(--red)',
          }}>
            {histStats.wr.toFixed(0)}% WR · {histStats.wins}W/{histStats.losses}L
            {histStats.streak?.n >= 2 && (
              <span style={{ marginLeft: 8, color: histStats.streak.type === 'W' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                {histStats.streak.type === 'W' ? '🔥' : '❄'} {histStats.streak.n} em sequência
              </span>
            )}
            {histStats.roi != null && (
              <span style={{ marginLeft: 8, color: +histStats.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                ROI {+histStats.roi >= 0 ? '+' : ''}{histStats.roi}%
              </span>
            )}
          </span>
        )}
      </div>

      {/* ══════ TAB: HISTÓRICO ══════ */}
      {tab === 'historico' && (
        <HistoricoView
          histStats={histStats}
          history={history}
          onSetResult={handleSetResult}
          onClear={() => { saveHistory([]); setHistory([]) }}
        />
      )}

      {/* ══════ TAB: PICKS ══════ */}
      {tab === 'picks' && <>

      {/* ── Barra de filtros ── */}
      {loaded && picks.length > 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: 'var(--r2)', padding: '10px 14px', marginBottom: 12,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.10em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono',monospace" }}>
            Filtros
            {(filterLeague !== 'all' || filterMarket !== 'all' || filterTier !== 'all' || filterEV || filterHour !== 'all') && (
              <button onClick={() => { setFilterLeague('all'); setFilterMarket('all'); setFilterTier('all'); setFilterEV(false); setFilterHour('all'); }}
                style={{ marginLeft: 10, fontSize: 10, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>
                ✕ Limpar
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Liga — Favoritas chip + select */}
            {favLeagues.size > 0 && (
              <button onClick={() => setFilterLeague(filterLeague === '__favorites__' ? 'all' : '__favorites__')} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:'4px 10px',
                borderRadius:'var(--r-pill)', cursor:'pointer',
                background: filterLeague === '__favorites__' ? 'rgba(250,200,30,.15)' : 'transparent',
                border: `1px solid ${filterLeague === '__favorites__' ? 'rgba(250,200,30,.5)' : 'var(--border)'}`,
                color: filterLeague === '__favorites__' ? '#fac81e' : 'var(--mute)',
              }}>⭐ Favoritas ({favLeagues.size})</button>
            )}
            <select value={filterLeague === '__favorites__' ? 'all' : filterLeague} onChange={e => setFilterLeague(e.target.value)} style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 8px',
              background: 'var(--ink2)', border: `1px solid ${filterLeague !== 'all' && filterLeague !== '__favorites__' ? 'rgba(77,143,245,.5)' : 'var(--border)'}`,
              borderRadius: 'var(--r-pill)', color: filterLeague !== 'all' && filterLeague !== '__favorites__' ? 'var(--blue)' : 'var(--t3)', cursor: 'pointer',
            }}>
              <option value="all">🏆 Todas as ligas</option>
              {availableLeagues.filter(l => l !== 'all').map(l => <option key={l} value={l}>{favLeagues.has(l) ? '⭐ ' : ''}{l}</option>)}
            </select>
            {/* Botão para favoritar liga selecionada */}
            {filterLeague !== 'all' && filterLeague !== '__favorites__' && (
              <button onClick={() => toggleFavLeague(filterLeague)} title={favLeagues.has(filterLeague) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} style={{
                background:'none', border:'none', cursor:'pointer', fontSize:14, padding:'2px',
                color: favLeagues.has(filterLeague) ? '#fac81e' : 'var(--mute)',
                transition:'color .15s',
              }}>{favLeagues.has(filterLeague) ? '⭐' : '☆'}</button>
            )}

            {/* Mercado */}
            <select value={filterMarket} onChange={e => setFilterMarket(e.target.value)} style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 8px',
              background: 'var(--ink2)', border: `1px solid ${filterMarket !== 'all' ? 'rgba(77,143,245,.5)' : 'var(--border)'}`,
              borderRadius: 'var(--r-pill)', color: filterMarket !== 'all' ? 'var(--blue)' : 'var(--t3)', cursor: 'pointer',
            }}>
              <option value="all">📊 Todos os mercados</option>
              {availableMarkets.filter(m => m !== 'all').map(m => <option key={m} value={m}>{m}</option>)}
            </select>

            {/* Tier */}
            <select value={filterTier} onChange={e => setFilterTier(e.target.value)} style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 8px',
              background: 'var(--ink2)', border: `1px solid ${filterTier !== 'all' ? 'rgba(77,143,245,.5)' : 'var(--border)'}`,
              borderRadius: 'var(--r-pill)', color: filterTier !== 'all' ? 'var(--blue)' : 'var(--t3)', cursor: 'pointer',
            }}>
              <option value="all">⚡ Todos os tiers</option>
              <option value="safe">🟢 Safe</option>
              <option value="value">🔵 Value</option>
              <option value="aggressive">🔴 Aggressive</option>
            </select>

            {/* Horário do jogo */}
            {[['all','⏰ Todos'],['manha','🌅 <12h'],['tarde','☀ 12–18h'],['noite','🌙 >18h']].map(([v,l]) => (
              <button key={v} onClick={() => setFilterHour(v)} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:10, padding:'4px 7px',
                background: filterHour===v ? 'rgba(139,92,246,.15)' : 'transparent',
                border: `1px solid ${filterHour===v ? 'rgba(139,92,246,.45)' : 'var(--border)'}`,
                borderRadius: 'var(--r-pill)', color: filterHour===v ? '#c4b5fd' : 'var(--t3)',
                cursor: 'pointer', fontWeight: filterHour===v ? 700 : 400,
              }}>{l}</button>
            ))}

            {/* EV+ toggle */}
            <button onClick={() => setFilterEV(v => !v)} style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 11px',
              background: filterEV ? 'rgba(0,229,160,.12)' : 'transparent',
              border: `1px solid ${filterEV ? 'rgba(0,229,160,.4)' : 'var(--border)'}`,
              borderRadius: 'var(--r-pill)', color: filterEV ? 'var(--green)' : 'var(--t3)',
              cursor: 'pointer', fontWeight: filterEV ? 700 : 400,
            }}>
              {filterEV ? '● EV+' : '○ EV+'}
            </button>

            {/* Contagem */}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', fontFamily: "'JetBrains Mono',monospace" }}>
              <b style={{ color: 'var(--t1)' }}>{guaranteed.length}</b> picks · <b style={{ color: 'var(--t1)' }}>{grouped.length}</b> jogos
            </span>
          </div>
        </div>
      )}

      {/* ── Painel de configuração ── */}
      {configOpen && (
        <div style={{ background:'var(--card-bg)', border:'1px solid rgba(255,176,32,.2)', borderRadius:'var(--r2)', padding:14, marginBottom:12 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--amber)', letterSpacing:'1px', textTransform:'uppercase', marginBottom:12 }}>⚙ Configuração — compartilhada com Análise 365</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ padding:'6px 10px', background:'rgba(0,214,143,.06)', border:'1px solid rgba(0,214,143,.2)', borderRadius:5, fontSize:11, color:'var(--green)', fontFamily:"'JetBrains Mono',monospace" }}>
              ✅ Odds reais ativas via Worker · chave segura no servidor
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--soft)', marginBottom:5, fontWeight:600 }}>
                🤖 Claude API Key
                <span style={{ marginLeft:8, fontSize:11, fontWeight:400, fontFamily:"'JetBrains Mono',monospace", color: claudeKey ? 'var(--green)' : 'var(--mute)' }}>
                  {claudeKey ? '✅ configurada' : '(opcional — para IA Analisar)'}
                </span>
              </div>
              <input type="password" value={claudeKey} onChange={e => handleClaudeKey(e.target.value)}
                placeholder="sk-ant-…"
                style={{ width:'100%', fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:'6px 8px', background:'rgba(255,255,255,.05)', border:'1px solid var(--line)', borderRadius:4, color:'var(--text)', outline:'none', boxSizing:'border-box' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Painel IA ── */}
      {(aiContent || aiLoading) && (
        <div style={{ background:'rgba(0,214,143,.04)', border:'1px solid rgba(0,214,143,.2)', borderRadius:'var(--r2)', padding:14, marginBottom:14 }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--green)', letterSpacing:'1px', textTransform:'uppercase', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
            🎯 Análise IA
            {aiStatus && <span style={{ fontSize:10, color:'var(--mute)', fontWeight:400 }}>{aiStatus}</span>}
            {aiContent && <button onClick={() => setAiContent('')} style={{ marginLeft:'auto', background:'none', border:'none', color:'var(--t3)', cursor:'pointer', fontSize:14 }}>✕</button>}
          </div>
          {aiLoading && <div style={{ color:'var(--mute)', fontSize:12 }}>Analisando picks com IA…</div>}
          {aiContent && <div style={{ fontSize:12, lineHeight:1.6, color:'var(--soft)' }} dangerouslySetInnerHTML={{ __html: aiContent }} />}
        </div>
      )}

      {/* KPIs */}
      {(loaded || loading) && (
        <KpiRow>
          <Kpi value={kpis.total}      label={`🔒 Garantidos ≥${minConf}%`}  color="var(--green)" pulse={kpis.total > 0} />
          <Kpi value={kpis.acima80}    label="≥ 80% conf"                     color="#86efac" />
          <Kpi value={kpis.acima85}    label="⭐ ≥ 85% conf"                  color="#4ade80" />
          <Kpi value={kpis.jogos}      label="Jogos cobertos"                  color="var(--blue)" />
          <Kpi value={`${kpis.avgConf}%`} label="Conf média"                  color="var(--amber)" />
          <Kpi value={kpis.football}   label="⚽ Futebol"                      color="var(--soft)" />
          <Kpi value={kpis.basketball} label="🏀 NBA"                          color="var(--purple)" />
        </KpiRow>
      )}

      {/* Loading */}
      {loading && !loaded && (
        <div>
          <div style={{
            fontFamily: "'Inter', sans-serif", fontSize: 13, color: 'var(--mute)',
            marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</span>
            Analisando todos os jogos de hoje...
          </div>
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} />)}
        </div>
      )}

      {/* Vazio */}
      {loaded && guaranteed.length === 0 && (
        <EmptyState
          icon="🔍"
          title="Nenhum palpite garantido encontrado"
          subtitle={`Nenhum pick com confiança ≥ ${minConf}% hoje. Tente reduzir o mínimo.`}
          action={
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center' }}>
              <button onClick={() => setMinConf(v => Math.max(70, v - 5))} className="btn btn-primary" style={{ fontSize: 13 }}>
                Reduzir para {Math.max(70, minConf - 5)}%
              </button>
              <button onClick={load} className="btn" style={{ fontSize: 13 }}>↺ Recarregar</button>
            </div>
          }
        />
      )}

      {/* Picks agrupados por jogo */}
      {loaded && grouped.map(({ match, league, country, kickoff, props: matchProps }) => {
        // collapsed[match] === true → aberto; undefined/false → fechado (default fechado)
        const isOpen = collapsed[match] === true
        return (
        <div key={match}>
          <MatchHeader
            match={match}
            league={league}
            country={country}
            kickoff={kickoff}
            count={matchProps.length}
            isOpen={isOpen}
            onToggle={() => toggleMatch(match)}
          />
          {!isOpen && <MarketSummary props={matchProps} oddsMap={oddsMap} />}
          {isOpen && matchProps.map((prop, i) => {
            const pid = makePickId(selectedDate, prop.match || '', prop.stat || prop.market || '')
            const ro  = lookupOdds(prop, oddsMap)
            return (
              <GuaranteedCard
                key={`${match}_${prop.stat}_${i}`}
                prop={prop}
                rank={guaranteed.indexOf(prop) + 1}
                realOdds={ro}
                pickId={pid}
                onSetResult={handleSetResult}
                histResult={histById[pid] ?? null}
                isSelected={selectedPicks.has(pid)}
                onToggleSelect={() => togglePickSelect(pid, prop, ro)}
              />
            )
          })}
        </div>
        )
      })}

      {/* Rodapé informativo */}
      {loaded && guaranteed.length > 0 && (
        <div style={{
          marginTop: 20, padding: '10px 14px',
          background: 'rgba(34,197,94,.05)',
          border: '1px solid rgba(34,197,94,.15)',
          borderRadius: 8,
          fontFamily: "'Inter', sans-serif",
          fontSize: 11, color: 'var(--mute)',
          lineHeight: 1.5,
        }}>
          🔒 <strong style={{ color: 'var(--soft)' }}>Garantido</strong> mostra apenas picks com ≥{minConf}% de confiança calculada pelo motor de IA do SportsBrain.
          Confiança ≥75% não representa garantia absoluta — representa alta consistência histórica do padrão identificado.
          Aposte com responsabilidade.
        </div>
      )}

      {/* Acumuladores salvos */}
      {savedAccus.length > 0 && loaded && (
        <SavedAccumulators accus={savedAccus} onDelete={deleteAccu} />
      )}

      {/* Acumulador floating panel */}
      <AcumuladorPanel picks={selectedPicks} banca={banca} onClear={clearSelection} onSave={saveAccumulator} />

      </> /* end tab=picks */}
    </div>
  )
}

// ─── Componente: aba Histórico ────────────────────────────────────────────────
function HistoricoView({ histStats, history, onSetResult, onClear }) {
  const [histFilter, setHistFilter] = useState('all')   // 'all' | 'W' | 'L' | 'pending'
  const [histDate,   setHistDate]   = useState('all')   // 'all' | date string

  const allDates = useMemo(() => ['all', ...histStats.byDate.map(d => d.date)], [histStats])

  const filtered = useMemo(() => {
    let items = history
    if (histDate !== 'all')    items = items.filter(h => h.date === histDate)
    if (histFilter === 'W')       items = items.filter(h => h.result === 'W')
    else if (histFilter === 'L')  items = items.filter(h => h.result === 'L')
    else if (histFilter === 'pending') items = items.filter(h => !h.result)
    return [...items].sort((a, b) => b.savedAt - a.savedAt)
  }, [history, histFilter, histDate])

  if (history.length === 0) {
    return (
      <div style={{
        padding: '40px 20px', textAlign: 'center',
        color: 'var(--mute)', fontSize: 13,
        fontFamily: "'Inter',sans-serif",
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>Histórico vazio</div>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          Os picks gerados pelo Garantido são salvos automaticamente aqui.<br />
          Marque os resultados (Win/Loss) para ver sua taxa de acerto real.
        </div>
      </div>
    )
  }

  const { wr, roi, calibration, wins, losses, pending, total } = histStats

  return (
    <div>
      {/* ── KPI strip ── */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Total', value: total, color: 'var(--t1)' },
          { label: '✅ Win',  value: wins,   color: 'var(--green)' },
          { label: '❌ Loss', value: losses, color: 'var(--red)' },
          { label: '⏳ Pendente', value: pending, color: 'var(--amber)' },
          { label: 'Win Rate', value: wr != null ? `${wr.toFixed(0)}%` : '—', color: wr >= 55 ? 'var(--green)' : wr >= 45 ? 'var(--amber)' : wr != null ? 'var(--red)' : 'var(--t3)' },
          { label: 'ROI (c/odds)', value: roi != null ? `${+roi >= 0 ? '+' : ''}${roi}%` : '—', color: roi != null && +roi >= 0 ? 'var(--green)' : roi != null ? 'var(--red)' : 'var(--t3)' },
        ].map(k => (
          <div key={k.label} style={{
            flex: '1 1 80px', background: 'var(--card-bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--r2)', padding: '10px 12px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* ── Calibração de confiança ── */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--r2)', padding: '12px 14px', marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', letterSpacing: '.10em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono',monospace", marginBottom: 10 }}>
          🎯 Calibração do Modelo — Confiança vs Acerto Real
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          {calibration.map(c => {
            const accurate = c.wr != null && Math.abs(c.wr - c.expected) <= 10
            const overconf = c.wr != null && c.wr < c.expected - 10
            return (
              <div key={c.label} style={{
                background: c.wr != null ? (accurate ? 'rgba(34,197,94,.06)' : overconf ? 'rgba(239,68,68,.06)' : 'rgba(245,158,11,.06)') : 'transparent',
                border: `1px solid ${c.wr != null ? (accurate ? 'rgba(34,197,94,.2)' : overconf ? 'rgba(239,68,68,.2)' : 'rgba(245,158,11,.2)') : 'var(--border)'}`,
                borderRadius: 6, padding: '10px 10px', textAlign: 'center',
              }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1,
                  color: c.wr != null ? (accurate ? 'var(--green)' : overconf ? 'var(--red)' : 'var(--amber)') : 'var(--t3)',
                }}>
                  {c.wr != null ? `${c.wr}%` : '—'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 3 }}>
                  acerto · esp: ~{c.expected}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
                  {c.resolved}/{c.total} picks
                </div>
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
        <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
          Modelo bem calibrado: faixa ≥85% deve acertar ≥75% das vezes. Marque os resultados para calibrar o modelo ao longo do tempo.
        </div>
      </div>

      {/* ── Filtros ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { id: 'all',     label: `Todos (${history.length})` },
          { id: 'pending', label: `⏳ Pendente (${pending})` },
          { id: 'W',       label: `✅ Win (${wins})` },
          { id: 'L',       label: `❌ Loss (${losses})` },
        ].map(f => (
          <button key={f.id} onClick={() => setHistFilter(f.id)} style={{
            padding: '4px 11px', fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
            background: histFilter === f.id ? 'rgba(59,130,246,.12)' : 'transparent',
            border: `1px solid ${histFilter === f.id ? 'rgba(59,130,246,.4)' : 'var(--border)'}`,
            borderRadius: 'var(--r-pill)', color: histFilter === f.id ? 'var(--blue)' : 'var(--t3)',
            cursor: 'pointer', fontWeight: histFilter === f.id ? 700 : 400,
          }}>{f.label}</button>
        ))}
        <select value={histDate} onChange={e => setHistDate(e.target.value)} style={{
          fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '4px 8px',
          background: 'var(--ink2)', border: `1px solid ${histDate !== 'all' ? 'rgba(77,143,245,.5)' : 'var(--border)'}`,
          borderRadius: 'var(--r-pill)', color: histDate !== 'all' ? 'var(--blue)' : 'var(--t3)', cursor: 'pointer',
        }}>
          <option value="all">📅 Todas as datas</option>
          {allDates.filter(d => d !== 'all').map(d => (
            <option key={d} value={d}>{fmtDate(d)} ({histStats.byDate.find(x => x.date === d)?.picks?.length || 0})</option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', fontFamily: "'JetBrains Mono',monospace" }}>
          {filtered.length} picks
        </span>
        <button onClick={() => { if (window.confirm('Apagar todo o histórico?')) onClear() }} style={{
          padding: '4px 10px', fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
          background: 'transparent', border: '1px solid rgba(239,68,68,.3)',
          borderRadius: 'var(--r-pill)', color: 'var(--red)', cursor: 'pointer',
        }}>🗑 Limpar</button>
      </div>

      {/* ── Lista de picks ── */}
      {filtered.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mute)', fontSize: 12 }}>
          Nenhum pick neste filtro.
        </div>
      )}
      {filtered.map(h => {
        const rc_res = h.result ? RESULT_COLORS[h.result] : null
        return (
          <div key={h.id} style={{
            background: 'var(--card-bg)',
            border: `1px solid ${rc_res ? rc_res.border : 'var(--border)'}`,
            borderRadius: 'var(--r2)', padding: '10px 12px', marginBottom: 6,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {/* conf */}
            <div style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 900,
              color: confColor(h.conf), minWidth: 40, textAlign: 'center', flexShrink: 0,
            }}>{h.conf}%</div>

            {/* info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', marginBottom: 2 }}>
                {h.stat}
                {h.autoVerified && (
                  <span title="Verificado automaticamente pelo SportsBrain" style={{
                    marginLeft: 6, fontSize: 9, fontFamily: "'JetBrains Mono',monospace",
                    color: 'var(--blue)', background: 'rgba(59,130,246,.1)',
                    border: '1px solid rgba(59,130,246,.2)', borderRadius: 4, padding: '1px 5px',
                  }}>🤖 auto</span>
                )}
                {h.realOdd && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
                    color: 'var(--blue)', background: 'rgba(59,130,246,.1)',
                    border: '1px solid rgba(59,130,246,.25)', borderRadius: 4, padding: '1px 5px',
                  }}>@{h.realOdd}</span>
                )}
                {h.evReal != null && (
                  <span style={{
                    marginLeft: 4, fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
                    color: h.evReal >= 0 ? 'var(--green)' : 'var(--red)',
                    background: h.evReal >= 0 ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
                    border: `1px solid ${h.evReal >= 0 ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'}`,
                    borderRadius: 4, padding: '1px 5px',
                  }}>{h.evReal >= 0 ? '+' : ''}{h.evReal.toFixed(1)}% EV</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--soft)', marginBottom: 1 }}>
                {h.match}
              </div>
              <div style={{ fontSize: 10, color: 'var(--mute)' }}>
                {h.league && <span style={{ color: 'var(--blue)' }}>{h.league}</span>}
                {h.league && ' · '}{fmtDate(h.date)}
              </div>
            </div>

            {/* resultado buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
              {['W','L','V','P'].map(r => {
                const rc = RESULT_COLORS[r]
                const active = h.result === r
                return (
                  <button key={r} onClick={() => onSetResult(h.id, active ? null : r)} style={{
                    padding: '2px 8px', fontSize: 10, fontWeight: 700,
                    fontFamily: "'JetBrains Mono',monospace",
                    background: active ? rc.bg : 'transparent',
                    border: `1px solid ${active ? rc.border : 'var(--border)'}`,
                    borderRadius: 4, color: active ? rc.c : 'var(--t3)',
                    cursor: 'pointer', lineHeight: 1.6, transition: 'all .15s',
                  }}>{rc.label}</button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
