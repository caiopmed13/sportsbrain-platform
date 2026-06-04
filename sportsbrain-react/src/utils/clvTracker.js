// ═══════════════════════════════════════════════════════════════════════════
// CLV Tracker — Fase 2 / 3
// ═══════════════════════════════════════════════════════════════════════════
// Salva cada Top Pick com odd no momento do registro (odd_open).
// Quando o jogo se aproxima do kickoff (ou após), permite gravar odd_close.
// CLV = (odd_open / odd_close) - 1   → +% bom, -% ruim.
//
// CLV positivo persistente é o ÚNICO indicador honesto de edge —
// independe de variance e sorte de curto prazo.
//
// Storage: localStorage chave 'sb_clv_diary_v1' com array de picks.
// Limite: últimos 1000 picks (rolling). Limpeza automática.
//
// API:
//   logPick(pick)               → salva snapshot do pick
//   getDiary()                  → lê todos picks
//   updateClose(pickId, oddClose)→ grava odd de fechamento
//   computeRollingClv(days=30)  → { avgClv, count, positive, sample }
//   markResult(pickId, result)  → 'W'|'L'|'V'|'P'
//   exportDiary()               → CSV pra análise externa
// ═══════════════════════════════════════════════════════════════════════════

const KEY = 'sb_clv_diary_v1'
const MAX = 1000

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function writeAll(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX))) } catch {}
}

/**
 * Loga um Top Pick no diário no momento da decisão.
 * @param {Object} pick {sport, league, home, away, market, side, label, prob, conf,
 *                       odd, ev, kelly, fairProb, gameTime, dataQuality}
 */
export function logPick(pick) {
  if (!pick || !pick.market) return null
  const id = `${pick.home}_${pick.away}_${pick.market}_${pick.side}_${pick.gameTime || Date.now()}`
    .toLowerCase().replace(/[^a-z0-9_]/g, '')
  const all = readAll()
  // Idempotente: se já existir mesmo id, atualiza odd_open (sempre o último visto antes do close)
  const existing = all.find(p => p.id === id)
  if (existing && existing.odd_close) return existing  // já fechado, não mexe
  const entry = {
    id,
    ts_open: Date.now(),
    sport: pick.sport || null,
    league: pick.league || null,
    home: pick.home,
    away: pick.away,
    game_time: pick.gameTime || null,
    market: pick.market,
    side: pick.side,
    label: pick.label,
    prob_model: pick.prob,
    prob_fair: pick.fairProb || null,
    conf: pick.conf,
    odd_open: pick.odd || null,
    ev_open: pick.ev || null,
    kelly_pct: pick.kelly || null,
    data_quality: pick.dataQuality || null,
    premium: !!pick.premium,
    odd_close: null,
    clv: null,
    result: null,
    closed_at: null,
  }
  if (existing) {
    Object.assign(existing, { odd_open: entry.odd_open ?? existing.odd_open, prob_fair: entry.prob_fair ?? existing.prob_fair })
    writeAll(all)
    return existing
  }
  all.push(entry)
  writeAll(all)
  return entry
}

export function getDiary() { return readAll() }

/**
 * Grava odd de fechamento e calcula CLV.
 * CLV = (odd_open / odd_close) - 1   (back side)
 */
export function updateClose(pickId, oddClose) {
  if (!pickId || !oddClose || oddClose <= 1) return null
  const all = readAll()
  const p = all.find(x => x.id === pickId)
  if (!p || !p.odd_open) return null
  p.odd_close = oddClose
  p.clv = +((p.odd_open / oddClose - 1) * 100).toFixed(2)
  p.closed_at = Date.now()
  writeAll(all)
  return p
}

export function markResult(pickId, result) {
  const valid = ['W','L','V','P']  // win, loss, void, pending
  if (!valid.includes(result)) return null
  const all = readAll()
  const p = all.find(x => x.id === pickId)
  if (!p) return null
  p.result = result
  writeAll(all)
  return p
}

/**
 * CLV médio dos últimos N dias (rolling).
 * Apenas picks com odd_close registrada entram na média.
 */
export function computeRollingClv(days = 30) {
  const cutoff = Date.now() - days * 86400_000
  const all = readAll().filter(p => p.closed_at && p.closed_at >= cutoff && p.clv != null)
  if (!all.length) return { avgClv: 0, count: 0, positive: 0, sample: 0, ready: false }
  const sum = all.reduce((a, p) => a + p.clv, 0)
  const positive = all.filter(p => p.clv > 0).length
  return {
    avgClv: +(sum / all.length).toFixed(2),
    count: all.length,
    positive,
    sample: all.length,
    ready: all.length >= 30,
    // gate da Fase 3: rolling 30d com CLV+ ≥ 1.5%
    gatePass: all.length >= 200 && (sum / all.length) >= 1.5,
  }
}

/**
 * ROI por mercado × liga (cruzada Fase 3).
 * Apenas picks com result em W/L/V.
 */
export function computeRoiByMarket() {
  const all = readAll().filter(p => p.result && p.result !== 'P' && p.odd_open)
  const buckets = {}
  for (const p of all) {
    const k = `${p.league || 'unknown'}__${p.market}`
    if (!buckets[k]) buckets[k] = { league: p.league, market: p.market, n: 0, profit: 0, w: 0, clvSum: 0, clvN: 0 }
    const b = buckets[k]
    b.n += 1
    if (p.result === 'W')      { b.profit += (p.odd_open - 1); b.w += 1 }
    else if (p.result === 'L') { b.profit -= 1 }
    // V = void = 0
    if (p.clv != null) { b.clvSum += p.clv; b.clvN += 1 }
  }
  return Object.values(buckets).map(b => ({
    ...b,
    roi: b.n > 0 ? +((b.profit / b.n) * 100).toFixed(2) : 0,
    winRate: b.n > 0 ? +((b.w / b.n) * 100).toFixed(1) : 0,
    avgClv: b.clvN > 0 ? +(b.clvSum / b.clvN).toFixed(2) : null,
  })).sort((a, b) => b.roi - a.roi)
}

/**
 * Brier score por mercado (rolling 30d).
 * Brier = média de (prob_model − outcome)²  onde outcome ∈ {0,1}
 */
export function computeBrierByMarket(days = 30) {
  const cutoff = Date.now() - days * 86400_000
  const all = readAll().filter(p =>
    p.result && (p.result === 'W' || p.result === 'L') &&
    p.closed_at && p.closed_at >= cutoff && p.prob_model != null,
  )
  const buckets = {}
  for (const p of all) {
    const k = p.market
    if (!buckets[k]) buckets[k] = { market: k, sum: 0, n: 0 }
    const outcome = p.result === 'W' ? 1 : 0
    buckets[k].sum += (p.prob_model - outcome) ** 2
    buckets[k].n += 1
  }
  return Object.values(buckets).map(b => ({
    market: b.market,
    n: b.n,
    brier: b.n > 0 ? +(b.sum / b.n).toFixed(4) : null,
  })).sort((a, b) => a.brier - b.brier)
}

export function exportDiary() {
  const all = readAll()
  if (!all.length) return ''
  const head = ['ts_open','sport','league','home','away','game_time','market','side','label',
                'prob_model','prob_fair','conf','odd_open','odd_close','clv','ev_open','kelly_pct',
                'result','data_quality','premium']
  const rows = all.map(p => head.map(k => {
    const v = p[k]
    if (v == null) return ''
    if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`
    return v
  }).join(','))
  return [head.join(','), ...rows].join('\n')
}

export function clearDiary() {
  try { localStorage.removeItem(KEY) } catch {}
}

/**
 * Auto-close: snapshot da odd atual em picks cujo kickoff está próximo (<30min)
 * e ainda não tem odd_close registrada.
 *
 * @param {Function} resolveOdd  fn(pick) → odd atual no mercado | null
 * Chamada com cada pick pendente; deve retornar a odd no mesmo lado/mercado.
 * @returns {{closed: number, scanned: number}}
 */
export function autoCloseRipePicks(resolveOdd) {
  if (typeof resolveOdd !== 'function') return { closed: 0, scanned: 0 }
  const all = readAll()
  let closed = 0, scanned = 0
  const now = Date.now()
  for (const p of all) {
    if (p.odd_close || !p.game_time || !p.odd_open) continue
    const minsToKickoff = (new Date(p.game_time).getTime() - now) / 60000
    // Janela: dos 30min antes do jogo até 4h depois (cobre fechamento real)
    if (minsToKickoff > 30 || minsToKickoff < -240) continue
    scanned++
    let oddClose = null
    try { oddClose = resolveOdd(p) } catch {}
    if (!oddClose || oddClose <= 1) continue
    p.odd_close = oddClose
    p.clv = +((p.odd_open / oddClose - 1) * 100).toFixed(2)
    p.closed_at = now
    closed++
  }
  if (closed > 0) writeAll(all)
  return { closed, scanned }
}
