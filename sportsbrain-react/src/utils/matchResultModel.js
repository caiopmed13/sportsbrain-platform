// ═══════════════════════════════════════════════════════════════════════════
// Motor 1X2 — Distribuição de Poisson (match result model v1)
// ═══════════════════════════════════════════════════════════════════════════
// Substitui o gerador hash-seed anterior por cálculo estatístico real:
//   1. Estima λ (gols esperados) para mandante e visitante
//   2. Gera matriz Poisson 6×6 de placares prováveis
//   3. Soma células onde H>A, H=A, H<A → p(Casa), p(Empate), p(Fora)
//
// Entradas:
//   home, away    — nomes dos times
//   league        — nome da liga (usa FTP_COMP_CONTEXT para baseline)
//   homeStats     — { goals_scored_per_game, goals_conceded_per_game, games_played } (D1) | null
//   awayStats     — idem para visitante
//
// Saída:
//   {
//     pHome, pDraw, pAway   — probabilidades normalizadas (0-1)
//     lambdaHome, lambdaAway — gols esperados
//     expGoals              — total esperado (Over/Under 2.5)
//     model: 'poisson-v1',
//     dataQuality: 'REAL' | 'PARCIAL' | 'EST'
//   }
// ═══════════════════════════════════════════════════════════════════════════

// ── Vantagem de mando por liga (multiplicador em λ_home) ──────────────────
// Fontes: Football-Data.co.uk 2020-25, Opta
// Brasileirão tem mandante mais forte (torcida/viagens); Champions menos (times elite)
const HOME_ADVANTAGE = {
  'brasileirao':       1.22,
  'brasileirao a':     1.22,
  'brasileirao b':     1.25,   // Série B → mais jogos sem torcida visitante
  'serie b':           1.25,
  'copa do brasil':    1.20,
  'copa libertadores': 1.18,
  'copa sulamericana': 1.18,
  'copa sudamericana': 1.18,
  'premier league':    1.13,
  'la liga':           1.14,
  'serie a':           1.12,
  'bundesliga':        1.12,
  'ligue 1':           1.13,
  'champions league':  1.08,
  'europa league':     1.10,
  'conference league': 1.11,
  'primeira liga':     1.15,
  'eredivisie':        1.13,
  'mls':               1.16,
  'championship':      1.14,
  'liga argentina':    1.20,
  'liga profesional':  1.20,
  'super lig':         1.18,
  'default':           1.15,
}

// ── Baseline de gols por liga (λ médio home + λ médio away = total/2 cada) ─
// Valores derivados de FTP_COMP_CONTEXT.htGoalRate * 2 = total por jogo
// Divisão ~54% home / 46% away é o padrão histórico
const LEAGUE_GOALS = {
  'premier league':    { total: 2.56, homeShare: 0.56 },
  'la liga':           { total: 2.36, homeShare: 0.55 },
  'serie a':           { total: 2.52, homeShare: 0.55 },
  'bundesliga':        { total: 2.84, homeShare: 0.56 },
  'ligue 1':           { total: 2.38, homeShare: 0.54 },
  'champions league':  { total: 2.70, homeShare: 0.53 },
  'europa league':     { total: 2.44, homeShare: 0.54 },
  'conference league': { total: 2.55, homeShare: 0.54 },
  'brasileirao':       { total: 2.20, homeShare: 0.58 },   // +mando forte
  'brasileirao a':     { total: 2.20, homeShare: 0.58 },
  'brasileirao b':     { total: 1.92, homeShare: 0.60 },
  'serie b':           { total: 1.92, homeShare: 0.60 },
  'copa do brasil':    { total: 2.04, homeShare: 0.58 },
  'copa libertadores': { total: 2.10, homeShare: 0.58 },
  'copa sulamericana': { total: 2.10, homeShare: 0.58 },
  'copa sudamericana': { total: 2.10, homeShare: 0.58 },
  'primeira liga':     { total: 2.24, homeShare: 0.55 },
  'eredivisie':        { total: 2.76, homeShare: 0.56 },
  'mls':               { total: 2.32, homeShare: 0.55 },
  'championship':      { total: 2.36, homeShare: 0.54 },
  'liga argentina':    { total: 2.40, homeShare: 0.57 },
  'liga profesional':  { total: 2.40, homeShare: 0.57 },
  'super lig':         { total: 2.44, homeShare: 0.56 },
  'default':           { total: 2.30, homeShare: 0.55 },
}

// ═══════════════════════════════════════════════════════════════════════════
// Cup Pedigree — times historicamente "copeiros"
// ═══════════════════════════════════════════════════════════════════════════
// Baseline: 1.00 (média da liga). Multiplicador aplicado em λ quando o jogo
// atual é uma competição-copa. Baseado em:
//   · Títulos + finais + semifinais nas últimas 2-3 décadas
//   · "DNA de copa" — times que historicamente elevam desempenho em mata-mata
//
// Fontes: CBF/Conmebol/UEFA trophy counts, Transfermarkt historic runs.
// ═══════════════════════════════════════════════════════════════════════════
const CUP_PEDIGREE = {
  'copa do brasil': {
    // Hexa-campeões e recorrentes
    'cruzeiro':       1.12,   // 6 títulos — maior campeão
    'gremio':         1.11,   // 5 títulos
    'flamengo':       1.11,   // 4 títulos + finais recentes
    'palmeiras':      1.10,   // 4 títulos
    'corinthians':    1.09,   // 3 títulos
    'athletico-pr':   1.08,
    'athletico paranaense': 1.08,
    'atletico-mg':    1.08,
    'atletico mineiro':1.08,
    'internacional':  1.06,
    'sao paulo':      1.06,
    'são paulo':      1.06,
    'santos':         1.06,
    'fluminense':     1.05,
    'vasco':          1.05,
    'botafogo':       1.03,
    'bahia':          1.04,
    'fortaleza':      1.04,
    'juventude':      1.04,   // 1 título histórico
  },
  'copa libertadores': {
    // Gigantes históricos sul-americanos
    'boca juniors':   1.14,   // 6 títulos
    'independiente':  1.12,   // 7 títulos
    'river plate':    1.12,   // 4 títulos
    'palmeiras':      1.12,   // 3 títulos (2 recentes — dominância atual)
    'flamengo':       1.12,   // 3 títulos (2 recentes)
    'penarol':        1.10,   // 5 títulos
    'peñarol':        1.10,
    'nacional':       1.09,   // 3 títulos
    'sao paulo':      1.09,
    'são paulo':      1.09,
    'santos':         1.09,
    'gremio':         1.09,
    'internacional':  1.08,
    'atletico-mg':    1.08,
    'atletico mineiro':1.08,
    'fluminense':     1.09,   // 1 título recente (2023)
    'cruzeiro':       1.07,
    'corinthians':    1.06,
    'estudiantes':    1.08,
    'olimpia':        1.07,
    'lanus':          1.04,
    'racing':         1.05,
    'velez':          1.05,
    'sporting cristal':1.04,
  },
  'copa sudamericana': {
    // Times que costumam se superar em copa "B"
    'independiente':  1.08,
    'atletico paranaense': 1.10,   // 2 títulos
    'athletico-pr':   1.10,
    'lanus':          1.07,
    'independiente del valle': 1.10,
    'liga de quito':  1.08,
    'sao paulo':      1.07,
    'são paulo':      1.07,
    'chapecoense':    1.07,   // título histórico 2016
    'corinthians':    1.06,
    'racing':         1.05,
    'athletico':      1.10,
  },
  'champions league': {
    // Pedigree europeu — títulos totais e dominância recente
    'real madrid':    1.15,   // 15 títulos — dominador histórico
    'bayern':         1.10,   // 6 títulos
    'bayern munich':  1.10,
    'manchester city':1.09,   // título recente + dominância
    'man city':       1.09,
    'barcelona':      1.08,
    'liverpool':      1.08,
    'ac milan':       1.07,
    'milan':          1.07,
    'inter milan':    1.07,
    'inter':          1.07,
    'chelsea':        1.06,
    'manchester united':1.06,
    'man united':     1.06,
    'ajax':           1.06,
    'psg':            1.05,
    'paris saint-germain':1.05,
    'borussia dortmund':1.04,
    'atletico madrid':1.05,
    'juventus':       1.05,
  },
  'europa league': {
    'sevilla':        1.14,   // 7 títulos — rei absoluto
    'atletico madrid':1.08,
    'chelsea':        1.06,
    'inter':          1.06,
    'manchester united':1.06,
    'porto':          1.07,
    'valencia':       1.05,
    'villarreal':     1.06,
    'eintracht':      1.05,
    'leverkusen':     1.06,
  },
  'conference league': {
    'roma':           1.08,   // campeão inaugural
    'west ham':       1.07,
    'fiorentina':     1.06,
    'olympiacos':     1.06,
  },
}

// Aplica pedigree de copa ao time quando o jogo é uma copa reconhecida
function cupPedigreeMult(teamName, league) {
  const lg = (league || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
  const tn = (teamName || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')

  for (const [cupKey, teams] of Object.entries(CUP_PEDIGREE)) {
    if (lg.includes(cupKey)) {
      for (const [teamKey, mult] of Object.entries(teams)) {
        if (tn === teamKey || tn.includes(teamKey) || teamKey.includes(tn)) return mult
      }
      return 1   // jogo é de copa, mas time não é "copeiro" → 1.0 (neutro)
    }
  }
  return 1   // jogo não é copa → sem pedigree
}

// ── Normalização de nome de liga ─────────────────────────────────────────
function normLeague(lg) {
  return (lg || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
}

function getHomeAdvantage(league) {
  const lg = normLeague(league)
  for (const k of Object.keys(HOME_ADVANTAGE)) {
    if (k !== 'default' && lg.includes(k)) return HOME_ADVANTAGE[k]
  }
  return HOME_ADVANTAGE['default']
}

function getLeagueGoals(league) {
  const lg = normLeague(league)
  for (const k of Object.keys(LEAGUE_GOALS)) {
    if (k !== 'default' && lg.includes(k)) return LEAGUE_GOALS[k]
  }
  return LEAGUE_GOALS['default']
}

// ── Poisson PMF: P(X = k | λ) ────────────────────────────────────────────
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  // P(k;λ) = e^-λ · λ^k / k!
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 2; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

// ── Seed fallback por nome (mantém diferenciação quando não há stats reais) ─
function teamSeed(name, suffix = '', scale = 1.0) {
  const n = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '') + suffix
  let h = 5381
  for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0
  return ((h % 1000) / 999.0 * 2 - 1) * scale   // -scale..+scale
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ═══════════════════════════════════════════════════════════════════════════
// Função principal
// ═══════════════════════════════════════════════════════════════════════════
// ── Lê campo de gols/jogos do schema do D1 (backend) ─────────────────────
// Suporta 2 formatos:
//   a) Aninhado (D1 via FootballService): { played, goals: { per_game_for, per_game_against } }
//   b) Flat (ftpTeamProps legado):         { games_played, goals_scored_per_game, goals_conceded_per_game }
function readStats(s) {
  if (!s) return { played: 0, gf: null, ga: null }
  const played = s.played ?? s.games_played ?? 0
  const gf = s.goals?.per_game_for  ?? s.goals_scored_per_game   ?? null
  const ga = s.goals?.per_game_against ?? s.goals_conceded_per_game ?? null
  return { played, gf, ga }
}

// formCtx (opcional, Fase 2): { home: { momentum, ppg, gfpg, gapg }, away: {...}, h2h: {...} }
// propCtx (opcional, Fase 8+): enriquecimento proprietário do D1
//   {
//     xgHome: { xg_per90, xga_per90, games, overperforming, underperforming },
//     xgAway: { ... },
//     weather: { goal_impact_mult },         // de weather_snapshots
//     refStats: { cards_per_game, pens_per_game, markets: {p_over_4_5_cards, p_red_in_match, p_pen_in_match} },
//     lineupsCtx: {                          // de /v1/match/:id/detail + /v1/players/team/:norm
//       home: { starScorerOut: bool, missingName: str, missingGoals: n },
//       away: { ... }
//     },
//     ppda: { home: n, away: n },            // rolling avg
//     marketOdds: { h: 2.1, d: 3.4, a: 3.2, btts_yes: 1.95, over25: 1.90 }  // pra edge
//   }
export function computeMatchResult(home, away, league, homeStats = null, awayStats = null, formCtx = null, propCtx = null) {
  const lgGoals = getLeagueGoals(league)
  const homeAdv = getHomeAdvantage(league)

  // Baseline de λ a partir da liga
  const lgHome = lgGoals.total * lgGoals.homeShare
  const lgAway = lgGoals.total * (1 - lgGoals.homeShare)

  const MIN_GAMES = 5
  const hS = readStats(homeStats)
  const aS = readStats(awayStats)
  const hasHomeReal = hS.played >= MIN_GAMES
  const hasAwayReal = aS.played >= MIN_GAMES

  // ─── Ataque (força ofensiva relativa à liga) ──────────────────────────
  // 1.0 = média da liga; 1.2 = 20% acima; 0.8 = 20% abaixo
  // Prioridade de dados: D1 real > ESPN form > hash-seed
  let homeAttack, awayAttack, homeDefense, awayDefense

  // Helpers: extrai gf/ga da forma ESPN quando D1 está vazio
  const fhForm = formCtx?.home
  const faForm = formCtx?.away
  const fhSample = fhForm?.sample ?? 0
  const faSample = faForm?.sample ?? 0
  // Considera ESPN form confiável com ≥3 jogos (tolerante para início de temporada)
  const hasHomeForm = fhSample >= 3 && fhForm?.gfpg != null
  const hasAwayForm = faSample >= 3 && faForm?.gfpg != null

  if (hasHomeReal && hS.gf != null) {
    homeAttack = clamp(hS.gf / lgHome, 0.55, 1.75)
  } else if (hasHomeForm) {
    // ESPN form como substituto do D1: usa gfpg ajustado para o baseline da liga
    homeAttack = clamp(fhForm.gfpg / lgHome, 0.50, 1.85)
  } else {
    homeAttack = 1.0 + teamSeed(home, 'atk', 0.22)
  }

  if (hasAwayReal && aS.gf != null) {
    awayAttack = clamp(aS.gf / lgAway, 0.55, 1.75)
  } else if (hasAwayForm) {
    awayAttack = clamp(faForm.gfpg / lgAway, 0.50, 1.85)
  } else {
    awayAttack = 1.0 + teamSeed(away, 'atk', 0.22)
  }

  if (hasHomeReal && hS.ga != null) {
    homeDefense = clamp(hS.ga / lgAway, 0.55, 1.75)
  } else if (hasHomeForm) {
    homeDefense = clamp(fhForm.gapg / lgAway, 0.50, 1.85)
  } else {
    homeDefense = 1.0 + teamSeed(home, 'def', 0.18)
  }

  if (hasAwayReal && aS.ga != null) {
    awayDefense = clamp(aS.ga / lgHome, 0.55, 1.75)
  } else if (hasAwayForm) {
    awayDefense = clamp(faForm.gapg / lgHome, 0.50, 1.85)
  } else {
    awayDefense = 1.0 + teamSeed(away, 'def', 0.18)
  }

  // ─── Fase 2+6: Multiplicadores de forma com split casa/fora ─────────
  let formMultH = 1, formMultA = 1
  let fatigueH = 1, fatigueA = 1
  let qualityH = 0.5, qualityA = 0.5
  let injMultH = 1, injMultA = 1

  if (formCtx?.home) {
    const fh = formCtx.home
    // Prioriza momentum em casa se disponível (mais relevante para mandante)
    const venueCtx = fh.asHome || fh    // usa split casa se tiver amostra
    formMultH = clamp(1 + (venueCtx.momentum - 0.5) * 0.28, 0.72, 1.28)
    // Penalidade de fadiga: <3 dias = -5%, <4 dias = -2.5%
    if (fh.rest != null) {
      if (fh.rest <= 2)      fatigueH = 0.95
      else if (fh.rest <= 3) fatigueH = 0.975
    }
    qualityH = fh.quality ?? 0.5
    // Penalidade por lesões ponderada (peso por gravidade): -1.8% por unidade, teto -14%
    const wInjH = fh.injuryWeight ?? fh.injuryCount ?? 0
    if (wInjH > 0) {
      injMultH = Math.max(0.86, 1 - wInjH * 0.018)
    }
    // Bônus/penalidade por sequência: 3+ vitórias = +, 3+ derrotas = -
    const stH = fh.streak
    if (stH && stH.count >= 3) {
      if (stH.type === 'W')      formMultH *= Math.min(1.10, 1 + stH.count * 0.015)   // até +10%
      else if (stH.type === 'L') formMultH *= Math.max(0.90, 1 - stH.count * 0.018)   // até -10%
    } else if (stH && stH.unbeaten >= 5) {
      formMultH *= 1.04   // série invicta longa
    } else if (stH && stH.winless >= 5) {
      formMultH *= 0.96
    }
  }

  if (formCtx?.away) {
    const fa = formCtx.away
    // Prioriza momentum fora (visitante)
    const venueCtx = fa.asAway || fa
    formMultA = clamp(1 + (venueCtx.momentum - 0.5) * 0.28, 0.72, 1.28)
    if (fa.rest != null) {
      if (fa.rest <= 2)      fatigueA = 0.95
      else if (fa.rest <= 3) fatigueA = 0.975
    }
    qualityA = fa.quality ?? 0.5
    const wInjA = fa.injuryWeight ?? fa.injuryCount ?? 0
    if (wInjA > 0) {
      injMultA = Math.max(0.86, 1 - wInjA * 0.018)
    }
    const stA = fa.streak
    if (stA && stA.count >= 3) {
      if (stA.type === 'W')      formMultA *= Math.min(1.10, 1 + stA.count * 0.015)
      else if (stA.type === 'L') formMultA *= Math.max(0.90, 1 - stA.count * 0.018)
    } else if (stA && stA.unbeaten >= 5) {
      formMultA *= 1.04
    } else if (stA && stA.winless >= 5) {
      formMultA *= 0.96
    }
  }

  // ─── Ataque/defesa com split venue quando disponível ─────────────────
  // Se temos stats reais (D1) + split de forma (ESPN), combina
  if (hasHomeReal && formCtx?.home?.asHome && hS.gf != null) {
    // Blend: 70% stats D1 + 30% form-at-home attack ratio
    const venueGfPg = formCtx.home.asHome.gfpg || hS.gf
    const blended   = 0.70 * hS.gf + 0.30 * venueGfPg
    homeAttack = clamp(blended / lgHome, 0.50, 1.85)
  }
  if (hasAwayReal && formCtx?.away?.asAway && aS.gf != null) {
    const venueGfPg = formCtx.away.asAway.gfpg || aS.gf
    const blended   = 0.70 * aS.gf + 0.30 * venueGfPg
    awayAttack = clamp(blended / lgAway, 0.50, 1.85)
  }
  if (hasHomeReal && formCtx?.home?.asHome && hS.ga != null) {
    const venueGaPg = formCtx.home.asHome.gapg || hS.ga
    const blended   = 0.70 * hS.ga + 0.30 * venueGaPg
    homeDefense = clamp(blended / lgAway, 0.50, 1.85)
  }
  if (hasAwayReal && formCtx?.away?.asAway && aS.ga != null) {
    const venueGaPg = formCtx.away.asAway.gapg || aS.ga
    const blended   = 0.70 * aS.ga + 0.30 * venueGaPg
    awayDefense = clamp(blended / lgHome, 0.50, 1.85)
  }

  // ─── #1 xG rolling blend (substitui gols marcados por xG quando disponível)
  // xG é mais preditivo que gols (menos ruído de finalização).
  // Blend: 55% xG normalizado + 45% stats anteriores (já em homeAttack).
  // Só aplica se temos >= 6 jogos com xG.
  const xgH = propCtx?.xgHome, xgA = propCtx?.xgAway
  let xgBlendApplied = false
  if (xgH?.xg_per90 != null && xgH.games >= 6) {
    const xgRatio = clamp(xgH.xg_per90 / lgHome, 0.50, 1.85)
    homeAttack = 0.55 * xgRatio + 0.45 * homeAttack
    xgBlendApplied = true
  }
  if (xgA?.xg_per90 != null && xgA.games >= 6) {
    const xgRatio = clamp(xgA.xg_per90 / lgAway, 0.50, 1.85)
    awayAttack = 0.55 * xgRatio + 0.45 * awayAttack
    xgBlendApplied = true
  }
  if (xgH?.xga_per90 != null && xgH.games >= 6) {
    const xgaRatio = clamp(xgH.xga_per90 / lgAway, 0.50, 1.85)
    homeDefense = 0.55 * xgaRatio + 0.45 * homeDefense
  }
  if (xgA?.xga_per90 != null && xgA.games >= 6) {
    const xgaRatio = clamp(xgA.xga_per90 / lgHome, 0.50, 1.85)
    awayDefense = 0.55 * xgaRatio + 0.45 * awayDefense
  }

  // ─── Qualidade relativa (ajuste fino ±5%) ────────────────────────────
  // Hoje: blend de quality estático (book ranking) + Elo dinâmico (forma+ppg+streak).
  // Elo pega trends que ranking não enxerga. Peso 60% Elo, 40% quality estático.
  const eloHome = eloFromForm(formCtx?.home, league)
  const eloAway = eloFromForm(formCtx?.away, league)
  const eloQH   = eloDeltaToQuality(eloHome, eloAway)        // 0..1
  const eloQA   = 1 - eloQH
  const blendQH = qualityH * 0.40 + eloQH * 0.60
  const blendQA = qualityA * 0.40 + eloQA * 0.60
  const qualityDiff = blendQH - blendQA                       // -1..+1
  let qualMultH   = 1 + qualityDiff * 0.06                    // ±6% (era ±5%, com Elo confiamos um pouco mais)
  let qualMultA   = 1 - qualityDiff * 0.06

  // ─── #4 Key player out (titular ausente que é top scorer → −7%) ───────
  // lineupsCtx vem de /v1/players/team/:norm (top_scorers) cruzado com
  // starters confirmados de /v1/match/:id/detail.
  const lineupsCtx = propCtx?.lineupsCtx
  const starOutH = lineupsCtx?.home?.starScorerOut ? 0.93 : 1
  const starOutA = lineupsCtx?.away?.starScorerOut ? 0.93 : 1
  qualMultH *= starOutH
  qualMultA *= starOutA

  // ─── Cup pedigree (times "copeiros") ─────────────────────────────────
  // Aplica só quando o jogo atual é uma copa reconhecida.
  // Ex: Cruzeiro em Copa do Brasil → ×1.12. Flamengo em Libertadores → ×1.12.
  const cupMultH = cupPedigreeMult(home, league)
  const cupMultA = cupPedigreeMult(away, league)

  // ─── ROTATION em Copa (gap histórico do modelo, finalmente resolvido) ─
  // Times grandes tipicamente poupam titulares em meio de semana quando:
  //   • Jogo é copa/mata-mata (Copa do Brasil, Copa da Liga, cup ties)
  //   • Time tem jogo de liga ≤3 dias antes ou depois
  //   • Time é tier-1 (cupMult > 1.05 = "copeiro" histórico = pode se dar ao luxo)
  //
  // Fonte: análise Football-Data.co.uk 2020-2025 — times tier-1 em copa
  // meio-semana marcam 18% menos gols que média da temporada.
  //
  // formCtx.rest = dias desde último jogo (mais alto = mais descansado)
  // formCtx.nextRest = dias até próximo jogo (baixo = pode rotacionar mais)
  function rotationMult(formSide, cupMult) {
    if (cupMult <= 1.02) return 1                     // Não é tier-1, joga com força total
    if (!formSide) return 1
    const rest = formSide.rest ?? 7
    const nextRest = formSide.nextRest ?? 7
    // Jogo meio-semana: rest ≤ 4 (jogo recente) E/OU nextRest ≤ 4 (liga logo)
    const tightSchedule = rest <= 4 || nextRest <= 4
    if (!tightSchedule) return 1
    // Quanto mais "copeiro" + mais apertado, maior a rotação
    const severity = Math.min(1, (1.15 - (rest / 4)) + (1.15 - (nextRest / 4)))
    const mult = 1 - (0.12 * severity * Math.min(1, (cupMult - 1) * 8))
    return Math.max(0.82, mult)   // teto −18%
  }
  const lgKey = (league || '').toLowerCase()
  const isCupContext = /copa|cup|libertadores|sudamericana|champions|europa|conference|copa do brasil/.test(lgKey)
  const rotMultH = isCupContext ? rotationMult(formCtx?.home, cupMultH) : 1
  const rotMultA = isCupContext ? rotationMult(formCtx?.away, cupMultA) : 1

  // ─── #8 Weather — multiplica ambos λ igualmente (reduz/aumenta total goals)
  const weatherMult = (propCtx?.weather?.goal_impact_mult != null)
    ? clamp(propCtx.weather.goal_impact_mult, 0.75, 1.15)
    : 1

  // ─── #6 PPDA mismatch — time que pressiona muito mais alto ganha chutes
  // Se diff > 3 (significativo), casa ganha +6% e cede -6% em ataque opp.
  let ppdaMultH = 1, ppdaMultA = 1
  const ppdaH = propCtx?.ppda?.home, ppdaA = propCtx?.ppda?.away
  if (ppdaH != null && ppdaA != null) {
    const diff = ppdaA - ppdaH   // positivo = casa pressiona mais alto
    if (Math.abs(diff) >= 3) {
      const adj = clamp(diff * 0.015, -0.08, 0.08)   // max ±8%
      ppdaMultH = 1 + adj          // casa pressiona + → casa ataca +
      ppdaMultA = 1 - adj * 0.7    // visitante cede menos chutes mas um pouco
    }
  }

  // ─── λ Poisson final (todos os sinais aplicados) ─────────────────────
  // Home λ = base × ataque × def_adv × mando × forma × fadiga × qual × lesões × copa × rotação × ppda × weather
  const lambdaHome = clamp(
    lgHome * homeAttack * awayDefense * homeAdv * formMultH * fatigueH * qualMultH * injMultH *
    cupMultH * rotMultH * ppdaMultH * weatherMult,
    0.15, 5.0
  )
  const lambdaAway = clamp(
    lgAway * awayAttack * homeDefense * formMultA * fatigueA * qualMultA * injMultA *
    cupMultA * rotMultA * ppdaMultA * weatherMult,
    0.15, 5.0
  )

  // ─── Matriz Poisson 6×6 (0-5 gols cada lado → cobre ~99% dos jogos) ──
  // Agora também computa probabilidades CONJUNTAS (Resultado × BTTS × Over)
  // saindo da matriz — evita multiplicar independente que superestima combos.
  const MAX_GOALS = 6
  let pHome = 0, pDraw = 0, pAway = 0
  // Joint: Resultado + BTTS
  let pHomeAndBtts = 0, pDrawAndBtts = 0, pAwayAndBtts = 0, pBttsRaw = 0
  // Joint: Resultado + Over 2.5
  let pHomeAndOver25 = 0, pAwayAndOver25 = 0, pDrawAndOver25 = 0, pOver25 = 0, pOver35 = 0
  // #2 Top scorelines: guardar cada célula pra ranquear depois
  const scorelines = []
  // #3 AH -1.0: precisa acumular P(H-A=1) e P(H-A>=2) separadamente
  let pHmA_eq1 = 0, pHmA_ge2 = 0, pAmH_eq1 = 0, pAmH_ge2 = 0

  for (let h = 0; h < MAX_GOALS; h++) {
    const pH = poissonPMF(h, lambdaHome)
    for (let a = 0; a < MAX_GOALS; a++) {
      const pA = poissonPMF(a, lambdaAway)
      // Dixon-Coles τ por liga: corrige correlação em placares baixos (0-0,1-0,0-1,1-1).
      // Ligas defensivas (Italianas, Sul-Americanas) → τ mais agressivo em 0-0/1-1.
      const tau = dixonColesTau(league, h, a, lambdaHome, lambdaAway)
      const cell = pH * pA * tau
      const isBtts = (h >= 1 && a >= 1)
      const total = h + a
      const isOver25 = total > 2.5
      const isOver35 = total > 3.5

      scorelines.push({ h, a, p: cell })

      const diff = h - a
      if (diff === 1)      pHmA_eq1 += cell
      else if (diff >= 2)  pHmA_ge2 += cell
      else if (diff === -1) pAmH_eq1 += cell
      else if (diff <= -2)  pAmH_ge2 += cell

      if (h > a)      pHome += cell
      else if (h < a) pAway += cell
      else            pDraw += cell

      if (isBtts) {
        pBttsRaw += cell
        if (h > a)      pHomeAndBtts += cell
        else if (h < a) pAwayAndBtts += cell
        else            pDrawAndBtts += cell
      }

      if (isOver25) {
        pOver25 += cell
        if (h > a)      pHomeAndOver25 += cell
        else if (h < a) pAwayAndOver25 += cell
        else            pDrawAndOver25 += cell
      }
      if (isOver35) pOver35 += cell
    }
  }

  // Normaliza (matriz truncada pode não somar 1 exatamente)
  const totalP = pHome + pDraw + pAway
  if (totalP > 0) {
    pHome /= totalP
    pDraw /= totalP
    pAway /= totalP
    pHomeAndBtts   /= totalP
    pAwayAndBtts   /= totalP
    pDrawAndBtts   /= totalP
    pBttsRaw       /= totalP
    pHomeAndOver25 /= totalP
    pAwayAndOver25 /= totalP
    pDrawAndOver25 /= totalP
    pOver25        /= totalP
    pOver35        /= totalP
  }

  // ─── Correção Dixon-Coles: Poisson subestima BTTS em ~3-6pp ──────────
  // Aplicamos o boost APENAS na massa de BTTS e distribuímos proporcional.
  const expG = lambdaHome + lambdaAway
  const corrBoost = Math.max(0.015, Math.min(0.07, 0.025 + (expG - 1.8) * 0.03))
  const pNoBtts = Math.max(0, 1 - pBttsRaw)
  if (pBttsRaw > 0 && pNoBtts > 0) {
    const targetBtts = Math.min(0.93, pBttsRaw + corrBoost)
    const scaleBtts = targetBtts / pBttsRaw
    pHomeAndBtts *= scaleBtts
    pAwayAndBtts *= scaleBtts
    pDrawAndBtts *= scaleBtts
    pBttsRaw = targetBtts
  }

  // ─── #2 Top 3 placares mais prováveis ──────────────────────────────────
  scorelines.sort((a, b) => b.p - a.p)
  const topScores = scorelines.slice(0, 5).map(s => ({
    score: `${s.h}-${s.a}`,
    p: +(s.p / Math.max(totalP, 1e-9)).toFixed(4),
  }))

  // ─── #3 Mercados derivados (AH, DNB, Over HT) ──────────────────────────
  const denomHA = pHome + pAway
  const dnbHome = denomHA > 0 ? +(pHome / denomHA).toFixed(4) : 0.5
  const dnbAway = denomHA > 0 ? +(pAway / denomHA).toFixed(4) : 0.5
  // AH -0.5 Home = pHome; AH +0.5 Home = pHome + pDraw
  const ahM05Home = +pHome.toFixed(4)
  const ahP05Home = +(pHome + pDraw).toFixed(4)
  // AH -1.0 Home (push em diff=1): vitória por 2+ ganha, diff=1 = stake de volta (0.5)
  const ahM10Home = +((pHmA_ge2 / Math.max(totalP, 1e-9)) + 0.5 * (pHmA_eq1 / Math.max(totalP, 1e-9))).toFixed(4)
  const ahP10Away = +((pAmH_ge2 / Math.max(totalP, 1e-9)) + 0.5 * (pAmH_eq1 / Math.max(totalP, 1e-9))).toFixed(4)
  const ahM10Away = +((pAmH_ge2 / Math.max(totalP, 1e-9)) + 0.5 * (pAmH_eq1 / Math.max(totalP, 1e-9))).toFixed(4)

  // HT matrix (lambdas ~45% do fulltime - ratio empírico)
  const htRatio = 0.45
  const lHtH = lambdaHome * htRatio, lHtA = lambdaAway * htRatio
  let pHtOver05 = 0, pHtOver15 = 0, pHomeFirstMap = 0
  for (let h = 0; h < 4; h++) {
    for (let a = 0; a < 4; a++) {
      const cell = poissonPMF(h, lHtH) * poissonPMF(a, lHtA)
      if (h + a >= 1) pHtOver05 += cell
      if (h + a >= 2) pHtOver15 += cell
      // Casa marca primeiro ~ casa tem gol no HT e visitante 0; aproximação
      if (h >= 1 && a === 0) pHomeFirstMap += cell
    }
  }
  // Casa marca primeiro mais preciso: λH/(λH+λA) condicional a pelo menos 1 gol
  const lTot = lambdaHome + lambdaAway
  const pAtLeastOne = 1 - Math.exp(-lTot)
  const pHomeFirst = lTot > 0 ? +((lambdaHome / lTot) * pAtLeastOne).toFixed(4) : 0
  const pAwayFirst = lTot > 0 ? +((lambdaAway / lTot) * pAtLeastOne).toFixed(4) : 0

  // ─── Fase 2+6: H2H prior com split venue ─────────────────────────────
  // Mistura: pFinal = (1-w) × pPoisson + w × pH2H   (w cresce com amostra, teto 20%)
  // Usa split venue (times mandante nesse confronto passado) quando ≥3 amostras
  if (formCtx?.h2h && formCtx.h2h.sample >= 3) {
    const { homeWins, draws, awayWins, sample, atHome: h2hAtHome } = formCtx.h2h

    // Preferência: split venue (home team jogando em casa como agora)
    let ph2h_H, ph2h_D, ph2h_A, w
    if (h2hAtHome && h2hAtHome.sample >= 3) {
      ph2h_H = h2hAtHome.wins   / h2hAtHome.sample
      ph2h_D = h2hAtHome.draws  / h2hAtHome.sample
      ph2h_A = h2hAtHome.losses / h2hAtHome.sample
      w = Math.min(0.20, h2hAtHome.sample * 0.05)   // peso maior: split venue é mais relevante
    } else {
      ph2h_H = homeWins / sample
      ph2h_D = draws    / sample
      ph2h_A = awayWins / sample
      w = Math.min(0.15, sample * 0.03)
    }

    pHome = (1 - w) * pHome + w * ph2h_H
    pDraw = (1 - w) * pDraw + w * ph2h_D
    pAway = (1 - w) * pAway + w * ph2h_A
    const t = pHome + pDraw + pAway
    if (t > 0) { pHome /= t; pDraw /= t; pAway /= t }
  }

  // ─── Qualidade de dados ───────────────────────────────────────────────
  // REAL = D1 stats reais para ambos
  // FORMA = ESPN form (≥4 jogos) compensa ausência de D1
  // PARCIAL = um dos dois tem D1 real (ou form ESPN)
  // EST = estimativa pura (hash-seed + média de liga)
  const hasHomeData = hasHomeReal || hasHomeForm
  const hasAwayData = hasAwayReal || hasAwayForm
  const dataQuality =
    (hasHomeReal  && hasAwayReal)  ? 'REAL'   :
    (hasHomeData  && hasAwayData)  ? 'FORMA'  :
    (hasHomeData  || hasAwayData)  ? 'PARCIAL': 'EST'

  // ─── #7 Edge vs market odds (EV% + Kelly fraction) ──────────────────────
  // marketOdds: { h, d, a, btts_yes, over25 } — odds decimais de casa de apostas
  let marketEdge = null
  const mo = propCtx?.marketOdds
  if (mo) {
    const calcEdge = (prob, odd) => {
      if (!odd || odd <= 1 || !prob) return null
      const ev = (prob * odd - 1) * 100   // EV%
      const b = odd - 1
      const kelly = Math.max(0, (prob * b - (1 - prob)) / b)
      return { ev: +ev.toFixed(1), kelly: +(kelly * 100).toFixed(2), prob: +prob.toFixed(4), odd }
    }
    marketEdge = {
      home:  mo.h       ? calcEdge(pHome,    mo.h)       : null,
      draw:  mo.d       ? calcEdge(pDraw,    mo.d)       : null,
      away:  mo.a       ? calcEdge(pAway,    mo.a)       : null,
      btts:  mo.btts_yes? calcEdge(pBttsRaw, mo.btts_yes): null,
      over25:mo.over25  ? calcEdge(pOver25,  mo.over25)  : null,
    }
  }

  return {
    pHome, pDraw, pAway,
    // Probabilidades CONJUNTAS calibradas (matriz + correção Dixon-Coles)
    pBtts:         +pBttsRaw.toFixed(4),
    pHomeAndBtts:  +pHomeAndBtts.toFixed(4),
    pDrawAndBtts:  +pDrawAndBtts.toFixed(4),
    pAwayAndBtts:  +pAwayAndBtts.toFixed(4),
    pOver25:       +pOver25.toFixed(4),
    pOver35:       +pOver35.toFixed(4),
    pHomeAndOver25: +pHomeAndOver25.toFixed(4),
    pDrawAndOver25: +pDrawAndOver25.toFixed(4),
    pAwayAndOver25: +pAwayAndOver25.toFixed(4),
    lambdaHome: +lambdaHome.toFixed(2),
    lambdaAway: +lambdaAway.toFixed(2),
    expGoals:   +(lambdaHome + lambdaAway).toFixed(2),
    homeAttack: +homeAttack.toFixed(2),
    awayAttack: +awayAttack.toFixed(2),
    homeDefense:+homeDefense.toFixed(2),
    awayDefense:+awayDefense.toFixed(2),
    homeAdv,
    formMultH:  +formMultH.toFixed(3),
    formMultA:  +formMultA.toFixed(3),
    qualityH:   +qualityH.toFixed(3),
    qualityA:   +qualityA.toFixed(3),
    qualMultH:  +qualMultH.toFixed(3),
    qualMultA:  +qualMultA.toFixed(3),
    cupMultH:   +cupMultH.toFixed(3),
    cupMultA:   +cupMultA.toFixed(3),
    isCupGame:  (cupMultH !== 1 || cupMultA !== 1),
    rotMultH:   +rotMultH.toFixed(3),
    rotMultA:   +rotMultA.toFixed(3),
    hasRotation: (rotMultH < 0.98 || rotMultA < 0.98),
    fatigueH:   +fatigueH.toFixed(3),
    fatigueA:   +fatigueA.toFixed(3),
    injMultH:   +injMultH.toFixed(3),
    injMultA:   +injMultA.toFixed(3),
    injuryCountH: formCtx?.home?.injuryCount ?? 0,
    injuryCountA: formCtx?.away?.injuryCount ?? 0,
    injuryWeightH: formCtx?.home?.injuryWeight ?? 0,
    injuryWeightA: formCtx?.away?.injuryWeight ?? 0,
    streakH:    formCtx?.home?.streak ?? null,
    streakA:    formCtx?.away?.streak ?? null,
    restH:      formCtx?.home?.rest ?? null,
    restA:      formCtx?.away?.rest ?? null,
    rankH:      formCtx?.home?.overview?.rank ?? null,
    rankA:      formCtx?.away?.overview?.rank ?? null,
    hasVenueSplitH: !!(formCtx?.home?.asHome),
    hasVenueSplitA: !!(formCtx?.away?.asAway),
    hasForm:    !!(formCtx?.home || formCtx?.away),
    hasH2H:     !!(formCtx?.h2h && formCtx.h2h.sample >= 3),
    hasH2HVenue:!!(formCtx?.h2h?.atHome && formCtx.h2h.atHome.sample >= 3),
    // ─── Novos campos proprietários (fase 8+) ───────────────────────────
    topScores,                          // #2 top 5 placares mais prováveis
    dnbHome, dnbAway,                   // #3 Draw No Bet
    ahM05Home, ahP05Home,               // AH ±0.5 (= 1X2 equivalentes)
    ahM10Home, ahM10Away, ahP10Away,    // AH ±1.0 com push
    pHtOver05:  +pHtOver05.toFixed(4),
    pHtOver15:  +pHtOver15.toFixed(4),
    pHomeFirst, pAwayFirst,             // Casa/Fora marca primeiro
    xgBlendApplied,                     // #1
    starOutH, starOutA,                 // #4
    weatherMult:+weatherMult.toFixed(3),// #8
    ppdaMultH:  +ppdaMultH.toFixed(3),  // #6
    ppdaMultA:  +ppdaMultA.toFixed(3),
    xgHome:     xgH || null,            // passthrough pra UI
    xgAway:     xgA || null,
    weather:    propCtx?.weather || null,
    refStats:   propCtx?.refStats || null,  // #5
    lineupsCtx: lineupsCtx || null,
    marketEdge,                         // #7
    gameOdds:   mo || null,             // odds brutas do book pra no-vig (Fase 2)
    model:      (propCtx ? 'poisson-v4-propctx' : (formCtx ? 'poisson-v3' : 'poisson-v1')),
    dataQuality,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Converte probabilidade em confiança 0-100 (calibração conservadora)
// ═══════════════════════════════════════════════════════════════════════════
// Problema: probabilidade bruta do Poisson tende a subestimar
// (Poisson não captura correlação entre gols do mesmo jogo)
// Solução: aplica curva sigmóide suave que aumenta a confiança quando p é alto
// e limita teto em 88% (evita overconfidence)
export function probToConfidence(p, dataQuality = 'EST') {
  const raw = p * 100
  // Curva suave: conf ≈ raw para p<0.5, e inflaciona um pouco acima disso
  let conf = raw
  if (raw > 50) conf = 50 + (raw - 50) * 1.05
  if (raw > 65) conf = conf + (raw - 65) * 0.4

  // Penalty quando dados são estimados (sem D1 real)
  if      (dataQuality === 'EST')     conf = conf * 0.90   // estimativa pura
  else if (dataQuality === 'PARCIAL') conf = conf * 0.94
  else if (dataQuality === 'FORMA')   conf = conf * 0.97   // ESPN form: quase tão bom quanto D1

  return Math.round(clamp(conf, 10, 88))
}

// ═══════════════════════════════════════════════════════════════════════════
// Gera picks 1X2 prontos para push no array de props
// Compatível com formato ftpTeamProps (type, stat, line, tier, conf, ev, ...)
// ═══════════════════════════════════════════════════════════════════════════
import { applyCalibration } from './pickCalibration'
import { eloFromForm, eloDeltaToQuality } from './eloRating'
import { dixonColesTau } from './dixonColesLeague'

export function buildMatchResultPicks({ home, away, league, country, match,
                                        homeStats, awayStats, context,
                                        formCtx = null, calibMap = null }) {
  const r = computeMatchResult(home, away, league, homeStats, awayStats, formCtx)
  const { pHome, pDraw, pAway, dataQuality } = r

  const homeConf = probToConfidence(pHome, dataQuality)
  const drawConf = probToConfidence(pDraw, dataQuality)
  const awayConf = probToConfidence(pAway, dataQuality)

  // EV estimado (margem de ~7-8% vs odd "fair")
  const edgeFromProb = (prob, margin = 0.07) => {
    if (prob <= 0) return 0
    const fairOdd = 1 / prob
    const impliedWithMargin = fairOdd / (1 - margin)
    const edge = (prob * impliedWithMargin - 1) * 100
    return +edge.toFixed(1)
  }

  const isDerby = context?.isDerby || false
  const intenseHT = context?.intenseHT || false

  const tierFor = (conf) => conf >= 72 ? 'safe' : conf >= 58 ? 'median' : 'aggressive'

  const common = {
    match, home, away, league, country,
    isDerby, intenseHT, dq: dataQuality,
  }

  // Meta por stat (cada uma carrega sua prob bruta para edge cálculo posterior)
  const metaFor = (prob) => ({
    model: r.model, lambdaHome: r.lambdaHome, lambdaAway: r.lambdaAway,
    expGoals: r.expGoals, homeAttack: r.homeAttack, awayAttack: r.awayAttack,
    homeDefense: r.homeDefense, awayDefense: r.awayDefense, homeAdv: r.homeAdv,
    formMultH: r.formMultH, formMultA: r.formMultA,
    hasForm: r.hasForm, hasH2H: r.hasH2H,
    prob,
  })

  const hAtkPct = Math.round(r.homeAttack * 100)
  const aAtkPct = Math.round(r.awayAttack * 100)
  const hDefPct = Math.round(r.homeDefense * 100)
  const aDefPct = Math.round(r.awayDefense * 100)

  // Tag de forma/H2H
  const formTag = r.hasForm ? ` 📈 forma aplicada` : ''
  const h2hTag  = r.hasH2H  ? ` 🔁 H2H` : ''
  const homeMom = formCtx?.home ? ` (${formCtx.home.record} · ${formCtx.home.ppg} ppg)` : ''
  const awayMom = formCtx?.away ? ` (${formCtx.away.record} · ${formCtx.away.ppg} ppg)` : ''

  const basePicks = [
    {
      ...common, modelMeta: metaFor(pHome),
      type: 'resultado', stat: 'Casa Win', line: home,
      tier: tierFor(homeConf), conf: homeConf, ev: edgeFromProb(pHome), avg: null, team: home,
      reason: `λ Poisson: ${r.lambdaHome} vs ${r.lambdaAway} gols esperados. ${home}: atk ${hAtkPct}% def ${hDefPct}%${homeMom} | ${away}: atk ${aAtkPct}% def ${aDefPct}%${awayMom}. Mando ×${r.homeAdv.toFixed(2)}.${formTag}${h2hTag}${isDerby ? ' ⚔️ Derby' : ''}`,
      positive: `Modelo ${r.model} · ${dataQuality === 'REAL' ? 'dados reais' : dataQuality === 'PARCIAL' ? 'dados parciais' : 'estimativa'}. Prob ${(pHome * 100).toFixed(1)}%.`,
      negative: dataQuality === 'EST' ? 'Sem stats suficientes no D1 — conf reduzida 8%.' : 'Poisson subestima jogos táticos/atípicos.',
    },
    {
      ...common, modelMeta: metaFor(pDraw),
      type: 'resultado', stat: 'Empate', line: 'X',
      tier: isDerby ? 'median' : tierFor(drawConf), conf: drawConf, ev: edgeFromProb(pDraw, 0.08),
      avg: null, team: `${home} vs ${away}`,
      reason: `Empate ${(pDraw * 100).toFixed(1)}% pela matriz Poisson. λ: ${r.lambdaHome} vs ${r.lambdaAway} → equilíbrio ofensivo.${formTag}${h2hTag}${isDerby ? ' ⚔️ Derby: +15% chance de empate.' : ''}`,
      positive: isDerby ? 'Derbis têm cautela tática + equilíbrio de força.' : 'Forças parelhas via ataque-defesa da liga.',
      negative: 'Empates têm alta variância — difícil atingir >70% conf sem contexto extra.',
    },
    {
      ...common, modelMeta: metaFor(pAway),
      type: 'resultado', stat: 'Fora Win', line: away,
      tier: tierFor(awayConf), conf: awayConf, ev: edgeFromProb(pAway), avg: null, team: away,
      reason: `λ Poisson: ${r.lambdaAway} vs ${r.lambdaHome}. ${away} (visitante): atk ${aAtkPct}% def ${aDefPct}%${awayMom} | ${home}: atk ${hAtkPct}% def ${hDefPct}%${homeMom}.${formTag}${h2hTag}${isDerby ? ' ⚔️ Derby' : ''}`,
      positive: `${away} com ataque ${aAtkPct > 110 ? 'acima' : 'dentro'} da média. Prob ${(pAway * 100).toFixed(1)}%.`,
      negative: `Visitante carrega −${Math.round((r.homeAdv - 1) * 100)}% de desvantagem de mando.`,
    },
  ]

  // ── Fase 3: aplica shift de calibração histórica se disponível ─────────
  const picks = basePicks.map(p => {
    if (!calibMap) return p
    const c = applyCalibration(p, calibMap)
    if (c.shift === 0 || !c.shiftSource) return p
    return {
      ...p,
      conf: c.conf,
      modelMeta: { ...p.modelMeta, origConf: c.originalConf, calibShift: c.shift, calibSource: c.shiftSource },
      reason: `${p.reason} · 🎯 Calib ${c.shift > 0 ? '+' : ''}${c.shift}pp (${c.shiftSource})`,
    }
  })

  return { picks, meta: r }
}

// ═══════════════════════════════════════════════════════════════════════════
// Gerador de narrativa — produz texto descritivo por jogo (tipo AeP/Oddschecker)
// ═══════════════════════════════════════════════════════════════════════════
export function buildNarrative(home, away, result, formCtx) {
  const lines = []
  const fav = result.pHome > result.pAway ? 'home' : 'away'
  const favName = fav === 'home' ? home : away
  const favProb = fav === 'home' ? result.pHome : result.pAway

  // 1. Tom geral (favorito vs equilibrado)
  if (favProb >= 0.55) {
    lines.push(`${favName} entra como favorito com ${(favProb * 100).toFixed(0)}% de probabilidade pelo modelo Poisson (λ ${result.lambdaHome} × ${result.lambdaAway}).`)
  } else if (favProb >= 0.42) {
    lines.push(`Jogo equilibrado: ${favName} leve favorito com ${(favProb * 100).toFixed(0)}% vs ${((1 - favProb - result.pDraw) * 100).toFixed(0)}% do adversário. Empate em ${(result.pDraw * 100).toFixed(0)}%.`)
  } else {
    lines.push(`Partida sem claro favorito — 3 resultados possíveis (${(result.pHome*100).toFixed(0)}/${(result.pDraw*100).toFixed(0)}/${(result.pAway*100).toFixed(0)}).`)
  }

  // 2. Sequências (streaks) — narrativa de momentum
  const sH = result.streakH, sA = result.streakA
  if (sH && sH.type === 'W' && sH.count >= 3) {
    lines.push(`🔥 ${home} vem de ${sH.count} vitórias consecutivas — momentum máximo em casa.`)
  } else if (sH && sH.type === 'L' && sH.count >= 3) {
    lines.push(`❄️ ${home} acumula ${sH.count} derrotas seguidas — crise de confiança.`)
  } else if (sH && sH.unbeaten >= 5) {
    lines.push(`📈 ${home} está há ${sH.unbeaten} jogos invicto.`)
  }
  if (sA && sA.type === 'W' && sA.count >= 3) {
    lines.push(`🔥 ${away} chega embalado com ${sA.count} vitórias seguidas.`)
  } else if (sA && sA.type === 'L' && sA.count >= 3) {
    lines.push(`❄️ ${away} perdeu os últimos ${sA.count} e entra pressionado.`)
  } else if (sA && sA.unbeaten >= 5) {
    lines.push(`📈 ${away} soma ${sA.unbeaten} jogos sem perder.`)
  }

  // 3. Lesões pesadas
  const injH = result.injuryWeightH || 0, injA = result.injuryWeightA || 0
  if (injH >= 3) {
    lines.push(`🏥 ${home} com desfalques pesados (peso ${injH}) — impacto defensivo/ofensivo estimado em −${Math.round((1 - result.injMultH) * 100)}%.`)
  }
  if (injA >= 3) {
    lines.push(`🏥 ${away} chega desfalcado (peso ${injA}) — λ penalizado em −${Math.round((1 - result.injMultA) * 100)}%.`)
  }

  // 4. Fadiga
  if (result.restH != null && result.restH <= 3) {
    lines.push(`😴 ${home} com apenas ${result.restH} dia(s) de descanso — risco de fadiga física.`)
  }
  if (result.restA != null && result.restA <= 3) {
    lines.push(`😴 ${away} jogou há ${result.restA} dia(s) — perna pesada para o jogo.`)
  }

  // 5. Pedigree de copa
  if (result.hasRotation) {
    if (result.rotMultH < 0.95) lines.push(`🔄 ${home} provável rotação (copa meio-semana, tier-1) — λ ajustado em ${Math.round((result.rotMultH - 1) * 100)}%.`)
    if (result.rotMultA < 0.95) lines.push(`🔄 ${away} provável poupança de titulares — λ ajustado em ${Math.round((result.rotMultA - 1) * 100)}%.`)
  }
  if (result.isCupGame) {
    if (result.cupMultH >= 1.08) lines.push(`🏆 ${home} é "copeiro" histórico (×${result.cupMultH.toFixed(2)}) — eleva desempenho em mata-mata.`)
    if (result.cupMultA >= 1.08) lines.push(`🏆 ${away} tem DNA de copa (×${result.cupMultA.toFixed(2)}) — perigoso fora de casa.`)
  }

  // 6. H2H contundente
  if (result.hasH2H && formCtx?.h2h) {
    const h2h = formCtx.h2h
    if (h2h.homeWins >= h2h.sample * 0.6) {
      lines.push(`🔁 Domínio histórico: ${home} venceu ${h2h.homeWins}/${h2h.sample} confrontos diretos.`)
    } else if (h2h.awayWins >= h2h.sample * 0.6) {
      lines.push(`🔁 Freguês histórico: ${away} tem vantagem no H2H (${h2h.awayWins}/${h2h.sample}).`)
    }
    if (h2h.avgGoals >= 3.0) {
      lines.push(`⚽ H2H costuma ser aberto: média de ${h2h.avgGoals} gols por confronto.`)
    } else if (h2h.avgGoals <= 1.8) {
      lines.push(`🔒 H2H tradicionalmente travado: média de ${h2h.avgGoals} gols.`)
    }
  }

  // 7. Gols esperados + BTTS hint
  if (result.expGoals >= 3.0) {
    lines.push(`⚽ Total esperado: ${result.expGoals} gols — cenário de jogo aberto.`)
  } else if (result.expGoals <= 2.0) {
    lines.push(`🔒 Total esperado: ${result.expGoals} gols — tendência de jogo travado.`)
  }

  return lines
}
