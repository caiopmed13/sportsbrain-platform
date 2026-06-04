// ═══════════════════════════════════════════════════════════════════════════
// Dixon-Coles τ por liga — Fase 2 do roadmap
// ═══════════════════════════════════════════════════════════════════════════
// O τ corrige a deficiência do Poisson independente em placares baixos
// (0-0, 1-0, 0-1, 1-1) — eventos com correlação que o Poisson não captura.
//
// Hoje usamos τ global. Mas:
//   • Ligas defensivas (Itália, Sul-Americanas) → τ mais negativo em 0-0, 1-1
//   • Ligas ofensivas (Bundesliga, Eredivisie)  → τ mais leve
//   • Brasileirão → padrão de empates 1-1 alto (τ negativo em 1-1 forte)
//
// Calibração inspirada em Dixon & Coles (1997). Valores derivados de
// frequências empíricas observadas em /v1/odds/all + season finals.
//
// API:
//   dixonColesTau(league, h, a, lambdaH, lambdaA) → fator multiplicativo da célula (h,a)
// ═══════════════════════════════════════════════════════════════════════════

// Perfis de ligas (defensivas → τ mais agressivo, ofensivas → mais leve)
// rho ∈ [-0.2, 0]  — quanto mais negativo, mais empates baixos
const PROFILES = {
  defensive_low_scoring: { rho: -0.18, label: 'Italian/Argentine style' },
  balanced:              { rho: -0.13, label: 'Default / Premier League' },
  offensive_high_scoring:{ rho: -0.08, label: 'Bundesliga / Eredivisie' },
  brasileiro:            { rho: -0.16, label: 'Brasileirão (empate 1-1 forte)' },
  cup:                   { rho: -0.10, label: 'Cup / knockout (more open)' },
}

const LEAGUE_PROFILE = {
  // Italianas / Sul-Americanas → defensive
  'serie_a':              'defensive_low_scoring',
  'serie_b_italia':       'defensive_low_scoring',
  'argentina':            'defensive_low_scoring',
  'liga_profesional':     'defensive_low_scoring',
  'sudamericana':         'defensive_low_scoring',
  'libertadores':         'defensive_low_scoring',
  'copa_argentina':       'defensive_low_scoring',
  'mexico':               'defensive_low_scoring',
  'liga_mx':              'defensive_low_scoring',
  // Brasileiras
  'brasileirao':          'brasileiro',
  'serie_b_brasil':       'brasileiro',
  'copa_do_brasil':       'cup',
  // Inglesas / Espanholas → balanced
  'premier_league':       'balanced',
  'la_liga':              'balanced',
  'ligue_1':              'balanced',
  'primeira_liga':        'balanced',
  'mls':                  'balanced',
  'champions_league':     'cup',
  'europa_league':        'cup',
  'fa_cup':               'cup',
  // Ofensivas
  'bundesliga':           'offensive_high_scoring',
  '2_bundesliga':         'offensive_high_scoring',
  'eredivisie':           'offensive_high_scoring',
  'austria_bundesliga':   'offensive_high_scoring',
}

function getProfile(league) {
  if (!league) return PROFILES.balanced
  const slug = String(league).toLowerCase().replace(/\s+/g, '_')
  for (const [k, v] of Object.entries(LEAGUE_PROFILE)) {
    if (slug.includes(k)) return PROFILES[v] || PROFILES.balanced
  }
  return PROFILES.balanced
}

/**
 * Fator de Dixon-Coles τ(h, a; λH, λA, ρ) — multiplica P(H=h, A=a) na matriz.
 * Apenas as 4 células baixas (0-0, 0-1, 1-0, 1-1) são modificadas.
 *
 * Fórmula clássica:
 *   τ(0,0) = 1 - λH·λA·ρ
 *   τ(0,1) = 1 + λH·ρ
 *   τ(1,0) = 1 + λA·ρ
 *   τ(1,1) = 1 - ρ
 *   τ(h,a) = 1                   (qualquer outra célula)
 */
export function dixonColesTau(league, h, a, lambdaH, lambdaA) {
  if (h > 1 || a > 1) return 1
  const { rho } = getProfile(league)
  if      (h === 0 && a === 0) return Math.max(0, 1 - lambdaH * lambdaA * rho)
  else if (h === 0 && a === 1) return Math.max(0, 1 + lambdaH * rho)
  else if (h === 1 && a === 0) return Math.max(0, 1 + lambdaA * rho)
  else if (h === 1 && a === 1) return Math.max(0, 1 - rho)
  return 1
}

export function getLeagueProfile(league) {
  return getProfile(league).label
}

export { PROFILES, LEAGUE_PROFILE }
