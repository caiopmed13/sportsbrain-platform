// ═══════════════════════════════════════════════════════════════════════════
// BTTS — Ambas Marcam (Both Teams To Score)
// ═══════════════════════════════════════════════════════════════════════════
// Usa as mesmas λ (gols esperados) do matchResultModel (Poisson).
// P(BTTS Sim) = P(home marca ≥1) × P(away marca ≥1)
//            = (1 - e^-λH) × (1 - e^-λA)     [assumindo independência]
//
// Pequeno ajuste: correlação positiva leve em jogos de muito gol (+2%)
// ═══════════════════════════════════════════════════════════════════════════

import { computeMatchResult, probToConfidence } from './matchResultModel'

export function computeBTTS(home, away, league, homeStats, awayStats, formCtx = null) {
  const r = computeMatchResult(home, away, league, homeStats, awayStats, formCtx)
  const { lambdaHome, lambdaAway, dataQuality } = r

  // P(time marca ≥1) = 1 - P(time marca 0) = 1 - e^-λ
  const pHomeScores = 1 - Math.exp(-lambdaHome)
  const pAwayScores = 1 - Math.exp(-lambdaAway)

  // Base: independência (Poisson puro)
  let pYes = pHomeScores * pAwayScores

  // ─── Correção de correlação positiva ──────────────────────────────────
  // Poisson assume gols independentes, mas na prática há "contágio":
  //   • Quando um time marca, o outro se abre para atacar → ambos acabam marcando mais
  //   • Empiricamente BTTS sai ~4-7pp acima do Poisson puro em ligas top
  //   • Fonte: Dixon-Coles 1997, Karlis-Ntzoufras 2003
  //
  // Correção proporcional ao total esperado de gols:
  //   expGoals=1.8 → +2.5pp   (jogo truncado, pouco espaço)
  //   expGoals=2.5 → +4.5pp   (padrão)
  //   expGoals=3.0 → +6.0pp   (jogo aberto)
  //   expGoals=3.5+ → +7.5pp  (goleada provável)
  const corrBoost = Math.max(0.015, Math.min(0.08, 0.025 + (r.expGoals - 1.8) * 0.033))
  pYes = Math.min(0.94, pYes + corrBoost)

  // ─── Ajuste por forma: times em alta → BTTS sobe levemente ───────────
  if (formCtx?.home?.gfpg && formCtx.home.gfpg >= 1.8 && formCtx?.away?.gfpg && formCtx.away.gfpg >= 1.2) {
    pYes = Math.min(0.94, pYes + 0.02)
  }

  // ─── Ajuste por H2H: se histórico mostra BTTS frequente ──────────────
  if (formCtx?.h2h?.sample >= 4 && formCtx.h2h.bttsRate != null) {
    const w = Math.min(0.20, formCtx.h2h.sample * 0.04)   // peso cresce com amostra, teto 20%
    pYes = (1 - w) * pYes + w * formCtx.h2h.bttsRate
  }

  const pNo = 1 - pYes

  return {
    pYes: +pYes.toFixed(4),
    pNo:  +pNo.toFixed(4),
    pHomeScores: +pHomeScores.toFixed(3),
    pAwayScores: +pAwayScores.toFixed(3),
    lambdaHome, lambdaAway,
    expGoals: r.expGoals,
    corrBoost: +(corrBoost * 100).toFixed(1),
    dataQuality,
    model: r.model,
    matchResult: r,   // inclui pHome/pDraw/pAway para consumo único
  }
}

// Gera pick Ambas Marcam pronto para exibição
export function buildBTTSPick({ home, away, league, homeStats, awayStats, formCtx }) {
  const b = computeBTTS(home, away, league, homeStats, awayStats, formCtx)
  const yesConf = probToConfidence(b.pYes, b.dataQuality)
  const noConf  = probToConfidence(b.pNo,  b.dataQuality)

  const bestSide = b.pYes >= b.pNo ? 'SIM' : 'NAO'
  const bestConf = bestSide === 'SIM' ? yesConf : noConf
  const bestProb = bestSide === 'SIM' ? b.pYes  : b.pNo

  return {
    bestSide,
    bestConf,
    bestProb: +(bestProb * 100).toFixed(1),
    pYes: +(b.pYes * 100).toFixed(1),
    pNo:  +(b.pNo  * 100).toFixed(1),
    yesConf, noConf,
    lambdaHome: b.lambdaHome,
    lambdaAway: b.lambdaAway,
    pHomeScores: +(b.pHomeScores * 100).toFixed(1),
    pAwayScores: +(b.pAwayScores * 100).toFixed(1),
    expGoals: b.expGoals,
    dataQuality: b.dataQuality,
    matchResult: b.matchResult,
  }
}
