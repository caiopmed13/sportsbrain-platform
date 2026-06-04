// ═══════════════════════════════════════════════════════════════════════════
// Palpites — Resultado Final (1/X/2) + Ambas Marcam (BTTS) por jogo
// ═══════════════════════════════════════════════════════════════════════════
// Para cada jogo do dia, mostra:
//   · Quem vence (ou empate) com % Poisson
//   · Ambas Marcam SIM/NÃO com % Poisson
// Exibe TODOS os jogos (sem filtro de 75%) — usuário decide
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import { fetchMatches, fetchTeamStats, fetchMatchDetailByTeams, fetchXG, fetchRefereeStats } from '../api/client'
import { fetchAllOdds, matchOddsForGame, findOddsEvent } from '../utils/oddsEdge'
import { computeMatchResult, probToConfidence, buildNarrative } from '../utils/matchResultModel'
import { buildBTTSPick } from '../utils/bttsModel'
import { buildFormContext } from '../utils/teamForm'
import { noVigFromGameOdds, noVigTwoWay, compareToNoVig } from '../utils/noVig'
import { logPick, computeRollingClv, autoCloseRipePicks } from '../utils/clvTracker'
import { getBlacklist, isBlacklisted, bettingWindow, shouldStopPick } from '../utils/marketBlacklist'
import { applyCalibration, autoRebuildIfStale } from '../utils/pickCalibration'

// Data no fuso de Brasília (UTC-3) — evita pedir amanhã às 22h BR
function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
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
// Formata horário do jogo em Brasília
function kickoffBR(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    })
  } catch { return '' }
}

// Slug de liga para /v1/xg (mapeia nome "humano" → slug ESPN)
const LEAGUE_SLUG_MAP = {
  // Brasil
  'Brasileirão A': 'bra.1', 'Brasileirão B': 'bra.2', 'Série C': 'bra.3',
  'Copa do Brasil': 'bra.copa_do_brazil',
  'Copa do Nordeste': 'bra.copa_do_nordeste',
  'Supercopa do Brasil': 'bra.supercopa_do_brazil',
  'Paulistão': 'bra.camp.paulista',
  'Campeonato Carioca': 'bra.camp.carioca',
  'Campeonato Mineiro': 'bra.camp.mineiro',
  'Campeonato Gaúcho': 'bra.camp.gaucho',
  // América do Sul
  'Copa Libertadores': 'conmebol.libertadores',
  'Copa Sudamericana': 'conmebol.sudamericana',
  'Copa América': 'conmebol.america',
  'Recopa Sulamericana': 'conmebol.recopa',
  // Europa
  'Premier League': 'eng.1', 'La Liga': 'esp.1', 'Bundesliga': 'ger.1',
  'Serie A': 'ita.1', 'Ligue 1': 'fra.1',
  'Champions League': 'uefa.champions', 'Europa League': 'uefa.europa',
  'Conference League': 'uefa.europa_conference',
  'Primeira Liga': 'por.1',
  // Américas
  'Liga Argentina': 'arg.1', 'Copa Argentina': 'arg.copa',
  'MLS': 'usa.1', 'Liga MX': 'mex.1',
}
function leagueSlug(name) {
  if (!name) return null
  if (LEAGUE_SLUG_MAP[name]) return LEAGUE_SLUG_MAP[name]
  const n = name.toLowerCase()
  // Disambiguação: "Premier League" prefixado com país = liga local, não EPL
  // TheOddsAPI usa "Belarus Premier League", "Russia Premier League", etc.
  if (n.includes('belarus')) return 'blr.1'
  if (n.includes('russia')) return 'rus.1'
  if (n.includes('ukrain')) return 'ukr.1'
  if (n.includes('scotland') || n.includes('scottish')) return 'sco.1'
  if (n.includes('turkey') || n.includes('turkish') || n.includes('super lig')) return 'tur.1'
  if (n.includes('greek') || n.includes('greece')) return 'gre.1'
  if (n.includes('norwegian') || n.includes('norway') || n.includes('eliteserien')) return 'nor.1'
  if (n.includes('swedish') || n.includes('sweden') || n.includes('allsvenskan')) return 'swe.1'
  if (n.includes('danish') || n.includes('denmark') || n.includes('superliga')) return 'den.1'
  if (n.includes('czech')) return 'cze.1'
  if (n.includes('polish') || n.includes('poland') || n.includes('ekstraklasa')) return 'pol.1'
  // Só depois checa English Premier League (inclui "english premier" explícito)
  if (n.includes('english premier') || n === 'premier league') return 'eng.1'
  // fallback: tenta achar por substring no mapa
  const k = Object.keys(LEAGUE_SLUG_MAP).find(k => name.includes(k) || k.includes(name))
  return k ? LEAGUE_SLUG_MAP[k] : null
}
// Season heuristics: europeias (eng/esp/ger/ita/fra/uefa/por) Aug-May cross-year
// → antes de Jul usa ano-1 como season; resto (Brasil/MLS/Arg) usa ano corrente.
function currentSeason(dateStr, slug) {
  try {
    const d = dateStr ? new Date(dateStr) : new Date()
    const year = d.getFullYear()
    const month = d.getMonth() + 1   // 1-12
    const isEuro = slug && /^(eng|esp|ger|ita|fra|uefa|por|ned)\./i.test(slug)
    if (isEuro && month <= 6) return String(year - 1)
    return String(year)
  } catch { return String(new Date().getFullYear()) }
}

// Pre-compute propCtx (xG + enrichment + referee + market odds) for a match
async function buildPropCtx({ home, away, league, date, oddsEvents }) {
  const slug = leagueSlug(league)
  const season = currentSeason(date, slug)
  const [xgH, xgA, detail] = await Promise.all([
    slug ? fetchXG(home, { league: slug, season }).catch(() => null) : null,
    slug ? fetchXG(away, { league: slug, season }).catch(() => null) : null,
    fetchMatchDetailByTeams(home, away, date).catch(() => null),
  ])
  const refName = detail?.officials?.[0]?.referee_name || detail?.referee || null
  const refStats = refName ? await fetchRefereeStats(refName).catch(() => null) : null

  // PPDA da match_team_metrics (só existe se pós-jogo ou dataset enriquecido)
  let ppda = null
  if (detail?.team_metrics?.length >= 2) {
    const h = detail.team_metrics.find(t => t.is_home === 1)
    const a = detail.team_metrics.find(t => t.is_home === 0)
    if (h?.ppda != null && a?.ppda != null) ppda = { home: +h.ppda, away: +a.ppda }
  }

  // Key player out: cruzar top scorer do time com starters confirmados
  const lineupsCtx = { home: {}, away: {} }
  if (detail?.lineups?.home?.length && xgH?.top_scorers?.length) {
    const starters = new Set(detail.lineups.home.filter(p => p.is_starter).map(p => p.player_name))
    const top = xgH.top_scorers[0]
    if (top && !starters.has(top.player_name)) {
      lineupsCtx.home = { starScorerOut: true, missingName: top.player_name, missingGoals: top.goals }
    }
  }
  if (detail?.lineups?.away?.length && xgA?.top_scorers?.length) {
    const starters = new Set(detail.lineups.away.filter(p => p.is_starter).map(p => p.player_name))
    const top = xgA.top_scorers[0]
    if (top && !starters.has(top.player_name)) {
      lineupsCtx.away = { starScorerOut: true, missingName: top.player_name, missingGoals: top.goals }
    }
  }

  // Odds de mercado (melhor H2H entre bookmakers) + bestBook por mercado
  let marketOdds = null
  if (oddsEvents?.length) {
    const m = matchOddsForGame(oddsEvents, home, away)
    if (m && (m.home || m.draw || m.away)) {
      marketOdds = {
        h: m.home || null, d: m.draw || null, a: m.away || null,
        bestBook: m.bestBook || null,
      }
    }
  }

  return {
    xgHome: xgH, xgAway: xgA,
    weather: detail?.weather || null,
    refStats: refStats || null,
    lineupsCtx,
    ppda,
    marketOdds,
  }
}

// ─── Cor conforme confiança ──────────────────────────────────────────────
function confColor(c) {
  if (c >= 75) return 'var(--green)'
  if (c >= 65) return '#5ecbff'
  if (c >= 55) return 'var(--amber)'
  return 'var(--mute)'
}

// ─── Top Pick: escolhe o melhor mercado entre 1X2, BTTS, Over, Combos ────
// Critério: conf calibrada × (1 + max(0, EV)/20) — favorece edge real
// + No-vig de mercado (sharp benchmark): edge fake (<3pp) penalizado
// + Blacklist: pares (liga × mercado) com ROI ruim ficam fora
// + Stop-pick: mercado com drift de Brier >15% é ocultado
// Retorna { market, label, side, prob, conf, ev, kelly, fairProb, fairGap,
//           edgeClass, dataQuality, premium, window }
function selectTopPick(game, blacklist, calibMap) {
  const { result, btts, home, away, league, time } = game
  const { dataQuality, marketEdge } = result

  // No-vig do mercado (sharp benchmark) — base p/ comparar com nossa prob
  const mo = result?.gameOdds
  const fair1X2 = mo ? noVigFromGameOdds({ h: mo.h, d: mo.d, a: mo.a }) : null
  // BTTS 2-way: book costuma dar btts_yes; se não tiver btts_no, pulamos (preferimos null a chute)
  const fairBTTS = (mo?.btts_yes && mo?.btts_no)
    ? noVigTwoWay(mo.btts_yes, mo.btts_no) : null

  const candidates = []

  // 1X2
  const opts1X2 = [
    { market: '1X2', label: `Vitória ${home}`,  side: 'H', prob: result.pHome, edge: marketEdge?.home, fairProb: fair1X2?.pH },
    { market: '1X2', label: `Empate`,           side: 'D', prob: result.pDraw, edge: marketEdge?.draw, fairProb: fair1X2?.pD },
    { market: '1X2', label: `Vitória ${away}`,  side: 'A', prob: result.pAway, edge: marketEdge?.away, fairProb: fair1X2?.pA },
  ]
  // BTTS
  const bttsOpt = btts.bestSide === 'SIM'
    ? { market: 'BTTS',  label: 'Ambas Marcam · SIM', side: 'YES', prob: btts.pYes / 100, edge: marketEdge?.btts, fairProb: fairBTTS?.pYes }
    : { market: 'BTTS',  label: 'Ambas Marcam · NÃO', side: 'NO',  prob: btts.pNo  / 100, edge: null,             fairProb: fairBTTS?.pNo }
  // Over 2.5 / Over 3.5
  const overOpts = []
  if (result.pOver25 != null) overOpts.push({
    market: 'Over', label: 'Mais de 2.5 gols', side: 'O25', prob: result.pOver25, edge: marketEdge?.over25,
  })
  if (result.pOver35 != null && result.pOver35 >= 0.55) overOpts.push({
    market: 'Over', label: 'Mais de 3.5 gols', side: 'O35', prob: result.pOver35, edge: null,
  })
  // Combos (probabilidade conjunta)
  const comboOpts = []
  if (result.pHomeAndBtts >= 0.45) comboOpts.push({ market: 'Combo', label: `${home.slice(0,12)} + Ambas Marcam`, side: 'HB',  prob: result.pHomeAndBtts })
  if (result.pAwayAndBtts >= 0.45) comboOpts.push({ market: 'Combo', label: `${away.slice(0,12)} + Ambas Marcam`, side: 'AB',  prob: result.pAwayAndBtts })
  if (result.pHomeAndOver25 >= 0.45) comboOpts.push({ market: 'Combo', label: `${home.slice(0,12)} + Over 2.5`,  side: 'HO',  prob: result.pHomeAndOver25 })
  if (result.pAwayAndOver25 >= 0.45) comboOpts.push({ market: 'Combo', label: `${away.slice(0,12)} + Over 2.5`,  side: 'AO',  prob: result.pAwayAndOver25 })
  // Dupla chance derivada (quando 1X2 está dividido — empate possível)
  if (result.pHome + result.pDraw >= 0.70) comboOpts.push({ market: 'DC', label: `Dupla Chance 1X (${home.slice(0,10)} ou Empate)`, side: '1X', prob: result.pHome + result.pDraw })
  if (result.pAway + result.pDraw >= 0.70) comboOpts.push({ market: 'DC', label: `Dupla Chance X2 (Empate ou ${away.slice(0,10)})`, side: 'X2', prob: result.pAway + result.pDraw })

  candidates.push(...opts1X2, bttsOpt, ...overOpts, ...comboOpts)

  // Filtra blacklist (par liga × mercado banido) + stop-pick por drift
  const filtered = candidates.filter(c => {
    if (blacklist && isBlacklisted(league, c.market, blacklist)) return false
    if (shouldStopPick(c.market)) return false
    return true
  })
  // Empate vetado salvo dataQuality REAL e prob ≥ 30%
  const filteredFinal = filtered.filter(c => {
    if (c.market === '1X2' && c.side === 'D') {
      return dataQuality === 'REAL' && c.prob >= 0.30
    }
    return true
  })

  // Score: conf × (1+EV/20) × penaliza fake-edge + bonifica gap real vs no-vig
  for (const c of filteredFinal) {
    c.conf = probToConfidence(c.prob, dataQuality)
    // Platt scaling (Fase 2): aplica shift histórico por liga × mercado × bracket
    if (calibMap) {
      const cal = applyCalibration({ league, stat: `${c.market}:${c.side}`, conf: c.conf }, calibMap)
      c.confRaw = c.conf
      c.conf    = cal.conf
      c.calibShift = cal.shift
    }
    c.ev   = c.edge?.ev ?? null
    c.kelly = c.edge?.kelly ?? null
    c.odd  = c.edge?.odd ?? null
    // Comparação com no-vig (sharp benchmark)
    if (c.fairProb != null) {
      const cmp = compareToNoVig(c.prob, c.fairProb)
      c.fairGap   = cmp.gapPct                   // pp
      c.edgeClass = cmp.classification
    } else {
      c.fairGap = null
      c.edgeClass = 'no_market'
    }
    const evBoost   = Math.max(0, c.ev ?? 0) / 20            // EV +10% → ×1.5
    // Penaliza fake-edge (gap < 3pp): score *0.85
    const fakePenalty = c.edgeClass === 'fake_edge' ? 0.85 : 1.0
    // Bonifica edge sharp (≥5pp acima do no-vig)
    const sharpBoost  = c.edgeClass === 'sharp_edge' ? 1.10 : 1.0
    c.score = c.conf * (1 + evBoost) * fakePenalty * sharpBoost
  }
  filteredFinal.sort((a, b) => b.score - a.score)
  const best = filteredFinal[0]
  if (!best) return null
  // Premium = conf ≥ 65 + dataQuality REAL/FORMA + edge real vs no-vig
  // (não basta EV vs odd do book — exigimos gap ≥3pp acima do no-vig se houver mercado)
  const hasFair = best.fairProb != null
  const realEdge = hasFair
    ? (best.edgeClass === 'real_edge' || best.edgeClass === 'sharp_edge')
    : (best.ev != null && best.ev >= 3 || best.prob >= 0.62)
  const premium = best.conf >= 65
    && (dataQuality === 'REAL' || dataQuality === 'FORMA')
    && realEdge

  // Janela de aposta (timing)
  const window = bettingWindow(time)

  return { ...best, dataQuality, premium, window }
}

// ─── Mini estatística (label + valor colorido) ─────────────────────────
function Stat({ label, value, color = 'var(--t2)', sub }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:1, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace",
        color:'var(--mute)', textTransform:'uppercase', letterSpacing:'.04em' }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily:"'JetBrains Mono',monospace" }}>
        {value}
        {sub && <span style={{ color:'var(--mute)', fontWeight:500, marginLeft:3 }}>{sub}</span>}
      </div>
    </div>
  )
}

// ─── Painel de variáveis de análise por time ──────────────────────────
function TeamSignals({ team, data, venue }) {
  if (!data) return (
    <div style={{ fontSize: 10, color:'var(--mute)', fontStyle:'italic' }}>
      Sem dados de forma para {team}
    </div>
  )
  const venueData = venue === 'home' ? data.asHome : data.asAway
  const restColor = data.rest == null ? 'var(--mute)'
                  : data.rest <= 2 ? 'var(--red)'
                  : data.rest <= 3 ? 'var(--amber)'
                  : 'var(--green)'
  const qualColor = data.quality >= 0.7 ? 'var(--green)'
                  : data.quality >= 0.55 ? '#5ecbff'
                  : data.quality >= 0.4 ? 'var(--amber)' : 'var(--red)'

  return (
    <div style={{ background:'var(--ink)', border:'1px solid var(--line)',
      borderRadius: 8, padding: 8, display:'flex', flexDirection:'column', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color:'var(--white)',
        display:'flex', justifyContent:'space-between', alignItems:'center', gap: 6, flexWrap:'wrap' }}>
        <span>{team}</span>
        <span style={{ display:'flex', gap: 5, alignItems:'center' }}>
          {data.streak && data.streak.count >= 3 && (
            <span style={{
              fontSize: 9, fontFamily:"'JetBrains Mono',monospace", fontWeight:800,
              padding:'2px 5px', borderRadius:4,
              color: data.streak.type === 'W' ? '#ff7a1a'
                   : data.streak.type === 'L' ? 'var(--red)' : 'var(--mute)',
              background: data.streak.type === 'W' ? 'rgba(255,122,26,.12)'
                       : data.streak.type === 'L' ? 'rgba(255,79,106,.12)' : 'rgba(255,255,255,.05)',
              border: `1px solid ${data.streak.type === 'W' ? '#ff7a1a' : data.streak.type === 'L' ? 'var(--red)' : 'var(--mute)'}`,
            }}>
              {data.streak.type === 'W' ? '🔥' : data.streak.type === 'L' ? '❄️' : '='}
              {' '}{data.streak.count}{data.streak.type}
            </span>
          )}
          {data.streak && data.streak.count < 3 && data.streak.unbeaten >= 5 && (
            <span style={{
              fontSize: 9, fontFamily:"'JetBrains Mono',monospace", fontWeight:800,
              padding:'2px 5px', borderRadius:4, color:'var(--green)',
              background:'rgba(0,214,143,.12)', border:'1px solid var(--green)',
            }}>📈 {data.streak.unbeaten} invicto</span>
          )}
          <span style={{ fontSize: 9, color:'var(--mute)',
            fontFamily:"'JetBrains Mono',monospace" }}>
            {venue === 'home' ? '🏠 MANDANTE' : '✈️ VISITANTE'}
          </span>
        </span>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 6 }}>
        <Stat label="Forma" value={data.record || '—'}
          color={data.momentum >= 0.6 ? 'var(--green)' : data.momentum <= 0.3 ? 'var(--red)' : '#5ecbff'}/>
        <Stat label="PPG" value={data.ppg ?? '—'} sub={`(${data.sample})`}/>
        <Stat label="GF/GA" value={`${data.gfpg ?? '—'} / ${data.gapg ?? '—'}`}/>
        <Stat label="Saldo" value={(data.gd > 0 ? '+' : '') + (data.gd ?? 0)}
          color={data.gd > 0 ? 'var(--green)' : data.gd < 0 ? 'var(--red)' : 'var(--t2)'}/>
      </div>

      {venueData && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 6,
          borderTop:'1px dashed var(--line)', paddingTop: 6 }}>
          <Stat label={venue === 'home' ? 'EM CASA' : 'FORA DE CASA'} value={venueData.record}/>
          <Stat label="PPG" value={venueData.ppg} sub={`(${venueData.sample})`}/>
          <Stat label="GF/GA" value={`${venueData.gfpg} / ${venueData.gapg}`}/>
          <Stat label="Saldo" value={(venueData.gd > 0 ? '+' : '') + venueData.gd}
            color={venueData.gd > 0 ? 'var(--green)' : venueData.gd < 0 ? 'var(--red)' : 'var(--t2)'}/>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 6,
        borderTop:'1px dashed var(--line)', paddingTop: 6 }}>
        <Stat label="Descanso" value={data.rest != null ? `${data.rest}d` : '—'} color={restColor}/>
        <Stat label="Qualidade" value={`${Math.round((data.quality || 0.5) * 100)}%`} color={qualColor}/>
        <Stat label="Lesões" value={data.injuryCount ?? 0}
          color={(data.injuryCount || 0) >= 3 ? 'var(--red)' : (data.injuryCount || 0) >= 1 ? 'var(--amber)' : 'var(--mute)'}/>
        <Stat label="Ranking" value={data.overview?.rank ? `#${data.overview.rank}` : '—'}/>
      </div>

      {data.injuries && data.injuries.length > 0 && (
        <div style={{ fontSize: 9, fontFamily:"'JetBrains Mono',monospace",
          color:'var(--amber)', marginTop: 2, lineHeight: 1.4 }}>
          ⚠️ Desfalques: {data.injuries.slice(0, 4).map(i => i.player.split(' ').slice(-1)[0]).join(', ')}
          {data.injuries.length > 4 ? ` +${data.injuries.length - 4}` : ''}
        </div>
      )}
    </div>
  )
}

// ─── Card de um jogo ─────────────────────────────────────────────────────
function MatchCard({ game, blacklist, calibMap }) {
  const { home, away, league, time, result, btts, formCtx } = game
  const { pHome, pDraw, pAway, dataQuality, hasForm, hasH2H, hasH2HVenue,
          hasVenueSplitH, hasVenueSplitA } = result
  const narrative = useMemo(() => buildNarrative(home, away, result, formCtx), [home, away, result, formCtx])
  const topPick = useMemo(() => selectTopPick(game, blacklist, calibMap), [game, blacklist, calibMap])

  // Loga Top Pick no diário CLV (idempotente — chave por game/market/side)
  useEffect(() => {
    if (!topPick || !topPick.premium || !topPick.odd) return
    logPick({
      sport: result.sport || 'football',
      league, home, away,
      market: topPick.market,
      side: topPick.side,
      label: topPick.label,
      prob: topPick.prob,
      conf: topPick.conf,
      odd: topPick.odd,
      ev: topPick.ev,
      kelly: topPick.kelly,
      fairProb: topPick.fairProb,
      gameTime: time,
      dataQuality,
      premium: topPick.premium,
    })
  }, [topPick, league, home, away, time, dataQuality, result.sport])

  const homeConf = probToConfidence(pHome, dataQuality)
  const drawConf = probToConfidence(pDraw, dataQuality)
  const awayConf = probToConfidence(pAway, dataQuality)

  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTried, setDetailTried] = useState(false)

  // Lazy-load de lineups + weather + PPDA/xA vindos da pipeline proprietária
  useEffect(() => {
    if (!expanded || detailTried) return
    setDetailLoading(true)
    const dateStr = game.time ? new Date(game.time).toISOString().slice(0, 10) : null
    fetchMatchDetailByTeams(home, away, dateStr)
      .then(d => setDetail(d))
      .catch(() => {})
      .finally(() => { setDetailLoading(false); setDetailTried(true) })
  }, [expanded, detailTried, home, away, game.time])

  // Melhor palpite 1X2
  const options = [
    { label: 'Casa',    team: home, prob: pHome, conf: homeConf, side: 'H' },
    { label: 'Empate',  team: 'X',  prob: pDraw, conf: drawConf, side: 'D' },
    { label: 'Fora',    team: away, prob: pAway, conf: awayConf, side: 'A' },
  ].sort((a,b) => b.prob - a.prob)
  const bestRes = options[0]

  const bttsBarColor = btts.bestSide === 'SIM' ? 'var(--green)' : 'var(--red)'

  return (
    <div style={{
      background: 'var(--ink2)', border: '1px solid var(--line)',
      borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header: liga + times */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display:'flex', gap: 6, alignItems:'center' }}>
            <div style={{
              fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
              color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '.04em',
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:1,
            }}>{league || 'Liga'}</div>
            {kickoffBR(time) && (
              <span style={{
                fontSize: 9, fontFamily:"'JetBrains Mono',monospace",
                color:'#5ecbff', background:'rgba(94,203,255,.1)',
                padding:'2px 5px', borderRadius:4, flexShrink:0,
              }}>⏰ {kickoffBR(time)}</span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--white)', marginTop: 2 }}>
            {home} <span style={{ color: 'var(--mute)' }}>×</span> {away}
          </div>
        </div>
        <div style={{ display:'flex', gap:4, flexShrink:0 }}>
          {hasForm && <span title="Forma recente aplicada" style={{
            fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color:'var(--green)',
            border:'1px solid rgba(0,214,143,.3)', padding:'2px 5px', borderRadius:4,
          }}>📈 FORMA</span>}
          {hasH2H && <span title="H2H aplicado" style={{
            fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color:'#5ecbff',
            border:'1px solid rgba(94,203,255,.3)', padding:'2px 5px', borderRadius:4,
          }}>🔁 H2H</span>}
          {result.isCupGame && (result.cupMultH >= 1.08 || result.cupMultA >= 1.08) && (
            <span title={`Pedigree de copa: ${home} ×${result.cupMultH?.toFixed(2)} | ${away} ×${result.cupMultA?.toFixed(2)}`} style={{
              fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color:'#ffd166',
              border:'1px solid rgba(255,209,102,.4)', padding:'2px 5px', borderRadius:4,
            }}>🏆 COPEIRO</span>
          )}
          {result.hasRotation && (
            <span title={`Rotação estimada (jogo de copa em calendário apertado): ${home} ×${result.rotMultH?.toFixed(2)} | ${away} ×${result.rotMultA?.toFixed(2)}`} style={{
              fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color:'#c084fc',
              border:'1px solid rgba(192,132,252,.4)', padding:'2px 5px', borderRadius:4,
            }}>🔄 ROTAÇÃO</span>
          )}
          <span title="Qualidade de dados" style={{
            fontSize: 9, fontFamily: "'JetBrains Mono',monospace",
            color: dataQuality === 'REAL'   ? 'var(--green)'
                 : dataQuality === 'FORMA'  ? '#5ecbff'
                 : dataQuality === 'PARCIAL'? 'var(--amber)'
                 : 'var(--mute)',
            border: '1px solid currentColor', padding:'2px 5px', borderRadius:4, opacity: .8,
          }}>{dataQuality}</span>
        </div>
      </div>

      {/* 🏆 Top Pick — recomendação principal do modelo */}
      {topPick && (
        <div style={{
          background: topPick.premium
            ? 'linear-gradient(135deg, rgba(0,214,143,.18), rgba(0,214,143,.04))'
            : 'rgba(94,203,255,.06)',
          border: `1px solid ${topPick.premium ? 'var(--green)' : 'rgba(94,203,255,.3)'}`,
          borderRadius: 8, padding: '8px 10px',
        }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', minWidth:0 }}>
              <span style={{
                fontSize: 9, fontFamily:"'JetBrains Mono',monospace", fontWeight:800, letterSpacing:'.06em',
                color: topPick.premium ? 'var(--green)' : '#5ecbff',
                background: topPick.premium ? 'rgba(0,214,143,.15)' : 'rgba(94,203,255,.12)',
                padding:'2px 6px', borderRadius:4,
              }}>
                {topPick.premium ? '💎 TOP PICK PREMIUM' : '🎯 TOP PICK'}
              </span>
              <span style={{
                fontSize: 9, fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)',
                border:'1px solid var(--line)', padding:'1px 5px', borderRadius:3,
              }}>
                {topPick.market}
              </span>
              {topPick.ev != null && topPick.ev >= 3 && (
                <span style={{
                  fontSize: 9, fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                  color:'var(--green)', background:'rgba(0,214,143,.12)',
                  padding:'1px 5px', borderRadius:3,
                }}>EV +{topPick.ev}%</span>
              )}
              {/* No-vig gap (sharp benchmark) */}
              {topPick.fairGap != null && (
                <span title="Diferença vs no-vig do mercado (Pinnacle/Betfair). Edge real exige ≥3pp."
                  style={{
                  fontSize: 9, fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                  color: topPick.edgeClass === 'sharp_edge' ? 'var(--green)'
                       : topPick.edgeClass === 'real_edge'  ? '#5ecbff'
                       : topPick.edgeClass === 'fake_edge'  ? 'var(--amber)'
                       : 'var(--mute)',
                  background: 'rgba(255,255,255,.04)',
                  border: '1px solid currentColor',
                  padding:'1px 5px', borderRadius:3,
                }}>
                  {topPick.fairGap >= 0 ? '+' : ''}{topPick.fairGap}pp vs no-vig
                </span>
              )}
              {/* Janela de aposta (timing) */}
              {topPick.window && topPick.window.window !== 'unknown' && (
                <span title="Janela ótima pra apostar — fora dela CLV cai" style={{
                  fontSize: 9, fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
                  color: topPick.window.color,
                  background: 'rgba(255,255,255,.04)',
                  padding:'1px 5px', borderRadius:3,
                }}>
                  ⏱ {topPick.window.label}
                </span>
              )}
            </div>
            <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
              <span style={{
                fontSize: 16, fontWeight: 800, fontFamily:"'JetBrains Mono',monospace",
                color: confColor(topPick.conf),
              }}>{topPick.conf}%</span>
              {topPick.odd && (
                <span style={{ fontSize: 10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>
                  @ {topPick.odd}
                  {result.gameOdds?.bestBook && (
                    <span style={{ color:'#5ecbff', marginLeft: 4 }}>
                      · {result.gameOdds.bestBook}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color:'var(--white)', marginTop: 4 }}>
            {topPick.label}
          </div>
          {topPick.kelly != null && topPick.kelly > 0.5 && (
            <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color:'var(--mute)', marginTop: 2 }}>
              Stake sugerida: <b style={{ color:'#ffd166' }}>{topPick.kelly}%</b> da banca (Kelly)
            </div>
          )}
        </div>
      )}

      {/* Resultado Final — 3 barras 1 X 2 */}
      <div>
        <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color: 'var(--mute)',
          textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
          🎯 Resultado Final
        </div>
        {options.slice().sort((a,b) =>
          // Sempre Casa, Empate, Fora na UI
          a.side === 'H' ? -1 : b.side === 'H' ? 1 : a.side === 'D' ? -1 : 1
        ).map(o => {
          const isBest = o.side === bestRes.side
          return (
            <div key={o.side} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
                color: isBest ? confColor(o.conf) : 'var(--t2)',
                width: 60, fontWeight: isBest ? 800 : 600,
              }}>
                {o.label}{isBest ? ' ★' : ''}
              </div>
              <div style={{ flex: 1, height: 8, background: 'var(--ink)', borderRadius: 4, overflow:'hidden' }}>
                <div style={{
                  width: `${Math.max(2, o.prob * 100)}%`, height: '100%',
                  background: confColor(o.conf),
                  opacity: isBest ? 1 : 0.6,
                  transition: 'width .3s',
                }}/>
              </div>
              <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
                color: confColor(o.conf), width: 46, textAlign: 'right',
                fontWeight: isBest ? 800 : 600,
              }}>
                {(o.prob * 100).toFixed(1)}%
              </div>
            </div>
          )
        })}
      </div>

      {/* Ambas Marcam */}
      <div>
        <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color: 'var(--mute)',
          textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span>⚽ Ambas Marcam</span>
          <span style={{ color: bttsBarColor, fontWeight: 800 }}>
            {btts.bestSide === 'SIM' ? 'SIM' : 'NÃO'} · {btts.bestConf}% conf
          </span>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <div style={{
            flex: btts.pYes, background: 'rgba(0,214,143,.18)',
            border: btts.bestSide === 'SIM' ? '1px solid var(--green)' : '1px solid transparent',
            padding:'8px 10px', borderRadius: 6, textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, fontFamily:"'JetBrains Mono',monospace" }}>SIM</div>
            <div style={{ fontSize: 14, color: 'var(--white)', fontWeight: 800 }}>{btts.pYes}%</div>
          </div>
          <div style={{
            flex: btts.pNo, background: 'rgba(255,79,106,.15)',
            border: btts.bestSide === 'NAO' ? '1px solid var(--red)' : '1px solid transparent',
            padding:'8px 10px', borderRadius: 6, textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700, fontFamily:"'JetBrains Mono',monospace" }}>NÃO</div>
            <div style={{ fontSize: 14, color: 'var(--white)', fontWeight: 800 }}>{btts.pNo}%</div>
          </div>
        </div>
        <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace",
          color: 'var(--mute)', marginTop: 6, display:'flex', gap: 10, justifyContent:'space-between' }}>
          <span>{home}: {btts.pHomeScores}% de marcar</span>
          <span>{away}: {btts.pAwayScores}% de marcar</span>
        </div>
        {game.h2hBtts != null && (
          <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace",
            color: '#5ecbff', marginTop: 4 }}>
            🔁 H2H ({game.h2hSample}): BTTS em {Math.round(game.h2hBtts * 100)}% dos confrontos
          </div>
        )}
      </div>

      {/* Combo Picks (probs conjuntas do modelo Poisson+DC) */}
      {(() => {
        const combos = [
          { k: 'H+BTTS',  label: `${home.slice(0,10)} + BTTS`,     p: result.pHomeAndBtts },
          { k: 'A+BTTS',  label: `${away.slice(0,10)} + BTTS`,     p: result.pAwayAndBtts },
          { k: 'D+BTTS',  label: `Empate + BTTS`,                  p: result.pDrawAndBtts },
          { k: 'H+O25',   label: `${home.slice(0,10)} + Over 2.5`, p: result.pHomeAndOver25 },
          { k: 'A+O25',   label: `${away.slice(0,10)} + Over 2.5`, p: result.pAwayAndOver25 },
          { k: 'O25',     label: `Over 2.5 gols`,                  p: result.pOver25 },
          { k: 'O35',     label: `Over 3.5 gols`,                  p: result.pOver35 },
        ].filter(c => c.p != null && c.p > 0)
          .sort((a, b) => b.p - a.p)
          .slice(0, 3)
        if (combos.length === 0) return null
        return (
          <div>
            <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color: 'var(--mute)',
              textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span>🎲 Combo Picks (prob. conjunta)</span>
              <span title="Derivado da matriz Poisson com correção Dixon-Coles (BTTS)"
                style={{ fontSize: 9, color:'#9ca3af' }}>Poisson + DC</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap: 4 }}>
              {combos.map((c, i) => {
                const pct = c.p * 100
                const color = pct >= 55 ? 'var(--green)' : pct >= 40 ? '#ffd166' : 'var(--t2)'
                return (
                  <div key={c.k} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
                      color: i === 0 ? color : 'var(--t2)',
                      width: 160, fontWeight: i === 0 ? 800 : 600, overflow:'hidden',
                      whiteSpace:'nowrap', textOverflow:'ellipsis',
                    }}>
                      {c.label}{i === 0 ? ' ★' : ''}
                    </div>
                    <div style={{ flex: 1, height: 6, background: 'var(--ink)', borderRadius: 3, overflow:'hidden' }}>
                      <div style={{
                        width: `${Math.max(2, pct)}%`, height: '100%',
                        background: color, opacity: i === 0 ? 1 : 0.6,
                      }}/>
                    </div>
                    <div style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
                      color, width: 46, textAlign: 'right',
                      fontWeight: i === 0 ? 800 : 600,
                    }}>
                      {pct.toFixed(1)}%
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* 🎯 Placares mais prováveis (top 3) */}
      {result.topScores && result.topScores.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color: 'var(--mute)',
            textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            🎯 Placar mais provável
          </div>
          <div style={{ display:'flex', gap: 6, flexWrap:'wrap' }}>
            {result.topScores.slice(0, 3).map((s, i) => (
              <span key={s.score} style={{
                fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
                padding: '4px 8px', borderRadius: 5,
                border: `1px solid ${i === 0 ? 'var(--green)' : 'var(--line)'}`,
                background: i === 0 ? 'rgba(0,214,143,.08)' : 'var(--ink)',
                color: i === 0 ? 'var(--green)' : 'var(--t2)', fontWeight: i === 0 ? 800 : 600,
              }}>
                {s.score} <span style={{ opacity: .7 }}>({(s.p * 100).toFixed(1)}%)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 🎲 Mercados derivados (DNB, AH, Over HT, Casa marca primeiro) */}
      {result.dnbHome != null && (
        <div>
          <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color: 'var(--mute)',
            textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            🎲 Mercados derivados
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 6, fontSize: 10,
            fontFamily:"'JetBrains Mono',monospace" }}>
            <Stat label="DNB Casa" value={`${(result.dnbHome * 100).toFixed(0)}%`}
              color={result.dnbHome >= 0.6 ? 'var(--green)' : 'var(--t2)'}/>
            <Stat label="DNB Fora" value={`${(result.dnbAway * 100).toFixed(0)}%`}
              color={result.dnbAway >= 0.6 ? 'var(--green)' : 'var(--t2)'}/>
            <Stat label="AH −1.0 Casa" value={`${(result.ahM10Home * 100).toFixed(0)}%`}
              color={result.ahM10Home >= 0.55 ? 'var(--green)' : 'var(--t2)'}/>
            <Stat label="AH +1.0 Fora" value={`${(result.ahP10Away * 100).toFixed(0)}%`}
              color={result.ahP10Away >= 0.55 ? 'var(--green)' : 'var(--t2)'}/>
            <Stat label="Over 0.5 HT" value={`${(result.pHtOver05 * 100).toFixed(0)}%`}
              color={result.pHtOver05 >= 0.65 ? 'var(--green)' : 'var(--t2)'}/>
            <Stat label="Over 1.5 HT" value={`${(result.pHtOver15 * 100).toFixed(0)}%`}
              color={result.pHtOver15 >= 0.45 ? 'var(--green)' : 'var(--t2)'}/>
            <Stat label="Casa marca 1º" value={`${(result.pHomeFirst * 100).toFixed(0)}%`}/>
            <Stat label="Fora marca 1º" value={`${(result.pAwayFirst * 100).toFixed(0)}%`}/>
          </div>
        </div>
      )}

      {/* 🟨 Cards & Specials (quando refStats disponível) */}
      {result.refStats && result.refStats.markets && (
        <div style={{
          background:'rgba(255,209,102,.05)', border:'1px solid rgba(255,209,102,.25)',
          borderRadius: 8, padding: 8,
        }}>
          <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color:'#ffd166',
            textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6, fontWeight:700,
            display:'flex', justifyContent:'space-between' }}>
            <span>🟨 Cards & Specials</span>
            <span style={{ color:'var(--mute)', fontWeight: 500 }}>
              Árbitro: {result.refStats.referee || result.refStats.referee_name || '—'} ({result.refStats.games || 0} jogos)
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 6 }}>
            <Stat label="Over 4.5 cards" value={`${Math.round((result.refStats.markets.p_over_4_5_cards || 0) * 100)}%`}
              color={(result.refStats.markets.p_over_4_5_cards || 0) >= 0.6 ? 'var(--green)' : 'var(--t2)'}/>
            <Stat label="Vermelho no jogo" value={`${Math.round((result.refStats.markets.p_red_in_match || 0) * 100)}%`}
              color={(result.refStats.markets.p_red_in_match || 0) >= 0.35 ? '#ffd166' : 'var(--t2)'}/>
            <Stat label="Pênalti no jogo" value={`${Math.round((result.refStats.markets.p_pen_in_match || 0) * 100)}%`}
              color={(result.refStats.markets.p_pen_in_match || 0) >= 0.30 ? '#ffd166' : 'var(--t2)'}/>
          </div>
        </div>
      )}

      {/* 💎 EDGE vs market odds */}
      {result.marketEdge && (() => {
        const edges = Object.entries(result.marketEdge)
          .filter(([, v]) => v && v.ev > 3)
          .sort((a, b) => b[1].ev - a[1].ev)
        if (!edges.length) return null
        return (
          <div style={{
            background:'rgba(0,214,143,.06)', border:'1px solid var(--green)',
            borderRadius: 8, padding: 8,
          }}>
            <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color:'var(--green)',
              textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6, fontWeight:800 }}>
              💎 EDGE detectado
            </div>
            {edges.slice(0, 3).map(([k, v]) => (
              <div key={k} style={{ fontSize: 11, fontFamily:"'JetBrains Mono',monospace",
                color:'var(--t2)', display:'flex', justifyContent:'space-between' }}>
                <span>{k.toUpperCase()} @ {v.odd}</span>
                <span style={{ color:'var(--green)', fontWeight:800 }}>
                  EV +{v.ev}% · Kelly {v.kelly}%
                </span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ⚠️ Key player out */}
      {result.lineupsCtx && (result.lineupsCtx.home?.starScorerOut || result.lineupsCtx.away?.starScorerOut) && (
        <div style={{
          fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color:'#ff7a1a',
          background:'rgba(255,122,26,.08)', border:'1px solid rgba(255,122,26,.3)',
          padding: '6px 8px', borderRadius: 6,
        }}>
          ⚠️ {result.lineupsCtx.home?.starScorerOut &&
            `${home}: ${result.lineupsCtx.home.missingName} (${result.lineupsCtx.home.missingGoals} gols) fora `}
          {result.lineupsCtx.away?.starScorerOut &&
            `${away}: ${result.lineupsCtx.away.missingName} (${result.lineupsCtx.away.missingGoals} gols) fora`}
        </div>
      )}

      {/* Narrativa automática (tipo AeP) */}
      {narrative && narrative.length > 0 && (
        <div style={{
          background:'rgba(94,203,255,.04)', border:'1px solid rgba(94,203,255,.15)',
          borderRadius: 8, padding: 10,
        }}>
          <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color:'#5ecbff',
            textTransform:'uppercase', letterSpacing:'.05em', marginBottom: 6, fontWeight:700 }}>
            📝 Análise
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap: 4 }}>
            {narrative.map((line, i) => (
              <div key={i} style={{ fontSize: 11, color:'var(--t2)', lineHeight: 1.5 }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer: λ + gols esperados + expandir */}
      <div style={{
        fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color: 'var(--mute)',
        borderTop: '1px solid var(--line)', paddingTop: 8,
        display:'flex', gap:12, justifyContent:'space-between', flexWrap:'wrap',
      }}>
        <span>λ {home.slice(0,10)}: <b style={{ color:'var(--t2)' }}>{result.lambdaHome}</b></span>
        <span>λ {away.slice(0,10)}: <b style={{ color:'var(--t2)' }}>{result.lambdaAway}</b></span>
        <span>Total gols: <b style={{ color:'var(--t2)' }}>{result.expGoals}</b></span>
      </div>

      {/* Botão de expandir análise completa */}
      {formCtx && (formCtx.home || formCtx.away) && (
        <button onClick={() => setExpanded(v => !v)} style={{
          fontFamily:"'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700,
          padding:'6px', borderRadius: 6,
          border:`1px solid ${expanded ? 'var(--green)' : 'var(--line)'}`,
          background: expanded ? 'rgba(0,214,143,.08)' : 'var(--ink)',
          color: expanded ? 'var(--green)' : 'var(--mute)',
          cursor:'pointer', width:'100%',
        }}>
          {expanded ? '▼ Ocultar análise detalhada' : '▶ Ver análise completa (forma casa/fora, descanso, lesões, ranking)'}
        </button>
      )}

      {expanded && formCtx && (
        <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
          <TeamSignals team={home} data={formCtx.home} venue="home"/>
          <TeamSignals team={away} data={formCtx.away} venue="away"/>

          {/* Match Detail proprietário (lineups + weather + PPDA/xA) */}
          {detailLoading && (
            <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace",
              color: 'var(--mute)', padding: 6, textAlign: 'center' }}>
              🔄 Carregando lineups, clima e métricas proprietárias…
            </div>
          )}
          {detail && (detail.lineups || detail.weather || (detail.team_metrics?.length > 0)) && (
            <div style={{
              background:'rgba(168,85,247,.04)', border:'1px solid rgba(168,85,247,.2)',
              borderRadius: 8, padding: 10, display:'flex', flexDirection:'column', gap: 10,
            }}>
              <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace", color:'#c084fc',
                textTransform:'uppercase', letterSpacing:'.05em', fontWeight:700,
                display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span>🎽 SportsBrain Match Detail</span>
                <span style={{ fontSize: 9, color:'var(--mute)' }}>D1 proprietary</span>
              </div>

              {/* Formations + Weather header */}
              {(detail.lineups?.formations?.home || detail.weather) && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8 }}>
                  {detail.lineups?.formations?.home && (
                    <Stat label="Formação" value={`${detail.lineups.formations.home} × ${detail.lineups.formations.away || '—'}`}/>
                  )}
                  {detail.weather && (
                    <Stat label={`🌦️ ${detail.weather.temperature_c ?? '—'}°C · ${detail.weather.wind_kmh ?? 0}km/h`}
                      value={detail.weather.goal_impact_mult ? `gols ×${(+detail.weather.goal_impact_mult).toFixed(2)}` : '—'}
                      color={detail.weather.goal_impact_mult < 0.96 ? 'var(--red)' : detail.weather.goal_impact_mult > 1.04 ? 'var(--green)' : 'var(--t2)'}/>
                  )}
                </div>
              )}

              {/* Team metrics (PPDA + xG + xA) quando é post-match */}
              {detail.team_metrics && detail.team_metrics.length > 0 && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 6,
                  borderTop:'1px dashed rgba(168,85,247,.2)', paddingTop: 8 }}>
                  {detail.team_metrics.map((tm, i) => (
                    <Fragment key={i}>
                      <Stat label={`${tm.is_home ? home.slice(0,8) : away.slice(0,8)} xG`}
                        value={tm.xg_total != null ? (+tm.xg_total).toFixed(2) : '—'}/>
                      <Stat label="xA" value={tm.xa_total != null ? (+tm.xa_total).toFixed(2) : '—'}/>
                      <Stat label="PPDA" value={tm.ppda != null ? (+tm.ppda).toFixed(1) : '—'}
                        color={tm.ppda != null && tm.ppda < 10 ? 'var(--green)' : 'var(--t2)'}/>
                      <Stat label="Chutes" value={`${tm.shots || 0} (${tm.shots_on_target || 0} no alvo)`}/>
                    </Fragment>
                  ))}
                </div>
              )}

              {/* Starters preview (primeiros 5 de cada) */}
              {detail.lineups?.home?.length > 0 && (
                <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace",
                  color:'var(--t2)', lineHeight: 1.5,
                  borderTop:'1px dashed rgba(168,85,247,.2)', paddingTop: 8 }}>
                  <div style={{ color: 'var(--mute)', marginBottom: 3 }}>
                    {detail.lineups.home[0]?.is_confirmed === 1 ? '✅ Escalação confirmada' : '🔸 Escalação provável'}
                  </div>
                  <div><b>{home}:</b> {detail.lineups.home.filter(p => p.is_starter).slice(0, 11).map(p => p.player_name).join(', ') || '—'}</div>
                  <div style={{ marginTop: 2 }}><b>{away}:</b> {detail.lineups.away.filter(p => p.is_starter).slice(0, 11).map(p => p.player_name).join(', ') || '—'}</div>
                </div>
              )}
            </div>
          )}
          {detail === null && detailTried && !detailLoading && (
            <div style={{ fontSize: 10, fontFamily:"'JetBrains Mono',monospace",
              color: 'var(--mute)', textAlign: 'center', padding: 4, opacity: .6 }}>
              Sem detalhe D1 proprietário para este jogo (ainda).
            </div>
          )}

          {/* H2H panel se disponível */}
          {formCtx.h2h && formCtx.h2h.sample >= 3 && (
            <div style={{
              background:'rgba(94,203,255,.05)', border:'1px solid rgba(94,203,255,.2)',
              borderRadius: 8, padding: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color:'#5ecbff', marginBottom: 6,
                display:'flex', alignItems:'center', gap: 6 }}>
                🔁 Histórico H2H · {formCtx.h2h.sample} confrontos
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 6 }}>
                <Stat label={`${home.slice(0,10)} V`} value={formCtx.h2h.homeWins}
                  color={formCtx.h2h.homeWins > formCtx.h2h.awayWins ? 'var(--green)' : 'var(--t2)'}/>
                <Stat label="Empates" value={formCtx.h2h.draws}/>
                <Stat label={`${away.slice(0,10)} V`} value={formCtx.h2h.awayWins}
                  color={formCtx.h2h.awayWins > formCtx.h2h.homeWins ? 'var(--green)' : 'var(--t2)'}/>
                <Stat label="Média Gols" value={formCtx.h2h.avgGoals}/>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 6,
                borderTop:'1px dashed var(--line)', paddingTop: 6, marginTop: 6 }}>
                <Stat label="BTTS" value={`${Math.round(formCtx.h2h.bttsRate * 100)}%`}
                  color={formCtx.h2h.bttsRate >= 0.5 ? 'var(--green)' : 'var(--t2)'}/>
                <Stat label="Over 2.5" value={`${Math.round(formCtx.h2h.over25Rate * 100)}%`}
                  color={formCtx.h2h.over25Rate >= 0.5 ? 'var(--green)' : 'var(--t2)'}/>
                <Stat label={`${home.slice(0,8)} em casa`}
                  value={formCtx.h2h.atHome ? `${formCtx.h2h.atHome.wins}W-${formCtx.h2h.atHome.draws}D-${formCtx.h2h.atHome.losses}L` : '—'}/>
              </div>
            </div>
          )}

          {/* Ajustes aplicados pelo modelo */}
          <div style={{
            background:'var(--ink)', border:'1px solid var(--line)',
            borderRadius: 8, padding: 8,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color:'var(--white)', marginBottom: 6 }}>
              ⚙️ Ajustes aplicados no modelo
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 6, fontSize: 10,
              fontFamily:"'JetBrains Mono',monospace", color:'var(--t2)' }}>
              <div>{home.slice(0,12)}:</div>
              <div>{away.slice(0,12)}:</div>
              <div>Forma: ×{result.formMultH?.toFixed(2)}</div>
              <div>Forma: ×{result.formMultA?.toFixed(2)}</div>
              <div>Fadiga: ×{result.fatigueH?.toFixed(2)}</div>
              <div>Fadiga: ×{result.fatigueA?.toFixed(2)}</div>
              <div>Qual: ×{result.qualMultH?.toFixed(2)}</div>
              <div>Qual: ×{result.qualMultA?.toFixed(2)}</div>
              <div>Lesões: ×{result.injMultH?.toFixed(2)}</div>
              <div>Lesões: ×{result.injMultA?.toFixed(2)}</div>
              <div>Mando: ×{result.homeAdv?.toFixed(2)}</div>
              <div>—</div>
              {(result.cupMultH > 1 || result.cupMultA > 1) && (
                <>
                  <div style={{ color: result.cupMultH > 1 ? 'var(--green)' : 'var(--mute)' }}>
                    🏆 Copa: ×{result.cupMultH?.toFixed(2)}
                  </div>
                  <div style={{ color: result.cupMultA > 1 ? 'var(--green)' : 'var(--mute)' }}>
                    🏆 Copa: ×{result.cupMultA?.toFixed(2)}
                  </div>
                </>
              )}
              {result.hasRotation && (
                <>
                  <div style={{ color: result.rotMultH < 0.98 ? '#c084fc' : 'var(--mute)' }}>
                    🔄 Rotação: ×{result.rotMultH?.toFixed(2)}
                  </div>
                  <div style={{ color: result.rotMultA < 0.98 ? '#c084fc' : 'var(--mute)' }}>
                    🔄 Rotação: ×{result.rotMultA?.toFixed(2)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Página principal ───────────────────────────────────────────────────
export default function Palpites() {
  const [games,   setGames]   = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded,  setLoaded]  = useState(false)
  const [search,  setSearch]  = useState('')
  const [leagueFilt, setLeagueFilt] = useState('all')
  const [sortBy, setSortBy] = useState('top')    // top | conf | goals | btts | edge
  const [premiumOnly, setPremiumOnly] = useState(false)
  const [selectedDate, setSelectedDate] = useState(today())
  const [coverage, setCoverage] = useState({ total: 0, skipped: 0 })

  const load = useCallback(async (date) => {
    setLoading(true)
    try {
      const targetDate = date || selectedDate
      const res = await fetchMatches({ date: targetDate, sport: 'football', per_page: 1000 })
      const raw = res.matches || res.data || []

      const shouldSkip = (g) => {
        if (g.status_meta?.isFin || g.status_meta?.isLive || g.status_meta?.isHT || g.status_meta?.isActive) return true
        const s = (g.status || g.state || g.fixture?.status?.short || '').toLowerCase()
        const skip = ['ft','finished','complete','completed','full_time','fim','ended','post','closed',
                      'live','1h','2h','ht','in_play','active','in_progress','running','in','halftime','paused','break']
        return skip.some(d => s === d || s.startsWith(d))
      }

      const normLeague = (g) => {
        const l = (typeof g.league === 'string' ? g.league : g.league?.name)
               || g.competition?.name || g.league_name || ''
        if (!l || l.length <= 1 || l.toLowerCase() === 'sem liga') return null
        // Disambiguação por times: "Premier League" genérico pode ser Belarus/Russia/etc.
        const home = (g.home_team || g.home_team_name || g.teams?.home?.name || g.home || '').toLowerCase()
        const away = (g.away_team || g.away_team_name || g.teams?.away?.name || g.away || '').toLowerCase()
        const ll = l.toLowerCase()
        if (ll === 'premier league' || ll === 'premier') {
          const BLR = ['bate','dinamo minsk','dinamo brest','dynamo minsk','dynamo brest','shakhtyor','shakhter','isloch','torpedo-belaz','zhodino','neman','slavia mozyr','minsk','gomel','naftan','slutsk','smolevichi','arsenal dzerzhinsk','vitebsk','dnepr mogilev','molodechno']
          const RUS = ['zenit','spartak moscow','cska moscow','dynamo moscow','lokomotiv moscow','krasnodar','rostov','rubin kazan','krylia sovetov','akhmat','sochi fc','orenburg','ural','fakel','pari nn']
          const UKR = ['shakhtar donetsk','dynamo kyiv','dnipro-1','zorya','kolos kovalivka','rukh lviv','vorskla','metalist 1925','kryvbas','polissya','veres','obolon','lviv','kryvbas']
          const SCO = ['celtic','rangers','hearts','hibernian','aberdeen','dundee','motherwell','kilmarnock','ross county','st mirren','st johnstone','livingston','dundee united']
          const isIn = (list) => list.some(k => home.includes(k) || away.includes(k))
          if (isIn(BLR)) return 'Belarus Premier League'
          if (isIn(RUS)) return 'Russia Premier League'
          if (isIn(UKR)) return 'Ukraine Premier League'
          if (isIn(SCO)) return 'Scottish Premiership'
        }
        // Disambiguação Serie A: Itália, Brasil e Argentina compartilham o nome.
        if (ll === 'serie a' || ll === 'série a' || ll === 'serie a betano' || ll === 'serie a tim') {
          // Prefere o country do ESPN normalize se disponível
          const country = (g.country || g.league?.country || '').toLowerCase()
          if (country.includes('italy'))    return 'Serie A · Itália'
          if (country.includes('brazil'))   return 'Serie A · Brasil'
          if (country.includes('argentin')) return 'Liga Profesional · Argentina'
          // Fallback por times conhecidos
          const ITA = ['juventus','milan','inter','napoli','roma','lazio','atalanta','fiorentina','bologna','torino','udinese','sassuolo','empoli','verona','genoa','cagliari','lecce','monza','salernitana','frosinone','parma','pisa','venezia','como','cremonese']
          const BRA = ['flamengo','palmeiras','sao paulo','são paulo','corinthians','santos','gremio','grêmio','internacional','cruzeiro','atletico mineiro','atlético mineiro','botafogo','vasco','fluminense','bahia','fortaleza','ceara','ceará','athletico','bragantino','red bull bragantino','cuiaba','cuiabá','goias','goiás','vitoria','vitória','sport','sport recife','juventude','novorizontino','remo','mirassol','londrina']
          const ARG = ['river plate','boca juniors','racing club','independiente','san lorenzo','estudiantes','velez','vélez','newells','newell','rosario central','huracan','huracán','lanus','lanús','banfield','colon','colón','union','unión','tigre','sarmiento','aldosivi','talleres','godoy cruz','platense','arsenal sarandi','barracas central','instituto','belgrano','central cordoba','central córdoba','riestra','defensa y justicia','gimnasia','argentinos juniors']
          if (ITA.some(k => home.includes(k) || away.includes(k))) return 'Serie A · Itália'
          if (BRA.some(k => home.includes(k) || away.includes(k))) return 'Serie A · Brasil'
          if (ARG.some(k => home.includes(k) || away.includes(k))) return 'Liga Profesional · Argentina'
        }
        return l
      }

      const allGames = (Array.isArray(raw) ? raw : [])
        .filter(g => !shouldSkip(g))
        .map(g => ({
          home: g.home_team || g.home_team_name || g.teams?.home?.name || g.home || 'Casa',
          away: g.away_team || g.away_team_name || g.teams?.away?.name || g.away || 'Fora',
          league: normLeague(g) || 'Sem Liga',
          time:   g.match_time || g.time || g.fixture?.date || '',
        }))
        .filter(g => !(g.home === 'Casa' && g.away === 'Fora'))

      // ── FILTRO 365: cobertura via Bet365 capturado (PROPRIETÁRIO) + TheOddsAPI fallback
      // Bet365 matches snapshot é a fonte canônica de "está na Bet365 hoje"
      const oddsEvents = await fetchAllOdds().catch(() => [])
      const bet365MatchesRes = await fetch('https://sportsbrain-api.sportsbrain-api.workers.dev/v1/bet365/matches/latest', { cache: 'no-store' }).then(r => r.json()).catch(() => ({}))
      const bet365Fixtures = (bet365MatchesRes.matches || [])
      const _normT = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
      const bet365Set = new Set(bet365Fixtures.map(m => `${_normT(m.home)}|${_normT(m.away)}`))

      // Auto-close de picks pendentes próximos do kickoff (Fase 2):
      // toda vez que carregamos Palpites, varremos diary e fechamos quem está
      // dentro da janela [-30min, +4h] usando a odd atual do book como close.
      try {
        const stats = autoCloseRipePicks(p => {
          if (!oddsEvents.length) return null
          const evt = matchOddsForGame(oddsEvents, p.home, p.away)
          if (!evt) return null
          if (p.market === '1X2') {
            if (p.side === 'H') return evt.home || null
            if (p.side === 'D') return evt.draw || null
            if (p.side === 'A') return evt.away || null
          }
          return null
        })
        if (stats.closed > 0) console.log(`[Palpites] auto-close: ${stats.closed}/${stats.scanned} picks`)
      } catch {}
      // Helper: normaliza string pra comparar ESPN vs book
      const nTeam = (s) => (s || '').toLowerCase()
        .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
        .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
        .replace(/[^a-z0-9]/g,'').slice(0, 6)
      const gamesRaw = allGames.reduce((acc, g) => {
        // PROPRIETÁRIO: se Bet365 capturado tem esse fixture, aceita direto
        const inBet365Cap = bet365Set.has(`${_normT(g.home)}|${_normT(g.away)}`) ||
                            bet365Set.has(`${_normT(g.away)}|${_normT(g.home)}`)
        if (inBet365Cap) { acc.push({ ...g, bet365_match: true, bet365_source: 'capturado' }); return acc }
        if (!oddsEvents.length) { acc.push(g); return acc }  // fallback: sem odds API → passa todos
        const ev = findOddsEvent(oddsEvents, g.home, g.away)
        if (!ev) return acc
        // Decide se ESPN home matcha event.home_team direto ou está invertido
        const homeIsHome = nTeam(ev.home_team).startsWith(nTeam(g.home).slice(0,4)) ||
                           nTeam(g.home).startsWith(nTeam(ev.home_team).slice(0,4))
        // Override league label usando sport_title da TheOddsAPI (mais específico que ESPN)
        // Ex: "Premier League" (ambíguo) → "Belarus Premier League", "English Premier League"
        const bookLeague = ev.sport_title || ''
        const leagueFinal = (bookLeague && bookLeague.length > 2) ? bookLeague : g.league
        acc.push({
          ...g,
          espn_home: g.home,
          espn_away: g.away,
          home: homeIsHome ? (ev.home_team || g.home) : (ev.away_team || g.home),
          away: homeIsHome ? (ev.away_team || g.away) : (ev.home_team || g.away),
          league: leagueFinal,
          espn_league: g.league,
          sport_key: ev.sport_key || null,
          bet365_match: true,
        })
        return acc
      }, [])
      const skippedCount = allGames.length - gamesRaw.length

      // Stats de times em paralelo (só dos que têm cobertura)
      const teamNames = [...new Set(gamesRaw.flatMap(g => [g.home, g.away]))]
      const statsMap = {}
      await Promise.allSettled(
        teamNames.map(async n => {
          const s = await fetchTeamStats(n, 'football', 'all')
          if (s) statsMap[n] = s
        })
      )

      // Forma + H2H (top 40 jogos — já priorizados por ligas destacadas)
      const gamesForForm = gamesRaw.slice(0, 40)
      const formMap = new Map()
      await Promise.allSettled(
        gamesForForm.map(async g => {
          const ctx = await buildFormContext(g.home, g.away, g.league).catch(() => null)
          if (ctx) formMap.set(`${g.home}|${g.away}`, ctx)
        })
      )

      // PropCtx (xG + enrichment + referee + odds) — top 20 jogos pra economizar bandwidth
      const gamesForProp = gamesRaw.slice(0, 20)
      const propMap = new Map()
      await Promise.allSettled(
        gamesForProp.map(async g => {
          const dateStr = g.time ? new Date(g.time).toISOString().slice(0, 10) : targetDate
          const pc = await buildPropCtx({ home: g.home, away: g.away, league: g.league, date: dateStr, oddsEvents }).catch(() => null)
          if (pc) propMap.set(`${g.home}|${g.away}`, pc)
        })
      )

      const built = gamesRaw.map(g => {
        const hS = statsMap[g.home] || null
        const aS = statsMap[g.away] || null
        const ctx = formMap.get(`${g.home}|${g.away}`) || null
        const propCtx = propMap.get(`${g.home}|${g.away}`) || null
        const result = computeMatchResult(g.home, g.away, g.league, hS, aS, ctx, propCtx)
        const btts   = buildBTTSPick({ home: g.home, away: g.away, league: g.league,
                                       homeStats: hS, awayStats: aS, formCtx: ctx })
        return {
          ...g, result, btts,
          formCtx:   ctx,
          propCtx,
          h2hBtts:   ctx?.h2h?.bttsRate ?? null,
          h2hSample: ctx?.h2h?.sample ?? null,
        }
      })

      setGames(built)
      setCoverage({ total: allGames.length, skipped: skippedCount })
      setLoaded(true)
    } catch (e) {
      console.warn('[Palpites]', e.message)
      setLoaded(true)
    }
    setLoading(false)
  }, [selectedDate])

  useEffect(() => { load() }, [load])

  function goDate(n) {
    const newDate = addDays(selectedDate, n)
    setSelectedDate(newDate)
    load(newDate)
  }

  const leagues = useMemo(() => {
    const set = new Set(games.map(g => g.league).filter(Boolean))
    return ['all', ...[...set].sort()]
  }, [games])

  // Blacklist (par liga × mercado banido pelo histórico) — recomputa quando games muda
  const blacklist = useMemo(() => getBlacklist(), [games])

  // CLV rolling 30d — exibido no header pra disciplina
  const clvRolling = useMemo(() => computeRollingClv(30), [games])

  // Calibração (Platt) — auto-rebuild se cache > 7 dias
  const calibMap = useMemo(() => autoRebuildIfStale(30, 7), [games])

  // Pré-computa Top Pick por jogo (memoizado pelo array de games)
  const gamesWithTop = useMemo(
    () => games.map(g => ({ ...g, _topPick: selectTopPick(g, blacklist, calibMap) })),
    [games, blacklist, calibMap]
  )

  const premiumCount = useMemo(
    () => gamesWithTop.filter(g => g._topPick?.premium).length,
    [gamesWithTop]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = gamesWithTop
    if (q) list = list.filter(g =>
      g.home.toLowerCase().includes(q) ||
      g.away.toLowerCase().includes(q) ||
      g.league.toLowerCase().includes(q))
    if (leagueFilt !== 'all') list = list.filter(g => g.league === leagueFilt)
    if (premiumOnly) list = list.filter(g => g._topPick?.premium)

    if (sortBy === 'top') {
      list = [...list].sort((a, b) => (b._topPick?.score || 0) - (a._topPick?.score || 0))
    } else if (sortBy === 'conf') {
      list = [...list].sort((a, b) => (b._topPick?.conf || 0) - (a._topPick?.conf || 0))
    } else if (sortBy === 'goals') {
      list = [...list].sort((a, b) => b.result.expGoals - a.result.expGoals)
    } else if (sortBy === 'btts') {
      list = [...list].sort((a, b) => b.btts.bestConf - a.btts.bestConf)
    } else if (sortBy === 'edge') {
      const evOf = (g) => Math.max(...Object.values(g.result.marketEdge || {})
        .filter(v => v).map(v => v.ev || 0), 0)
      list = [...list].sort((a, b) => evOf(b) - evOf(a))
    }
    return list
  }, [gamesWithTop, search, leagueFilt, sortBy, premiumOnly])

  return (
    <>
      <PageHeader
        icon="🔮"
        title="Palpites do Dia"
        subtitle={`${games.length} jogos · ${premiumCount} 💎 picks premium${coverage.skipped > 0 ? ` · ${coverage.skipped} sem cobertura` : ''}${
          clvRolling.sample > 0 ? ` · CLV 30d ${clvRolling.avgClv >= 0 ? '+' : ''}${clvRolling.avgClv}% (n=${clvRolling.sample})` : ''
        }${blacklist.size > 0 ? ` · ${blacklist.size} mercados banidos` : ''} · No-vig + Top Pick auto`}
        actions={
          <button onClick={load} disabled={loading} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
            padding:'6px 12px', borderRadius:6, border:'1px solid var(--line)',
            background:'var(--ink2)', color:'var(--white)', cursor:loading?'wait':'pointer',
          }}>
            {loading ? '⏳ Carregando…' : '↻ Atualizar'}
          </button>
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

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom: 14 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar time, liga..."
          style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:'6px 10px', borderRadius:6,
            border:'1px solid var(--line)', background:'var(--ink2)', color:'var(--white)', outline:'none', width:220 }}/>
        {leagues.length > 1 && (
          <select value={leagueFilt} onChange={e => setLeagueFilt(e.target.value)} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, padding:'6px 10px', borderRadius:6,
            border:'1px solid var(--line)', background:'var(--ink2)', color:'var(--white)', outline:'none' }}>
            {leagues.map(l => <option key={l} value={l}>{l === 'all' ? '🏆 Todas as ligas' : l}</option>)}
          </select>
        )}
        <button onClick={() => setPremiumOnly(v => !v)} title="Mostra só jogos com Top Pick Premium (conf ≥65 + dados reais + edge ou alta probabilidade)" style={{
          fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
          padding:'6px 10px', borderRadius:6,
          border:`1px solid ${premiumOnly ? 'var(--green)' : 'var(--line)'}`,
          background: premiumOnly ? 'rgba(0,214,143,.12)' : 'var(--ink2)',
          color: premiumOnly ? 'var(--green)' : 'var(--mute)',
          cursor:'pointer',
        }}>💎 Premium {premiumCount > 0 ? premiumCount : ''}</button>
        <div style={{ display:'flex', gap:4, marginLeft:'auto' }}>
          {[
            { id:'top',   label:'🏆 Top Pick' },
            { id:'conf',  label:'🎯 Confiança' },
            { id:'goals', label:'⚽ + Gols' },
            { id:'btts',  label:'🔀 BTTS' },
            { id:'edge',  label:'💎 Edge' },
          ].map(o => (
            <button key={o.id} onClick={() => setSortBy(o.id)} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
              padding:'6px 10px', borderRadius:6,
              border:`1px solid ${sortBy===o.id ? 'var(--green)' : 'var(--line)'}`,
              background: sortBy===o.id ? 'rgba(0,214,143,.1)' : 'var(--ink2)',
              color: sortBy===o.id ? 'var(--green)' : 'var(--mute)',
              cursor:'pointer',
            }}>{o.label}</button>
          ))}
        </div>
      </div>

      {loading && !loaded && (
        <div className="loading-center"><div className="spinner"/><span>Carregando palpites...</span></div>
      )}

      {loaded && filtered.length === 0 && (
        <EmptyState
          icon="🔮"
          title="Nenhum jogo encontrado"
          subtitle="Ajuste os filtros ou atualize os dados"
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))', gap: 12 }}>
        {filtered.map((g, i) => <MatchCard key={`${g.home}|${g.away}|${i}`} game={g} blacklist={blacklist} calibMap={calibMap}/>)}
      </div>
    </>
  )
}
