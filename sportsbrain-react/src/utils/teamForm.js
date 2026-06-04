// ═══════════════════════════════════════════════════════════════════════════
// Fase 2 + 6 — Forma Recente com split casa/fora, descanso, variância, H2H
// ═══════════════════════════════════════════════════════════════════════════
// Usa o wrapper ESPN (fetchTeamForm retorna { result, opponent, score, date, isHome }).
// Extrai do histórico dos últimos N jogos:
//   · overall — ppg, gfpg, gapg, momentum, variance, sample
//   · asHome  — quando jogou em casa: mesmos campos
//   · asAway  — quando jogou fora: mesmos campos
//   · rest    — dias desde o último jogo (fatiga)
//   · quality — índice derivado de saldo de gols + ppg
//
// H2H:
//   · splits por mando no histórico de confrontos diretos
//   · taxas de BTTS, O2.5, avgGoals
// ═══════════════════════════════════════════════════════════════════════════

import { fetchTeamForm, fetchH2H, fetchTeamInjuries, fetchTeamOverview } from './espn'

const FORM_CACHE_KEY = 'sb_form_ctx_v7'   // bump: streak + weighted injuries + rotation
const FORM_CACHE_TTL = 6 * 60 * 60 * 1000 // 6h
const memCache = new Map()

function cacheGet(key) {
  const hit = memCache.get(key)
  if (hit && Date.now() - hit.ts < FORM_CACHE_TTL) return hit.data
  try {
    const raw = sessionStorage.getItem(`${FORM_CACHE_KEY}:${key}`)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (o?.ts && Date.now() - o.ts < FORM_CACHE_TTL) {
      memCache.set(key, o)
      return o.data
    }
  } catch {}
  return null
}

function cacheSet(key, data) {
  const o = { ts: Date.now(), data }
  memCache.set(key, o)
  try { sessionStorage.setItem(`${FORM_CACHE_KEY}:${key}`, JSON.stringify(o)) } catch {}
}

// ── Detecta sequência atual (streak) do time ─────────────────────────────
// Retorna { type: 'W'|'D'|'L'|'U', count } - U = unbeaten (W+D), B = bad (L+D)
function computeStreak(games) {
  if (!games || !games.length) return null
  // Jogos vêm em ordem crescente por data — o último é o mais recente
  const last = games[games.length - 1].result
  let count = 1
  for (let i = games.length - 2; i >= 0; i--) {
    if (games[i].result === last) count++
    else break
  }
  // Sequência invicta (W ou D consecutivos)
  let unbeaten = 0
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i].result === 'W' || games[i].result === 'D') unbeaten++
    else break
  }
  // Sequência sem vencer (D ou L)
  let winless = 0
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i].result === 'D' || games[i].result === 'L') winless++
    else break
  }
  return { type: last, count, unbeaten, winless }
}

// ── Peso de lesões por gravidade (titulares pesam mais) ──────────────────
// Heurística: status do ESPN indica "Out", "Doubtful", "Day-To-Day", "Questionable"
// + posição (GK/DF/MF/FW ganha mais peso que reservas sem posição)
function weightInjuries(injuries) {
  if (!injuries || !injuries.length) return 0
  let total = 0
  for (const inj of injuries) {
    const status = (inj.status || '').toLowerCase()
    let w
    if (status.includes('out') || status.includes('suspended') || status.includes('red'))       w = 1.0
    else if (status.includes('doubt'))                                                           w = 0.6
    else if (status.includes('day') || status.includes('question'))                              w = 0.35
    else w = 0.5
    // Posição definida → provavelmente titular/relevante (×1.2)
    if (inj.position && inj.position.length > 0) w *= 1.15
    total += w
  }
  return +total.toFixed(2)
}

// ── Agrega uma lista de jogos em métricas ────────────────────────────────
function aggregateGames(games) {
  if (!games || !games.length) return null
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0
  const goalsFor = [], goalsAgainst = []
  games.forEach(g => {
    if (g.result === 'W') wins++
    else if (g.result === 'D') draws++
    else losses++
    const [a, b] = (g.score || '0-0').split('-').map(Number)
    const gfVal = a || 0, gaVal = b || 0
    gf += gfVal; ga += gaVal
    goalsFor.push(gfVal); goalsAgainst.push(gaVal)
  })
  const n = games.length
  const ppg  = (wins * 3 + draws) / n

  // Variância dos gols marcados (quanto mais consistente, menor)
  const meanGf = gf / n
  const varGf = goalsFor.reduce((s, x) => s + (x - meanGf) ** 2, 0) / n
  const stdGf = Math.sqrt(varGf)

  const streak = computeStreak(games)

  return {
    ppg:       +ppg.toFixed(2),
    gfpg:      +(gf / n).toFixed(2),
    gapg:      +(ga / n).toFixed(2),
    gd:        +((gf - ga) / n).toFixed(2),   // saldo por jogo
    momentum:  +Math.min(1, Math.max(0, ppg / 3)).toFixed(3),
    stdGf:     +stdGf.toFixed(2),              // variância ofensiva
    sample:    n,
    record:    `${wins}W ${draws}D ${losses}L`,
    wins, draws, losses,
    streak,                                   // { type, count, unbeaten, winless }
  }
}

// ── Dias desde o jogo mais recente (fatiga) ──────────────────────────────
function daysSinceLast(games) {
  if (!games || !games.length) return null
  // Games vêm ordenados por data crescente; pega a última
  const lastGame = games[games.length - 1]
  if (!lastGame?.date) return null
  const lastDate = new Date(lastGame.date)
  if (isNaN(lastDate.getTime())) return null
  const diffMs = Date.now() - lastDate.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

// ── Índice de qualidade: combina ppg + saldo ─────────────────────────────
// Escala [0, 1]: 0 = péssimo, 0.5 = mediano, 1 = excelente
function qualityIndex(overall) {
  if (!overall) return 0.5
  // ppg (0-3) normalizado + bonus/penalidade pelo saldo (cap ±1.5)
  const ppgScore = overall.ppg / 3
  const gdScore  = 0.5 + Math.max(-1.5, Math.min(1.5, overall.gd)) / 3
  // Penaliza times inconsistentes (stdGf muito alto = instável)
  const varPenalty = Math.min(0.15, (overall.stdGf || 0) * 0.03)
  return +Math.max(0, Math.min(1, (ppgScore * 0.6 + gdScore * 0.4) - varPenalty)).toFixed(3)
}

// ── Agrega forma completa: overall + splits por mando + rest + quality ───
function aggregateForm(games) {
  if (!games || !games.length) return null

  const overall = aggregateGames(games)
  const homeGames = games.filter(g => g.isHome === true)
  const awayGames = games.filter(g => g.isHome === false)

  const asHome = homeGames.length >= 2 ? aggregateGames(homeGames) : null
  const asAway = awayGames.length >= 2 ? aggregateGames(awayGames) : null
  const rest   = daysSinceLast(games)
  const quality = qualityIndex(overall)

  return {
    ...overall,
    asHome, asAway, rest, quality,
  }
}

// ─── H2H com splits ──────────────────────────────────────────────────────
function aggregateH2H(encounters, homeName) {
  if (!encounters || !encounters.length) return null
  const hNorm = (homeName || '').toLowerCase()
  let homeWins = 0, draws = 0, awayWins = 0, hDiff = 0
  let bttsCount = 0, over25Count = 0, totalGoals = 0

  // Splits por venue (quando o time "home" do jogo atual jogou em casa em H2H vs fora)
  let hAtHomeWins = 0, hAtHomeDraws = 0, hAtHomeLosses = 0, hAtHomeSample = 0
  let hAsAwayWins = 0, hAsAwayDraws = 0, hAsAwayLosses = 0, hAsAwaySample = 0

  encounters.forEach(e => {
    const [a, b] = (e.score || '0-0').split('-').map(Number)
    const w = (e.winner || '').toLowerCase()
    const hWon = !w.includes('empate') && w.includes(hNorm.split(' ')[0])
    const aWon = !w.includes('empate') && !hWon

    if (w === 'empate') draws++
    else if (hWon) homeWins++
    else awayWins++
    hDiff += (a - b)
    if (a >= 1 && b >= 1) bttsCount++
    if ((a + b) >= 3)    over25Count++
    totalGoals += (a + b)

    // Split venue: homeId vindo da API indica quem era mandante naquele confronto
    if (e.homeId && e.teamAId && e.homeId === e.teamAId) {
      // home-team atual foi mandante nesse confronto passado
      hAtHomeSample++
      if (hWon) hAtHomeWins++; else if (w === 'empate') hAtHomeDraws++; else hAtHomeLosses++
    } else if (e.homeId) {
      // home-team atual foi visitante nesse confronto passado
      hAsAwaySample++
      if (hWon) hAsAwayWins++; else if (w === 'empate') hAsAwayDraws++; else hAsAwayLosses++
    }
  })
  const n = encounters.length
  return {
    homeWins, draws, awayWins,
    sample: n,
    homeShare: +((homeWins + draws * 0.5) / n).toFixed(3),
    homeGoalDiff: +(hDiff / n).toFixed(2),
    bttsRate:   +(bttsCount  / n).toFixed(3),
    over25Rate: +(over25Count / n).toFixed(3),
    avgGoals:   +(totalGoals  / n).toFixed(2),
    atHome: hAtHomeSample >= 2 ? {
      wins: hAtHomeWins, draws: hAtHomeDraws, losses: hAtHomeLosses, sample: hAtHomeSample,
      winRate: +(hAtHomeWins / hAtHomeSample).toFixed(3),
    } : null,
    asAway: hAsAwaySample >= 2 ? {
      wins: hAsAwayWins, draws: hAsAwayDraws, losses: hAsAwayLosses, sample: hAsAwaySample,
      winRate: +(hAsAwayWins / hAsAwaySample).toFixed(3),
    } : null,
  }
}

// ─── Fetch unificado (com cache) ─────────────────────────────────────────
export async function buildFormContext(home, away, league) {
  const key = `${home}|${away}|${league || ''}`.toLowerCase()
  const cached = cacheGet(key)
  if (cached) return cached

  const [homeForm, awayForm, h2h, homeInj, awayInj, homeOv, awayOv] = await Promise.allSettled([
    fetchTeamForm(home, league, 10),
    fetchTeamForm(away, league, 10),
    fetchH2H(home, away, league),
    fetchTeamInjuries(home, league),
    fetchTeamInjuries(away, league),
    fetchTeamOverview(home, league),
    fetchTeamOverview(away, league),
  ])

  const homeBase = homeForm.status === 'fulfilled' ? aggregateForm(homeForm.value) : null
  const awayBase = awayForm.status === 'fulfilled' ? aggregateForm(awayForm.value) : null

  // Injeta dados extras nos objetos home/away (lesões + overview)
  if (homeBase) {
    homeBase.injuries  = homeInj.status === 'fulfilled' ? (homeInj.value?.injuries || []) : []
    homeBase.overview  = homeOv.status  === 'fulfilled' ? homeOv.value : null
    homeBase.injuryCount = homeBase.injuries.length
    homeBase.injuryWeight = weightInjuries(homeBase.injuries)
  }
  if (awayBase) {
    awayBase.injuries  = awayInj.status === 'fulfilled' ? (awayInj.value?.injuries || []) : []
    awayBase.overview  = awayOv.status  === 'fulfilled' ? awayOv.value : null
    awayBase.injuryCount = awayBase.injuries.length
    awayBase.injuryWeight = weightInjuries(awayBase.injuries)
  }

  // Quality recomputada com overview (rank melhora ranking)
  if (homeBase) homeBase.quality = refineQuality(homeBase)
  if (awayBase) awayBase.quality = refineQuality(awayBase)

  const ctx = {
    home: homeBase,
    away: awayBase,
    h2h:  h2h.status === 'fulfilled' ? aggregateH2H(h2h.value, home) : null,
  }
  cacheSet(key, ctx)
  return ctx
}

// ── Refina quality com overview (rank + histórico de temporada) ─────────
function refineQuality(teamData) {
  const base = teamData.quality || 0.5
  const ov   = teamData.overview
  if (!ov || !ov.played || ov.played < 3) return base

  // Bonus/penalty pelo desempenho geral da temporada
  const wRate = ov.wins / ov.played               // 0-1
  const gdRate = ov.gf && ov.ga ? (ov.gf - ov.ga) / ov.played : 0

  // Penalidade por lesões (cada lesão relevante = -1% no quality)
  const injPenalty = Math.min(0.12, (teamData.injuryCount || 0) * 0.01)

  // Mistura 50% forma recente + 30% temporada + 20% bonus saldo
  const seasonScore = wRate * 0.7 + (0.5 + Math.min(1, Math.max(-1, gdRate)) / 2) * 0.3
  const refined = 0.5 * base + 0.3 * seasonScore + 0.2 * Math.min(1, Math.max(0, 0.5 + gdRate * 0.3))
  return +Math.max(0, Math.min(1, refined - injPenalty)).toFixed(3)
}

// ─── Multiplicadores aplicáveis em λ ─────────────────────────────────────
export function formMultipliers(formCtx) {
  const base = { home: 1, away: 1 }
  if (!formCtx) return base
  if (formCtx.home?.momentum != null) {
    base.home = 1 + (formCtx.home.momentum - 0.5) * 0.25
  }
  if (formCtx.away?.momentum != null) {
    base.away = 1 + (formCtx.away.momentum - 0.5) * 0.25
  }
  base.home = Math.max(0.75, Math.min(1.25, base.home))
  base.away = Math.max(0.75, Math.min(1.25, base.away))
  return base
}

export function h2hPrior(formCtx) {
  if (!formCtx?.h2h || formCtx.h2h.sample < 3) return null
  const { homeWins, draws, awayWins, sample } = formCtx.h2h
  return {
    pHome: homeWins / sample,
    pDraw: draws   / sample,
    pAway: awayWins/ sample,
    weight: Math.min(0.15, sample * 0.03),
  }
}
