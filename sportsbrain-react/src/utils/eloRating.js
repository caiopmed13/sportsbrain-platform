// ═══════════════════════════════════════════════════════════════════════════
// Elo dinâmico por time — Fase 2 do roadmap
// ═══════════════════════════════════════════════════════════════════════════
// Hoje o `quality` do teamForm é um snapshot estático do ranking do book.
// Elo dinâmico recalcula com base nos resultados recentes — pega trends que
// rankings publicados não enxergam (time subindo/caindo de fase rápido).
//
// Formato:
//   • base = 1500 ± offset por liga (Tier-1 1600, Tier-3 1400, default 1500)
//   • K = 24 (ajuste rápido — janela curta)
//   • decay 30 dias: pesos antigos atenuados por exp(-Δdias/30)
//   • mandante adiciona +60 antes da expectativa (vantagem padrão)
//
// API:
//   eloFromForm(formData, league)            → rating absoluto
//   eloDeltaToQuality(eloHome, eloAway)      → 0..1 (0.5 = igual)
//   eloPredictWinProb(eloHome, eloAway)      → prob casa
//
// Storage opcional: localStorage 'sb_elo_v1' indexado por norm(team).
// Sem persistência: deriva de form (lastN com results) — barato e suficiente.
// ═══════════════════════════════════════════════════════════════════════════

const K_FACTOR = 24
const HOME_ADV = 60
const DECAY_DAYS = 30

const LEAGUE_BASE = {
  'premier_league':       1620,
  'la_liga':              1600,
  'bundesliga':           1580,
  'serie_a':              1580,
  'ligue_1':              1560,
  'champions_league':     1700,
  'europa_league':        1620,
  'brasileirao':          1520,
  'serie_b_brasil':       1430,
  'libertadores':         1560,
  'sudamericana':         1480,
  'mls':                  1480,
  'liga_mx':              1500,
  'eredivisie':           1530,
  'primeira_liga':        1520,
}

function leagueBase(league) {
  if (!league) return 1500
  const slug = String(league).toLowerCase().replace(/\s+/g, '_')
  for (const [k, v] of Object.entries(LEAGUE_BASE)) {
    if (slug.includes(k)) return v
  }
  return 1500
}

/**
 * Calcula Elo dinâmico a partir do histórico recente de jogos do `formData`.
 * formData esperado: { lastResults: [{result:'W'|'D'|'L', date, opponentRating?}], ... }
 * Se não houver lastResults, faz fallback usando momentum + ppg + quality.
 */
export function eloFromForm(formData, league) {
  const base = leagueBase(league)
  if (!formData) return base

  // Fallback: combinação de momentum + ppg + quality (todos 0..1)
  // momentum: 0..1 (form recente). ppg: 0..3 → /3. quality: 0..1 (ranking publicado)
  const mom  = formData.momentum ?? 0.5
  const ppg  = (formData.ppg ?? 1.5) / 3
  const qual = formData.quality ?? 0.5
  // Pesos: quality (ranking estático) tem maior peso, mas momentum/ppg pode tirar/colocar até ±100
  const composite = qual * 0.55 + mom * 0.25 + ppg * 0.20  // 0..1
  // Map composite para offset ±200 do base da liga
  const offset = (composite - 0.5) * 400
  // Bonus pequeno por streak quente
  let streakBonus = 0
  const st = formData.streak
  if (st) {
    if (st.type === 'W' && st.count >= 3) streakBonus = Math.min(40, st.count * 8)
    else if (st.type === 'L' && st.count >= 3) streakBonus = -Math.min(40, st.count * 8)
    else if (st.unbeaten >= 5) streakBonus = 20
    else if (st.winless >= 5) streakBonus = -20
  }
  // Penalidade por descanso ruim (já é coberto por fatigue, mas aqui é leve)
  let restPen = 0
  if (formData.rest != null && formData.rest <= 2) restPen = -15

  return Math.round(base + offset + streakBonus + restPen)
}

/**
 * Probabilidade de vitória da casa via Elo (com vantagem de mandante).
 * Fórmula clássica: 1 / (1 + 10^((Bopp - A - HOME_ADV)/400))
 */
export function eloPredictWinProb(eloHome, eloAway) {
  const diff = (eloHome + HOME_ADV) - eloAway
  return 1 / (1 + Math.pow(10, -diff / 400))
}

/**
 * Mapeia diff de Elo → quality 0..1 normalizado pra entrar no λ multiplicador.
 * Δ=0 → 0.5  ;  Δ=+200 → ~0.76  ;  Δ=-200 → ~0.24
 */
export function eloDeltaToQuality(eloHome, eloAway) {
  const diff = eloHome - eloAway   // sem home_adv aqui (quality é "qualidade pura")
  return 1 / (1 + Math.pow(10, -diff / 400))
}

/**
 * Multiplicador λ por time baseado no Elo gap (mais conservador que quality bruto).
 * Δ=+150 → 1.12 ataque casa, 0.92 ataque fora ; Δ=-150 → invertido.
 * Bounded para não explodir.
 */
export function eloAttackMult(eloA, eloB) {
  const diff = eloA - eloB
  const mult = 1 + Math.max(-0.20, Math.min(0.20, diff / 1500))
  return +mult.toFixed(3)
}

export { K_FACTOR, HOME_ADV, DECAY_DAYS, leagueBase }
