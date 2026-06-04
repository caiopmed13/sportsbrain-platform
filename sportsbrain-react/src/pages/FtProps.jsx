import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { PickTierBadge, ConfBar, EdgeBadge, StakeBadge, KellyBadge } from '../components/ui/PickBadges'
import { usePerfStore } from '../store'
import { fetchMatches, fetchTeamStats } from '../api/client'
import { makePickId, autoSavePicks, updateHistResult, serverSyncHistory, calcHistStats, HistoricoView } from '../utils/pickHistory'
import { callClaude, mdToHtml, getClaudeKey, saveClaudeKey } from '../utils/ai'
import { matchPriority, fetchFeaturedMatches } from '../utils/featured'
import { buildMatchResultPicks } from '../utils/matchResultModel'
import { buildFormContext } from '../utils/teamForm'
import { fetchAllOdds, matchOddsForGame, enrichPickWithOdds } from '../utils/oddsEdge'
import { rebuildCalibrationCache, loadCalibrationCache, fetchServerCalibration, mergeCalibrationMaps } from '../utils/pickCalibration'

function today() { return new Date().toISOString().split('T')[0] }

const FT_HIST_KEY = 'sb_ftprops_history'

// ─── Contexto por liga (taxas médias + cartões) ──────────────────────────────
// cardRate = amarelos por jogo (total); cardHome/Away = split por mando
// Fonte: Pinnacle Research, Football-Data.co.uk, FBref 2024-25
// htShotFactor  = proporção de chutes FT que ocorrem no 1T (Opta/FBref 2023-25)
// htCornerFactor = proporção de escanteios FT que ocorrem no 1T (idem)
// Mandante tende a ter fator levemente maior (mais agressivo no 1T); visitante -0.02 na aplicação
const FTP_COMP_CONTEXT = {
  'premier league':    { cornerRate:10.2, shotsRate:12.8, sotRate:4.1, intenseHT:true,  htGoalRate:1.28, htO05Rate:68, cardRate:3.8, cardHome:1.65, cardAway:2.15, htShotFactor:0.47, htCornerFactor:0.46 },
  'la liga':           { cornerRate:9.1,  shotsRate:11.6, sotRate:3.8, intenseHT:false, htGoalRate:1.18, htO05Rate:63, cardRate:5.2, cardHome:2.25, cardAway:2.95, htShotFactor:0.43, htCornerFactor:0.44 },
  'serie a':           { cornerRate:9.8,  shotsRate:10.9, sotRate:3.5, intenseHT:false, htGoalRate:1.08, htO05Rate:59, cardRate:4.6, cardHome:2.00, cardAway:2.60, htShotFactor:0.42, htCornerFactor:0.43 },
  'bundesliga':        { cornerRate:10.5, shotsRate:13.2, sotRate:4.3, intenseHT:true,  htGoalRate:1.42, htO05Rate:72, cardRate:3.2, cardHome:1.40, cardAway:1.80, htShotFactor:0.49, htCornerFactor:0.47 },
  'ligue 1':           { cornerRate:9.3,  shotsRate:11.1, sotRate:3.6, intenseHT:false, htGoalRate:1.14, htO05Rate:61, cardRate:4.1, cardHome:1.80, cardAway:2.30, htShotFactor:0.44, htCornerFactor:0.44 },
  'champions league':  { cornerRate:10.8, shotsRate:13.5, sotRate:4.5, intenseHT:true,  htGoalRate:1.35, htO05Rate:70, cardRate:3.5, cardHome:1.50, cardAway:2.00, htShotFactor:0.46, htCornerFactor:0.45 },
  'europa league':     { cornerRate:9.6,  shotsRate:12.0, sotRate:3.9, intenseHT:false, htGoalRate:1.22, htO05Rate:65, cardRate:3.7, cardHome:1.60, cardAway:2.10, htShotFactor:0.44, htCornerFactor:0.44 },
  'brasileirao':       { cornerRate:10.2, shotsRate:12.5, sotRate:4.12, intenseHT:false, htGoalRate:1.10, htO05Rate:60, cardRate:5.8, cardHome:2.50, cardAway:3.30, htShotFactor:0.43, htCornerFactor:0.44 },
  'serie b':           { cornerRate:8.0,  shotsRate:9.8,  sotRate:3.1, intenseHT:false, htGoalRate:0.96, htO05Rate:54, cardRate:5.5, cardHome:2.40, cardAway:3.10, htShotFactor:0.41, htCornerFactor:0.42 },
  'eredivisie':        { cornerRate:9.8,  shotsRate:13.0, sotRate:4.2, intenseHT:true,  htGoalRate:1.38, htO05Rate:71, cardRate:3.6, cardHome:1.55, cardAway:2.05, htShotFactor:0.47, htCornerFactor:0.46 },
  'primeira liga':     { cornerRate:9.2,  shotsRate:11.3, sotRate:3.7, intenseHT:false, htGoalRate:1.12, htO05Rate:60, cardRate:4.8, cardHome:2.10, cardAway:2.70, htShotFactor:0.44, htCornerFactor:0.44 },
  'liga portugal':     { cornerRate:9.2,  shotsRate:11.3, sotRate:3.7, intenseHT:false, htGoalRate:1.12, htO05Rate:60, cardRate:4.8, cardHome:2.10, cardAway:2.70, htShotFactor:0.44, htCornerFactor:0.44 },
  'championship':      { cornerRate:9.8,  shotsRate:12.0, sotRate:3.8, intenseHT:false, htGoalRate:1.18, htO05Rate:63, cardRate:4.2, cardHome:1.85, cardAway:2.35, htShotFactor:0.45, htCornerFactor:0.45 },
  '2. bundesliga':     { cornerRate:9.5,  shotsRate:12.0, sotRate:3.9, intenseHT:false, htGoalRate:1.25, htO05Rate:66, cardRate:3.8, cardHome:1.65, cardAway:2.15, htShotFactor:0.46, htCornerFactor:0.45 },
  'mls':               { cornerRate:9.0,  shotsRate:11.2, sotRate:3.6, intenseHT:false, htGoalRate:1.16, htO05Rate:62, cardRate:4.0, cardHome:1.75, cardAway:2.25, htShotFactor:0.44, htCornerFactor:0.44 },
  'copa libertadores': { cornerRate:9.0,  shotsRate:10.5, sotRate:3.4, intenseHT:false, htGoalRate:1.05, htO05Rate:58, cardRate:5.2, cardHome:2.25, cardAway:2.95, htShotFactor:0.42, htCornerFactor:0.43 },
  'copa do brasil':    { cornerRate:8.6,  shotsRate:10.3, sotRate:3.3, intenseHT:false, htGoalRate:1.02, htO05Rate:57, cardRate:5.0, cardHome:2.20, cardAway:2.80, htShotFactor:0.42, htCornerFactor:0.43 },
  'copa america':      { cornerRate:8.5,  shotsRate:10.0, sotRate:3.2, intenseHT:false, htGoalRate:0.98, htO05Rate:55, cardRate:4.5, cardHome:1.95, cardAway:2.55, htShotFactor:0.43, htCornerFactor:0.43 },
  'conference league': { cornerRate:9.4,  shotsRate:11.8, sotRate:3.8, intenseHT:false, htGoalRate:1.18, htO05Rate:63, cardRate:3.8, cardHome:1.65, cardAway:2.15, htShotFactor:0.44, htCornerFactor:0.44 },
  'default':           { cornerRate:9.5,  shotsRate:11.5, sotRate:3.7, intenseHT:false, htGoalRate:1.15, htO05Rate:62, cardRate:4.2, cardHome:1.85, cardAway:2.35, htShotFactor:0.44, htCornerFactor:0.44 },
}

// ─── Utilitários ─────────────────────────────────────────────────────────────
function ftpClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function ftpNorm(s) {
  return (s||'').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/[ñ]/g,'n').replace(/[ç]/g,'c')
}

function ftpCompCtx(league) {
  if (!league) return FTP_COMP_CONTEXT['default']
  const lg = ftpNorm(league)
  for (const k of Object.keys(FTP_COMP_CONTEXT)) {
    if (k !== 'default' && lg.includes(ftpNorm(k))) return FTP_COMP_CONTEXT[k]
  }
  return FTP_COMP_CONTEXT['default']
}

// Seed determinístico por nome de time (mesmo time → mesmo valor sempre)
function ftpTeamNameSeed(name, scale = 1.0) {
  const n = (name||'').toLowerCase().replace(/[^a-z0-9]/g,'')
  let h = 5381
  for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0
  const norm = (h % 1000) / 999.0 // 0→1
  return (norm * 2 - 1) * scale   // -scale→+scale
}

// Seed de ATAQUE (ofensividade do time) — separado do seed geral
function ftpTeamAttackSeed(name, scale = 1.0) {
  const n = (name||'').toLowerCase().replace(/[^a-z0-9]/g,'') + 'atk'
  let h = 5381
  for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0
  return ((h % 1000) / 999.0 * 2 - 1) * scale
}

// Seed de DEFESA (qualidade defensiva do time) — reduz chutes/gols do adversário
function ftpTeamDefSeed(name, scale = 1.0) {
  const n = (name||'').toLowerCase().replace(/[^a-z0-9]/g,'') + 'def'
  let h = 5381
  for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0
  return ((h % 1000) / 999.0 * 2 - 1) * scale
}

// Seed de 1T (tendência do time a ser "fast starter" ou "slow starter")
// Fast starters (+) pressionam mais no 1T → mais chutes/escanteios no 1T vs FT ratio
// Slow starters (-) crescem ao longo do jogo → menor proporção no 1T
function ftpTeamHTSeed(name, scale = 1.0) {
  const n = (name||'').toLowerCase().replace(/[^a-z0-9]/g,'') + 'ht1'
  let h = 5381
  for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0
  return ((h % 1000) / 999.0 * 2 - 1) * scale
}

// Seed de AGRESSIVIDADE (tendência a cartões — físico, provocativo)
function ftpTeamAggrSeed(name, scale = 1.0) {
  const n = (name||'').toLowerCase().replace(/[^a-z0-9]/g,'') + 'aggr'
  let h = 5381
  for (let i = 0; i < n.length; i++) h = (((h << 5) + h) + n.charCodeAt(i)) >>> 0
  return ((h % 1000) / 999.0 * 2 - 1) * scale
}

// ─── Estimativa de cartões (multi-variável) ───────────────────────────────────
// Variáveis: taxa da liga (cardHome/cardAway) + agressividade do time + derby +30%
// Fonte de referência: derbis têm +30% cartões vs média histórica da liga
function ftpEstimateCards(hn, an, league) {
  const ctx       = ftpCompCtx(league)
  const isDerby   = ftpIsDerby(hn, an)
  const derbyMult = isDerby ? 1.30 : 1.0

  const hCards = ftpClamp(
    ctx.cardHome * (1 + ftpTeamAggrSeed(hn, 0.22)) * derbyMult, 0.5, 5.5
  )
  const aCards = ftpClamp(
    ctx.cardAway * (1 + ftpTeamAggrSeed(an, 0.22)) * derbyMult, 0.8, 6.5
  )
  return {
    home: +hCards.toFixed(1), away: +aCards.toFixed(1),
    total: +(hCards + aCards).toFixed(1),
    isDerby, leagueBase: ctx.cardRate,
  }
}

// ─── Detecção de derbis / rivalidades regionais ───────────────────────────────
// Times do mesmo grupo → derby detectado → mais intensidade, escanteios, gols
const FTP_DERBY_GROUPS = [
  ['manchester city','manchester united'],
  ['arsenal','chelsea','tottenham','west ham','crystal palace','fulham','brentford'],
  ['real madrid','atletico madrid','getafe','rayo vallecano'],
  ['barcelona','espanyol','girona'],
  ['inter','milan','ac milan','atalanta'],
  ['juventus','torino'],
  ['roma','lazio'],
  ['ajax','feyenoord','psv','az'],
  ['flamengo','vasco','fluminense','botafogo'],
  ['palmeiras','corinthians','são paulo','santos','sport','atletico'],
  ['porto','benfica','sporting','braga'],
  ['celtic','rangers','hearts','hibernian'],
  ['river plate','boca juniors','racing','independiente','san lorenzo'],
  ['dortmund','schalke','koln','leverkusen','gladbach'],
  ['marseille','nice','monaco'],
  ['paris saint-germain','lille','lens','reims'],
  ['sevilla','betis','atletico mineiro'],
  ['napoli','lazio','roma'],
]

function ftpIsDerby(hn, an) {
  const h2 = ftpNorm(hn), a2 = ftpNorm(an)
  return FTP_DERBY_GROUPS.some(g =>
    g.some(t => h2.includes(ftpNorm(t))) &&
    g.some(t => a2.includes(ftpNorm(t)) && ftpNorm(t) !== h2)
  )
}

// ─── Estimativa de chutes (multi-variável) ────────────────────────────────────
// Variáveis: média da liga + intensidade do 1T + ataque time + defesa adversário
//            + vantagem de casa + fator derby
function ftpEstimateShots(hn, an, league) {
  const ctx        = ftpCompCtx(league)
  const isDerby    = ftpIsDerby(hn, an)
  const intenseAdj = ctx.intenseHT ? 1.1 : 0          // +1.1 chutes em ligas intensas (PL, Bundesliga…)
  const derbyAdj   = isDerby ? 0.7 : 0                 // derbis têm mais pressão e chutes

  // Mandante: base + bônus intensidade + ataque home − defesa away + vantagem casa + derby
  let hShots = ctx.shotsRate
    + intenseAdj
    + ftpTeamAttackSeed(hn, ctx.shotsRate * 0.24)     // ofensividade do mandante
    - ftpTeamDefSeed(an,  ctx.shotsRate * 0.14)        // defesa do visitante reduz chutes
    + 0.9                                               // home advantage (10% base)
    + derbyAdj

  // Visitante: base -1.5 (desvantagem fora) + ataque away − defesa home + derby
  let aShots = (ctx.shotsRate - 1.5)
    + intenseAdj * 0.8
    + ftpTeamAttackSeed(an, ctx.shotsRate * 0.24)     // ofensividade do visitante
    - ftpTeamDefSeed(hn,  ctx.shotsRate * 0.14)        // defesa do mandante
    + derbyAdj * 0.8

  hShots = ftpClamp(hShots, 5.5, 20.0)
  aShots = ftpClamp(aShots, 4.5, 17.0)
  return {
    home:     +hShots.toFixed(1),
    away:     +aShots.toFixed(1),
    total:    +(hShots + aShots).toFixed(1),
    isDerby,
    intenseHT: ctx.intenseHT,
  }
}

function ftpEstimateSOT(shots) {
  return {
    home:  +(shots.home * 0.33).toFixed(1),
    away:  +(shots.away * 0.30).toFixed(1),
    total: +(shots.total * 0.315).toFixed(1)
  }
}

// ─── Estimativa de escanteios (multi-variável) ────────────────────────────────
// Variáveis: média da liga + intensidade + ataque home + defesa away (defesa profunda = mais escanteios)
//            + vantagem de casa + derby (derbis têm +20-30% escanteios historicamente)
function ftpEstimateCorners(hn, an, league) {
  const ctx        = ftpCompCtx(league)
  const isDerby    = ftpIsDerby(hn, an)
  const intenseAdj = ctx.intenseHT ? 0.7 : 0          // ligas intensas = mais escanteios
  const derbyAdj   = isDerby ? 0.8 : 0                 // +20-25% escanteios em derbis

  // Mandante: times atacantes criam escanteios; defesa sólida do adversário → time cai nas laterais
  let hC = ctx.cornerRate * 0.55
    + intenseAdj
    + ftpTeamAttackSeed(hn, ctx.cornerRate * 0.26)     // ataque wide do mandante
    + ftpTeamDefSeed(an,  ctx.cornerRate * 0.08)        // defesa sólida do adversário recua → + escanteios
    + derbyAdj * 0.55

  // Visitante: menos escanteios (joga mais recuado), mas defesa profunda pode receber mais presssão
  let aC = ctx.cornerRate * 0.45
    + intenseAdj * 0.7
    + ftpTeamAttackSeed(an, ctx.cornerRate * 0.26)
    + ftpTeamDefSeed(hn,  ctx.cornerRate * 0.08)
    + derbyAdj * 0.45

  hC = ftpClamp(hC, 2.0, 12.0)
  aC = ftpClamp(aC, 1.5, 10.0)
  // htCornerFactor: proporção de escanteios do 1T vs FT — específico por liga
  // Mandante tende a ter fator ligeiramente maior (pressão inicial de casa)
  // Visitante: -0.02 (mais cauteloso na saída)
  const hCF = ftpClamp(ctx.htCornerFactor + 0.01, 0.40, 0.52)  // home +0.01 vs liga
  const aCF = ftpClamp(ctx.htCornerFactor - 0.02, 0.38, 0.50)  // away -0.02 vs liga
  return {
    home:    +hC.toFixed(1),
    away:    +aC.toFixed(1),
    total:   +(hC + aC).toFixed(1),
    homeHT:  +(hC * hCF).toFixed(1),
    awayHT:  +(aC * aCF).toFixed(1),
    totalHT: +((hC * hCF + aC * aCF)).toFixed(1),
    isDerby,
    intenseHT: ctx.intenseHT,
  }
}

// ─── Linhas em 3 tiers (safe / median / aggressive) ──────────────────────────
// Bet365 usa APENAS linhas .5 (4.5, 5.5, 6.5, 7.5, 8.5, 9.5...)
// snapDn = arredonda p/ baixo para o .5 mais próximo (ex: 6.0 → 5.5, 6.6 → 6.5)
// snapUp = arredonda p/ cima para o .5 mais próximo  (ex: 6.0 → 6.5, 6.6 → 7.5)
function ftpTierLines(avg) {
  const snapDn = v => Math.floor(v - 0.5) + 0.5   // sempre X.5, arredonda p/ baixo
  const snapUp = v => Math.ceil(v  - 0.5) + 0.5   // sempre X.5, arredonda p/ cima
  const s = +Math.max(0.5, snapDn(avg * 0.72)).toFixed(1)
  const m = +Math.max(0.5, snapDn(avg * 0.88)).toFixed(1)
  const a = +Math.max(1.5, snapUp(avg * 1.05)).toFixed(1)
  // Garante que os 3 tiers são distintos
  return {
    safe:       s,
    median:     m > s ? m : +(s + 1.0).toFixed(1),
    aggressive: a > m ? a : +(m + 1.0).toFixed(1),
  }
}

// ─── Confiança pelo modelo de distribuição normal ─────────────────────────────
// Over: z = (avg - line) / std — positivo quando avg > line (favorável ao Over)
// Under: usar ftpUnderConf abaixo (z simétrico)
function ftpPropConf(avg, line, variance = 0.35, dq = 'EST') {
  const std = Math.max(0.5, variance * avg)
  const z = (avg - line) / std
  let conf = Math.round(50 + 50 * (z / (1 + Math.abs(z))))
  conf = ftpClamp(conf, 20, 95)
  if (dq === 'EST')     conf = ftpClamp(conf - 4, 20, 92)
  if (dq === 'PARCIAL') conf = ftpClamp(conf - 2, 20, 93)
  return conf
}

// ─── Confiança para apostas Under ────────────────────────────────────────────
// z = (line - avg) / std — positivo quando linha está acima da média (favorável ao Under)
function ftpUnderConf(avg, line, variance = 0.35, dq = 'EST') {
  const std = Math.max(0.5, variance * avg)
  const z   = (line - avg) / std
  let conf  = Math.round(50 + 50 * (z / (1 + Math.abs(z))))
  conf = ftpClamp(conf, 20, 95)
  if (dq === 'EST')     conf = ftpClamp(conf - 4, 20, 92)
  if (dq === 'PARCIAL') conf = ftpClamp(conf - 2, 20, 93)
  return conf
}

// ─── EV / Edge ────────────────────────────────────────────────────────────────
function ftpEdgeEV(conf, mktMargin = 0.09) {
  const c = Math.max(1, isFinite(conf) ? conf : 50)
  const fairOdds = +(100 / c).toFixed(2)
  const bookOdds = +(fairOdds * (1 + mktMargin)).toFixed(2)
  const edge = +((1/bookOdds - (1 - c/100)) * 100).toFixed(1)
  const ev   = +(c/100 * (bookOdds - 1) - (1 - c/100)).toFixed(3)
  return { fairOdds, bookOdds, edge, ev }
}

// ─── Thresholds mínimos Bet365 ────────────────────────────────────────────────
// A Bet365 só oferece mercados a partir destas linhas mínimas.
// Props gerados abaixo do threshold são filtrados (não aparecem na plataforma).
// Fonte: observação direta dos mercados disponíveis na Bet365 BR.
const BET365_MIN = {
  shots1hTeam:     4.5,  // Chutes 1T por time (Over): mínimo oferecido = 4.5
  shots1hTotal:    5.5,  // Chutes 1T total (Over): mínimo = 5.5
  shots1hUnder:    4.5,  // Chutes 1T Under: mínimo da linha = 4.5
  shotsFtTeam:     4.5,  // Chutes FT por time (Over): mínimo = 4.5
  shotsFtTotal:    9.5,  // Chutes FT total (Over): mínimo = 9.5
  sotTeam:         1.5,  // SOT 1T por time: mínimo = 1.5
  sotTotal:        2.5,  // SOT 1T total: mínimo = 2.5
  corners1hTotal:  3.5,  // Escanteios 1T total: mínimo = 3.5
  cornersFtTotal:  7.5,  // Escanteios FT total: mínimo = 7.5
  cards:           1.5,  // Cartões total: mínimo = 1.5
}

// ─── Gerador principal de props de time ───────────────────────────────────────
// homeStats / awayStats: dados reais do D1 (quando disponíveis) — substituem estimativas
export function ftpTeamProps(hn, an, league, country, match, homeStats = null, awayStats = null, opts = {}) {
  const props = []
  const ctx    = ftpCompCtx(league)

  // Base estimates
  let shots   = ftpEstimateShots(hn, an, league)
  let sot     = ftpEstimateSOT(shots)
  let corners = ftpEstimateCorners(hn, an, league)
  const cards   = ftpEstimateCards(hn, an, league)

  // Override with real DB data when available (mínimo 5 jogos para usar)
  const hGames = homeStats?.games_played || 0
  const aGames = awayStats?.games_played || 0
  if (hGames >= 5 || aGames >= 5) {
    // Shots: usa real do time se disponível, senão estimativa
    const hShotsReal = homeStats?.shots_per_game  || shots.home
    const aShotsReal = awayStats?.shots_per_game  || shots.away
    shots = {
      home:     +hShotsReal.toFixed(1),
      away:     +aShotsReal.toFixed(1),
      total:    +(hShotsReal + aShotsReal).toFixed(1),
      isDerby:  shots.isDerby,
      intenseHT: shots.intenseHT,
      dataQuality: (hGames >= 5 && aGames >= 5) ? 'REAL' : 'PARCIAL',
    }
    const hSotReal = homeStats?.shots_on_target_per_game || shots.home * 0.33
    const aSotReal = awayStats?.shots_on_target_per_game || shots.away * 0.30
    sot = { home: +hSotReal.toFixed(1), away: +aSotReal.toFixed(1), total: +(hSotReal+aSotReal).toFixed(1) }
    const hCornersReal = homeStats?.corners_per_game || corners.home
    const aCornersReal = awayStats?.corners_per_game || corners.away
    corners = {
      home:  +hCornersReal.toFixed(1),
      away:  +aCornersReal.toFixed(1),
      total: +(hCornersReal + aCornersReal).toFixed(1),
    }
  }

  const DQ = shots.dataQuality === 'REAL' ? 'REAL' : shots.dataQuality === 'PARCIAL' ? 'PARCIAL' : 'EST'

  const push = (p) => props.push({ match, home: hn, away: an, league, country, ...p })

  // ══ PALPITES POR TIME (Resultado, Gols, BTTS) ══════════════════════════════
  const isDerby  = shots.isDerby       // já calculado nos chutes
  const intense  = shots.intenseHT

  // Força combinada: ataque + seed geral - defesa adversária
  // Gera scores diferenciados por ataque E defesa (não apenas nome)
  const hAttk = 0.5 + ftpTeamAttackSeed(hn, 0.22)   // 0.28–0.72
  const hDef  = 0.5 + ftpTeamDefSeed(hn,  0.18)      // qualidade defensiva home
  const aAttk = 0.5 + ftpTeamAttackSeed(an, 0.22)
  const aDef  = 0.5 + ftpTeamDefSeed(an,  0.18)

  // Força líquida: ataque vs defesa do adversário
  const hNet  = ftpClamp(hAttk - aDef + 0.5 + 0.08, 0.1, 1.2)  // +0.08 home adv
  const aNet  = ftpClamp(aAttk - hDef + 0.5,         0.1, 1.2)
  const totNet = hNet + aNet

  // Probabilidades de resultado → confiança
  const hWinConf = ftpClamp(Math.round((hNet / totNet) * 100), 22, 82)
  const aWinConf = ftpClamp(Math.round((aNet / totNet) * 100), 14, 74)
  // Derby aumenta empate (mais equilíbrio e tensão)
  const drawBase = ftpClamp(100 - hWinConf - aWinConf, 14, 55)
  const drawConf = isDerby ? ftpClamp(drawBase + 5, 18, 58) : drawBase

  // Gols totais: média da liga × 2 + ataque dos dois times − defesa dos dois times + derby + intensidade
  const fullGoals = ftpClamp(
    ctx.htGoalRate * 2
      + (hAttk - 0.5) * 1.2                           // ataque do mandante
      + (aAttk - 0.5) * 1.0                           // ataque do visitante
      - (hDef  - 0.5) * 0.6                           // defesa do mandante
      - (aDef  - 0.5) * 0.6                           // defesa do visitante
      + (isDerby ? 0.25 : 0)                           // derby = mais gols (tensão → espaços)
      + (intense ? 0.15 : 0),                          // liga intensa = mais gols
    0.8, 6.0
  )

  const over25Conf  = ftpPropConf(fullGoals, 2.5, 0.38, 'EST')
  const under25Conf = ftpClamp(100 - over25Conf, 20, 90)

  // BTTS: taxa base da liga + ataque dos dois times − defesas + derby
  const bttsBase = ctx.htO05Rate / 100
  const bttsAdj  = ftpClamp(
    bttsBase
      + (hAttk - 0.5) * 0.18    // time que ataca = mais chance de marcar
      + (aAttk - 0.5) * 0.15
      - (hDef  - 0.5) * 0.12    // boa defesa home reduz BTTS
      - (aDef  - 0.5) * 0.10
      + (isDerby ? 0.04 : 0),
    0.25, 0.82
  )
  const bttsConf   = Math.round(bttsAdj * 100)
  const noBttsConf = ftpClamp(100 - bttsConf, 18, 88)

  const derbyTag  = isDerby  ? ' ⚔️ Derby' : ''
  const intenseTag = intense ? ' ⚡ Liga Intensa' : ''
  const hAtkPct   = Math.round(hAttk * 100)
  const aAtkPct   = Math.round(aAttk * 100)
  const hDefPct   = Math.round(hDef  * 100)
  const aDefPct   = Math.round(aDef  * 100)

  // ── 1X2 Resultado Final (Poisson v1/v2) ───────────────────────────────────
  // Substitui cálculo hash-seed anterior por modelo estatístico real.
  // v1: stats do D1 + liga   v2: +forma recente (ESPN) +H2H +calibração histórica
  ;(() => {
    const { picks } = buildMatchResultPicks({
      home: hn, away: an, league, country, match,
      homeStats, awayStats,
      context: { isDerby, intenseHT: intense },
      formCtx:  opts.formCtx  || null,
      calibMap: opts.calibMap || null,
    })
    picks.forEach(p => props.push(p))
  })()

  // ── Over 2.5 Gols ─────────────────────────────────────────────────────────
  ;(() => {
    const fe   = ftpEdgeEV(over25Conf, 0.08)
    const tier = over25Conf >= 62 ? 'safe' : over25Conf >= 52 ? 'median' : 'aggressive'
    push({ type:'resultado', stat:'Over 2.5 Gols', line:'O2.5', tier,
      avg: +fullGoals.toFixed(2), conf: over25Conf, ev: fe.edge, dq:'EST',
      team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`Estimativa: ${fullGoals.toFixed(2)} gols (liga ~${(ctx.htGoalRate*2).toFixed(1)}/jogo). Atk: ${hAtkPct}%+${aAtkPct}% | Def: ${hDefPct}%+${aDefPct}%.${derbyTag}${intenseTag}`,
      positive: `Alta média goleadora da ${league}${isDerby?' + intensidade do derby':''}.`,
      negative: 'Jogos táticos e derbis truncados podem ir ao Under' })
  })()

  // ── Under 2.5 Gols ────────────────────────────────────────────────────────
  ;(() => {
    const fe   = ftpEdgeEV(under25Conf, 0.08)
    const tier = under25Conf >= 58 ? 'safe' : 'aggressive'
    push({ type:'resultado', stat:'Under 2.5 Gols', line:'U2.5', tier,
      avg: +fullGoals.toFixed(2), conf: under25Conf, ev: fe.edge, dq:'EST',
      team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`Jogo mais fechado estimado. Gols: ${fullGoals.toFixed(2)}. Def home: ${hDefPct}% | Def away: ${aDefPct}%.`,
      positive: 'Defesas sólidas estimadas dos dois lados.',
      negative: `${league} tem média de ${(ctx.htGoalRate*2).toFixed(1)} gols/jogo — Under é contramão` })
  })()

  // ── BTTS Sim ──────────────────────────────────────────────────────────────
  ;(() => {
    const fe   = ftpEdgeEV(bttsConf, 0.09)
    const tier = bttsConf >= 62 ? 'safe' : bttsConf >= 52 ? 'median' : 'aggressive'
    push({ type:'resultado', stat:'BTTS Sim', line:'Ambas Marcam', tier,
      avg: null, conf: bttsConf, ev: fe.edge, dq:'EST', team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`BTTS base na ${league}: ~${ctx.htO05Rate}%. Atk home: ${hAtkPct}% | Atk away: ${aAtkPct}% | Def home: ${hDefPct}% | Def away: ${aDefPct}%.${derbyTag}`,
      positive: `Liga com taxa base de BTTS de ${ctx.htO05Rate}%${isDerby?' + pressão de derby':''}.`,
      negative: 'Defesa forte de um dos times pode segurar o adversário' })
  })()

  // ── BTTS Não ──────────────────────────────────────────────────────────────
  ;(() => {
    const fe = ftpEdgeEV(noBttsConf, 0.09)
    push({ type:'resultado', stat:'BTTS Não', line:'Ao Menos 1 Não Marca', tier:'aggressive',
      avg: null, conf: noBttsConf, ev: fe.edge, dq:'EST', team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`Chance de ao menos 1 time não marcar: ~${noBttsConf}%. Def mais forte: ${Math.max(hDefPct,aDefPct)}%.`,
      positive: 'Defesa estimada forte de um dos times.',
      negative: `Taxa BTTS base da ${league} é ${ctx.htO05Rate}% — difícil segurar os dois` })
  })()

  const derbyNote   = shots.isDerby   ? ' ⚔️ Derby detectado (+intensidade).' : ''
  const intenseNote = shots.intenseHT ? ' ⚡ Liga de alta intensidade no 1T.' : ''

  // ── Chutes Totais (3 tiers) ────────────────────────────────────────────────
  const shTiers = ftpTierLines(shots.total)
  ;[
    { line: shTiers.safe,       tier: 'safe',       variance: 0.28 },
    { line: shTiers.median,     tier: 'median',     variance: 0.28 },
    { line: shTiers.aggressive, tier: 'aggressive', variance: 0.28 },
  ].forEach(lv => {
    const conf = ftpPropConf(shots.total, lv.line, lv.variance, DQ)
    const fe   = ftpEdgeEV(conf, 0.09)
    push({ type:'team', stat:'Chutes Totais', line:`O${lv.line}`, tier:lv.tier,
      avg: shots.total, conf, ev: fe.edge, dq: DQ,
      isDerby: shots.isDerby, intenseHT: shots.intenseHT,
      team:`${hn} vs ${an}`,
      reason:`${hn} ~${shots.home} chutes + ${an} ~${shots.away} = ${shots.total} total. Mandante +ataque, visitante -defesa adversária.${derbyNote}${intenseNote}`,
      positive: `Média da liga (${ctx.shotsRate.toFixed(1)} chutes) + ajuste ataque/defesa por equipe`,
      negative: 'Variância alta por jogo — tática do dia pode alterar' })
  })

  // ── Chutes no Alvo (2 tiers) ──────────────────────────────────────────────
  const sotTiers = ftpTierLines(sot.total)
  ;[
    { line: sotTiers.safe,   tier: 'safe' },
    { line: sotTiers.median, tier: 'median' },
  ].forEach(lv => {
    const conf = ftpPropConf(sot.total, lv.line, 0.35, DQ)
    const fe   = ftpEdgeEV(conf, 0.10)
    push({ type:'team', stat:'Chutes no Alvo', line:`O${lv.line}`, tier:lv.tier,
      avg: sot.total, conf, ev: fe.edge, dq: DQ,
      team:`${hn} vs ${an}`,
      reason:`SOT estimado: ${hn} ~${sot.home} + ${an} ~${sot.away} = ${sot.total}.`,
      positive: 'SOT = indicador de qualidade real dos chutes',
      negative: 'Menor volume que chutes totais' })
  })

  // ── Chutes Mandante ───────────────────────────────────────────────────────
  const hShTiers = ftpTierLines(shots.home)
  ;[
    { line: hShTiers.safe,   tier: 'safe' },
    { line: hShTiers.median, tier: 'median' },
  ].forEach(lv => {
    if (lv.line <= 3.5) return
    const conf = ftpPropConf(shots.home, lv.line, 0.32, DQ)
    const fe   = ftpEdgeEV(conf, 0.10)
    push({ type:'team', stat:`Chutes ${hn}`, line:`O${lv.line}`, tier:lv.tier,
      avg: shots.home, conf, ev: fe.edge, dq: DQ, team: hn,
      reason:`${hn}: ~${shots.home} chutes/jogo como mandante.`,
      positive: `${hn} (mandante) tende a ter mais posse e chutes`,
      negative: 'Depende do estilo defensivo do adversário' })
  })

  // ── Chutes Visitante ──────────────────────────────────────────────────────
  const aShTiers = ftpTierLines(shots.away)
  if (aShTiers.safe > 2.5) {
    const conf = ftpPropConf(shots.away, aShTiers.safe, 0.38, DQ)
    const fe   = ftpEdgeEV(conf, 0.11)
    push({ type:'team', stat:`Chutes ${an}`, line:`O${aShTiers.safe}`, tier:'safe',
      avg: shots.away, conf, ev: fe.edge, dq: DQ, team: an,
      reason:`${an}: ~${shots.away} chutes/jogo como visitante.`,
      positive: 'Bons visitantes mantêm volume mesmo fora',
      negative: 'Visitante geralmente mais defensivo' })
  }

  const cDerbyNote   = corners.isDerby   ? ' ⚔️ Derby: +20-30% escanteios histórico.' : ''
  const cIntenseNote = corners.intenseHT ? ' ⚡ Liga intensa gera mais pressão nas laterais.' : ''

  // ── Escanteios Totais (3 tiers) ───────────────────────────────────────────
  const cTiers = ftpTierLines(corners.total)
  ;[
    { line: cTiers.safe,       tier: 'safe',       variance: 0.30 },
    { line: cTiers.median,     tier: 'median',     variance: 0.30 },
    { line: cTiers.aggressive, tier: 'aggressive', variance: 0.30 },
  ].forEach(lv => {
    if (lv.line < BET365_MIN.cornersFtTotal) return
    const conf = ftpPropConf(corners.total, lv.line, lv.variance, DQ)
    const fe   = ftpEdgeEV(conf, 0.09)
    push({ type:'team', stat:'Escanteios', line:`O${lv.line}`, tier:lv.tier,
      avg: corners.total, conf, ev: fe.edge, dq: DQ,
      isDerby: corners.isDerby, intenseHT: corners.intenseHT,
      team:`${hn} vs ${an}`,
      reason:`${hn} ~${corners.home} + ${an} ~${corners.away} = ${corners.total} esc/jogo (liga base: ${ctx.cornerRate}).${cDerbyNote}${cIntenseNote}`,
      positive: 'Ataque wide dos times + qualidade defensiva do adversário gera escanteios',
      negative: 'Escanteios têm alta variância — depende de ritmo do jogo' })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // ── CHUTES 1T (total + mandante + visitante, Over E Under) ────────────────
  // htShotFactor por liga + ftpTeamHTSeed por time (fast/slow starter)
  // ════════════════════════════════════════════════════════════════════════════
  // Fast starter: times que pressionam alto desde o apito inicial têm mais
  // chutes no 1T vs o total do jogo. Slow starters crescem no 2T.
  const hHTFact = ftpClamp(ctx.htShotFactor + ftpTeamHTSeed(hn, 0.04), 0.36, 0.54)
  const aHTFact = ftpClamp(ctx.htShotFactor - 0.02 + ftpTeamHTSeed(an, 0.04), 0.34, 0.52)
  const sh1hHome  = +(shots.home * hHTFact).toFixed(1)
  const sh1hAway  = +(shots.away * aHTFact).toFixed(1)
  const sh1hTotal = +(sh1hHome + sh1hAway).toFixed(1)
  const sh1hTiers = ftpTierLines(sh1hTotal)
  const htFactPct = Math.round(hHTFact * 100)  // para exibir no reason

  // helper: gera Under com safe + median — usa ftpUnderConf (z simétrico direto)
  function pushUnder(stat, avg, line1, line2, variance, team, extraFields, notePos, noteNeg, minLine = 1.0) {
    [[line1,'safe'],[line2,'median']].forEach(([uLine, uTier]) => {
      if (!uLine || uLine < Math.max(1.0, minLine)) return
      const conf  = ftpUnderConf(avg, uLine, variance, DQ)
      if (conf < 30) return
      const tier  = conf >= 62 ? 'safe' : conf >= 50 ? 'median' : 'aggressive'
      const fe    = ftpEdgeEV(conf, 0.10)
      push({ type:'ht', stat, line:`U${uLine}`, tier,
        avg, conf, ev: fe.edge, dq: DQ, team, ...extraFields,
        reason:`Under ${uLine} ${stat.replace('Chutes 1T','chutes 1T').replace('Escanteios 1T','esc. 1T')}. Est.: ${avg}. Linha acima da média estimada.`,
        positive: notePos, negative: noteNeg })
    })
  }

  // Over Total
  ;[
    { line: sh1hTiers.safe,   tier: 'safe',   variance: 0.34 },
    { line: sh1hTiers.median, tier: 'median', variance: 0.34 },
  ].forEach(lv => {
    if (lv.line < BET365_MIN.shots1hTotal) return
    const conf = ftpPropConf(sh1hTotal, lv.line, lv.variance, DQ)
    const fe   = ftpEdgeEV(conf, 0.10)
    push({ type:'ht', stat:'Chutes 1T', line:`O${lv.line}`, tier:lv.tier,
      avg: sh1hTotal, conf, ev: fe.edge, dq: DQ, team:`${hn} vs ${an}`,
      reason:`1T: ${sh1hHome}+${sh1hAway} = ${sh1hTotal} chutes. Liga ${ctx.htShotFactor*100|0}% dos chutes FT no 1T.${derbyNote}${intenseNote}`,
      positive: `Liga usa ~${ctx.htShotFactor*100|0}% dos chutes no 1T — linha conservadora.`,
      negative: 'Times táticos ou com defesas sólidas podem truncar o 1T' })
  })

  // Under Total (safe + median)
  pushUnder('Chutes 1T', sh1hTotal,
    sh1hTiers.aggressive, +(sh1hTiers.aggressive + 1.0).toFixed(1),
    0.34, `${hn} vs ${an}`, {},
    'Jogo truncado no 1T — defesas organizadas reduzem volume de chutes.',
    `Média estimada ${sh1hTotal} — ambos os times podem pressionar desde o início`,
    BET365_MIN.shots1hUnder)

  // Over Mandante
  ;(() => {
    const sh1hHTiers = ftpTierLines(sh1hHome)
    if (sh1hHome < BET365_MIN.shots1hTeam) return
    ;[
      { line: sh1hHTiers.safe,   tier: 'safe',   variance: 0.36 },
      { line: sh1hHTiers.median, tier: 'median', variance: 0.36 },
    ].forEach(lv => {
      if (lv.line < BET365_MIN.shots1hTeam) return
      const conf = ftpPropConf(sh1hHome, lv.line, lv.variance, DQ)
      const fe   = ftpEdgeEV(conf, 0.10)
      const tier = conf >= 60 ? 'safe' : lv.tier
      push({ type:'ht', stat:`Chutes 1T ${hn}`, line:`O${lv.line}`, tier,
        avg: sh1hHome, conf, ev: fe.edge, dq: DQ, team: hn,
        isDerby: shots.isDerby, intenseHT: shots.intenseHT,
        reason:`${hn}: ~${sh1hHome} chutes 1T (FT ${shots.home} × ${htFactPct}% fator liga+time). Início agressivo como mandante.${derbyNote}${intenseNote}`,
        positive: `${hn} com fator 1T ${htFactPct}% — pressionador no início.`,
        negative: 'Volume de chutes no 1T depende da tática do dia e da defesa adversária' })
    })
  })()

  // Under Mandante (safe + median)
  ;(() => {
    const sh1hHTiers = ftpTierLines(sh1hHome)
    if (sh1hHome < BET365_MIN.shots1hTeam) return
    pushUnder(`Chutes 1T ${hn}`, sh1hHome,
      sh1hHTiers.aggressive, +(sh1hHTiers.aggressive + 1.0).toFixed(1),
      0.36, hn, { isDerby: shots.isDerby, intenseHT: shots.intenseHT },
      `${hn} pode entrar mais recuado — visitante sólido pode segurar pressão.`,
      'Mandante ofensivo tende a superar linhas de chutes 1T',
      BET365_MIN.shots1hUnder)
  })()

  // Over Visitante
  ;(() => {
    const sh1hATiers = ftpTierLines(sh1hAway)
    if (sh1hAway < BET365_MIN.shots1hTeam) return
    ;[
      { line: sh1hATiers.safe,   tier: 'safe',   variance: 0.40 },
      { line: sh1hATiers.median, tier: 'median', variance: 0.40 },
    ].forEach(lv => {
      if (lv.line < BET365_MIN.shots1hTeam) return
      const conf = ftpPropConf(sh1hAway, lv.line, lv.variance, DQ)
      const fe   = ftpEdgeEV(conf, 0.11)
      const aHTFactPct = Math.round(aHTFact * 100)
      push({ type:'ht', stat:`Chutes 1T ${an}`, line:`O${lv.line}`, tier:lv.tier,
        avg: sh1hAway, conf, ev: fe.edge, dq: DQ, team: an,
        isDerby: shots.isDerby, intenseHT: shots.intenseHT,
        reason:`${an}: ~${sh1hAway} chutes 1T (FT ${shots.away} × ${aHTFactPct}% fator liga+time). Visitante.${derbyNote}`,
        positive: `${an} ofensivo mantém volume de chutes mesmo fora.`,
        negative: `${an} mais reativo no 1T — fator 1T reduzido como visitante` })
    })
  })()

  // Under Visitante (safe + median)
  ;(() => {
    const sh1hATiers = ftpTierLines(sh1hAway)
    if (sh1hAway < BET365_MIN.shots1hTeam) return
    pushUnder(`Chutes 1T ${an}`, sh1hAway,
      sh1hATiers.aggressive, +(sh1hATiers.aggressive + 1.0).toFixed(1),
      0.40, an, { isDerby: shots.isDerby, intenseHT: shots.intenseHT },
      'Visitante recuado no 1T é padrão — baixo volume de chutes esperado.',
      'Time visitante ofensivo ou fast-starter pode superar a linha facilmente',
      BET365_MIN.shots1hUnder)
  })()

  // ════════════════════════════════════════════════════════════════════════════
  // ── SOT 1T (Finalizações no Alvo — total + mandante + visitante, O e U) ──
  // ════════════════════════════════════════════════════════════════════════════
  const sot1hHome  = +(sh1hHome * 0.33).toFixed(1)   // ~33% dos chutes vão no alvo
  const sot1hAway  = +(sh1hAway * 0.30).toFixed(1)   // visitante: proporção levemente menor
  const sot1hTotal = +(sot1hHome + sot1hAway).toFixed(1)
  const sotHTiers  = ftpTierLines(sot1hTotal)
  const sothHTiers = ftpTierLines(sot1hHome)
  const sotaHTiers = ftpTierLines(sot1hAway)

  // Over SOT Total
  ;[
    { line: sotHTiers.safe,   tier: 'safe' },
    { line: sotHTiers.median, tier: 'median' },
  ].forEach(lv => {
    if (lv.line < BET365_MIN.sotTotal) return
    const conf = ftpPropConf(sot1hTotal, lv.line, 0.40, DQ)
    const fe   = ftpEdgeEV(conf, 0.10)
    push({ type:'ht', stat:'SOT 1T', line:`O${lv.line}`, tier:lv.tier,
      avg: sot1hTotal, conf, ev: fe.edge, dq: DQ, team:`${hn} vs ${an}`,
      reason:`SOT 1T: ${sot1hHome}+${sot1hAway} = ${sot1hTotal} finalizações no alvo. (~33%/30% dos chutes).`,
      positive: 'SOT 1T é mercado de nicho — menor eficiência das casas.',
      negative: 'Alta variância — qualidade do goleiro pode distorcer' })
  })

  // Under SOT Total
  ;(() => {
    const uLine = sotHTiers.aggressive
    if (uLine < BET365_MIN.sotTotal) return
    const conf = ftpClamp(ftpUnderConf(sot1hTotal, uLine, 0.40, DQ), 20, 78)
    const fe   = ftpEdgeEV(conf, 0.10)
    push({ type:'ht', stat:'SOT 1T', line:`U${uLine}`, tier:'aggressive',
      avg: sot1hTotal, conf, ev: fe.edge, dq: DQ, team:`${hn} vs ${an}`,
      reason:`Under ${uLine} finalizações no alvo no 1T. Estimativa: ${sot1hTotal}. Jogo mais truncado.`,
      positive: 'Defesas organizadas ou goleiros de alto nível reduzem SOT.',
      negative: `Média estimada ${sot1hTotal} — margem de segurança pode ser pequena` })
  })()

  // Over SOT Mandante
  ;(() => {
    if (sot1hHome < 1.2 || sothHTiers.safe < BET365_MIN.sotTeam) return
    const conf = ftpPropConf(sot1hHome, sothHTiers.safe, 0.44, DQ)
    const fe   = ftpEdgeEV(conf, 0.10)
    const tier = conf >= 60 ? 'safe' : 'median'
    push({ type:'ht', stat:`SOT 1T ${hn}`, line:`O${sothHTiers.safe}`, tier,
      avg: sot1hHome, conf, ev: fe.edge, dq: DQ, team: hn,
      isDerby: shots.isDerby, intenseHT: shots.intenseHT,
      reason:`${hn}: ~${sot1hHome} finalizações no alvo no 1T. Pressão inicial como mandante.${derbyNote}`,
      positive: `${hn} gera mais oportunidades de qualidade no 1T.`,
      negative: 'SOT é mais volátil que chutes totais — varia muito por jogo' })
  })()

  // Under SOT Mandante
  ;(() => {
    if (sot1hHome < 1.2) return
    const uLine = sothHTiers.aggressive
    if (uLine < BET365_MIN.sotTeam) return
    const conf = ftpClamp(ftpUnderConf(sot1hHome, uLine, 0.44, DQ), 20, 78)
    const fe   = ftpEdgeEV(conf, 0.10)
    push({ type:'ht', stat:`SOT 1T ${hn}`, line:`U${uLine}`, tier:'aggressive',
      avg: sot1hHome, conf, ev: fe.edge, dq: DQ, team: hn,
      isDerby: shots.isDerby,
      reason:`${hn} Under ${uLine} SOT no 1T. Estimativa: ${sot1hHome}. Defesa do adversário pode fechar.`,
      positive: `${an} defensivo pode bloquear finalizações de ${hn}.`,
      negative: `${hn} ofensivo com qualidade pode superar linha de SOT facilmente` })
  })()

  // Over SOT Visitante
  ;(() => {
    if (sot1hAway < 0.8 || sotaHTiers.safe < BET365_MIN.sotTeam) return
    const conf = ftpPropConf(sot1hAway, sotaHTiers.safe, 0.48, DQ)
    const fe   = ftpEdgeEV(conf, 0.11)
    push({ type:'ht', stat:`SOT 1T ${an}`, line:`O${sotaHTiers.safe}`, tier:'safe',
      avg: sot1hAway, conf, ev: fe.edge, dq: DQ, team: an,
      isDerby: shots.isDerby, intenseHT: shots.intenseHT,
      reason:`${an}: ~${sot1hAway} finalizações no alvo no 1T. Visitante ofensivo.${derbyNote}`,
      positive: `${an} de qualidade cria SOT mesmo fora de casa.`,
      negative: `${an} tende a ter menos finalizações de qualidade fora` })
  })()

  // Under SOT Visitante
  ;(() => {
    if (sot1hAway < 0.8) return
    const uLine = sotaHTiers.aggressive
    if (uLine < BET365_MIN.sotTeam) return
    const conf = ftpClamp(ftpUnderConf(sot1hAway, uLine, 0.48, DQ), 22, 80)
    const fe   = ftpEdgeEV(conf, 0.11)
    const tier = conf >= 60 ? 'median' : 'aggressive'
    push({ type:'ht', stat:`SOT 1T ${an}`, line:`U${uLine}`, tier,
      avg: sot1hAway, conf, ev: fe.edge, dq: DQ, team: an,
      isDerby: shots.isDerby,
      reason:`${an} Under ${uLine} SOT no 1T. Visitante recuado — estimativa ${sot1hAway} finalizações no alvo.`,
      positive: `${an} recuado no 1T raramente cria muitas finalizações de qualidade.`,
      negative: 'Contra-ataques rápidos podem gerar SOT alto mesmo com posse baixa' })
  })()

  // ════════════════════════════════════════════════════════════════════════════
  // ── ESCANTEIOS 1T (total + mandante + visitante, Over E Under) ────────────
  // htCornerFactor por liga (já aplicado em ftpEstimateCorners via ctx)
  // ════════════════════════════════════════════════════════════════════════════
  const chtTiers  = ftpTierLines(corners.totalHT)
  const hcfPct    = Math.round(ctx.htCornerFactor * 100)   // para exibir

  // Over Total
  ;[
    { line: chtTiers.safe,   tier: 'safe' },
    { line: chtTiers.median, tier: 'median' },
  ].forEach(lv => {
    if (lv.line < BET365_MIN.corners1hTotal) return
    const conf = ftpPropConf(corners.totalHT, lv.line, 0.38, DQ)
    const fe   = ftpEdgeEV(conf, 0.10)
    push({ type:'ht', stat:'Escanteios 1T', line:`O${lv.line}`, tier:lv.tier,
      avg: corners.totalHT, conf, ev: fe.edge, dq: DQ, team:`${hn} vs ${an}`,
      reason:`${hn} ${corners.homeHT}+${an} ${corners.awayHT} = ${corners.totalHT} esc. 1T. Liga: ${hcfPct}% do FT no 1T.${cDerbyNote}`,
      positive: `Liga usa ~${hcfPct}% dos escanteios no 1T — mercado mais conservador.`,
      negative: 'Escanteios do 1T têm maior variância — defesas sólidas reduzem' })
  })

  // Under Total (safe + median)
  pushUnder('Escanteios 1T', corners.totalHT,
    chtTiers.aggressive, +(chtTiers.aggressive + 1.0).toFixed(1),
    0.38, `${hn} vs ${an}`, {},
    'Defesas bem organizadas e jogo mais truncado geram menos escanteios no 1T.',
    'Times de ataque wide pressionam desde o início e superam linhas de 1T rapidamente',
    BET365_MIN.corners1hTotal)

  // Over Mandante
  ;(() => {
    const hHTiers = ftpTierLines(corners.homeHT)
    if (corners.homeHT < 1.2) return
    ;[
      { line: hHTiers.safe,   tier: 'safe',   variance: 0.42 },
      { line: hHTiers.median, tier: 'median', variance: 0.42 },
    ].forEach(lv => {
      if (lv.line < 0.5) return
      const conf = ftpPropConf(corners.homeHT, lv.line, lv.variance, DQ)
      const fe   = ftpEdgeEV(conf, 0.10)
      push({ type:'ht', stat:`Escanteios 1T ${hn}`, line:`O${lv.line}`, tier:lv.tier,
        avg: corners.homeHT, conf, ev: fe.edge, dq: DQ, team: hn,
        isDerby: corners.isDerby, intenseHT: corners.intenseHT,
        reason:`${hn}: ~${corners.homeHT} esc. 1T (FT ${corners.home} × ${hcfPct+1}% fator liga).${cDerbyNote}`,
        positive: `${hn} pressiona mais no 1T — defesa de ${an} empurra para laterais.`,
        negative: 'Proporção 1T/FT tem variância — defesa sólida pode bloquear cruzamentos' })
    })
  })()

  // Under Mandante (safe + median)
  ;(() => {
    const hHTiers = ftpTierLines(corners.homeHT)
    if (corners.homeHT < 1.2) return
    pushUnder(`Escanteios 1T ${hn}`, corners.homeHT,
      hHTiers.aggressive, +(hHTiers.aggressive + 1.0).toFixed(1),
      0.42, hn, { isDerby: corners.isDerby },
      `${an} defensivo bloqueia cruzamentos — ${hn} cria menos escanteios.`,
      `${hn} de ataque wide normalmente supera estas linhas`)
  })()

  // Over Visitante
  ;(() => {
    const aHTiers = ftpTierLines(corners.awayHT)
    if (corners.awayHT < 0.8) return
    ;[
      { line: aHTiers.safe,   tier: 'safe',   variance: 0.46 },
      { line: aHTiers.median, tier: 'median', variance: 0.46 },
    ].forEach(lv => {
      if (lv.line < 0.5) return
      const conf = ftpPropConf(corners.awayHT, lv.line, lv.variance, DQ)
      const fe   = ftpEdgeEV(conf, 0.11)
      const aHCFpct = Math.round((ctx.htCornerFactor - 0.02) * 100)
      push({ type:'ht', stat:`Escanteios 1T ${an}`, line:`O${lv.line}`, tier:lv.tier,
        avg: corners.awayHT, conf, ev: fe.edge, dq: DQ, team: an,
        isDerby: corners.isDerby, intenseHT: corners.intenseHT,
        reason:`${an}: ~${corners.awayHT} esc. 1T (FT ${corners.away} × ${aHCFpct}% fator liga). Visitante.${cDerbyNote}`,
        positive: `${an} ofensivo força escanteios em contra-ataques e bolas longas.`,
        negative: `${an} tende a ter menos escanteios no 1T — alta variância` })
    })
  })()

  // Under Visitante (safe + median)
  ;(() => {
    const aHTiers = ftpTierLines(corners.awayHT)
    if (corners.awayHT < 0.8) return
    pushUnder(`Escanteios 1T ${an}`, corners.awayHT,
      aHTiers.aggressive, +(aHTiers.aggressive + 1.0).toFixed(1),
      0.46, an, { isDerby: corners.isDerby },
      `${an} recuado no 1T raramente gera muitos escanteios.`,
      `${an} ofensivo pode criar pressão lateral desde o apito inicial`)
  })()

  // ── Gols 1T ───────────────────────────────────────────────────────────────
  // htGoalRate = média de gols no 1T por jogo da liga
  // Ajustado pelo ataque/defesa dos times
  const htGoals = ftpClamp(
    ctx.htGoalRate
      + (hAttk - 0.5) * 0.6
      + (aAttk - 0.5) * 0.5
      - (hDef  - 0.5) * 0.3
      - (aDef  - 0.5) * 0.3
      + (isDerby ? 0.10 : 0)
      + (intense ? 0.08 : 0),
    0.3, 3.0
  )
  // Over 0.5 Gols 1T — linha mais comum nas casas de apostas brasileiras
  ;(() => {
    const htO05base = ctx.htO05Rate / 100
    const htO05adj  = ftpClamp(
      htO05base
        + (hAttk - 0.5) * 0.12
        + (aAttk - 0.5) * 0.10
        - (hDef  - 0.5) * 0.08
        - (aDef  - 0.5) * 0.07
        + (isDerby ? 0.03 : 0),
      0.25, 0.88
    )
    const conf05 = Math.round(htO05adj * 100)
    const fe = ftpEdgeEV(conf05, 0.09)
    const tier = conf05 >= 65 ? 'safe' : conf05 >= 55 ? 'median' : 'aggressive'
    push({ type:'ht', stat:'Over 0.5 Gols 1T', line:'O0.5', tier,
      avg: +htGoals.toFixed(2), conf: conf05, ev: fe.edge, dq:'EST',
      team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`1T estimado: ${htGoals.toFixed(2)} gols (liga base ${ctx.htO05Rate}% jogos c/ gol). Atk home: ${hAtkPct}% | Atk away: ${aAtkPct}%.${derbyTag}`,
      positive: `${Math.round(htO05adj*100)}% de chance de ao menos 1 gol no 1T pela liga + ajuste ofensivo.`,
      negative: 'Jogos truncados no 1T são comuns — defesas mais organizadas cedo.' })
  })()
  // Under 0.5 Gols 1T (0 a 0 no intervalo)
  ;(() => {
    const htO05base = ctx.htO05Rate / 100
    const htU05adj  = ftpClamp(1 - (htO05base + (hAttk-0.5)*0.12 + (aAttk-0.5)*0.10 - (hDef-0.5)*0.08 - (aDef-0.5)*0.07 + (isDerby?0.03:0)), 0.12, 0.75)
    const conf = Math.round(htU05adj * 100)
    const fe = ftpEdgeEV(conf, 0.09)
    const tier = conf >= 55 ? 'median' : 'aggressive'
    push({ type:'ht', stat:'Under 0.5 Gols 1T', line:'U0.5', tier,
      avg: +htGoals.toFixed(2), conf, ev: fe.edge, dq:'EST',
      team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`${Math.round(htU05adj*100)}% chance de 0 gols no 1T. Média estimada: ${htGoals.toFixed(2)}. Def home: ${hDefPct}% | Def away: ${aDefPct}%.`,
      positive: 'Times mais cautelosos no 1T — 0x0 no intervalo é resultado frequente.',
      negative: `Liga tem ${ctx.htO05Rate}% de jogos com gol no 1T — maioria marca.` })
  })()
  // Over 1.5 Gols 1T
  ;(() => {
    const conf15 = ftpPropConf(htGoals, 1.5, 0.42, 'EST')
    if (conf15 < 28) return
    const fe = ftpEdgeEV(conf15, 0.09)
    const tier = conf15 >= 60 ? 'safe' : conf15 >= 50 ? 'median' : 'aggressive'
    push({ type:'ht', stat:'Over 1.5 Gols 1T', line:'O1.5', tier,
      avg: +htGoals.toFixed(2), conf: conf15, ev: fe.edge, dq:'EST',
      team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`Média estimada 1T: ${htGoals.toFixed(2)} gols. Liga base: ${ctx.htGoalRate.toFixed(2)}/1T. Atk: ${hAtkPct}%+${aAtkPct}%.${intenseTag}`,
      positive: 'Liga de ritmo alto com times de ataque — 2+ gols no 1T possível.',
      negative: 'Linha exigente — apenas ~25-30% dos jogos têm 2+ gols no 1T.' })
  })()

  // ── Resultado 1T (quem lidera no intervalo) ───────────────────────────────
  // Distribuição típica brasileirão: Casa 1T ~38% | Empate 1T ~43% | Fora 1T ~19%
  // Ajustamos pelas forças estimadas dos times
  const ht1WinBase  = ftpClamp(0.38 + (hNet/totNet - 0.5) * 0.28, 0.18, 0.60)
  const ht1DrawBase = ftpClamp(0.42 - Math.abs(hNet/totNet - 0.5) * 0.20, 0.28, 0.55)
  const ht1AWinBase = ftpClamp(1 - ht1WinBase - ht1DrawBase, 0.10, 0.40)

  const ht1HomeConf = Math.round(ht1WinBase * 100)
  const ht1DrawConf = Math.round(ht1DrawBase * 100)
  const ht1AwayConf = Math.round(ht1AWinBase * 100)

  ;(() => {
    const fe = ftpEdgeEV(ht1HomeConf, 0.08)
    const tier = ht1HomeConf >= 50 ? 'median' : 'aggressive'
    push({ type:'ht', stat:'Casa Vence 1T', line:hn, tier,
      avg: null, conf: ht1HomeConf, ev: fe.edge, dq:'EST', team: hn, isDerby, intenseHT: intense,
      reason:`${hn} mandante: probabilidade estimada de liderar no intervalo ${ht1HomeConf}%. Vantagem de casa + ataque ${hAtkPct}%.${derbyTag}`,
      positive: 'Mandante tende a pressionar mais no 1T e abrir vantagem antes do intervalo.',
      negative: 'Resultado 1T tem alta variância — empate no intervalo é o resultado mais comum.' })
  })()

  ;(() => {
    const fe = ftpEdgeEV(ht1DrawConf, 0.08)
    const tier = ht1DrawConf >= 52 ? 'median' : 'aggressive'
    push({ type:'ht', stat:'Empate 1T', line:'0-0/1-1', tier,
      avg: null, conf: ht1DrawConf, ev: fe.edge, dq:'EST', team:`${hn} vs ${an}`, isDerby, intenseHT: intense,
      reason:`Empate no intervalo estimado em ${ht1DrawConf}%. Mais frequente em jogos equilibrados. Forças: H ${hAtkPct}% vs A ${aAtkPct}%.${derbyTag}`,
      positive: `Empate no 1T é o resultado mais comum (~42% dos jogos) — inclui 0-0 e 1-1.${isDerby?' Derbis tendem a ser truncados no 1T.':''}`,
      negative: 'Liga ofensiva ou desequilíbrio grande reduz chance de empate no intervalo.' })
  })()

  ;(() => {
    if (ht1AwayConf < 22) return
    const fe = ftpEdgeEV(ht1AwayConf, 0.09)
    const tier = ht1AwayConf >= 42 ? 'median' : 'aggressive'
    push({ type:'ht', stat:'Fora Vence 1T', line:an, tier,
      avg: null, conf: ht1AwayConf, ev: fe.edge, dq:'EST', team: an, isDerby, intenseHT: intense,
      reason:`${an} visitante: ${ht1AwayConf}% de chance de liderar no intervalo. Ataque ${aAtkPct}% vs defesa home ${hDefPct}%.`,
      positive: 'Time visitante forte ofensivamente pode surpreender no 1T antes do adversário se organizar.',
      negative: 'Visitante vence o 1T em apenas ~19% dos jogos historicamente — linha exigente.' })
  })()

  // ── Cartões ───────────────────────────────────────────────────────────────────
  // Bet365 oferece o mercado de cartões na maioria das ligas mas disponibilidade
  // varia por jogo. Picks marcados com needsVerify=true quando liga não é
  // confirmadamente europeia — o Garantido/365 IA deve verificar disponibilidade.
  const CARD_CONFIRMED_LEAGUES = new Set([
    'premier league','la liga','serie a','bundesliga','ligue 1',
    'primeira liga','liga portugal','eredivisie','champions league',
    'europa league','conference league','championship','2. bundesliga',
    'super lig','pro league',
  ])
  const leagueNorm = (league||'').toLowerCase()
  // Para ligas não confirmadas: inclui os picks mas marca needsVerify
  const cardNeedsVerify = !CARD_CONFIRMED_LEAGUES.has(leagueNorm)

  ;(() => {
    const cardDerbyNote = cards.isDerby ? ' ⚔️ Derby: +30% cartões histórico.' : ''
    // Linhas reais Bet365: snapped para 2.5, 3.5 ou 4.5
    const snapLine = v => v >= 4.5 ? 4.5 : v >= 3.5 ? 3.5 : 2.5
    const line35 = snapLine(cards.total)
    const line45 = cards.total >= 4.0 ? snapLine(cards.total + 1) : null

    const cardLinesList = line45 && line45 !== line35
      ? [{ line: line35, tier:'safe' }, { line: line45, tier:'median' }]
      : [{ line: line35, tier:'safe' }]

    cardLinesList.forEach(lv => {
      const conf = ftpPropConf(cards.total, lv.line, 0.30, DQ)
      const fe   = ftpEdgeEV(conf, 0.09)
      push({ type:'cartoes', stat:'Cartões Totais', line:`O${lv.line}`, tier:lv.tier,
        avg: cards.total, conf, ev: fe.edge, dq: DQ,
        isDerby: cards.isDerby, intenseHT: shots.intenseHT,
        team:`${hn} vs ${an}`, needsVerify: cardNeedsVerify,
        reason:`${hn} ~${cards.home} + ${an} ~${cards.away} = ${cards.total} cartões (liga base: ${cards.leagueBase}).${cardDerbyNote}`,
        positive: `${league} com média de ${cards.leagueBase} amarelos/jogo${cards.isDerby?' + rivalidade regional':''}.`,
        negative: cardNeedsVerify
          ? '⚠ Verificar disponibilidade na Bet365 — mercado de cartões nem sempre disponível nesta competição'
          : 'Árbitro e estilos defensivos variam — alta variância' })
    })

    // Cartões Mandante
    const hLine = cards.home >= 2.5 ? 2.5 : cards.home >= 1.5 ? 1.5 : null
    if (hLine) {
      const conf = ftpPropConf(cards.home, hLine, 0.38, DQ)
      const fe   = ftpEdgeEV(conf, 0.10)
      push({ type:'cartoes', stat:`Cartões ${hn}`, line:`O${hLine}`, tier:'safe',
        avg: cards.home, conf, ev: fe.edge, dq: DQ, team: hn,
        isDerby: cards.isDerby, needsVerify: cardNeedsVerify,
        reason:`${hn}: ~${cards.home} cartões estimados (base liga: ${cards.leagueBase}).`,
        positive: `${hn} sob pressão da torcida tende a ser mais agressivo`,
        negative: cardNeedsVerify ? '⚠ Verificar disponibilidade na Bet365' : 'Alta variância — depende do árbitro' })
    }

    // Cartões Visitante
    const aLine = cards.away >= 2.5 ? 2.5 : cards.away >= 1.5 ? 1.5 : null
    if (aLine) {
      const conf = ftpPropConf(cards.away, aLine, 0.38, DQ)
      const fe   = ftpEdgeEV(conf, 0.10)
      push({ type:'cartoes', stat:`Cartões ${an}`, line:`O${aLine}`, tier:'safe',
        avg: cards.away, conf, ev: fe.edge, dq: DQ, team: an,
        isDerby: cards.isDerby, needsVerify: cardNeedsVerify,
        reason:`${an}: ~${cards.away} cartões estimados. Visitante historicamente mais agressivo fora.`,
        positive: `${an} historicamente leva mais cartões (pressionado fora de casa)`,
        negative: cardNeedsVerify ? '⚠ Verificar disponibilidade na Bet365' : 'Alta variância — depende do árbitro' })
    }
  })()

  // ── Deduplica: mesmo (stat + team + line) → mantém maior conf ───────────────
  const seen = new Map()
  props.forEach(p => {
    const k = `${p.stat}|${p.team||''}|${p.line||''}`
    if (!seen.has(k) || p.conf > seen.get(k).conf) seen.set(k, p)
  })
  return [...seen.values()]
}

// ─── Filtros de tier/UI ──────────────────────────────────────────────────────
const TIERS = [
  { id:'all',        label:'🏆 Todos',     color:'var(--green)',  bg:'rgba(0,214,143,.12)', border:'rgba(0,214,143,.4)' },
  { id:'safe',       label:'🛡 Seguras',   color:'var(--blue)',   bg:'var(--b3)',            border:'rgba(59,158,255,.35)' },
  { id:'median',     label:'⚖ Medianas',  color:'var(--amber)',  bg:'var(--a3)',            border:'rgba(255,184,48,.3)' },
  { id:'aggressive', label:'🔥 Agressivas',color:'var(--red)',   bg:'var(--r3)',            border:'rgba(255,79,106,.3)' },
]

const STAT_FILTERS = ['all','Resultado','Gols','BTTS','1T','Chutes','Escanteios','Cartões']

// ─── Agrupamento por método (categoria de mercado) dentro de cada jogo ────────
function getPropMethodFt(stat) {
  const s = (stat || '').toLowerCase()
  if (s.includes('chutes 1t'))      return { key:'chutes1t',  label:'🎯 Chutes 1° Tempo',          order:1 }
  if (s.includes('sot 1t'))         return { key:'sot1t',     label:'🔍 Finalizações no Alvo 1T',   order:2 }
  if (s.includes('escanteios 1t'))  return { key:'esc1t',     label:'⚑ Escanteios 1° Tempo',       order:3 }
  if (s.includes('1t'))             return { key:'res1t',     label:'⚽ Gols & Resultado 1T',       order:4 }
  if (['casa win','empate','fora win','over 2.5','under 2.5','btts'].some(k => s.includes(k)))
                                    return { key:'resultado', label:'⚽ Resultado & Gols',          order:5 }
  if (s.includes('chute') || s.includes('sot'))
                                    return { key:'chutes',    label:'📊 Chutes & SOT',              order:6 }
  if (s.includes('escanteio'))      return { key:'esc',       label:'⚑ Escanteios FT',             order:7 }
  return                                   { key:'cartoes',   label:'🟨 Cartões',                   order:8 }
}

function MethodSection({ label, count, children }) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 0 6px',
        borderBottom:'1px solid rgba(255,255,255,.06)',marginBottom:8}}>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,fontWeight:700,
          color:'var(--amber)',letterSpacing:'0.5px'}}>{label}</span>
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'var(--dim)',
          background:'rgba(255,255,255,.05)',padding:'1px 5px',borderRadius:8}}>{count}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(330px,1fr))',gap:10}}>
        {children}
      </div>
    </div>
  )
}

const DQ_COLOR = { REAL: 'var(--green)', PARCIAL: 'var(--amber)', EST: 'var(--mute)' }

// ─── PropCard ────────────────────────────────────────────────────────────────
function PropCard({ prop, pickId, histResult, onSetResult }) {
  const { banca } = usePerfStore()
  const RESULT_COLORS_FT = {
    W: { bg: 'rgba(0,214,143,.85)',  border: 'var(--green)', text: '#fff', label: '✓W' },
    L: { bg: 'rgba(255,79,106,.85)', border: 'var(--red)',   text: '#fff', label: '✕L' },
    V: { bg: 'rgba(255,255,255,.1)', border: 'var(--mute)',  text: 'var(--t2)', label: '○V' },
    P: { bg: 'rgba(255,184,48,.7)', border: 'var(--amber)', text: '#fff', label: '=P' },
  }
  const rc = histResult ? RESULT_COLORS_FT[histResult] : null
  return (
    <div className="pick-card" style={{padding:'12px 14px', display:'flex', gap:8, alignItems:'flex-start',
      borderColor: rc ? rc.border : undefined, opacity: histResult === 'L' ? 0.75 : 1 }}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:'var(--white)',marginBottom:2}}>
              {prop.stat} <span style={{color:'var(--blue)',fontWeight:700}}>{prop.line}</span>
            </div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--soft)',marginBottom:2}}>
              {prop.team}
            </div>
            {prop.avg != null && (
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--dim)'}}>
                Média estimada: <span style={{color:'var(--soft)'}}>{prop.avg}</span>
              </div>
            )}
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
            <PickTierBadge conf={prop.conf} ev={prop.ev}/>
            {prop.dq && (
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:DQ_COLOR[prop.dq]||'var(--mute)',
                background:'rgba(255,255,255,.05)',padding:'1px 5px',borderRadius:3}}>
                {prop.dq}
              </span>
            )}
          </div>
        </div>
        <ConfBar conf={prop.conf}/>
        {prop.reason && (
          <div style={{fontFamily:"'Inter', sans-serif",fontSize:11,color:'var(--soft)',margin:'7px 0 4px',
            borderLeft:'2px solid var(--amber)',paddingLeft:7,lineHeight:1.55,opacity:0.85}}>
            {prop.reason}
          </div>
        )}
        <div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap',alignItems:'center'}}>
          <EdgeBadge ev={prop.ev}/>
          <StakeBadge conf={prop.conf} ev={prop.ev}/>
          {prop.real_odd && <KellyBadge conf={prop.conf} odd={prop.real_odd} banca={banca}/>}
          {prop.isDerby && (
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'#ff6b35',
              background:'rgba(255,107,53,.12)',padding:'1px 5px',borderRadius:3}}>⚔️ Derby</span>
          )}
          {prop.intenseHT && !prop.isDerby && (
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'var(--purple)',
              background:'rgba(139,92,246,.12)',padding:'1px 5px',borderRadius:3}}>⚡ Intensa</span>
          )}
          {prop.type==='resultado' && (
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--green)',
              background:'rgba(0,214,143,.12)',padding:'1px 5px',borderRadius:3}}>⚽ Palpite</span>
          )}
          {prop.type==='ht' && (
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--amber)',
              background:'var(--a3)',padding:'1px 5px',borderRadius:3}}>🕐 1T</span>
          )}
          {prop.type==='cartoes' && (
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'#fbbf24',
              background:'rgba(251,191,36,.12)',padding:'1px 5px',borderRadius:3}}>🟨 Cartões</span>
          )}
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginLeft:'auto'}}>
            {prop.tier==='safe'?'🛡':prop.tier==='median'?'⚖':'🔥'}
          </span>
        </div>
      </div>
      {onSetResult && pickId && (
        <div style={{display:'flex',flexDirection:'column',gap:3,flexShrink:0}}>
          {['W','L','V','P'].map(r => {
            const rcc = RESULT_COLORS_FT[r]; const active = histResult === r
            return (
              <button key={r} onClick={() => onSetResult(pickId, active ? null : r)} style={{
                fontFamily:"'JetBrains Mono',monospace",fontSize:9,fontWeight:700,
                padding:'2px 5px',borderRadius:3,cursor:'pointer',
                background: active ? rcc.bg : 'transparent',
                border:`1px solid ${active ? rcc.border : 'var(--border)'}`,
                color: active ? rcc.text : 'var(--t3)',
                minWidth:34,textAlign:'center',
              }}>{rcc.label}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Resultado Final Card — estilo Bet365 "Criar Aposta" ─────────────────────
// Mostra Casa / Empate / Fora com barras de probabilidade, pick destacado e análise
function ResultadoFinalCard({ data, onSetResult, histById }) {
  const { banca } = usePerfStore()
  const { match, home, away, league, country, homeConf, drawConf, awayConf,
          best, isDerby, intenseHT, reason, positive, negative, dq,
          hAtkPct, aAtkPct, hDefPct, aDefPct } = data

  // Normaliza para somar 100% (exibição)
  const total = homeConf + drawConf + awayConf
  const hPct = Math.round((homeConf / total) * 100)
  const aPct = Math.round((awayConf / total) * 100)
  const dPct = 100 - hPct - aPct

  const getPickId = (stat) => makePickId(today(), match, stat, stat === 'Casa Win' ? home : stat === 'Fora Win' ? away : 'X')
  const bestPickId = getPickId(best.stat)
  const bestHist   = histById[bestPickId] ?? null

  const RESULT_COLORS_FT = {
    W: { bg: 'rgba(0,214,143,.85)',  border: 'var(--green)', text: '#fff', label: '✓W' },
    L: { bg: 'rgba(255,79,106,.85)', border: 'var(--red)',   text: '#fff', label: '✕L' },
    V: { bg: 'rgba(255,255,255,.1)', border: 'var(--mute)',  text: 'var(--t2)', label: '○V' },
    P: { bg: 'rgba(255,184,48,.7)', border: 'var(--amber)', text: '#fff', label: '=P' },
  }
  const rc = bestHist ? RESULT_COLORS_FT[bestHist] : null

  const rowStyle = (isBest, pct, conf, color) => ({
    display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
    borderRadius:6, marginBottom:6,
    background: isBest ? `${color}22` : 'rgba(255,255,255,.03)',
    border: `1px solid ${isBest ? color : 'rgba(255,255,255,.06)'}`,
    position:'relative', overflow:'hidden', cursor:'default',
  })
  const barFill = (pct, color) => ({
    position:'absolute', top:0, left:0, bottom:0, width:`${pct}%`,
    background: `linear-gradient(90deg, ${color}22 0%, ${color}10 100%)`,
    pointerEvents:'none',
  })

  const COLORS = { home: 'var(--green)', draw: 'var(--amber)', away: 'var(--blue)' }
  const rows = [
    { stat:'Casa Win', label:home, pct:hPct, conf:homeConf, color:COLORS.home, isBest:best.stat==='Casa Win' },
    { stat:'Empate',   label:'Empate', pct:dPct, conf:drawConf, color:COLORS.draw, isBest:best.stat==='Empate' },
    { stat:'Fora Win', label:away, pct:aPct, conf:awayConf, color:COLORS.away, isBest:best.stat==='Fora Win' },
  ]

  return (
    <div className="pick-card" style={{
      padding:'14px 16px', marginBottom:12,
      borderColor: rc ? rc.border : 'var(--line)',
      opacity: bestHist === 'L' ? 0.75 : 1,
    }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10, marginBottom:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--white)', marginBottom:2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {match}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--t3)' }}>
            {league}{country ? ` · ${country}` : ''}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--green)', background:'rgba(0,214,143,.12)',
            padding:'2px 7px', borderRadius:4, letterSpacing:'.5px' }}>
            🎯 RESULTADO FINAL
          </span>
          {dq && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, fontWeight:700,
              color: DQ_COLOR[dq] || 'var(--mute)',
              background:'rgba(255,255,255,.05)', padding:'1px 5px', borderRadius:3 }}>
              {dq}
            </span>
          )}
        </div>
      </div>

      {/* 3 linhas de probabilidade */}
      <div style={{ marginBottom:10 }}>
        {rows.map(r => (
          <div key={r.stat} style={rowStyle(r.isBest, r.pct, r.conf, r.color)}>
            <div style={barFill(r.pct, r.color)}/>
            <span style={{ fontSize:10, fontWeight:700, color: r.isBest ? r.color : 'var(--mute)',
              minWidth:18, zIndex:1, fontFamily:"'JetBrains Mono',monospace" }}>
              {r.stat === 'Casa Win' ? '1' : r.stat === 'Empate' ? 'X' : '2'}
            </span>
            <span style={{ flex:1, fontSize:12, fontWeight: r.isBest ? 700 : 500,
              color: r.isBest ? 'var(--white)' : 'var(--soft)', zIndex:1,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {r.label}
            </span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
              color: r.color, zIndex:1, minWidth:40, textAlign:'right' }}>
              {r.pct}%
            </span>
            {r.isBest && (
              <span style={{ fontSize:10, zIndex:1 }}>✓</span>
            )}
          </div>
        ))}
      </div>

      {/* Pick destacado + badges */}
      <div style={{ padding:'10px 12px', borderRadius:6,
        background:'rgba(0,214,143,.06)', border:'1px solid rgba(0,214,143,.2)',
        marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6 }}>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)',
              letterSpacing:'.5px', marginBottom:2 }}>PALPITE RECOMENDADO</div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--white)' }}>
              {best.stat === 'Casa Win' ? `${home} vence` : best.stat === 'Fora Win' ? `${away} vence` : 'Empate'}
            </div>
          </div>
          <PickTierBadge conf={best.conf} ev={best.ev}/>
        </div>
        <ConfBar conf={best.conf}/>
        <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap', alignItems:'center' }}>
          <EdgeBadge ev={best.ev}/>
          <StakeBadge conf={best.conf} ev={best.ev}/>
          {best.real_odd && <KellyBadge conf={best.conf} odd={best.real_odd} banca={banca}/>}
          {/* Fase 4: Badge odd real + edge */}
          {best.real_odd && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
              color: best.has_edge ? 'var(--green)' : 'var(--mute)',
              background: best.has_edge ? 'rgba(0,214,143,.12)' : 'rgba(255,255,255,.05)',
              padding:'2px 6px', borderRadius:3, border: `1px solid ${best.has_edge ? 'rgba(0,214,143,.3)' : 'transparent'}` }}
              title={`${best.book || 'Mercado'}: @${best.real_odd} (${best.implied_pct}% implícita)`}>
              @{best.real_odd} · {best.edge_pp > 0 ? '+' : ''}{best.edge_pp}pp
            </span>
          )}
          {/* Fase 2: Badge forma aplicada */}
          {best.modelMeta?.hasForm && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
              color:'#60a5fa', background:'rgba(96,165,250,.12)',
              padding:'2px 6px', borderRadius:3 }}
              title="Últimos 5 jogos aplicados ao modelo">📈 Forma</span>
          )}
          {best.modelMeta?.hasH2H && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
              color:'#c084fc', background:'rgba(192,132,252,.12)',
              padding:'2px 6px', borderRadius:3 }}
              title="H2H histórico aplicado">🔁 H2H</span>
          )}
          {/* Fase 3: Badge calibração */}
          {best.modelMeta?.calibShift != null && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
              color: best.modelMeta.calibShift > 0 ? 'var(--green)' : '#fbbf24',
              background:'rgba(255,184,48,.12)', padding:'2px 6px', borderRadius:3 }}
              title={`Shift de calibração: ${best.modelMeta.calibSource}`}>
              🎯 {best.modelMeta.calibShift > 0 ? '+' : ''}{best.modelMeta.calibShift}pp
            </span>
          )}
          {isDerby && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'#ff6b35',
              background:'rgba(255,107,53,.12)', padding:'2px 6px', borderRadius:3, fontWeight:700 }}>
              ⚔️ Derby
            </span>
          )}
          {intenseHT && !isDerby && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--purple)',
              background:'rgba(139,92,246,.12)', padding:'2px 6px', borderRadius:3, fontWeight:700 }}>
              ⚡ Intensa
            </span>
          )}
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--mute)', marginLeft:'auto' }}>
            {best.tier === 'safe' ? '🛡 Safe' : best.tier === 'median' ? '⚖ Médio' : '🔥 Agressivo'}
          </span>
        </div>
      </div>

      {/* Análise */}
      <div style={{ fontFamily:"'Inter', sans-serif", fontSize:11, color:'var(--soft)',
        lineHeight:1.6, padding:'8px 10px', background:'rgba(255,255,255,.02)',
        borderRadius:5, borderLeft:'2px solid var(--amber)' }}>
        <div style={{ marginBottom:4 }}>
          <span style={{ color:'var(--amber)', fontWeight:700, fontSize:9,
            fontFamily:"'JetBrains Mono',monospace", letterSpacing:'.5px' }}>ANÁLISE</span>
        </div>
        {hAtkPct != null && (
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
            color:'var(--t2)', marginBottom:5, display:'flex', gap:10, flexWrap:'wrap' }}>
            <span>🏠 {home}: <span style={{ color:'var(--green)' }}>atk {hAtkPct}%</span> · <span style={{ color:'var(--blue)' }}>def {hDefPct}%</span></span>
            <span>✈️ {away}: <span style={{ color:'var(--green)' }}>atk {aAtkPct}%</span> · <span style={{ color:'var(--blue)' }}>def {aDefPct}%</span></span>
          </div>
        )}
        {reason && <div style={{ marginBottom:5 }}>{reason}</div>}
        {positive && (
          <div style={{ color:'var(--green)', marginBottom:3 }}>
            <span style={{ fontWeight:700 }}>✓ </span>{positive}
          </div>
        )}
        {negative && (
          <div style={{ color:'var(--mute)', fontStyle:'italic' }}>
            <span style={{ fontWeight:700 }}>⚠ </span>{negative}
          </div>
        )}
      </div>

      {/* Result buttons */}
      {onSetResult && (
        <div style={{ display:'flex', gap:4, marginTop:10, justifyContent:'flex-end' }}>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
            color:'var(--mute)', alignSelf:'center', marginRight:'auto' }}>
            Marcar resultado:
          </span>
          {['W','L','V','P'].map(r => {
            const rcc = RESULT_COLORS_FT[r]; const active = bestHist === r
            return (
              <button key={r} onClick={() => onSetResult(bestPickId, active ? null : r)} style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
                padding:'3px 8px', borderRadius:3, cursor:'pointer',
                background: active ? rcc.bg : 'transparent',
                border:`1px solid ${active ? rcc.border : 'var(--border)'}`,
                color: active ? rcc.text : 'var(--t3)',
                minWidth:36, textAlign:'center',
              }}>{rcc.label}</button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Boletim View — Betslip estilo Bet365 "Criar Aposta" ─────────────────────
export function BoletimView({ matches, banca }) {
  const [selected, setSelected] = useState({})  // { [match]: true/false }
  const [stake, setStake]       = useState(10)
  const [copied, setCopied]     = useState(false)

  // Auto-seleciona top 6 picks (maior conf) na montagem
  const topPicks = useMemo(() => {
    return [...matches]
      .sort((a, b) => b.best.conf - a.best.conf)
      .slice(0, 12)
  }, [matches])

  // Pre-seleciona os top 6 na primeira vez
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (!initialized && topPicks.length > 0) {
      const pre = {}
      topPicks.slice(0, 6).forEach(m => { pre[m.match] = true })
      setSelected(pre)
      setInitialized(true)
    }
  }, [topPicks, initialized])

  const toggle = (m) => setSelected(s => ({ ...s, [m]: !s[m] }))

  const active = topPicks.filter(m => selected[m.match])

  // Odd combinada (multiplicação das reais, ou estimativa pela prob)
  const combined = useMemo(() => {
    if (active.length === 0) return { odd: 0, hasReal: false }
    let odd = 1, hasReal = true
    active.forEach(m => {
      const realOdd = m.best.real_odd
      if (realOdd && realOdd > 1) {
        odd *= realOdd
      } else {
        // fallback: odd "fair" a partir da prob do modelo + margem 7%
        const p = m.best.modelMeta?.prob || (m.best.conf / 100)
        const fair = 1 / p
        odd *= fair * 1.07
        hasReal = false
      }
    })
    return { odd: +odd.toFixed(2), hasReal }
  }, [active])

  const potentialReturn = +(combined.odd * stake).toFixed(2)
  const profit          = +(potentialReturn - stake).toFixed(2)

  // Formato de texto para copiar/compartilhar (estilo Bet365 Criar Aposta)
  const shareText = useMemo(() => {
    if (active.length === 0) return ''
    const today = new Date().toLocaleDateString('pt-BR')
    const lines = [
      `🎯 SPORTSBRAIN — BOLETIM DO DIA`,
      `📅 ${today}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━`,
    ]
    active.forEach((m, i) => {
      const pickLabel = m.best.stat === 'Casa Win' ? m.home
                       : m.best.stat === 'Fora Win' ? m.away : 'Empate'
      lines.push(``)
      lines.push(`${i + 1}. ${m.match}`)
      lines.push(`   🏆 ${m.league}`)
      lines.push(`   ⚽ Resultado Final: *${pickLabel}*`)
      if (m.best.real_odd) lines.push(`   💰 Odd: ${m.best.real_odd} · Conf: ${m.best.conf}%`)
      else                 lines.push(`   📊 Conf: ${m.best.conf}%`)
      if (m.best.has_edge) lines.push(`   ✅ Value +${m.best.edge_pp}pp`)
    })
    lines.push(``)
    lines.push(`━━━━━━━━━━━━━━━━━━━━━`)
    lines.push(`📋 ${active.length} palpites combinados`)
    if (combined.hasReal) {
      lines.push(`💹 Odd total: ${combined.odd}`)
      lines.push(`💵 Stake: R$ ${stake.toFixed(2)}`)
      lines.push(`🎁 Retorno potencial: R$ ${potentialReturn.toFixed(2)}`)
      lines.push(`📈 Lucro: R$ ${profit.toFixed(2)}`)
    } else {
      lines.push(`💹 Odd estimada: ~${combined.odd}`)
    }
    lines.push(``)
    lines.push(`🧠 Modelo Poisson-v2 (forma, H2H, calibração mensal)`)
    return lines.join('\n')
  }, [active, combined, stake, potentialReturn, profit])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const handleWhatsApp = () => {
    const encoded = encodeURIComponent(shareText)
    window.open(`https://wa.me/?text=${encoded}`, '_blank')
  }

  if (matches.length === 0) {
    return (
      <EmptyState icon="📋"
        title="Sem palpites ≥60% para o boletim"
        subtitle="Aguarde jogos com maior confiança ou ajuste filtros"/>
    )
  }

  return (
    <div>
      {/* Header do boletim */}
      <div style={{ padding:'12px 14px', marginBottom:12, borderRadius:8,
        background:'linear-gradient(135deg, rgba(0,214,143,.12) 0%, rgba(59,130,246,.08) 100%)',
        border:'1px solid rgba(0,214,143,.25)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
          <span style={{ fontSize:18 }}>📋</span>
          <span style={{ fontSize:14, fontWeight:700, color:'var(--white)' }}>
            Boletim do Dia
          </span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
            color:'var(--green)', background:'rgba(0,214,143,.15)',
            padding:'2px 7px', borderRadius:10, fontWeight:700, marginLeft:'auto' }}>
            {active.length}/{topPicks.length} selecionados
          </span>
        </div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'var(--t3)' }}>
          Top 12 palpites ≥60% · marque para incluir no boletim · compartilhe por WhatsApp
        </div>
      </div>

      {/* Lista de picks estilo betslip */}
      <div style={{ background:'var(--ink2)', border:'1px solid var(--line)',
        borderRadius:8, overflow:'hidden', marginBottom:12 }}>
        {topPicks.map((m, i) => {
          const isSelected = !!selected[m.match]
          const pickLabel  = m.best.stat === 'Casa Win' ? m.home
                           : m.best.stat === 'Fora Win' ? m.away : 'Empate'
          const odd = m.best.real_odd
          return (
            <div key={i} onClick={() => toggle(m.match)} style={{
              padding:'11px 14px', cursor:'pointer',
              borderBottom: i < topPicks.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none',
              background: isSelected ? 'rgba(0,214,143,.06)' : 'transparent',
              transition:'background .15s',
              display:'flex', alignItems:'center', gap:10,
            }}>
              {/* Checkbox */}
              <div style={{
                width:18, height:18, borderRadius:4, flexShrink:0,
                background: isSelected ? 'var(--green)' : 'transparent',
                border:`2px solid ${isSelected ? 'var(--green)' : 'var(--mute)'}`,
                display:'flex', alignItems:'center', justifyContent:'center',
                color:'#000', fontSize:11, fontWeight:900,
              }}>{isSelected ? '✓' : ''}</div>

              {/* Conteúdo */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', marginBottom:3 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:'var(--white)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {m.match}
                  </span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
                    color:'var(--t3)', flexShrink:0 }}>
                    {m.league}
                  </span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                    color:'var(--mute)', letterSpacing:'.5px' }}>
                    RESULTADO FINAL
                  </span>
                  <span style={{ fontSize:12, fontWeight:700,
                    color: m.best.stat === 'Casa Win' ? 'var(--green)'
                         : m.best.stat === 'Fora Win' ? 'var(--blue)' : 'var(--amber)' }}>
                    {pickLabel}
                  </span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
                    color:'var(--soft)', background:'rgba(255,255,255,.05)',
                    padding:'1px 5px', borderRadius:3 }}>
                    {m.best.conf}%
                  </span>
                  {m.best.has_edge && (
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                      color:'var(--green)', background:'rgba(0,214,143,.12)',
                      padding:'1px 5px', borderRadius:3 }}>
                      +{m.best.edge_pp}pp
                    </span>
                  )}
                </div>
              </div>

              {/* Odd */}
              <div style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:900,
                color: odd ? 'var(--white)' : 'var(--mute)',
                background: isSelected ? 'rgba(0,214,143,.15)' : 'rgba(255,255,255,.03)',
                border:`1px solid ${isSelected ? 'rgba(0,214,143,.3)' : 'var(--line)'}`,
                padding:'6px 10px', borderRadius:5, minWidth:54, textAlign:'center', flexShrink:0,
              }}>
                {odd ? odd.toFixed(2) : '—'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer estilo Bet365 — total + stake + return */}
      <div style={{ padding:'14px 16px', borderRadius:8,
        background:'var(--ink2)', border:'2px solid var(--green)',
        boxShadow:'0 4px 12px rgba(0,214,143,.08)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
              color:'var(--mute)', letterSpacing:'.5px', marginBottom:2 }}>
              CRIAR APOSTA · {active.length} SELEÇÕES
            </div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--white)' }}>
              Boletim Combinado
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
              color:'var(--mute)', letterSpacing:'.5px', marginBottom:2 }}>
              ODD TOTAL {!combined.hasReal && '~'}
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:22,
              fontWeight:900, color:'var(--green)', lineHeight:1 }}>
              {combined.odd || '—'}
            </div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
          <div>
            <label style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
              color:'var(--mute)', letterSpacing:'.5px', display:'block', marginBottom:4 }}>
              STAKE (R$)
            </label>
            <input type="number" min="1" step="1" value={stake}
              onChange={e => setStake(Math.max(1, +e.target.value || 1))}
              style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:14, fontWeight:700,
                width:'100%', padding:'8px 10px', borderRadius:5,
                border:'1px solid var(--line)', background:'var(--bg)', color:'var(--white)',
                outline:'none',
              }}/>
          </div>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
              color:'var(--mute)', letterSpacing:'.5px', marginBottom:4 }}>
              RETORNO POTENCIAL
            </div>
            <div style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:16, fontWeight:900,
              color:'var(--green)', padding:'8px 10px',
              background:'rgba(0,214,143,.08)', borderRadius:5,
              border:'1px solid rgba(0,214,143,.2)',
            }}>
              R$ {potentialReturn.toFixed(2)}
            </div>
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'8px 0', borderTop:'1px solid rgba(255,255,255,.05)', marginBottom:10 }}>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)' }}>
            Lucro se ganhar
          </span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, fontWeight:700,
            color: profit > 0 ? 'var(--green)' : 'var(--mute)' }}>
            + R$ {profit.toFixed(2)}
          </span>
        </div>

        {/* Botões de ação */}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={handleCopy} disabled={active.length === 0}
            style={{
              flex:1, padding:'10px', borderRadius:6, cursor: active.length ? 'pointer' : 'not-allowed',
              fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
              background: copied ? 'rgba(0,214,143,.2)' : 'rgba(255,255,255,.05)',
              border:`1px solid ${copied ? 'var(--green)' : 'var(--line)'}`,
              color: copied ? 'var(--green)' : 'var(--white)',
              opacity: active.length ? 1 : 0.4,
              transition:'all .15s',
            }}>
            {copied ? '✓ Copiado!' : '📋 Copiar texto'}
          </button>
          <button onClick={handleWhatsApp} disabled={active.length === 0}
            style={{
              flex:1, padding:'10px', borderRadius:6, cursor: active.length ? 'pointer' : 'not-allowed',
              fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
              background:'rgba(37,211,102,.15)',
              border:'1px solid rgba(37,211,102,.4)',
              color:'#25D366',
              opacity: active.length ? 1 : 0.4,
              transition:'all .15s',
            }}>
            💬 WhatsApp
          </button>
        </div>
      </div>

      {/* Preview do texto que será compartilhado */}
      {active.length > 0 && (
        <details style={{ marginTop:12 }}>
          <summary style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11,
            color:'var(--mute)', cursor:'pointer', padding:'6px 0',
          }}>
            👁 Preview da mensagem
          </summary>
          <pre style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--soft)',
            background:'var(--ink2)', border:'1px solid var(--line)',
            borderRadius:6, padding:'12px 14px', marginTop:6,
            whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:1.5,
          }}>{shareText}</pre>
        </details>
      )}
    </div>
  )
}

// ─── Extrai análises 1X2 (Resultado Final) por jogo ───────────────────────────
export function buildResultadoMatches(props) {
  const byMatch = new Map()
  props.forEach(p => {
    if (!['Casa Win','Empate','Fora Win'].includes(p.stat)) return
    const key = p.match
    if (!byMatch.has(key)) {
      const [home, away] = (p.match || '').split(' vs ')
      byMatch.set(key, {
        match: p.match, home: home || 'Casa', away: away || 'Fora',
        league: p.league || '', country: p.country || '',
        isDerby: p.isDerby, intenseHT: p.intenseHT,
        picks: {},
      })
    }
    byMatch.get(key).picks[p.stat] = p
  })

  // Extrai atk/def percentages do reason do Casa Win (padrão "atk X% def Y%")
  const extractAD = (reason) => {
    if (!reason) return {}
    const re = /atk\s+(\d+)%\s+def\s+(\d+)%/gi
    const matches = [...reason.matchAll(re)]
    return {
      hAtkPct: matches[0] ? +matches[0][1] : null,
      hDefPct: matches[0] ? +matches[0][2] : null,
      aAtkPct: matches[1] ? +matches[1][1] : null,
      aDefPct: matches[1] ? +matches[1][2] : null,
    }
  }

  return Array.from(byMatch.values())
    .filter(m => m.picks['Casa Win'] && m.picks['Empate'] && m.picks['Fora Win'])
    .map(m => {
      const h = m.picks['Casa Win']
      const d = m.picks['Empate']
      const a = m.picks['Fora Win']
      // Best = maior confiança
      const candidates = [h, d, a]
      const best = candidates.reduce((b, c) => c.conf > b.conf ? c : b, candidates[0])
      const ad = extractAD(h.reason)
      return {
        match: m.match, home: m.home, away: m.away,
        league: m.league, country: m.country,
        isDerby: m.isDerby, intenseHT: m.intenseHT,
        homeConf: h.conf, drawConf: d.conf, awayConf: a.conf,
        best, dq: best.dq || 'EST',
        reason: best.reason, positive: best.positive, negative: best.negative,
        ...ad,
      }
    })
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function FtProps() {
  const [props,     setProps]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [loaded,    setLoaded]    = useState(false)
  const [tier,           setTier]          = useState('all')
  const [featuredList,   setFeaturedList]  = useState([])
  const [country,        setCountry]       = useState('all')
  const [leagueFilt,     setLeagueFilt]    = useState('all')
  const [showGeoFilters, setShowGeoFilters]= useState(false)
  const [search,     setSearch]     = useState('')
  const [statFilt,   setStatFilt]   = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [collapsed,  setCollapsed]  = useState({})
  const [tab,      setTab]      = useState('resultado')
  const [history,  setHistory]  = useState([])

  // IA Bet365
  const [aiLoading,  setAiLoading]  = useState(false)
  const [aiContent,  setAiContent]  = useState('')
  const [aiOpen,     setAiOpen]     = useState(false)
  const [claudeKey,  setClaudeKeyState] = useState(() => getClaudeKey())
  const [showKeyInput, setShowKeyInput] = useState(false)
  const aiPanelRef = useRef(null)

  function handleClaudeKey(v) { setClaudeKeyState(v); saveClaudeKey(v) }

  // Scroll para o painel IA quando abrir
  useEffect(() => {
    if (aiOpen) {
      setTimeout(() => {
        const contentEl = document.querySelector('.content')
        if (contentEl) contentEl.scrollTo({ top: 0, behavior: 'smooth' })
        else aiPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 80)
    }
  }, [aiOpen])

  // collapsed[m]=true→CLOSED, false→OPEN, undefined→gi===0 open, others closed
  const toggleMatch = (m, currentIsOpen) => setCollapsed(c => ({ ...c, [m]: currentIsOpen }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetchMatches({ date:today(), sport:'football', per_page: 1000 })
      const raw  = res.matches||res.data||[]
      const all  = []

      // Exclui jogos em andamento OU encerrados — só props para jogos que ainda NÃO começaram
      const shouldSkip = (g) => {
        // API própria: status_meta é o campo mais confiável
        if (g.status_meta?.isFin)    return true   // encerrado
        if (g.status_meta?.isLive)   return true   // ao vivo
        if (g.status_meta?.isHT)     return true   // intervalo (meio-jogo)
        if (g.status_meta?.isActive) return true   // qualquer estado ativo
        const s = (g.status || g.state || g.fixture?.status?.short || '').toLowerCase()
        const skip = [
          'ft','finished','complete','completed','full_time','fim','ended','post','closed', // encerrado
          'live','1h','2h','ht','in_play','active','in_progress','running','in','halftime','paused','break' // ao vivo
        ]
        return skip.some(d => s === d || s.startsWith(d))
      }

      // API retorna g.league como STRING direta ("Premier League") e g.league_country para país
      const normLeague = (g) => {
        const l = (typeof g.league === 'string' ? g.league : g.league?.name)
               || g.competition?.name || g.league_name || ''
        const bad = ['Liga','liga','','Sem Liga']
        return (l && !bad.includes(l) && l.length > 1) ? l : null
      }
      const normCountry = (g) => {
        const c = g.league_country || g.country
               || (typeof g.league === 'object' ? g.league?.country : null)
               || g.competition?.country || ''
        const bad = ['World','world','']
        return (c && !bad.includes(c) && c.length > 1) ? c : null
      }

      if (Array.isArray(raw) && raw.length) {
        // Pré-carrega stats reais de todos os times em paralelo (não-bloqueante)
        const games = raw.filter(g => !shouldSkip(g)).map(g => ({
          home: g.home_team||g.home_team_name||g.teams?.home?.name||g.home||'Casa',
          away: g.away_team||g.away_team_name||g.teams?.away?.name||g.away||'Fora',
          league: normLeague(g) || 'Sem Liga',
          country: normCountry(g) || '',
        })).filter(g => !(g.home === 'Casa' && g.away === 'Fora'))

        // Fetch stats de todos os times únicos em paralelo
        const teamNames = [...new Set(games.flatMap(g => [g.home, g.away]))]
        const statsMap  = {}
        await Promise.allSettled(
          teamNames.map(async name => {
            const s = await fetchTeamStats(name, 'football', 'all')
            if (s) statsMap[name] = s
          })
        )

        // ── Fase 3+5: Calibração mensal (local + server merge) ───────────────
        const localCalib  = rebuildCalibrationCache(30) || loadCalibrationCache()
        const serverCalib = await fetchServerCalibration('football', 30).catch(() => null)
        const calibMap    = mergeCalibrationMaps(serverCalib, localCalib)

        // ── Fase 4: Odds reais (único fetch ao worker) ───────────────────────
        const allOdds = await fetchAllOdds().catch(() => [])

        // ── Fase 2: Forma + H2H em paralelo para todos os jogos ──────────────
        // Limita a 20 jogos para não explodir o ESPN (60 requests por 30 jogos)
        const TOP_N_FORM = 20
        const gamesForForm = games.slice(0, TOP_N_FORM)
        const formMap = new Map()
        await Promise.allSettled(
          gamesForForm.map(async g => {
            const ctx = await buildFormContext(g.home, g.away, g.league).catch(() => null)
            if (ctx) formMap.set(`${g.home}|${g.away}`, ctx)
          })
        )

        games.forEach(({ home, away, league, country }) => {
          const match     = `${home} vs ${away}`
          const homeStats = statsMap[home] || null
          const awayStats = statsMap[away] || null
          const formCtx   = formMap.get(`${home}|${away}`) || null

          // Gera props normais (passa formCtx + calibMap → modelo Poisson-v2)
          const matchProps = ftpTeamProps(home, away, league, country, match, homeStats, awayStats, { formCtx, calibMap })

          // Fase 4: enriquece picks 1X2 com odds reais (Kelly usa banca real do store)
          const gameOdds = matchOddsForGame(allOdds, home, away)
          const banca    = usePerfStore.getState?.().banca || 100
          const enriched = matchProps.map(p => {
            if (!['Casa Win', 'Empate', 'Fora Win'].includes(p.stat)) return p
            return enrichPickWithOdds(p, gameOdds, banca)
          })
          all.push(...enriched)
        })
      }

      const finalProps = all.length ? all : getDemoProps()
      setProps(finalProps)
      setLoaded(true)
      // Auto-save picks to history
      const todayStr = today()
      const toSave = finalProps.map(p => ({
        ...p,
        id: makePickId(todayStr, p.match || '', p.stat || '', p.line || ''),
      }))
      const updatedHist = autoSavePicks(toSave, todayStr, FT_HIST_KEY, 'football')
      setHistory(updatedHist)
    } catch(e) {
      console.warn('[FtProps]', e.message)
      const demoProps = getDemoProps()
      setProps(demoProps)
      setLoaded(true)
      const todayStr = today()
      const toSave = demoProps.map(p => ({
        ...p,
        id: makePickId(todayStr, p.match || '', p.stat || '', p.line || ''),
      }))
      const updatedHist = autoSavePicks(toSave, todayStr, FT_HIST_KEY, 'football')
      setHistory(updatedHist)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [])
  useEffect(() => { fetchFeaturedMatches().then(setFeaturedList).catch(()=>{}) }, [])

  useEffect(() => {
    async function syncFromServer() {
      const synced = await serverSyncHistory(FT_HIST_KEY, 'football')
      setHistory(synced)
    }
    syncFromServer()
    function onVisible() { if (!document.hidden) syncFromServer() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(syncFromServer, 10 * 60 * 1000)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  // ─── IA Bet365 — seleção rule-based + Claude opcional ────────────────────────
  const runBet365AI = useCallback(async () => {
    if (!props.length) return
    setAiLoading(true)
    setAiOpen(true)
    setShowKeyInput(false)

    // ── 1. Seleção rule-based (sempre funciona, sem Claude) ──────────────────
    const norm = s => (s||'').toLowerCase()
      .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/ç/g,'c')
      .replace(/[íìî]/g,'i').replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u')

    const PRIO_LEAGUES = ['brasileirao','serie b','copa do brasil','premier league',
      'la liga','serie a','bundesliga','ligue 1','copa libertadores',
      'champions league','europa league','eredivisie','primeira liga','mls']

    const isLineValid = line => {
      if (!line) return true // resultado sem número
      const m = String(line).match(/[OU]?([\d.]+)/)
      if (!m) return true
      const n = parseFloat(m[1])
      return isNaN(n) || (n % 1 === 0.5) // só X.5
    }

    const scored = props
      .filter(p => p && p.tier !== 'aggressive' && p.conf >= 55 && isLineValid(p.line))
      .map(p => {
        const lg = norm(p.league || '')
        const isPrio = PRIO_LEAGUES.some(l => lg.includes(norm(l)))
        const score = p.conf * 0.65 + Math.max(0, p.ev || 0) * 2.5 + (isPrio ? 10 : 0) + (p.tier === 'safe' ? 5 : 0)
        return { ...p, _score: score, _isPrio: isPrio }
      })
      .sort((a, b) => b._score - a._score)

    // Max 2 picks por jogo, top 10 total, sem repetir (match+stat combo)
    const seenMatch = new Map()
    const seenStat  = new Set()
    const top = []
    for (const p of scored) {
      if (top.length >= 10) break
      const matchCount = seenMatch.get(p.match) || 0
      if (matchCount >= 2) continue
      const statKey = `${p.match}|${p.stat}`
      if (seenStat.has(statKey)) continue
      top.push(p)
      seenMatch.set(p.match, matchCount + 1)
      seenStat.add(statKey)
    }

    // Renderiza picks rule-based como HTML
    const TIER_ICON = { safe: '🛡', median: '⚖', aggressive: '🔥' }
    const confColor = c => c >= 68 ? 'var(--green)' : c >= 58 ? 'var(--blue)' : 'var(--amber)'
    const evColor   = e => e >= 5 ? 'var(--green)' : e >= 0 ? 'var(--amber)' : 'var(--mute)'

    const picksHtml = top.length === 0
      ? '<div style="color:var(--mute);font-size:12px;padding:12px 0;text-align:center">Nenhum pick ≥55% conf encontrado para hoje. Tente ajustar os filtros.</div>'
      : top.map((p, i) => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:900;color:${p._isPrio?'var(--green)':'var(--blue)'};min-width:20px;margin-top:1px">${i+1}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--white);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.match}</div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px">
              <span style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:800;color:var(--amber)">${p.stat} <span style="color:var(--white)">${p.line}</span></span>
              <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${confColor(p.conf)};background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">${p.conf}%</span>
              <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:${evColor(p.ev || 0)}">EV ${(p.ev||0)>=0?'+':''}${p.ev||0}%</span>
              <span style="font-size:11px">${TIER_ICON[p.tier]||''}</span>
              ${p._isPrio ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:9px;color:var(--green);background:rgba(0,214,143,.1);padding:1px 5px;border-radius:3px">⭐ Bet365</span>' : ''}
            </div>
            <div style="font-size:10px;color:var(--mute)">${p.league}${p.country?' · '+p.country:''}</div>
            ${p.reason ? `<div style="font-size:10px;color:var(--dim);margin-top:2px;line-height:1.4">${String(p.reason).slice(0,120)}${String(p.reason).length>120?'…':''}</div>` : ''}
          </div>
        </div>`).join('')

    const statsLine = `${props.filter(p=>p.tier==='safe').length} seguras · ${props.filter(p=>p.conf>=65).length} conf≥65% · ${props.filter(p=>p._isPrio||false).length || top.filter(p=>p._isPrio).length} ligas prio`

    let html = `<div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--green);font-weight:700">🤖 Seleção Automática — ${top.length} picks encontrados</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--dim)">${statsLine}</span>
      </div>
      ${picksHtml}
      <div style="margin-top:10px;padding:8px;background:rgba(255,255,255,.02);border-radius:5px;font-size:10px;color:var(--dim)">
        Critérios: Conf ≥55% · Tier safe/median · Linhas X.5 · Máx 2 picks/jogo · ⭐ = disponível na Bet365 BR
      </div>
    </div>`

    setAiContent(html)

    // ── 2. Se tem chave Claude — enriquece com análise IA ───────────────────
    const key = claudeKey || getClaudeKey()
    if (key && top.length > 0) {
      setAiContent(html + '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)"><div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--blue);margin-bottom:6px">🎯 Análise Claude IA…</div></div>')

      const today2 = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' })
      const pickLines = top.map((p, i) =>
        `${i+1}. ${p.match} [${p.league}] — ${p.stat} ${p.line} | Conf: ${p.conf}% | EV: ${(p.ev||0)>=0?'+':''}${p.ev||0}% | ${p.tier}`
      ).join('\n')

      const prompt = `Você é analista profissional de apostas focado na Bet365 Brasil. ${today2}.

Os ${top.length} melhores picks selecionados automaticamente para hoje:
${pickLines}

Forneça uma análise CURTA e OBJETIVA em português:
## 🎯 Análise dos Picks
Para cada pick, 1 frase de justificativa adicional e nível de confiança pessoal (Alto/Médio/Baixo).

## 📊 Gestão de Banca
% sugerida por pick (Kelly simplificado, banca conservadora).

## ✅ Veredicto
1-2 frases. Máximo total: 400 palavras.`

      try {
        const text = await callClaude(key, prompt, 1500)
        setAiContent(html + '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)">' + mdToHtml(text) + '</div>')
      } catch(e) {
        const msg = e.message || 'Erro'
        setAiContent(html + `<div style="margin-top:10px;font-size:11px;color:var(--red)">❌ Claude: ${msg}</div>`)
      }
    }

    setAiLoading(false)
  }, [claudeKey, props])

  // Demo com times reais
  function getDemoProps() {
    const demos = [
      { hn:'Manchester City', an:'Arsenal',  league:'Premier League',  country:'England' },
      { hn:'Real Madrid',     an:'Barcelona',league:'La Liga',         country:'Spain'   },
      { hn:'Bayern',          an:'Dortmund', league:'Bundesliga',      country:'Germany' },
      { hn:'PSG',             an:'Lyon',     league:'Ligue 1',         country:'France'  },
      { hn:'Flamengo',        an:'Palmeiras',league:'Brasileirao',     country:'Brazil'  },
      { hn:'Inter',           an:'Milan',    league:'Serie A',         country:'Italy'   },
    ]
    const all = []
    demos.forEach(({ hn, an, league, country }) =>
      all.push(...ftpTeamProps(hn, an, league, country, `${hn} vs ${an}`))
    )
    return all
  }

  const countries = useMemo(() =>
    ['all', ...new Set(props.map(p => p.country).filter(c =>
      Boolean(c) && c !== 'World' && c !== 'world' && c.length > 1
    ))].filter((v,i,a) => i===0 || a.indexOf(v)===i), [props])

  const leagues = useMemo(() =>
    ['all', ...new Set(props.map(p => p.league).filter(l =>
      Boolean(l) && l !== 'Sem Liga' && l !== 'Liga' && l.length > 1
    ))].filter((v,i,a) => i===0 || a.indexOf(v)===i), [props])

  const filtered = useMemo(() => {
    let p = props
    if (tier !== 'all')        p = p.filter(x => x.tier === tier)
    if (country !== 'all')     p = p.filter(x => x.country === country)
    if (leagueFilt !== 'all')  p = p.filter(x => x.league === leagueFilt)
    if (typeFilter !== 'all')  p = p.filter(x => x.type === typeFilter)
    if (statFilt !== 'all') {
      if (statFilt === 'Resultado') p = p.filter(x => ['Casa Win','Empate','Fora Win'].includes(x.stat))
      else if (statFilt === 'Gols') p = p.filter(x => (x.stat||'').includes('Gols'))
      else if (statFilt === 'BTTS') p = p.filter(x => (x.stat||'').includes('BTTS'))
      else if (statFilt === '1T')  p = p.filter(x => (x.stat||'').includes('1T'))
      else p = p.filter(x => (x.stat||'').toLowerCase().includes(statFilt.toLowerCase()))
    }
    if (search.trim())      p = p.filter(x =>
      (x.team||'').toLowerCase().includes(search.toLowerCase()) ||
      (x.match||'').toLowerCase().includes(search.toLowerCase()))
    return p
  }, [props, tier, country, leagueFilt, typeFilter, statFilt, search])

  const groupedByMatch = useMemo(() => {
    const map = new Map()
    filtered.forEach(p => {
      if (!map.has(p.match)) map.set(p.match, { match:p.match, league:p.league, country:p.country, props:[] })
      map.get(p.match).props.push(p)
    })
    return Array.from(map.values()).sort((a, b) => {
      const [aH, aA] = (a.match||'').split(' vs ')
      const [bH, bA] = (b.match||'').split(' vs ')
      return matchPriority(aH, aA, a.league||'', featuredList) - matchPriority(bH, bA, b.league||'', featuredList)
    })
  }, [filtered, featuredList])

  const kpis = {
    total:   props.length,
    seguras: props.filter(p => p.tier==='safe').length,
    valor:   props.filter(p => p.ev > 4).length,
    avgConf: props.length ? Math.round(props.reduce((a,p) => a+p.conf, 0)/props.length) : 0,
  }

  const histStats = useMemo(() => calcHistStats(history), [history])
  const histById = useMemo(() => {
    const m = {}; history.forEach(h => { m[h.id] = h.result }); return m
  }, [history])

  // Resultado Final: ≥60% conf (era 75 mas com Poisson real raramente passa 70%)
  const RESULTADO_CONF_MIN = 60
  const resultadoMatches = useMemo(() => {
    let p = props
    if (country !== 'all')    p = p.filter(x => x.country === country)
    if (leagueFilt !== 'all') p = p.filter(x => x.league === leagueFilt)
    if (search.trim())        p = p.filter(x =>
      (x.match||'').toLowerCase().includes(search.toLowerCase()))
    const matches = buildResultadoMatches(p)
      .filter(m => m.best.conf >= RESULTADO_CONF_MIN)   // ≥60% (Poisson real)
    // Ordena por prioridade (Bet365 featured → Brasil → resto)
    return matches.sort((a, b) => {
      const pa = matchPriority(a.home, a.away, a.league, featuredList)
      const pb = matchPriority(b.home, b.away, b.league, featuredList)
      if (pa !== pb) return pa - pb
      // Dentro da mesma prioridade: maior confiança da pick principal primeiro
      return b.best.conf - a.best.conf
    })
  }, [props, country, leagueFilt, search, featuredList])

  function handleSetResult(id, result) {
    const updated = updateHistResult(id, result, FT_HIST_KEY)
    setHistory(updated)
  }

  return (
    <div className="page">
      <PageHeader icon="⚽" title="Futebol Props"
        subtitle={loaded?`${props.length} props · ${groupedByMatch.length} jogos`:'Carregando...'}
        actions={
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <button onClick={load} className="btn" style={{padding:'4px 10px',fontSize:11}}>↺ Atualizar</button>
            <button onClick={runBet365AI} disabled={aiLoading || !loaded}
              className="btn"
              style={{ padding:'5px 12px', fontSize:11, fontWeight:700,
                background: aiLoading ? 'rgba(0,214,143,.06)' : 'rgba(0,214,143,.14)',
                borderColor:'rgba(0,214,143,.35)', color:'var(--green)' }}>
              {aiLoading ? '⏳ Analisando…' : '🎯 IA Bet365'}
            </button>
          </div>
        }
      />

      <KpiRow>
        <Kpi value={kpis.total}   label="Total Props"    color="var(--soft)"/>
        <Kpi value={kpis.seguras} label="🛡 Seguras"    color="var(--blue)"/>
        <Kpi value={kpis.valor}   label="💡 Alto EV"    color="var(--purple)"/>
        <Kpi value={kpis.avgConf?`${kpis.avgConf}%`:'-'} label="Conf Média" color="var(--green)"/>
      </KpiRow>

      {/* IA Bet365 — painel de resultado */}
      {aiOpen && (
        <div ref={aiPanelRef} style={{ background:'rgba(0,0,0,.4)', border:'1px solid rgba(0,214,143,.25)',
          borderRadius:'var(--r2)', padding:'14px 16px', marginBottom:12,
          boxShadow:'0 0 28px rgba(0,214,143,.07)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:800,
              color:'var(--green)', display:'flex', alignItems:'center', gap:8 }}>
              <span>🎯 Best Bets Bet365</span>
              {aiLoading && <span style={{ fontSize:10, color:'var(--blue)' }}>⏳ analisando…</span>}
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              {/* Chave Claude opcional */}
              {showKeyInput ? (
                <>
                  <input type="password" value={claudeKey} onChange={e => handleClaudeKey(e.target.value)}
                    placeholder="sk-ant-… (opcional: Claude IA)"
                    style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
                      padding:'3px 7px', background:'rgba(255,255,255,.05)',
                      border:'1px solid rgba(59,130,246,.3)', borderRadius:4,
                      color:'var(--text)', outline:'none', width:200 }}
                  />
                  <button onClick={() => { setShowKeyInput(false); runBet365AI() }}
                    style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
                      padding:'3px 8px', borderRadius:4, cursor:'pointer',
                      background:'rgba(59,130,246,.15)', border:'1px solid rgba(59,130,246,.3)',
                      color:'var(--blue)' }}>✓</button>
                  <button onClick={() => setShowKeyInput(false)}
                    style={{ background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:14 }}>✕</button>
                </>
              ) : (
                <>
                  <button onClick={() => setShowKeyInput(v => !v)}
                    title={claudeKey ? 'Claude AI configurado' : 'Adicionar Claude AI (opcional)'}
                    style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
                      padding:'3px 8px', borderRadius:4, cursor:'pointer',
                      background: claudeKey ? 'rgba(0,214,143,.1)' : 'rgba(255,255,255,.05)',
                      border: `1px solid ${claudeKey ? 'rgba(0,214,143,.3)' : 'rgba(255,255,255,.1)'}`,
                      color: claudeKey ? 'var(--green)' : 'var(--mute)' }}>
                    {claudeKey ? '🤖 IA ✓' : '🤖 +IA'}
                  </button>
                  <button onClick={runBet365AI} disabled={aiLoading}
                    style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
                      padding:'3px 9px', borderRadius:4, cursor:'pointer',
                      background:'rgba(0,214,143,.1)', border:'1px solid rgba(0,214,143,.3)',
                      color:'var(--green)' }}>
                    ↺ Atualizar
                  </button>
                </>
              )}
              <button onClick={() => setAiOpen(false)}
                style={{ background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize:16, lineHeight:1 }}>
                ✕
              </button>
            </div>
          </div>
          {!claudeKey && !showKeyInput && (
            <div style={{ fontSize:10, color:'var(--dim)', marginBottom:8, fontFamily:"'JetBrains Mono',monospace" }}>
              💡 Clique em <span style={{ color:'var(--blue)' }}>🤖 +IA</span> para adicionar análise Claude (opcional) ·{' '}
              <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color:'var(--blue)' }}>console.anthropic.com</a>
            </div>
          )}
          {aiLoading && !aiContent && (
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11,
              color:'var(--mute)', textAlign:'center', padding:'20px 0' }}>
              ⏳ Selecionando melhores picks ({props.filter(p => p.conf>=55&&p.tier!=='aggressive').length} candidatos)…
            </div>
          )}
          {aiContent && (
            <div style={{ fontSize:12, color:'var(--soft)', lineHeight:1.7 }}
              dangerouslySetInnerHTML={{ __html: aiContent }}
            />
          )}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display:'flex', gap:0, marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[
          { id:'resultado', label:`🎯 Resultado Final ${resultadoMatches.length > 0 ? resultadoMatches.length : ''}` },
          { id:'boletim',   label:`📋 Boletim` },
          { id:'props',     label:`⚽ Props` },
          { id:'historico', label:`📊 Histórico ${history.length > 0 ? history.length : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700,
            padding:'8px 16px', background:'none', border:'none',
            borderBottom: tab===t.id ? '2px solid var(--green)' : '2px solid transparent',
            color: tab===t.id ? 'var(--green)' : 'var(--mute)',
            cursor:'pointer', marginBottom:-1,
          }}>{t.label}</button>
        ))}
        {histStats.wr != null && (
          <span style={{ marginLeft:'auto', alignSelf:'center', fontSize:11,
            fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)',
            paddingRight:4 }}>
            {histStats.wr.toFixed(0)}% WR · {histStats.wins}W/{histStats.losses}L
          </span>
        )}
      </div>

      {tab === 'historico' && (
        <HistoricoView
          history={history}
          histStats={histStats}
          onSetResult={handleSetResult}
          sport="football"
          emptyTitle="Histórico de Futebol Props vazio"
          emptySubtitle="Os props gerados são salvos automaticamente. Marque os resultados (Win/Loss) para calibrar o modelo."
        />
      )}

      {tab === 'boletim' && (
        <BoletimView
          matches={resultadoMatches}
          banca={usePerfStore.getState?.().banca || 100}
        />
      )}

      {tab === 'resultado' && (<>
        {/* Banner confiança mínima */}
        <div style={{ padding:'8px 12px', marginBottom:10, borderRadius:6,
          background:'rgba(0,214,143,.08)', border:'1px solid rgba(0,214,143,.2)',
          display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:14 }}>🎯</span>
          <span style={{ fontSize:12, color:'var(--white)', fontWeight:700 }}>
            Palpites Resultado Final — ≥60% confiança
          </span>
          <span style={{ fontSize:10, color:'var(--mute)',
            fontFamily:"'JetBrains Mono',monospace", marginLeft:'auto' }}>
            Padrão de alta consistência histórica (modelo 1X2)
          </span>
        </div>

        {/* Filtros compactos para Resultado Final */}
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar time ou jogo..."
            style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:'6px 10px', borderRadius:6,
              border:'1px solid var(--line)', background:'var(--ink2)', color:'var(--white)', outline:'none', width:220 }}/>
          {leagues.length > 1 && (
            <select value={leagueFilt} onChange={e => setLeagueFilt(e.target.value)} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:'6px 10px', borderRadius:6,
              border:'1px solid var(--line)', background:'var(--ink2)', color:'var(--white)', outline:'none' }}>
              {leagues.map(l => <option key={l} value={l}>{l === 'all' ? '🏆 Todas as ligas' : l}</option>)}
            </select>
          )}
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'var(--mute)', marginLeft:'auto' }}>
            {resultadoMatches.length} jogos · pick médio {
              resultadoMatches.length
                ? Math.round(resultadoMatches.reduce((a,m) => a + m.best.conf, 0) / resultadoMatches.length)
                : 0
            }% conf
          </span>
        </div>

        {loading && !loaded && (
          <div className="loading-center"><div className="spinner"/><span>Carregando palpites...</span></div>
        )}
        {loaded && resultadoMatches.length === 0 && (
          <EmptyState icon="🎯" title="Nenhum palpite de Resultado Final"
            subtitle="Ajuste os filtros ou atualize os dados"/>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))', gap:12 }}>
          {resultadoMatches.map((m, i) => (
            <ResultadoFinalCard key={i} data={m} onSetResult={handleSetResult} histById={histById}/>
          ))}
        </div>
      </>)}

      {tab === 'props' && (<>

      {/* Tier filter */}
      <div className="filter-bar">
        {TIERS.map(t => (
          <button key={t.id}
            className={`filter-chip${tier===t.id?' active':''}`}
            onClick={() => setTier(t.id)}>
            {t.label}
          </button>
        ))}
        <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',alignSelf:'center',marginLeft:'auto'}}>
          {filtered.length} props
        </span>
      </div>

      {/* Toggle País / Liga */}
      {(() => {
        const geoActive = country !== 'all' || leagueFilt !== 'all'
        const activeLabel = country !== 'all' ? country : leagueFilt !== 'all' ? leagueFilt : null
        return (
          <div style={{marginBottom:8}}>
            <div style={{display:'flex',gap:6,alignItems:'center',marginBottom: showGeoFilters ? 8 : 0}}>
              <button onClick={() => setShowGeoFilters(v => !v)} style={{
                fontFamily:"'JetBrains Mono',monospace",fontSize: 11,padding:'3px 10px',borderRadius:4,cursor:'pointer',
                border:`1px solid ${geoActive?'rgba(0,214,143,.4)':'rgba(255,255,255,.08)'}`,
                background: geoActive?'rgba(0,214,143,.08)':'transparent',
                color: geoActive?'var(--green)':'var(--mute)',
                display:'flex',alignItems:'center',gap:5,
              }}>
                🌍 País / Liga
                {activeLabel && <span style={{color:'var(--green)',fontWeight:700}}>· {activeLabel}</span>}
                <span style={{opacity:.5,fontSize:7,transition:'transform .2s',display:'inline-block',transform:showGeoFilters?'rotate(180deg)':'none'}}>▼</span>
              </button>
              {geoActive && (
                <button onClick={() => { setCountry('all'); setLeagueFilt('all') }} style={{
                  fontFamily:"'JetBrains Mono',monospace",fontSize:7,padding:'2px 7px',borderRadius:4,cursor:'pointer',
                  border:'1px solid rgba(255,79,106,.3)',background:'rgba(255,79,106,.08)',color:'var(--red)',
                }}>✕ limpar</button>
              )}
            </div>

            {showGeoFilters && (
              <div style={{background:'rgba(255,255,255,.02)',border:'1px solid rgba(255,255,255,.06)',borderRadius:6,padding:'10px 12px',display:'flex',flexDirection:'column',gap:8}}>
                {/* Países */}
                {countries.length > 1 && (
                  <div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'var(--dim)',marginBottom:5,letterSpacing:'1px'}}>🌍 PAÍS</div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                      {countries.map(c => (
                        <button key={c}
                          className={`filter-chip${country===c?' active-green':''}`}
                          style={{fontSize:10,padding:'3px 10px'}}
                          onClick={() => setCountry(c)}>
                          {c==='all'?'Todos':c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Ligas */}
                {leagues.length > 1 && (
                  <div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:'var(--dim)',marginBottom:5,letterSpacing:'1px'}}>🏆 LIGA</div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                      {leagues.map(l => (
                        <button key={l}
                          className={`filter-chip${leagueFilt===l?' active':''}`}
                          style={{fontSize:10,padding:'3px 10px'}}
                          onClick={() => setLeagueFilt(l)}>
                          {l==='all'?'Todas':l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Busca + tipo + stat */}
      <div className="filter-bar" style={{flexDirection:'column',alignItems:'stretch',gap:8}}>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar time ou liga..."
            style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,padding:'5px 10px',borderRadius:6,
              border:'1px solid var(--line)',background:'var(--ink2)',color:'var(--white)',outline:'none',width:180}}/>
          {search && (
            <button onClick={() => setSearch('')} style={{background:'none',border:'none',color:'var(--mute)',cursor:'pointer',padding:'2px 4px',fontSize:11}}>✕</button>
          )}
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginLeft:'auto'}}>
            {filtered.length} props
          </span>
        </div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
          {['all','resultado','team','ht','cartoes'].map(t => (
            <button key={t}
              className={`filter-chip${typeFilter===t?' active':''}`}
              onClick={() => setTypeFilter(t)}>
              {t==='all'?'Todos':t==='resultado'?'⚽ Palpites':t==='team'?'📊 Stats':t==='ht'?'🕐 1T':'🟨 Cartões'}
            </button>
          ))}
          {STAT_FILTERS.filter(s=>s!=='all').map(s => (
            <button key={s}
              className={`filter-chip${statFilt===s?' active-green':''}`}
              onClick={() => setStatFilt(statFilt===s?'all':s)}>
              {s==='Resultado'?'⚽ Resultado':s==='Gols'?'🎯 Gols':s==='BTTS'?'🔵 BTTS':s==='Cartões'?'🟨 Cartões':s}
            </button>
          ))}
        </div>
      </div>

      {loading && !loaded && (
        <div className="loading-center"><div className="spinner"/><span>Carregando Futebol Props...</span></div>
      )}
      {loaded && filtered.length===0 && (
        <EmptyState icon="⚽" title="Nenhum prop encontrado" subtitle="Ajuste os filtros ou atualize os dados"/>
      )}

      {groupedByMatch.map((group, gi) => {
        const isOpen = group.match in collapsed ? !collapsed[group.match] : gi === 0
        return (
          <div key={gi} style={{marginBottom:10,background:'var(--ink2)',borderRadius:'var(--r2)',
            border:'1px solid var(--line)',overflow:'hidden',
            transition:'border-color var(--transition-fast)'}}>
            <button onClick={() => toggleMatch(group.match, isOpen)} className="match-row" style={{
              width:'100%',display:'flex',alignItems:'center',gap:8,padding:'10px 14px',
              background:'none',border:'none',cursor:'pointer',textAlign:'left',borderRadius:0}}>
              <span style={{fontSize:11,color:isOpen?'var(--green)':'var(--mute)',flexShrink:0}}>
                {isOpen?'▼':'▶'}
              </span>
              <span style={{fontSize:13,fontWeight:700,color:'var(--white)',flex:1,minWidth:0,
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{group.match}</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--t3)',flexShrink:0}}>
                {group.league} · {group.country}
              </span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--blue)',
                background:'var(--b3)',padding:'2px 8px',borderRadius:10,flexShrink:0,fontWeight:700}}>
                {group.props.length}
              </span>
            </button>
            {isOpen && (
              <div style={{padding:'0 12px 12px'}}>
                {(() => {
                  const mm = new Map()
                  group.props.forEach(p => {
                    const m = getPropMethodFt(p.stat)
                    if (!mm.has(m.key)) mm.set(m.key, { ...m, props:[] })
                    mm.get(m.key).props.push(p)
                  })
                  return Array.from(mm.values())
                    .sort((a,b) => a.order - b.order)
                    .map(m => (
                      <MethodSection key={m.key} label={m.label} count={m.props.length}>
                        {m.props.map((p,i) => {
                          const pid = makePickId(today(), p.match||'', p.stat||'', p.line||'')
                          return <PropCard key={i} prop={p} pickId={pid} histResult={histById[pid]??null} onSetResult={handleSetResult}/>
                        })}
                      </MethodSection>
                    ))
                })()}
              </div>
            )}
          </div>
        )
      })}

      </>)}
    </div>
  )
}
