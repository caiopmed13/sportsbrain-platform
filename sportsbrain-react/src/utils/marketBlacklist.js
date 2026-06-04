// ═══════════════════════════════════════════════════════════════════════════
// Market Blacklist + Drift Stop — Fase 2
// ═══════════════════════════════════════════════════════════════════════════
// Identifica automaticamente mercados onde nosso modelo erra mais do que
// um baseline (random ou no-vig). Esses pares (liga × mercado) são
// "banidos" do Top Pick → menos picks ruins, mais sinal.
//
// Critérios:
//   • mín 30 picks fechados no par (liga × mercado)
//   • ROI < -3% rolling 60d   → BANIDO (auto-blacklist)
//   • Brier > baseline + 15%  → DEGRADADO (alerta circuit-breaker)
//   • CLV médio < -1%         → ANTI-EDGE (book está ganhando da gente)
//
// Storage: deriva de clvTracker.js (sempre fresh).
//
// API:
//   getBlacklist()                       → Set<"league__market">
//   isBlacklisted(league, market)        → bool
//   getDegradedMarkets()                 → [{league, market, reason, score}]
//   shouldStopPick(market, brierBaseline)→ bool (drift > 15%)
// ═══════════════════════════════════════════════════════════════════════════

import { computeRoiByMarket, computeBrierByMarket, getDiary } from './clvTracker.js'

const MIN_SAMPLE = 30
const ROI_BAN_THRESHOLD   = -3      // ROI% abaixo de -3 = banimento
const CLV_BAN_THRESHOLD   = -1      // CLV% abaixo de -1 sustentado = anti-edge
const BRIER_DRIFT_FACTOR  = 1.15    // 15% pior que baseline

/**
 * Retorna Set de "league__market" banidos.
 */
export function getBlacklist() {
  const blacklist = new Set()
  const roi = computeRoiByMarket()
  for (const r of roi) {
    if (r.n < MIN_SAMPLE) continue
    if (r.roi <= ROI_BAN_THRESHOLD) {
      blacklist.add(`${r.league || 'unknown'}__${r.market}`)
      continue
    }
    if (r.avgClv != null && r.avgClv <= CLV_BAN_THRESHOLD) {
      blacklist.add(`${r.league || 'unknown'}__${r.market}`)
    }
  }
  return blacklist
}

/**
 * Checa se par (liga, mercado) está banido.
 */
export function isBlacklisted(league, market, blacklist = null) {
  const bl = blacklist || getBlacklist()
  return bl.has(`${league || 'unknown'}__${market}`)
}

/**
 * Lista mercados degradados (ainda não banidos, mas piorando).
 */
export function getDegradedMarkets() {
  const out = []
  const roi = computeRoiByMarket()
  for (const r of roi) {
    if (r.n < MIN_SAMPLE) continue
    if (r.roi > ROI_BAN_THRESHOLD && r.roi < 0) {
      out.push({
        league: r.league, market: r.market,
        reason: `ROI ${r.roi}% (n=${r.n})`,
        score: r.roi,
      })
    } else if (r.avgClv != null && r.avgClv < 0 && r.avgClv > CLV_BAN_THRESHOLD) {
      out.push({
        league: r.league, market: r.market,
        reason: `CLV ${r.avgClv}% (n=${r.n})`,
        score: r.avgClv,
      })
    }
  }
  return out.sort((a, b) => a.score - b.score)
}

/**
 * Stop-pick por drift: Brier subiu >15% vs baseline esperado por mercado.
 * Baselines empíricos típicos (no-vig do mercado):
 *   1X2 ≈ 0.21    BTTS ≈ 0.22    Over ≈ 0.23    Combo ≈ 0.20    DC ≈ 0.18
 */
const BRIER_BASELINES = {
  '1X2':  0.21,
  'BTTS': 0.22,
  'Over': 0.23,
  'Combo':0.20,
  'DC':   0.18,
}

export function shouldStopPick(market) {
  const baseline = BRIER_BASELINES[market]
  if (!baseline) return false
  const briers = computeBrierByMarket(30)
  const cur = briers.find(b => b.market === market)
  if (!cur || cur.n < MIN_SAMPLE || cur.brier == null) return false
  return cur.brier > baseline * BRIER_DRIFT_FACTOR
}

/**
 * Resumo geral pra UI: contagem de banidos, degradados, em drift.
 */
export function getMarketHealthSummary() {
  const bl = getBlacklist()
  const degraded = getDegradedMarkets()
  const stops = ['1X2','BTTS','Over','Combo','DC'].filter(m => shouldStopPick(m))
  const diary = getDiary()
  return {
    blacklistCount: bl.size,
    degradedCount: degraded.length,
    stopMarkets: stops,
    diarySize: diary.length,
    closedPicks: diary.filter(p => p.result && p.result !== 'P').length,
  }
}

/**
 * Janela de aposta ótima (timing).
 * Heurística simples baseada em time do jogo:
 *   • >24h: AGUARDAR (lineups ainda fluidas)
 *   • 4–24h: BOM (Pinnacle já calibrou, soft books ainda não)
 *   • 2–4h:  PRIME (lineup confirmada, mercado ainda não totalmente fechado)
 *   • <2h:   APOSTAR JÁ (ou desistir — close iminente)
 *   • <30m:  TARDE (CLV negativo provável)
 */
export function bettingWindow(gameTime) {
  if (!gameTime) return { window: 'unknown', label: '—', color: 'var(--mute)' }
  const minutesToKickoff = (new Date(gameTime).getTime() - Date.now()) / 60000
  if (minutesToKickoff < 0)        return { window: 'live',     label: 'AO VIVO',         color: 'var(--red)' }
  if (minutesToKickoff < 30)       return { window: 'too_late', label: 'TARDE p/ CLV',     color: 'var(--red)' }
  if (minutesToKickoff < 120)      return { window: 'now',      label: 'APOSTAR JÁ',      color: 'var(--amber)' }
  if (minutesToKickoff < 240)      return { window: 'prime',    label: 'JANELA PRIME',    color: 'var(--green)' }
  if (minutesToKickoff < 24 * 60)  return { window: 'good',     label: 'JANELA BOA',      color: '#5ecbff' }
  return { window: 'wait', label: 'AGUARDAR LINEUP', color: 'var(--mute)' }
}
