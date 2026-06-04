/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           SportsBrain Data API — Cloudflare Worker              ║
 * ║           Version: 4.5.0  |  Edge Runtime                       ║
 * ║                                                                  ║
 * ║  DATA LAYER (free / starter)                                     ║
 * ║    /health                          API health check             ║
 * ║    /v1/status                       API status & tier info       ║
 * ║    /v1/demo/*                       Schema explorer (no auth)    ║
 * ║    /v1/football/games/today         Football games today         ║
 * ║    /v1/football/games/:date         Football games by date       ║
 * ║    /v1/football/game/:id/props      Football props for game      ║
 * ║    /v1/football/props/today         All football props today     ║
 * ║    /v1/football/team/:name/stats    Team statistics              ║
 * ║    /v1/basketball/games/today       NBA games today              ║
 * ║    /v1/basketball/games/:date       NBA games by date            ║
 * ║    /v1/basketball/game/:id/props    NBA props for game           ║
 * ║    /v1/basketball/props/today       All NBA props today          ║
 * ║    /v1/basketball/player/:n/stats   Player statistics            ║
 * ║    /v1/basketball/player/:n/props   Player props (contextual)    ║
 * ║    /v1/basketball/team/:name/stats  Team statistics              ║
 * ║                                                                  ║
 * ║  INTELLIGENCE LAYER (pro)                                        ║
 * ║    /v1/intelligence/picks/today     Ranked picks (all sports)    ║
 * ║    /v1/intelligence/value           High-EV opportunities        ║
 * ║    /v1/intelligence/rankings        Confidence-ranked picks      ║
 * ║    /v1/intelligence/projection      Projection engine as service ║
 * ║    /v1/intelligence/edge            Edge/EV calculator           ║
 * ║    /v1/intelligence/streaks/:sport  Active streaks detected      ║
 * ║    /v1/recommendations/*            AI recommendations engine    ║
 * ║                                                                  ║
 * ║  MARKET INTELLIGENCE LAYER (starter / pro)                       ║
 * ║    /v1/market/lines/:sport          Latest lines from snapshots  ║
 * ║    /v1/market/movement/:prop_key    Line movement history        ║
 * ║    /v1/market/consensus             Consensus + market signals   ║
 * ║                                                                  ║
 * ║  ANALYTICS LAYER (enterprise)                                    ║
 * ║    /v1/analytics/team/:team_id      Team analytical profile      ║
 * ║    /v1/analytics/player/:player_id  Player analytical profile    ║
 * ║    /v1/analytics/performance/me     My API key performance       ║
 * ║                                                                  ║
 * ║  META                                                            ║
 * ║    /v1/meta/quality                 Data quality report          ║
 * ║    /v1/meta/sources                 Active data sources          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { CacheService }       from './services/cache.js';
import { FootballService }    from './services/football.js';
import { BasketballService }  from './services/basketball.js';
import { OddsService }        from './services/odds.js';
import { PersistenceService } from './services/persistence.js';
import { HistoryService }     from './services/history.js';
import { handleHealth, corsHeaders } from './routes/health.js';
import { handleFootball }    from './routes/football.js';
import { handleBasketball }  from './routes/basketball.js';
import { handleIntelligence } from './routes/intelligence.js';
import { handleMarket }      from './routes/market.js';
import { handleAnalytics }   from './routes/analytics.js';
import { handleDemo }        from './routes/demo.js';
import { handleIngest }      from './routes/ingest.js';
import { handleBriefing }    from './routes/briefing.js';
import { handleDocs }        from './routes/docs.js';
import { handleAdmin, checkRateLimit } from './routes/admin.js';
import { handleMLTraining } from './routes/mlTraining.js';
import { handleMLQuality }  from './routes/mlQuality.js';
import { handleXG }          from './routes/xg.js';
import { ingestMatches, recomputeTeamXG, recomputeTeamCorners } from './cron/ingestMatches.js';
import { handleParlay }      from './routes/parlay.js';
import { handleDetail }      from './routes/detail.js';
import { handleOddsEngine }  from './routes/oddsEngine.js';
import { snapshotOdds, pruneOldSnapshots } from './cron/snapshotOdds.js';
import { detectSteam } from './cron/steamDetector.js'
import { collectForm } from './cron/formCollector.js'
import { collectLineups } from './cron/lineupCollector.js'
import { collectReferees } from './cron/refereeCollector.js'
import { handleSignalStatus } from './routes/signalStatus.js'
import { handleTrackRecord }  from './routes/trackRecord.js'
import { handleSofaScoreIngest } from './routes/sofascoreIngest.js';
import { handleSofaScoreHistoricalIngest } from './routes/sofascoreHistoricalIngest.js';
import { ingestApifDate, backfillApifLastNDays } from './services/apifHistoricalIngest.js';
import { fetchSofaScoreScoresForDateCached, fetchSofaScoreBoxStatsCached } from './services/sofascore.js';
import { normTeam as normTeamUtil, fuzzyFindGameInMap } from './utils/teamNorm.js';
import { sbError }           from './schemas/base.js'
import { computeBetaReadinessScore, getBankrollTestConfig, queryBetaReadinessMetrics } from './services/betaReadiness.js';
import { queryMicroTestReport } from './services/microTestAnalytics.js';
import { evaluateMicroTestPolicy } from './services/microTestPolicy.js';
import { evaluateSegmentHealth } from './services/segmentHealth.js';
import { evaluateBetaAdmission } from './services/betaAdmission.js';
import { evaluatePrivateBetaSandbox } from './services/privateBetaSandbox.js';
import { evaluateSimulatedCohortMonitor } from './services/simulatedCohortMonitor.js';
import { evaluateOperatorDecisionPacket } from './services/operatorDecisionPacket.js';
import { evaluateManualReviewGovernance } from './services/manualReviewGovernance.js';
import { evaluateEvidenceExport } from './services/evidenceExport.js';
import { evaluateExportContract } from './services/exportContract.js';
import { evaluateSnapshotSimulation } from './services/snapshotSimulation.js';
import { evaluateRegressionLockdown } from './services/regressionLockdown.js';
import { evaluateAdminExportPreview } from './services/adminExportPreview.js';
import { applyImmutableNoSellEnvelope } from './services/immutableNoSell.js';
import { handleOperatorReportPreview } from './routes/operatorReportPreview.js';
import { evaluateReportRedaction } from './services/reportRedaction.js';
import { evaluateExportAbuseProtection } from './services/exportAbuseProtection.js';
import { evaluateAdminPreviewUx } from './services/adminPreviewUx.js';
import { evaluateInternalExportRenderer } from './services/internalExportRenderer.js';
import { evaluateAdminDownloadDryRun } from './services/adminDownloadDryRun.js';
import { evaluateRedactionRegressionLock } from './services/redactionRegressionLock.js';
import { evaluateAdminExportArchive } from './services/adminExportArchive.js';
import { evaluateReportHistorySimulation } from './services/reportHistorySimulation.js';
import { evaluateAdminAccessAudit } from './services/adminAccessAudit.js';
import { evaluateInternalExportStorage } from './services/internalExportStorage.js';
import { evaluateAdminAccessReplay } from './services/adminAccessReplay.js';
import { evaluateReleaseFreezeSentinel } from './services/releaseFreezeSentinel.js';
import { evaluateReleaseFreezeBaseline } from './services/releaseFreezeBaseline.js';
import { evaluateSafetyInvariantSnapshot } from './services/safetyInvariantSnapshot.js';
import { evaluateControlledUnfreezeDesign } from './services/controlledUnfreezeDesign.js';
import { evaluateCapabilityUnlockMatrix } from './services/capabilityUnlockMatrix.js';
import { evaluateControlledUnfreezeSimulation } from './services/controlledUnfreezeSimulation.js';
import { evaluatePreBetaGovernanceGate } from './services/preBetaGovernanceGate.js';
import { evaluatePreBetaReadinessCouncil } from './services/preBetaReadinessCouncil.js';
import { evaluateOperatorSignoffSimulation } from './services/operatorSignoffSimulation.js';
import { evaluatePrivateBetaNonDelivery } from './services/privateBetaNonDelivery.js';
import { evaluateNonUserCohortContract } from './services/nonUserCohortContract.js';
import { evaluatePrivateBetaInvitationSimulation } from './services/privateBetaInvitationSimulation.js';
import { evaluateDeliveryKillSwitch } from './services/deliveryKillSwitch.js';
import { evaluateSyntheticCohortReview } from './services/syntheticCohortReview.js';
import { evaluatePrivateBetaDryInviteReport } from './services/privateBetaDryInviteReport.js';
import { evaluateDeliveryIncidentDrill } from './services/deliveryIncidentDrill.js';
import { evaluateBetaSafetyIncidentLedger } from './services/betaSafetyIncidentLedger.js';
import { evaluateIncidentRecoverySimulation } from './services/incidentRecoverySimulation.js';
import { evaluateOperatorEscalationProtocol } from './services/operatorEscalationProtocol.js';
import { evaluateP38GovernanceClosure } from './services/p38GovernanceClosure.js';
import { evaluateP38SafetyFinalization } from './services/p38SafetyFinalization.js';
import { evaluateP39TransitionPlan } from './services/p39TransitionPlan.js';
import { evaluateResolvedSampleAudit } from './services/resolvedSampleAudit.js';
import { evaluateMicroTestActivationReadiness } from './services/microTestActivationReadiness.js';
import { evaluateQualityProofKickoff } from './services/qualityProofKickoff.js';
import { evaluateMicroTestManualActivationGuard } from './services/microTestManualActivationGuard.js';
import { evaluatePostActivationMonitor } from './services/postActivationMonitor.js';
import { evaluateFirstRealQualitySnapshot } from './services/firstRealQualitySnapshot.js';
import { evaluateBreakEvenOddsReview } from './services/breakEvenOddsReview.js';
import { evaluateSegmentQualityProof } from './services/segmentQualityProof.js';
import { evaluateSegmentExclusionRecommendations } from './services/segmentExclusionRecommendations.js';
import { evaluateSegmentExclusionDryRun } from './services/segmentExclusionDryRun.js';
import { evaluateQualityReweightProposal } from './services/qualityReweightProposal.js';
import { evaluateShadowRecommendationPolicy } from './services/shadowRecommendationPolicy.js';
import { evaluateShadowReweightBacktest } from './services/shadowReweightBacktest.js';
import { evaluateRecommendationStabilityCheck } from './services/recommendationStabilityCheck.js';
import { evaluateQualityProofDecisionGate } from './services/qualityProofDecisionGate.js';
import { evaluateQualityProofTrendMonitor } from './services/qualityProofTrendMonitor.js';
import { evaluateSegmentDecisionHistory } from './services/segmentDecisionHistory.js';
import { evaluateBetaSimulationReadiness } from './services/betaSimulationReadiness.js';
import { evaluateBetaSimulationCohortPlan } from './services/betaSimulationCohortPlan.js';
import { evaluateSyntheticDeliveryUxContract } from './services/syntheticDeliveryUxContract.js';
import { evaluateQualityProofReviewBoard } from './services/qualityProofReviewBoard.js';
import { evaluateInternalPickCardContract } from './services/internalPickCardContract.js';
import { evaluateSyntheticBetaExperiencePreview } from './services/syntheticBetaExperiencePreview.js';
import { evaluateSyntheticFeedbackLoop } from './services/syntheticFeedbackLoop.js';

const API_VERSION = '4.5.0';

// ── PICK HISTORY HELPERS ──────────────────────────────────────────────────────

function normTeam(s) {
  // NFD + diacritic strip: "Atlético" → "Atletico", "América" → "America", "São" → "Sao"
  // Necessário pois picks usam nomes sem acento mas ESPN retorna nomes com acento.
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fuzzy lookup: busca jogo no score map por substring match de nomes de times.
// Ex: "cienciano" bate "cienciano del cusco"; "juventud de las piedras" bate "juventud".
// Retorna { home, away, eventId, slug } ou null.
function fuzzyFindGame(scMap, homePick, awayPick) {
  const hN = normTeam(homePick), aN = normTeam(awayPick);
  // 1) Exact match
  if (scMap[`${hN}|${aN}`]) return scMap[`${hN}|${aN}`];
  if (scMap[`${aN}|${hN}`]) { const g = scMap[`${aN}|${hN}`]; return { home: g.away, away: g.home, eventId: g.eventId, slug: g.slug }; }
  // 2) Fuzzy substring: exige mínimo 4 chars para evitar falsos positivos
  const minLen = 4;
  for (const [mapKey, mapVal] of Object.entries(scMap)) {
    const [mH, mA] = mapKey.split('|');
    if (!mH || !mA) continue;
    const hMatch = (hN.length >= minLen && mH.length >= minLen) && (mH.includes(hN) || hN.includes(mH));
    const aMatch = (aN.length >= minLen && mA.length >= minLen) && (mA.includes(aN) || aN.includes(mA));
    if (hMatch && aMatch) return mapVal;
    const hMatchR = (aN.length >= minLen && mH.length >= minLen) && (mH.includes(aN) || aN.includes(mH));
    const aMatchR = (hN.length >= minLen && mA.length >= minLen) && (mA.includes(hN) || hN.includes(mA));
    if (hMatchR && aMatchR) { return { home: mapVal.away, away: mapVal.home, eventId: mapVal.eventId, slug: mapVal.slug }; }
  }
  return null;
}

// Busca placares finalizados da ESPN para uma data (YYYY-MM-DD)
async function fetchESPNScoresForDate(date) {
  const leagues = [
    // ── CONMEBOL primeiro — evita corte por limite de subrequests do Workers ──
    'conmebol.libertadores','conmebol.sudamericana','conmebol.america',
    // ── Brasil ────────────────────────────────────────────────────────────────
    'bra.copa_do_brazil','bra.copa_do_nordeste',
    'bra.1','bra.2','bra.3',
    'bra.camp.paulista','bra.camp.carioca','bra.camp.mineiro','bra.camp.gaucho',
    // ── Argentina ─────────────────────────────────────────────────────────────
    'arg.1','arg.2','arg.copa',
    // ── Europa ────────────────────────────────────────────────────────────────
    'eng.1','eng.2','eng.3','eng.4','eng.fa','eng.league_cup',
    'esp.1','esp.2','esp.copa_del_rey',
    'ger.1','ger.2','ger.dfb_pokal',
    'ita.1','ita.2','ita.coppa_italia',
    'fra.1','fra.2',
    'por.1','por.2',
    'ned.1','bel.1','sco.1','tur.1','rus.1','ukr.1','aut.1','sui.1','gre.1',
    // ── UEFA / FIFA ───────────────────────────────────────────────────────────
    'uefa.champions','uefa.europa','uefa.europa.conf','uefa.nations',
    'fifa.world','fifa.world.qualifying.uefa','fifa.world.qualifying.conmebol',
    'concacaf.champions','concacaf.gold',
    // ── Américas ──────────────────────────────────────────────────────────────
    'usa.1','mex.1','col.1','chi.1','uru.1','par.1','per.1','ecu.1','ven.1','bol.1',
    // ── Ásia / Oceania / África ───────────────────────────────────────────────
    'jpn.1','kor.1','chn.1','aus.1',
    'afc.champions','caf.champions',
  ];
  const dateStr = date.replace(/-/g, '');
  // Ligas que respondem corretamente ao parâmetro ?dates= (grandes ligas europeias + internacionais)
  // Ligas brasileiras e sul-americanas menores NÃO retornam histórico com ?dates= — usam current round
  const datesLeagues = new Set([
    // Brasileirão + Copas BR — ESPN suporta ?dates= RANGE (ex: dates=20260501-20260507)
    // Nota: ?dates=YYYYMMDD (dia único) não funciona para bra.1; usar range de ±1 dia
    'bra.1','bra.copa_do_brazil','bra.copa_do_nordeste',
    'bra.camp.paulista','bra.camp.carioca','bra.camp.mineiro','bra.camp.gaucho',
    // Europeias
    'eng.1','eng.2','eng.3','eng.4','eng.fa','eng.league_cup',
    'esp.1','esp.2','esp.copa_del_rey',
    'ger.1','ger.2','ger.dfb_pokal',
    'ita.1','ita.2','ita.coppa_italia',
    'fra.1','fra.2','por.1','por.2',
    'ned.1','bel.1','sco.1','tur.1',
    'uefa.champions','uefa.europa','uefa.europa.conf','uefa.nations',
    'fifa.world','fifa.world.qualifying.uefa','fifa.world.qualifying.conmebol',
    'conmebol.libertadores','conmebol.sudamericana','conmebol.america',
    'concacaf.champions','usa.1',
  ])

  function parseEvents(data, slug, dateRange) {
    // dateRange = [minDate, maxDate] strings 'YYYY-MM-DD', ou null para aceitar tudo
    for (const ev of (data.events || [])) {
      if (ev.status?.type?.state !== 'post') continue;
      if (dateRange) {
        const evDate = (ev.date || ev.competitions?.[0]?.date || '').slice(0, 10)
        if (evDate < dateRange[0] || evDate > dateRange[1]) continue
      }
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const hs = parseInt(home.score ?? -1, 10);
      const as = parseInt(away.score ?? -1, 10);
      if (hs < 0 || as < 0) continue;
      const hN = normTeam(home.team?.displayName || home.team?.name || '');
      const aN = normTeam(away.team?.displayName || away.team?.name || '');
      // Extrai placar do 1º tempo (período 1) para resolver picks "1T"
      const hLS = home.linescores;
      const aLS = away.linescores;
      const hHT = hLS?.length ? parseInt(hLS[0]?.value ?? hLS[0]?.displayValue ?? -1, 10) : -1;
      const aHT = aLS?.length ? parseInt(aLS[0]?.value ?? aLS[0]?.displayValue ?? -1, 10) : -1;
      if (hN && aN) map[`${hN}|${aN}`] = {
        home: hs, away: as, eventId: ev.id, slug,
        home_ht: hHT >= 0 ? hHT : null,
        away_ht: aHT >= 0 ? aHT : null,
      };
    }
  }

  // Jogos noturnos brasileiros (>21h BRT) aparecem como dia+1 UTC no ESPN.
  // Usa range [date-1, date+2] para capturar todos os jogos do dia + jogos do DIA SEGUINTE
  // (picks são gerados com pick_date=hoje para jogos que ocorrem amanhã — ex: partidas europeias
  // às 18:30 UTC de amanhã que são criadas com pick_date de hoje).
  const dayMs = 86_400_000
  const baseMs = new Date(date + 'T12:00:00Z').getTime()
  const prevDay  = new Date(baseMs - dayMs).toISOString().slice(0, 10)
  const nextDay  = new Date(baseMs + dayMs).toISOString().slice(0, 10)
  const next2Day = new Date(baseMs + 2*dayMs).toISOString().slice(0, 10)
  const rangeDateStr = `${prevDay.replace(/-/g, '')}-${next2Day.replace(/-/g, '')}`
  const dateRange = [prevDay, next2Day]

  // Busca em batches de 10 para evitar sobrecarga de conexões no Workers
  // (70 fetches paralelos causam timeouts no Cloudflare Workers)
  const FETCH_BATCH = 10;
  const map = {};
  for (let i = 0; i < leagues.length; i += FETCH_BATCH) {
    const batch = leagues.slice(i, i + FETCH_BATCH);
    await Promise.allSettled(batch.map(async slug => {
      try {
        if (datesLeagues.has(slug)) {
          // Ligas com suporte a ?dates= — usa RANGE ±1 dia para pegar jogos noturnos BR
          const res = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${rangeDateStr}&limit=50`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!res.ok) return;
          parseEvents(await res.json(), slug, dateRange);
        } else {
          // Ligas sem suporte a ?dates= — busca current round e filtra pelo range ±1 dia
          const res = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!res.ok) return;
          parseEvents(await res.json(), slug, dateRange);
        }
      } catch {}
    }));
  }
  return map;
}

// ── D1-backed score map cache ──────────────────────────────────────────────
// Problema: plano free do Cloudflare Workers limita 50 subrequests por invocação.
// fetchESPNScoresForDate usa 49 sozinha, deixando apenas 1 para box stats.
//
// Solução: armazenar o score map no D1 SQLite (leituras D1 NÃO contam como subrequest).
// Na primeira invocação do dia, o score map é buscado do ESPN (49 subrequests) e armazenado no D1.
// Em invocações subsequentes, o D1 é consultado (0 subrequests) e os 50 slots ficam livres para box stats.
//
// Tabela criada automaticamente na primeira execução.

async function fetchESPNScoresForDateCached(date, env) {
  const isToday = date === new Date().toISOString().slice(0, 10);
  const daysOld = (Date.now() - new Date(date + 'T12:00:00Z').getTime()) / 86_400_000;
  // TTL curto para datas recentes (jogos podem terminar a qualquer hora durante 2 dias)
  // TTL longo para datas antigas (resultados imutáveis)
  const maxAgeMs = isToday ? 900_000 : (daysOld < 3 ? 600_000 : 7_200_000); // hoje=15min, <3 dias=10min, antigo=2h

  // 1. Tenta ler do D1 (NÃO conta como subrequest)
  if (env?.SB_DB) {
    try {
      await env.SB_DB.exec(
        `CREATE TABLE IF NOT EXISTS score_map_cache (date TEXT PRIMARY KEY, map_json TEXT NOT NULL, cached_at INTEGER NOT NULL)`
      ).catch(() => {});
      const row = await env.SB_DB.prepare(
        `SELECT map_json, cached_at FROM score_map_cache WHERE date = ?`
      ).bind(date).first().catch(() => null);
      if (row?.map_json) {
        const age = Date.now() - (row.cached_at || 0);
        if (age < maxAgeMs) {
          try { return JSON.parse(row.map_json); } catch {}
        }
      }
    } catch { /* D1 indisponível — continua com fetch ESPN */ }
  }

  // 2. Cache miss — faz os 49 fetches ESPN
  const map = await fetchESPNScoresForDate(date);

  // 3. Armazena no D1 de forma assíncrona (não bloqueia)
  if (env?.SB_DB && Object.keys(map).length > 0) {
    env.SB_DB.prepare(
      `INSERT OR REPLACE INTO score_map_cache (date, map_json, cached_at) VALUES (?, ?, ?)`
    ).bind(date, JSON.stringify(map), Date.now()).run().catch(() => {});
  }

  return map;
}

// ── D1-backed ESPN box stats cache ────────────────────────────────────────
// Box stats de jogos passados são imutáveis — TTL de 24h no D1.
// Leituras D1 NÃO contam como subrequest → libera budget para mais fetches ESPN.
async function fetchESPNBoxStatsCached(slug, eventId, env) {
  const cacheKey = `${slug}/${eventId}`;

  // 1. Tenta D1
  if (env?.SB_DB) {
    try {
      await env.SB_DB.exec(
        `CREATE TABLE IF NOT EXISTS box_stats_cache (key TEXT PRIMARY KEY, stats_json TEXT NOT NULL, cached_at INTEGER NOT NULL)`
      ).catch(() => {});
      const row = await env.SB_DB.prepare(
        `SELECT stats_json FROM box_stats_cache WHERE key = ?`
      ).bind(cacheKey).first().catch(() => null);
      if (row?.stats_json) {
        try { return JSON.parse(row.stats_json); } catch {}
      }
    } catch { /* D1 indisponível */ }
  }

  // 2. Cache miss — faz o fetch ESPN
  const stats = await fetchESPNBoxStats(slug, eventId);

  // 3. Armazena no D1 (permanente para jogos passados)
  if (stats && env?.SB_DB) {
    env.SB_DB.prepare(
      `INSERT OR REPLACE INTO box_stats_cache (key, stats_json, cached_at) VALUES (?, ?, ?)`
    ).bind(cacheKey, JSON.stringify(stats), Date.now()).run().catch(() => {});
  }

  return stats;
}

// Busca estatísticas detalhadas de um jogo via ESPN summary (box score)
// Retorna { total: {...}, home: {teamName,...}, away: {teamName,...} }
async function fetchESPNBoxStats(slug, eventId) {
  try {
    // User-Agent de browser real — ESPN retorna dados reduzidos (sem box stats) para IPs
    // de servidores/Workers sem UA de browser. Copa Lib e outras ligas afetadas.
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.espn.com/',
          // Sem Origin nem Accept-Language — ESPN retorna dados completos sem esses headers
        }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const teams = data.boxscore?.teams || [];
    if (!teams.length) return null;
    // Se nenhum time tem estatísticas reais, ESPN não tem box stats para esta liga/jogo
    const hasRealStats = teams.some(t => (t.statistics || []).length > 0);
    if (!hasRealStats) return null;

    function parseTeamStats(team) {
      // ESPN usa camelCase: wonCorners, totalShots, shotsOnTarget, yellowCards, redCards, foulsCommitted, offsides
      const t = {};
      for (const stat of (team.statistics || [])) {
        const k = stat.name || stat.label || '';  // manter case original
        const v = parseFloat(stat.displayValue ?? stat.value ?? '0');
        if (!isNaN(v)) t[k] = v;
      }
      const teamName = normTeam(team.team?.displayName || team.team?.name || '');
      return {
        teamName,
        corners:         t['wonCorners']     || t['cornerKicks']   || 0,
        shots:           t['totalShots']     || t['shots']         || 0,
        shots_on_target: t['shotsOnTarget']  || t['shotsOnGoal']   || 0,
        yellow_cards:    t['yellowCards']                          || 0,
        red_cards:       t['redCards']                             || 0,
        cards:          (t['yellowCards']    || 0) + (t['redCards'] || 0),
        fouls:           t['foulsCommitted'] || t['fouls']         || 0,
        offsides:        t['offsides']                             || 0,
      };
    }

    // ESPN box score: teams[0]=home, teams[1]=away (by convention)
    const homeStats = parseTeamStats(teams[0]);
    const awayStats = teams[1] ? parseTeamStats(teams[1]) : null;
    const addStats = (a, b) => ({
      corners:         (a.corners || 0)         + (b?.corners || 0),
      shots:           (a.shots || 0)           + (b?.shots || 0),
      shots_on_target: (a.shots_on_target || 0) + (b?.shots_on_target || 0),
      yellow_cards:    (a.yellow_cards || 0)    + (b?.yellow_cards || 0),
      red_cards:       (a.red_cards || 0)       + (b?.red_cards || 0),
      cards:           (a.cards || 0)           + (b?.cards || 0),
      fouls:           (a.fouls || 0)           + (b?.fouls || 0),
      offsides:        (a.offsides || 0)        + (b?.offsides || 0),
    });
    return {
      total: addStats(homeStats, awayStats),
      home:  homeStats,
      away:  awayStats || homeStats,  // fallback
    };
  } catch { return null; }
}

// ─── SofaScore fallback box stats ────────────────────────────────────────────
// Fallback quando ESPN não tem box stats (Copa Lib, Copa Sud, etc.)
// Sem autenticação necessária — API pública do SofaScore

// Busca estatísticas de box score via SofaScore
// Retorna mesmo formato de fetchESPNBoxStats: { total, home, away }
async function fetchSofaScoreBoxStats(ssEventId) {
  try {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/event/${ssEventId}/statistics`,
      {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SportsBrain/1.0; +https://sportsbrain.app)' }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const allPeriod = (data.statistics || []).find(p => p.period === 'ALL');
    if (!allPeriod) return null;

    // Extrai mapa key→{home,away} de todos os grupos do período ALL
    const statsMap = {};
    for (const group of (allPeriod.groups || [])) {
      for (const item of (group.statisticsItems || [])) {
        if (!item.key) continue;
        statsMap[item.key] = {
          home: parseFloat(item.home ?? '0') || 0,
          away: parseFloat(item.away ?? '0') || 0,
        };
      }
    }

    function buildSide(side) {
      const g = (k) => statsMap[k]?.[side] || 0;
      const yc = g('yellowCards');
      const rc = g('redCards');
      return {
        corners:         g('cornerKicks'),
        shots:           g('totalShotsOnGoal'),   // total shots
        shots_on_target: g('shotsOnGoal'),         // shots on target
        yellow_cards:    yc,
        red_cards:       rc,
        cards:           yc + rc,
        fouls:           g('fouls'),
        offsides:        g('offsides'),
      };
    }

    const homeStats = buildSide('home');
    const awayStats = buildSide('away');
    const addStats  = (a, b) => ({
      corners:         a.corners         + b.corners,
      shots:           a.shots           + b.shots,
      shots_on_target: a.shots_on_target + b.shots_on_target,
      yellow_cards:    a.yellow_cards    + b.yellow_cards,
      red_cards:       a.red_cards       + b.red_cards,
      cards:           a.cards           + b.cards,
      fouls:           a.fouls           + b.fouls,
      offsides:        a.offsides        + b.offsides,
    });

    return { total: addStats(homeStats, awayStats), home: homeStats, away: awayStats };
  } catch { return null; }
}

// Busca jogos finalizados de uma data no SofaScore
// Retorna mapa normKey → { home, away, ssEventId }
async function fetchSofaScoreScoresForDate(date) {
  try {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SportsBrain/1.0; +https://sportsbrain.app)' }
      }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const ev of (data.events || [])) {
      if (ev.status?.type !== 'finished') continue;
      const h = normTeam(ev.homeTeam?.name || ev.homeTeam?.shortName || '');
      const a = normTeam(ev.awayTeam?.name || ev.awayTeam?.shortName || '');
      if (!h || !a) continue;
      const entry = { home: h, away: a, ssEventId: ev.id };
      map[`${h}|${a}`] = entry;
      map[`${a}|${h}`] = entry;  // também indexa invertido para match bidirecional
    }
    return map;
  } catch { return {}; }
}

// Resolve mercado contra placar — retorna 'W'|'L'|'V' (void)|null
// 'V' = void (mercado não verificável com placar agregado, ex: player props)
// direction e line: colunas separadas do pick_history (passados quando disponíveis)
function resolvePickMarket(stat, scores, direction, line) {
  const s     = (stat || '').toLowerCase();
  const dir   = (direction || '').toLowerCase();
  const total = scores.home + scores.away;
  const homeWon = scores.home > scores.away;
  const awayWon = scores.away > scores.home;
  const draw    = scores.home === scores.away;
  const btts    = scores.home > 0 && scores.away > 0;

  // ── 1X2 / Result via stat normalizado + direction separado ──────────────
  // Cobre stat='result','1x2','match_result','match_winner','h2h','RESULT' etc.
  const isResultStat = /^(?:result|1x2|match.?result|match.?winner|h2h|1x2|home_away)$/i.test(s);
  if (isResultStat || (s === '' && (dir === 'home' || dir === 'away' || dir === 'draw'))) {
    if (dir === 'home' || dir === '1') return homeWon ? 'W' : 'L';
    if (dir === 'away' || dir === '2') return awayWon ? 'W' : 'L';
    if (dir === 'draw' || dir === 'x') return draw    ? 'W' : 'L';
    if (dir === '1x'  || dir === 'dc_1x') return (homeWon || draw) ? 'W' : 'L';
    if (dir === 'x2'  || dir === 'dc_x2') return (awayWon || draw) ? 'W' : 'L';
    if (dir === '12'  || dir === 'dc_12') return !draw ? 'W' : 'L';
  }

  // ── TOTAL_GOALS / Over-Under via stat normalizado + direction + line ─────
  const isTotalGoalsStat = /^(?:total.?goals?|goals?.?total|over.?under|totals?|ou)$/i.test(s);
  if (isTotalGoalsStat && line != null && !isNaN(line)) {
    if (dir.startsWith('over') || dir === 'mais' || dir === 'acima')
      return total > line ? 'W' : 'L';
    if (dir.startsWith('under') || dir === 'menos' || dir === 'abaixo')
      return total < line ? 'W' : 'L';
  }

  // ── BTTS via stat normalizado + direction separado ────────────────────────
  const isBttsStat = /^(?:btts|both.?teams?.?score?|ambos?.?marcam?|ambas.?equipes?)$/i.test(s);
  if (isBttsStat) {
    const isBttsNo = dir === 'no' || dir === 'nao' || dir === 'não' || dir === 'nein' ||
                     dir === 'btts_no' || dir === 'no_btts';
    if (isBttsNo) return btts ? 'L' : 'W';
    return btts ? 'W' : 'L';
  }

  // ── Double Chance via stat normalizado + direction ────────────────────────
  const isDCStat = /^(?:double.?chance|dc|dupla.?hipotese|dupla.?chance)$/i.test(s);
  if (isDCStat) {
    if (dir === '1x' || dir === 'dc_1x') return (homeWon || draw) ? 'W' : 'L';
    if (dir === 'x2' || dir === 'dc_x2') return (awayWon || draw) ? 'W' : 'L';
    if (dir === '12' || dir === 'dc_12') return !draw ? 'W' : 'L';
  }

  // ── Match Result / 1X2 via texto livre na stat string ────────────────────
  if ((s.includes('vitória') || s.includes('vit.')) && (s.includes('casa') || s.includes('mandante') || s.includes('home')))
    return homeWon ? 'W' : 'L';
  if ((s.includes('vitória') || s.includes('vit.')) && (s.includes('fora') || s.includes('visitante') || s.includes('away')))
    return awayWon ? 'W' : 'L';
  if (s.includes('empate') || s.includes('draw')) return draw ? 'W' : 'L';
  if (s === 'casa win' || s === 'home win' || s === 'casa') return homeWon ? 'W' : 'L';
  if (s === 'fora win' || s === 'away win' || s === 'fora') return awayWon ? 'W' : 'L';
  // stat='win' dir='win' — pick de vitória do mandante (home win)
  if ((s === 'win' || s === 'home') && (dir === 'win' || dir === 'home' || dir === '1' || dir === '')) return homeWon ? 'W' : 'L';
  // stat='BTTS Sim'/'BTTS Não' — BTTS com resultado embutido no nome
  if (s === 'btts sim' || s === 'btts yes') return btts ? 'W' : 'L';
  if (s === 'btts não' || s === 'btts nao' || s === 'btts no') return btts ? 'L' : 'W';

  // ── Over/Under embutido na stat string (legacy) ───────────────────────────
  const overM  = s.match(/(?:over|mais de|acima de)\s*([\d.]+)/i);
  if (overM)  return total > parseFloat(overM[1])  ? 'W' : 'L';
  const underM = s.match(/(?:under|menos de|abaixo de)\s*([\d.]+)/i);
  if (underM) return total < parseFloat(underM[1]) ? 'W' : 'L';

  // ── Over/Under via direction+line quando stat não tem linha embutida ──────
  // (Fallback para stats genéricos que têm direction/line mas não embutem no texto)
  if (line != null && !isNaN(line)) {
    if (dir.startsWith('over') || dir === 'mais')   return total > line  ? 'W' : 'L';
    if (dir.startsWith('under') || dir === 'menos') return total < line  ? 'W' : 'L';
  }

  // ── BTTS via texto livre na stat string ───────────────────────────────────
  if (s.includes('btts') || s.includes('ambos marcam') || s.includes('ambas equipes') ||
      s.includes('both teams score') ||
      (s.includes('marcam') && (s.includes('sim') || s.includes('não') || s.includes('nao')))) {
    const isBttsNo = s.includes('não') || s.includes('nao') || s.includes(': não') || s.includes(': nao') ||
                     dir === 'no' || dir === 'nao' || dir === 'não';
    if (isBttsNo) return btts ? 'L' : 'W';
    return btts ? 'W' : 'L';
  }

  // ── 1X2 por direction string (saves como "home vence", "away vence", etc.) ─
  if (s.includes('vence') && (s.includes('casa')))  return homeWon ? 'W' : 'L';
  if (s.includes('vence') && (s.includes('fora') || s.includes('visitante'))) return awayWon ? 'W' : 'L';

  // ── Double chance via texto livre ─────────────────────────────────────────
  if ((s.includes('1x') || (s.includes('casa') && s.includes('empate'))) && !s.includes('vence'))
    return (homeWon || draw) ? 'W' : 'L';
  if ((s.includes('x2') || (s.includes('fora') && s.includes('empate'))) && !s.includes('vence'))
    return (awayWon || draw) ? 'W' : 'L';
  if (s.includes('12') || (s.includes('sem empate') && !s.includes('vence')))
    return (homeWon || awayWon) ? 'W' : 'L';

  // ── Spread NBA ────────────────────────────────────────────────────────────
  const spreadM = s.match(/spread\s*(-?[\d.]+)/i);
  if (spreadM && (s.includes('home') || s.includes('casa'))) {
    const margin = scores.home - scores.away;
    return margin > -parseFloat(spreadM[1]) ? 'W' : 'L';
  }
  // Spread via stat='spread' ou stat='nba_game_lines' + direction/line
  if (/^(?:spread|nba_game_lines|nba_spread)$/i.test(s) && line != null) {
    if (dir.includes('home') || dir.includes('casa')) {
      return (scores.home - scores.away) > -line ? 'W' : 'L';
    }
    if (dir.includes('away') || dir.includes('fora')) {
      return (scores.away - scores.home) > -line ? 'W' : 'L';
    }
  }

  // ── Mercados de player props NBA — não resolvíveis com placar agregado ─────
  const unresolvableStats = [
    'pontos', 'rebotes', 'reboundes', 'assistências', 'assistencias', 'assists',
    '3pt', 'three', 'pra', 'pr', 'pa', 'ra',
    'marca/assist', 'score or assist', 'gol ou assist', 'player_',
    'desarme', 'tackle',
  ];
  if (unresolvableStats.some(k => s.includes(k))) return 'V';

  // ── Mercados 1T — resolve via placar HT quando disponível ───────────────
  if (/\b1t\b|primeiro tempo|first half|ht\b|halftime/i.test(s)) {
    const hHT = scores.home_ht;
    const aHT = scores.away_ht;
    if (hHT != null && aHT != null) {
      const htTotal = hHT + aHT;
      const htHome  = hHT > aHT;
      const htAway  = aHT > hHT;
      const htDraw  = hHT === aHT;
      // Resultado 1T: Casa Vence 1T / Empate 1T / Fora Vence 1T
      if (s.includes('casa vence') || (s.includes('home') && s.includes('wins'))) return htHome ? 'W' : 'L';
      if (s.includes('fora vence') || (s.includes('away') && s.includes('wins'))) return htAway ? 'W' : 'L';
      if (s.includes('empate') && !s.includes('sem empate')) return htDraw ? 'W' : 'L';
      // Over/Under gols 1T (linha embutida na stat)
      const htOver  = s.match(/(?:over|mais de|acima de)\s*([\d.]+)/);
      if (htOver)  return htTotal > parseFloat(htOver[1])  ? 'W' : 'L';
      const htUnder = s.match(/(?:under|menos de|abaixo de)\s*([\d.]+)/);
      if (htUnder) return htTotal < parseFloat(htUnder[1]) ? 'W' : 'L';
      // Over/Under via direction + line separados ("Over 0.5 Gols 1T")
      if (line != null && !isNaN(line)) {
        if (dir.startsWith('over')  || dir === 'mais')   return htTotal > line ? 'W' : 'L';
        if (dir.startsWith('under') || dir === 'menos') return htTotal < line ? 'W' : 'L';
      }
    }
    // Sem placar HT disponível — retorna null (fica pendente até void por idade)
    return null;
  }

  return null; // mercado desconhecido — fica pendente pra revisão manual
}

// Busca placares NBA da ESPN para uma data
async function fetchESPNNBAScoresForDate(date) {
  const dateStr = date.replace(/-/g, '');
  const map = {};
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return map;
    const data = await res.json();
    for (const ev of (data.events || [])) {
      if (ev.status?.type?.state !== 'post') continue;
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const hs = parseInt(home.score ?? -1, 10);
      const as = parseInt(away.score ?? -1, 10);
      if (hs < 0 || as < 0) continue;
      const hN = normTeam(home.team?.displayName || home.team?.name || '');
      const aN = normTeam(away.team?.displayName || away.team?.name || '');
      if (hN && aN) map[`${hN}|${aN}`] = { home: hs, away: as };
    }
  } catch {}
  return map;
}

// Split robusto de "Home vs Away" / "Home v Away" / "Home x Away" / "Home – Away"
function splitMatchString(matchStr) {
  if (!matchStr) return null;
  // Tenta separadores em ordem de especificidade
  const seps = [' vs ', ' v ', ' × ', ' x ', ' – ', ' - ', ' @ '];
  for (const sep of seps) {
    const idx = matchStr.toLowerCase().indexOf(sep.toLowerCase());
    if (idx > 0) {
      return [matchStr.slice(0, idx), matchStr.slice(idx + sep.length)];
    }
  }
  return null;
}

// Resolve pick via ESPN box stats (corners/shots/cards/fouls/offsides)
// boxStats = { total: {...}, home: {teamName,...}, away: {teamName,...} }
// Extraído para file scope para uso no endpoint de backfill SofaScore.
function resolveCornerCardShotPickFn(stat, line, direction, boxStats, matchStr) {
  const s = (stat || '').toLowerCase();
  if (line == null || isNaN(line)) return null;

  // Detecta se é stat de um time específico (ex: "Cartões Ituano", "Escanteios Casa")
  // Se sim, escolhe home/away; se não, usa total
  let src = boxStats.total;
  if (boxStats.home || boxStats.away) {
    // Tenta mapear time pelo nome na stat ou por "casa/home/fora/away"
    const isCasa = /casa|home|mandante/.test(s);
    const isFora = /fora|away|visitante/.test(s);
    if (isCasa) {
      src = boxStats.home;
    } else if (isFora) {
      src = boxStats.away;
    } else if (matchStr) {
      // Extrai nomes home/away do match string e verifica se a stat menciona um deles
      const mParts = splitMatchString(matchStr);
      if (mParts) {
        const hNorm = normTeam(mParts[0]);
        const aNorm = normTeam(mParts[1]);
        // Verifica overlap entre palavras do nome do time e a stat
        const statWords = s.replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3);
        const hWords = hNorm.split(' ').filter(w => w.length > 3);
        const aWords = aNorm.split(' ').filter(w => w.length > 3);
        const hMatch = statWords.some(w => hWords.some(h => h.includes(w) || w.includes(h)));
        const aMatch = statWords.some(w => aWords.some(a => a.includes(w) || w.includes(a)));
        if (hMatch && !aMatch) src = boxStats.home;
        else if (aMatch && !hMatch) src = boxStats.away;
        // else: ambiguous → usa total
      }
    }
  }

  let value = 0;
  if (/corner|escantei|canto/.test(s))                             value = src.corners || 0;
  else if (/shots?\s*on\s*(target|goal)|chute.*ao gol|sot/.test(s)) value = src.shots_on_target || 0;
  else if (/shot|chute|finaliz/.test(s))                           value = src.shots || 0;
  else if (/yellow.card|cartão amarelo|cartao amarelo|amarelo/.test(s)) value = src.yellow_cards || 0;
  else if (/red.card|cartão vermelho|cartao vermelho|vermelho/.test(s)) value = src.red_cards || 0;
  else if (/card|cart/.test(s))                                    value = src.cards || 0;
  else if (/foul|falta/.test(s))                                   value = src.fouls || 0;
  else if (/offside|impedi/.test(s))                               value = src.offsides || 0;
  else return null;
  const isOver = /over|mais/.test((direction || '').toLowerCase());
  return isOver ? (value > line ? 'W' : 'L') : (value < line ? 'W' : 'L');
}

// Auto-verifica picks pendentes no D1 usando ESPN — football + basketball
// box_recovery=true: reabre especificamente voids de box stats (corners/shots/cards) para retentativa via SofaScore
// F2.86b: cron dedicado pra pre-popular score_map_cache de D-1/D-2.
// Roda em isolamento (sem outras tarefas concorrentes) → budget Cloudflare
// total disponível (~50 subrequests) garantido para ESPN fetch.
// Próximo runPickAutoVerify usa cache warm sem precisar de fresh fetch.
async function warmYesterdayCache(env) {
  if (!env?.SB_DB) return { ok: false, error: 'no_db' };
  const out = { ok: true, dates: [] };
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  // Foca em D-1 primeiro (mais visível na UI). D-2 fica pra próximo tick se budget esgotar.
  const targets = [yesterday, twoDaysAgo];
  let freshUsed = false;
  for (const d of targets) {
    if (d === today) continue;
    if (freshUsed) {
      // Budget gasto. Pula pra próximo cron tick.
      out.dates.push({ date: d, status: 'skipped_budget' });
      continue;
    }
    try {
      const freshMap = await fetchESPNScoresForDate(d);
      const gameCount = Object.keys(freshMap || {}).length;
      if (gameCount > 0) {
        await env.SB_DB.prepare(
          `INSERT OR REPLACE INTO score_map_cache (date, map_json, cached_at) VALUES (?, ?, ?)`
        ).bind(d, JSON.stringify(freshMap), Date.now()).run().catch(() => {});
        freshUsed = true;
        out.dates.push({ date: d, status: 'cached', games: gameCount });
      } else {
        out.dates.push({ date: d, status: 'empty_response' });
      }
    } catch (e) {
      out.dates.push({ date: d, status: 'error', error: e?.message });
    }
  }
  return out;
}

async function runPickAutoVerify(env, recovery = false, boxRecovery = false) {
  if (!env.SB_DB) return { verified: 0, error: 'no_db' };

  // ── Schema: ensure SofaScore D1 tables exist ─────────────────────────────
  await Promise.allSettled([
    env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS sofascore_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      norm_key TEXT NOT NULL,
      event_date TEXT NOT NULL,
      ss_event_id INTEGER NOT NULL,
      sport TEXT NOT NULL DEFAULT 'football',
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      home_ht INTEGER,
      away_ht INTEGER,
      status TEXT NOT NULL DEFAULT 'finished',
      league TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(norm_key, event_date, sport)
    )`),
    env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS sofascore_stats (
      ss_event_id INTEGER PRIMARY KEY,
      corner_home INTEGER DEFAULT 0,
      corner_away INTEGER DEFAULT 0,
      shots_home INTEGER DEFAULT 0,
      shots_away INTEGER DEFAULT 0,
      shots_on_target_home INTEGER DEFAULT 0,
      shots_on_target_away INTEGER DEFAULT 0,
      yellow_home INTEGER DEFAULT 0,
      yellow_away INTEGER DEFAULT 0,
      red_home INTEGER DEFAULT 0,
      red_away INTEGER DEFAULT 0,
      fouls_home INTEGER DEFAULT 0,
      fouls_away INTEGER DEFAULT 0,
      offsides_home INTEGER DEFAULT 0,
      offsides_away INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`),
    env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS sofascore_health (
      id INTEGER PRIMARY KEY,
      last_ingest_at INTEGER DEFAULT 0,
      last_ingest_date TEXT DEFAULT '',
      events_today INTEGER DEFAULT 0,
      stats_today INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT 0
    )`).then(() =>
      env.SB_DB.prepare(`INSERT OR IGNORE INTO sofascore_health (id) VALUES (1)`).run()
    ),
  ]);

  // Adiciona colunas de rastreamento de fonte de resultado (idempotente)
  // ALTER TABLE errors se coluna já existe — esperado, allSettled absorve
  await Promise.allSettled([
    env.SB_DB.exec(`ALTER TABLE pick_history ADD COLUMN result_source TEXT DEFAULT NULL`),
    env.SB_DB.exec(`ALTER TABLE pick_history ADD COLUMN result_confidence TEXT DEFAULT NULL`),
  ]);

  // Data UTC atual calculada em JS — evita divergência com date('now') do D1
  const jsDateNow       = new Date().toISOString().slice(0, 10);                     // ex: '2026-05-08'
  const jsDateYesterday = new Date(Date.now() -  1 * 86_400_000).toISOString().slice(0, 10);
  const jsDate14DaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  // Em modo recovery: reabre voids dos últimos 14 dias; em modo normal: apenas ontem+hoje.
  const reopenWindowDate = recovery ? jsDate14DaysAgo : jsDateYesterday;

  // Em modo recovery: void picks passados que o ESPN não consegue resolver (mesmo sem isOldDate).
  // Em modo normal: só void quando pick_date >= 3 dias atrás (isOldDate).
  function shouldVoid(pickDate) {
    if (recovery) return pickDate < jsDateNow; // picks passados sempre void se não resolver
    return isOldDate(pickDate);
  }

  // Marcador de void: recovery usa auto_verified=2 para que PASSO 0c (que filtra auto_verified=1)
  // não reabra os mesmos picks a cada run de recovery, quebrando o loop reopen/void.
  const voidMark = recovery ? 2 : 1;

  // PASSO 0c usa janela de ontem+hoje para dar chance de jogos europeus (18-20h UTC) e
  // sul-americanos (01h UTC) do dia anterior resolverem antes do threshold de 48h.
  // Picks de ontem têm ~26h de idade → isOldDate(48h) = false → só skippam, nunca void.
  // Quando amanhã chegar, jsDateYesterday avança para hoje, e ontem não é mais aberto.
  // → zero risco de loop.

  // ── PASSO 0a: Batch void de picks verdadeiramente não-resolvíveis via ESPN
  // Void apenas HT/1T e player props — APENAS picks de dias ANTERIORES (pick_date < today)
  // NUNCA voidar picks do dia atual pelo saved_at (jogo pode ainda não ter ocorrido)
  const batchVoidResult = await env.SB_DB.prepare(`
    UPDATE pick_history
    SET result = 'V', auto_verified = 1, updated_at = datetime('now')
    WHERE result IS NULL
      AND pick_date < ?
      AND (
        -- 1T box stats: chutes, escanteios, SOT — não resolvíveis sem stats HT do ESPN
        -- EXCETO picks de resultado 1T (Casa Vence/Empate/Gols) — resolvíveis via linescores
        (
          (
            stat LIKE '%1T%'     OR stat LIKE '% 1t %'         OR
            stat LIKE '%1T %'    OR stat LIKE '% 1T%'           OR
            LOWER(stat) LIKE '%primeiro tempo%'                 OR
            LOWER(stat) LIKE '%first half%'                     OR
            LOWER(stat) LIKE '%halftime%'
          )
          AND NOT (
            -- Score-based 1T: resolvíveis via placar HT (ESPN linescores)
            LOWER(stat) LIKE '%vence%'    OR
            LOWER(stat) LIKE '%empate%'   OR
            LOWER(stat) LIKE '%gols%'     OR
            LOWER(stat) LIKE '%goals%'
          )
        )
        OR LOWER(stat) LIKE '%pontos%'
        OR LOWER(stat) LIKE '%rebotes%'
        OR LOWER(stat) LIKE '%assistencias%'
        OR LOWER(stat) LIKE '%assistências%'
        OR LOWER(stat) LIKE '%assists%'
        OR LOWER(stat) LIKE '%player_%'
        OR LOWER(stat) LIKE '%marca/assist%'
        OR LOWER(stat) LIKE '%score or assist%'
        OR LOWER(stat) LIKE '%desarme%'
        OR LOWER(stat) LIKE '%tackle%'
        -- NÃO incluir escanteio/corner/chute — resolvíveis via ESPN box stats
      )
  `).bind(jsDateNow).run().catch(() => ({ meta: { changes: 0 } }));
  const batchVoided = batchVoidResult?.meta?.changes || 0;

  // PASSO 0a.2 removido — sem PASSO 0b não há mais re-voiding incorreto.
  // O loop ESPN já voideia individualmente picks velhos não-resolvíveis.

  // PASSO 0b removido — o loop ESPN já faz void individual de picks velhos não-resolvíveis.
  // Remover este batch void era necessário porque ele re-voideava picks que o PASSO 0a.2
  // tinha reativado, impedindo a verificação ESPN de rodar sobre eles.
  const batchVoidedOld = 0;

  // ── PASSO 0c: Re-abrir voids automáticos de ONTEM+HOJE (batch de 80 por vez) ─
  // Janela: pick_date >= ontem (UTC) — cobre jogos europeus (18-20h UTC) e sul-americanos
  // (00-02h UTC) que foram voided antes de terminar ou de serem buscados pelo ESPN.
  // isOldDate = 48h garante que picks de ontem (26h) não são re-voideados — sem loop.
  // Quando o dia vira, jsDateYesterday avança e picks de 2 dias atrás saem da janela.
  // NÃO re-abre HT/1T box stats e player props — esses são legitimamente unresolvable.
  // Limit 80 por run para evitar timeout do Worker.

  // DEBUG: amostra de picks que seriam reabertos (para diagnóstico do loop)
  const debugReopenSample = await env.SB_DB.prepare(`
    SELECT id, pick_date, match, stat FROM pick_history
    WHERE result = 'V'
      AND auto_verified = 1
      AND pick_date >= ?
      AND NOT (
        (
          (stat LIKE '%1T%' OR stat LIKE '% 1t %' OR stat LIKE '%1T %' OR stat LIKE '% 1T%' OR
           LOWER(stat) LIKE '%primeiro tempo%' OR LOWER(stat) LIKE '%first half%' OR LOWER(stat) LIKE '%halftime%')
          AND NOT (LOWER(stat) LIKE '%vence%' OR LOWER(stat) LIKE '%empate%' OR LOWER(stat) LIKE '%gols%' OR LOWER(stat) LIKE '%goals%')
        )
        OR LOWER(stat) LIKE '%pontos%' OR LOWER(stat) LIKE '%rebotes%'
        OR LOWER(stat) LIKE '%assistencias%' OR LOWER(stat) LIKE '%assistências%'
        OR LOWER(stat) LIKE '%player_%' OR LOWER(stat) LIKE '%marca/assist%'
        OR LOWER(stat) LIKE '%score or assist%' OR LOWER(stat) LIKE '%desarme%' OR LOWER(stat) LIKE '%tackle%'
      )
    ORDER BY pick_date DESC LIMIT ${recovery ? 10 : 5}
  `).bind(reopenWindowDate).all().catch(() => ({ results: [] }));

  const reopenResult = await env.SB_DB.prepare(`
    UPDATE pick_history
    SET result = NULL, auto_verified = 0, updated_at = datetime('now')
    WHERE id IN (
      SELECT id FROM pick_history
      WHERE result = 'V'
        AND auto_verified = 1
        AND pick_date >= ?
        AND NOT (
          -- 1T box stats: não reabrir (legítimos, sem stats HT no ESPN)
          (
            (
              stat LIKE '%1T%'     OR stat LIKE '% 1t %'         OR
              stat LIKE '%1T %'    OR stat LIKE '% 1T%'           OR
              LOWER(stat) LIKE '%primeiro tempo%'                 OR
              LOWER(stat) LIKE '%first half%'                     OR
              LOWER(stat) LIKE '%halftime%'
            )
            AND NOT (
              LOWER(stat) LIKE '%vence%'  OR LOWER(stat) LIKE '%empate%' OR
              LOWER(stat) LIKE '%gols%'   OR LOWER(stat) LIKE '%goals%'
            )
          )
          OR LOWER(stat) LIKE '%pontos%'
          OR LOWER(stat) LIKE '%rebotes%'
          OR LOWER(stat) LIKE '%assistencias%'
          OR LOWER(stat) LIKE '%assistências%'
          OR LOWER(stat) LIKE '%player_%'
          OR LOWER(stat) LIKE '%marca/assist%'
          OR LOWER(stat) LIKE '%score or assist%'
          OR LOWER(stat) LIKE '%desarme%'
          OR LOWER(stat) LIKE '%tackle%'
        )
      ORDER BY pick_date DESC
      LIMIT ${recovery ? 500 : 80}
    )
  `).bind(reopenWindowDate).run().catch(() => ({ meta: { changes: 0 } }));
  const batchReopened = reopenResult?.meta?.changes || 0;
  if (batchReopened > 0) console.log(`[AutoVerify] PASSO 0c: ${batchReopened} voids re-abertos | recovery=${recovery} | window>=${reopenWindowDate} | sample=${JSON.stringify((debugReopenSample.results||[]).map(r=>r.pick_date+'|'+r.match))}`);

  // ── PASSO 0d: box_recovery — reabre voids de box stats (auto_verified 1 ou 2) para retentativa SofaScore ──
  // Só executa quando box_recovery=true. Reabre APENAS picks de corners/shots/cards (box stats)
  // que foram voided (inclusive auto_verified=2 do recovery anterior) pois agora temos SofaScore.
  // Reabre até 500 por vez; na próxima run, o main loop resolve via SofaScore e marca auto_verified=1.
  let boxReopened = 0;
  if (boxRecovery) {
    const boxReopenResult = await env.SB_DB.prepare(`
      UPDATE pick_history
      SET result = NULL, auto_verified = 0, updated_at = datetime('now')
      WHERE id IN (
        SELECT id FROM pick_history
        WHERE result = 'V'
          AND auto_verified IN (1, 2)
          AND pick_date >= ?
          AND pick_date < ?
          AND sport = 'football'
          AND (
            LOWER(stat) LIKE '%corner%'    OR LOWER(stat) LIKE '%escantei%' OR
            LOWER(stat) LIKE '%canto%'     OR LOWER(stat) LIKE '%shot%'     OR
            LOWER(stat) LIKE '%chute%'     OR LOWER(stat) LIKE '%finaliz%'  OR
            LOWER(stat) LIKE '%sot%'       OR LOWER(stat) LIKE '%card%'     OR
            LOWER(stat) LIKE '%cart%'      OR LOWER(stat) LIKE '%foul%'     OR
            LOWER(stat) LIKE '%falta%'     OR LOWER(stat) LIKE '%offside%'  OR
            LOWER(stat) LIKE '%impedi%'
          )
          -- Exclui picks de 1T (HT) — não temos stats HT via SofaScore
          AND NOT (
            stat LIKE '%1T%' OR stat LIKE '% 1t %' OR stat LIKE '%1T %' OR stat LIKE '% 1T%' OR
            LOWER(stat) LIKE '%primeiro tempo%' OR LOWER(stat) LIKE '%first half%' OR LOWER(stat) LIKE '%halftime%'
          )
        ORDER BY pick_date DESC
        LIMIT 500
      )
    `).bind(jsDate14DaysAgo, jsDateNow).run().catch(() => ({ meta: { changes: 0 } }));
    boxReopened = boxReopenResult?.meta?.changes || 0;
    if (boxReopened > 0) console.log(`[AutoVerify] PASSO 0d (box_recovery): ${boxReopened} box stats voids reabertos para retentativa SofaScore`);
  }

  // Exclui da fila stats que são 100% unresolvable (ex: Rebotes de hoje ainda não confirmadas).
  // Elas serão batch-voided no próximo cron (quando pick_date < date('now')).
  const { results: pending } = await env.SB_DB.prepare(
    `SELECT id, pick_date, match, stat, sport, line, direction, home_team, away_team, match_id FROM pick_history
     WHERE result IS NULL
       AND NOT (
         LOWER(stat) LIKE '%rebotes%'        OR LOWER(stat) LIKE '%pontos%'          OR
         LOWER(stat) LIKE '%assistencias%'   OR LOWER(stat) LIKE '%assistências%'    OR
         LOWER(stat) LIKE '%assists%'        OR LOWER(stat) LIKE '%player_%'         OR
         LOWER(stat) LIKE '%marca/assist%'   OR LOWER(stat) LIKE '%score or assist%' OR
         LOWER(stat) LIKE '%desarme%'        OR LOWER(stat) LIKE '%tackle%'          OR
         -- 1T box stats: excluir (sem stats HT); EXCETO resultado 1T (vence/empate/gols)
         (
           (
             stat LIKE '%1T%'    OR stat LIKE '% 1t %'                OR
             stat LIKE '%1T %'   OR stat LIKE '% 1T%'                 OR
             LOWER(stat) LIKE '%primeiro tempo%'                      OR
             LOWER(stat) LIKE '%first half%'                          OR
             LOWER(stat) LIKE '%halftime%'
           )
           AND NOT (
             LOWER(stat) LIKE '%vence%'  OR LOWER(stat) LIKE '%empate%' OR
             LOWER(stat) LIKE '%gols%'   OR LOWER(stat) LIKE '%goals%'
           )
         )
       )
     ORDER BY pick_date ASC LIMIT 1500`
  ).all();
  if (!pending.length) return { verified: 0, pending: 0 };

  // Agrupa dates por sport
  const ftDates = [...new Set(pending.filter(p => (p.sport || 'football') === 'football').map(p => p.pick_date))];
  const bkDates = [...new Set(pending.filter(p => p.sport === 'basketball').map(p => p.pick_date))];
  const ftScoresByDate = {};
  const bkScoresByDate = {};

  // ── Score map fetch com budget guard de subrequests ───────────────────────
  // fetchESPNScoresForDate usa 49 subrequests. Com limite de 50/invocação, só podemos
  // fazer 1 fetch fresco por invocação. Datas já em D1 = 0 subrequests (safe).
  //
  // F2.85b FIX: SKIP TODAY do loop. Premissa anterior (F2.85) era que today retorna
  // vazio, mas jogos europeus matinais podem estar finalizados às 17h UTC e consumir
  // budget injustamente. Como today's picks ficam pendentes intencionalmente (jogos
  // em andamento), pulamos today completamente → ontem recebe fresh fetch garantido.
  {
    const todayStr = new Date().toISOString().slice(0, 10);
    // F2.85b: filtra today e ordena DESC (ontem primeiro). Cron processa só pick_date<today.
    const ftDatesSorted = [...ftDates].filter(d => d < todayStr).sort().reverse();
    let freshFetchUsed = false;
    for (const d of ftDatesSorted) {
      // Tenta D1 primeiro (0 subrequests)
      const daysOld = (Date.now() - new Date(d + 'T12:00:00Z').getTime()) / 86_400_000;
      const maxAge  = d === todayStr ? 900_000 : (daysOld < 3 ? 600_000 : 7_200_000);
      let fromD1    = false;
      if (env?.SB_DB) {
        try {
          const row = await env.SB_DB.prepare(`SELECT map_json, cached_at FROM score_map_cache WHERE date = ?`).bind(d).first().catch(() => null);
          if (row?.map_json && (Date.now() - (row.cached_at || 0)) < maxAge) {
            try { ftScoresByDate[d] = JSON.parse(row.map_json); fromD1 = true; } catch {}
          } else if (freshFetchUsed && row?.map_json) {
            // Budget já usado: aceita dado stale do D1 para não perder o jogo
            try { ftScoresByDate[d] = JSON.parse(row.map_json); fromD1 = true; } catch {}
          }
        } catch {}
      }
      if (!fromD1 && !freshFetchUsed) {
        // Cache miss + budget disponível: faz o fetch ESPN (49 subrequests)
        const freshMap = await fetchESPNScoresForDate(d);
        ftScoresByDate[d] = freshMap;
        const hasGames = Object.keys(freshMap || {}).length > 0;
        if (hasGames) {
          // Só consome o budget se realmente obteve jogos (hoje pode retornar vazio)
          freshFetchUsed = true;
          // Armazena no D1
          if (env?.SB_DB) {
            env.SB_DB.prepare(`INSERT OR REPLACE INTO score_map_cache (date, map_json, cached_at) VALUES (?, ?, ?)`)
              .bind(d, JSON.stringify(freshMap), Date.now()).run().catch(() => {});
          }
        }
        // Se retornou vazio (jogos de hoje ainda em andamento), freshFetchUsed = false
        // → próxima data também tentará fresh fetch
      }
      if (!ftScoresByDate[d]) ftScoresByDate[d] = {};
    }
    // Basketball: paralelo mas só NBA (1 subrequest por data) — budget não é problema
    await Promise.allSettled(bkDates.map(async d => { bkScoresByDate[d] = await fetchESPNNBAScoresForDate(d); }));
  }

  // Helper: detecta stats verdadeiramente unresolvable (player props NBA + HT box stats)
  function isUnresolvableStat(stat) {
    const s = (stat || '').toLowerCase();
    // Player props NBA — precisam box score individual, não temos
    const playerProps = [
      'pontos', 'rebotes', 'reboundes', 'assistências', 'assistencias', 'assists',
      '3pt', 'three',
      'marca/assist', 'score or assist', 'gol ou assist', 'player_',
      'desarme', 'tackle',
    ];
    if (playerProps.some(k => s.includes(k))) return true;
    // 1T picks: unresolvable APENAS para box stats (chutes/escanteios/SOT)
    // Score-based 1T (Casa Vence 1T, Empate 1T, Gols 1T) são resolvíveis via linescores HT
    if (/\b1t\b|primeiro tempo|first half|halftime/i.test(s)) {
      const isScoreBased = s.includes('vence') || s.includes('empate') ||
                           s.includes('gols') || s.includes('goals');
      return !isScoreBased; // true (unresolvable) apenas para 1T box stats
    }
    return false;
    // NOTA: corners, shots, cards, fouls, offsides agora resolvíveis via ESPN box stats
  }

  // Stats que precisam do ESPN box score (summary API) — corners, shots, cards, etc.
  function isBoxStatsPick(stat) {
    const s = (stat || '').toLowerCase();
    return /(corner|escantei|canto|shot|chute|finaliz|sot|card|cart|foul|falta|offside|impedi)/.test(s);
  }

  // Resolve pick via ESPN box stats — delegated to file-scope resolveCornerCardShotPickFn
  // (kept as local alias for backward compat with calls inside this function)
  const resolveCornerCardShotPick = resolveCornerCardShotPickFn;

  // Helper: data velha (>=3 dias atrás) → considera ESPN final mesmo sem match
  const today = new Date().toISOString().slice(0, 10);
  const dayMs = 86400000;
  function isOldDate(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr).getTime();
    // Void após 3 dias (72h) para garantir que jogos da Copa Lib/Copa Sud que terminam
    // às 02:00 UTC do dia pick_date+2 ainda sejam resolvíveis antes do threshold.
    // Ex: pick_date=May7, jogo termina 02:00 UTC May9 (50h) → 50h < 72h → resolve ✅
    // Sem loop: PASSO 0c abre apenas >= ontem (1 dia), então picks de 3+ dias atrás
    // nunca são reabertos, mesmo com isOldDate de 72h.
    return (Date.now() - d) > 3 * dayMs;
  }

  // PRÉ-FETCH ESPN box stats para picks de corners/shots/cards
  // Agrupa por eventId para evitar chamadas duplicadas
  const boxStatsCache = {}; // eventId → { corners, shots, shots_on_target, cards, ... }
  {
    const statsPicks = pending.filter(p => (p.sport || 'football') === 'football' && isBoxStatsPick(p.stat));
    const seenIds = new Set();
    const fetchJobs = [];
    for (const pick of statsPicks) {
      const scMap = ftScoresByDate[pick.pick_date] || {};
      const parts = splitMatchString(pick.match || '');
      if (!parts) continue;
      const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`;
      const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`;
      const gd = scMap[k1] || scMap[k2] || fuzzyFindGame(scMap, parts[0], parts[1]);
      if (!gd?.eventId || seenIds.has(gd.eventId)) continue;
      seenIds.add(gd.eventId);
      fetchJobs.push({ eventId: gd.eventId, slug: gd.slug });
    }
    // Limita a 60 fetches paralelos (evita rate limit ESPN)
    const BATCH = 60;
    for (let i = 0; i < fetchJobs.length; i += BATCH) {
      await Promise.allSettled(
        fetchJobs.slice(i, i + BATCH).map(async ({ eventId, slug }) => {
          const stats = await fetchESPNBoxStatsCached(slug, eventId, env);
          if (stats) boxStatsCache[eventId] = stats;
        })
      );
    }
  }

  // PRÉ-FETCH SofaScore box stats via D1 cache (fallback para jogos sem ESPN box stats)
  // ─────────────────────────────────────────────────────────────────────────────────────
  // SofaScore API retorna 403 de IPs do Cloudflare. Solução: self-hosted runner (PC do
  // usuário) busca os dados 5x/dia e armazena no D1 via /internal/sofascore-ingest.
  // Aqui lemos o D1 (0 subrequests). Se D1 estiver vazio, tentamos fetch live como
  // fallback (funciona do PC, 403 do Worker — falha silenciosamente).
  // ─────────────────────────────────────────────────────────────────────────────────────
  const ssBoxStatsCache = {};
  let ssCacheHits = 0, ssCacheMisses = 0;
  {
    const statsPicks = pending.filter(p => (p.sport || 'football') === 'football' && isBoxStatsPick(p.stat));
    const ssDatesNeeded = new Set();

    for (const pick of statsPicks) {
      const scMap = ftScoresByDate[pick.pick_date] || {};
      const parts = splitMatchString(pick.match || '');
      if (!parts) continue;
      const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`;
      const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`;
      const gd = scMap[k1] || scMap[k2] || fuzzyFindGame(scMap, parts[0], parts[1]);
      if (gd?.eventId && boxStatsCache[gd.eventId]) continue; // ESPN já tem
      ssDatesNeeded.add(pick.pick_date);
      ssDatesNeeded.add(new Date(new Date(pick.pick_date).getTime() + 86_400_000).toISOString().slice(0, 10));
    }

    if (ssDatesNeeded.size > 0) {
      // Lê mapas de jogos SofaScore do D1 (0 subrequests) — com fallback live
      const ssScoresByDate = {};
      await Promise.allSettled(
        [...ssDatesNeeded].map(async d => {
          ssScoresByDate[d] = await fetchSofaScoreScoresForDateCached(d, env, fetchSofaScoreScoresForDate);
        })
      );

      // Para cada pick sem ESPN, encontra evento SofaScore e busca box stats do D1
      const ssSeenKeys = new Set();
      const ssFetchJobs = [];
      for (const pick of statsPicks) {
        const scMap = ftScoresByDate[pick.pick_date] || {};
        const parts = splitMatchString(pick.match || '');
        if (!parts) continue;
        const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`;
        const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`;
        const gd = scMap[k1] || scMap[k2] || fuzzyFindGame(scMap, parts[0], parts[1]);
        if (gd?.eventId && boxStatsCache[gd.eventId]) continue; // ESPN já resolveu

        const nextDay = new Date(new Date(pick.pick_date).getTime() + 86_400_000).toISOString().slice(0, 10);
        for (const d of [pick.pick_date, nextDay]) {
          const ssMap = ssScoresByDate[d] || {};
          const ssGd = ssMap[k1] || ssMap[k2];
          if (!ssGd?.ssEventId) continue;
          const canonKey = k1;
          if (ssSeenKeys.has(canonKey)) break;
          ssSeenKeys.add(canonKey);
          ssFetchJobs.push({ normKey: canonKey, ssEventId: ssGd.ssEventId });
          break;
        }
      }

      // Busca box stats SofaScore do D1 em paralelo (máx 30 simultâneos)
      const SS_BATCH = 30;
      for (let i = 0; i < ssFetchJobs.length; i += SS_BATCH) {
        await Promise.allSettled(
          ssFetchJobs.slice(i, i + SS_BATCH).map(async ({ normKey, ssEventId }) => {
            const stats = await fetchSofaScoreBoxStatsCached(ssEventId, env, fetchSofaScoreBoxStats);
            if (stats) {
              ssBoxStatsCache[normKey] = stats;
              if (stats.source === 'sofascore_d1') ssCacheHits++;
              else ssCacheMisses++;
            }
          })
        );
      }
    }
  }

  let verified = 0, voided = 0, skipped = 0;
  const debugVoided = []; // temp: amostra dos picks voideados para diagnóstico
  for (const pick of pending) {
    const sport = pick.sport || 'football';

    // Step 1a: player props NBA e HT — verdadeiramente unresolvable
    // Void após 2 dias (mesmo threshold de isOldDate) — não tem como resolver sem API externa
    if (isUnresolvableStat(pick.stat)) {
      if (shouldVoid(pick.pick_date)) {
        await env.SB_DB.prepare(
          `UPDATE pick_history SET result = 'V', auto_verified = ${voidMark}, updated_at = datetime('now') WHERE id = ?`
        ).bind(pick.id).run().catch(() => {});
        voided++;
        if (debugVoided.length < 8) debugVoided.push({ id: pick.id, pick_date: pick.pick_date, match: pick.match, stat: pick.stat, reason: 'unresolvable_old' });
      } else {
        skipped++;
      }
      continue;
    }

    // Step 1b: box stats (corners/shots/cards/fouls/offsides) — resolve via ESPN box score
    if (sport === 'football' && isBoxStatsPick(pick.stat)) {
      // Parse line/direction from pick ID when not stored as separate columns
      // Old ID format: "date|match|stat|o2 5" where "o2 5" = over 2.5
      let { line: pickLine, direction: pickDir } = pick;
      if ((pickLine == null || pickDir == null) && pick.id) {
        const idSegs = pick.id.split('|');
        const lastSeg = idSegs[idSegs.length - 1] || '';
        const m = lastSeg.match(/^([ou])([\d]+)[\s.]?(\d*)/i);
        if (m) {
          pickDir = pickDir || (m[1].toLowerCase() === 'o' ? 'over' : 'under');
          pickLine = pickLine ?? parseFloat(m[2] + (m[3] ? '.' + m[3] : ''));
        }
        // Also try stat string: "Mais de 9.5 Escanteios" / "Menos de 3.5 Cartões"
        if (pickLine == null) {
          const s2 = (pick.stat || '').toLowerCase();
          const mStat = s2.match(/(?:mais de|over|acima de)\s*([\d.]+)/) || s2.match(/([\d.]+)\s*(?:mais|over)/);
          if (mStat) { pickDir = pickDir || 'over'; pickLine = pickLine ?? parseFloat(mStat[1]); }
          const mStat2 = s2.match(/(?:menos de|under|abaixo de)\s*([\d.]+)/) || s2.match(/([\d.]+)\s*(?:menos|under)/);
          if (mStat2) { pickDir = pickDir || 'under'; pickLine = pickLine ?? parseFloat(mStat2[1]); }
        }
      }
      const scMap = ftScoresByDate[pick.pick_date] || {};
      const parts = splitMatchString(pick.match || '');
      let resolved = false;
      if (parts) {
        const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`;
        const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`;
        const gd = scMap[k1] || scMap[k2] || fuzzyFindGame(scMap, parts[0], parts[1]);
        if (gd?.eventId && boxStatsCache[gd.eventId]) {
          const verdict = resolveCornerCardShotPick(pick.stat, pickLine, pickDir, boxStatsCache[gd.eventId], pick.match);
          if (verdict) {
            await env.SB_DB.prepare(
              `UPDATE pick_history SET result = ?, auto_verified = 1, result_source = 'espn', updated_at = datetime('now') WHERE id = ?`
            ).bind(verdict, pick.id).run().catch(() => {});
            verified++;
            resolved = true;
          }
        }
      }
      // Fallback SofaScore: tenta resolver via SofaScore se ESPN não tinha box stats
      if (!resolved && parts) {
        const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`;
        const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`;
        const ssStats = ssBoxStatsCache[k1] || ssBoxStatsCache[k2];
        if (ssStats) {
          const verdict = resolveCornerCardShotPick(pick.stat, pickLine, pickDir, ssStats, pick.match);
          if (verdict) {
            await env.SB_DB.prepare(
              `UPDATE pick_history SET result = ?, auto_verified = 1, result_source = 'sofascore', updated_at = datetime('now') WHERE id = ?`
            ).bind(verdict, pick.id).run().catch(() => {});
            verified++;
            resolved = true;
          }
        }
      }
      if (!resolved) {
        if (shouldVoid(pick.pick_date)) {
          await env.SB_DB.prepare(
            `UPDATE pick_history SET result = 'V', auto_verified = ${voidMark}, updated_at = datetime('now') WHERE id = ?`
          ).bind(pick.id).run().catch(() => {});
          voided++;
          if (debugVoided.length < 8) debugVoided.push({ id: pick.id, pick_date: pick.pick_date, match: pick.match, stat: pick.stat, reason: 'box_stats_unresolved_old' });
        } else { skipped++; }
      }
      continue;
    }

    // Step 2: resolve via placar ESPN (1X2, BTTS, total goals, spread NBA)
    const scoresMap = sport === 'basketball' ? (bkScoresByDate[pick.pick_date] || {}) : (ftScoresByDate[pick.pick_date] || {});
    const parts = splitMatchString(pick.match || '');
    if (!parts) {
      if (shouldVoid(pick.pick_date)) {
        await env.SB_DB.prepare(
          `UPDATE pick_history SET result = 'V', auto_verified = ${voidMark}, updated_at = datetime('now') WHERE id = ?`
        ).bind(pick.id).run().catch(() => {});
        voided++;
        if (debugVoided.length < 8) debugVoided.push({ id: pick.id, pick_date: pick.pick_date, match: pick.match, stat: pick.stat, reason: 'no_parts_old' });
      } else { skipped++; }
      continue;
    }
    const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`;
    const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`;
    let scores = null;
    if (scoresMap[k1])      scores = scoresMap[k1];
    else if (scoresMap[k2]) scores = { home: scoresMap[k2].away, away: scoresMap[k2].home };
    else { const fg = fuzzyFindGame(scoresMap, parts[0], parts[1]); if (fg) scores = fg; }
    if (!scores) {
      if (shouldVoid(pick.pick_date)) {
        await env.SB_DB.prepare(
          `UPDATE pick_history SET result = 'V', auto_verified = ${voidMark}, updated_at = datetime('now') WHERE id = ?`
        ).bind(pick.id).run().catch(() => {});
        voided++;
        if (debugVoided.length < 8) debugVoided.push({ id: pick.id, pick_date: pick.pick_date, match: pick.match, stat: pick.stat, reason: 'no_espn_match_old' });
      } else { skipped++; }
      continue;
    }
    // Extrai direction do ID para picks de resultado sem direction salvo
    let pickDir2 = pick.direction;
    if (!pickDir2 && pick.id) {
      const idSegs = pick.id.split('|');
      const last2  = idSegs[idSegs.length - 1] || '';
      if (/^(home|away|draw|1|2|x|1x|x2|12|win|yes|no|sim|nao|não)$/i.test(last2)) {
        pickDir2 = last2.toLowerCase();
      }
    }
    // Extrai direction de stat para Chance Dupla (ex: "Chance Dupla 12", "Chance Dupla Chance Dupla 1X")
    if (!pickDir2 && /chance dupla|double chance/i.test(pick.stat || '')) {
      // Pega a ÚLTIMA ocorrência de (1X|X2|12|1|2|X) na stat — funciona para doubled e simples
      const dcDir2 = (pick.stat || '').match(/\b(1X|X2|12|1|2|X)\s*$/i);
      if (dcDir2) pickDir2 = dcDir2[1].toLowerCase();
    }
    const verdict = resolvePickMarket(pick.stat, scores, pickDir2 ?? pick.direction, pick.line);
    if (!verdict) {
      if (shouldVoid(pick.pick_date)) {
        await env.SB_DB.prepare(
          `UPDATE pick_history SET result = 'V', auto_verified = ${voidMark}, updated_at = datetime('now') WHERE id = ?`
        ).bind(pick.id).run().catch(() => {});
        voided++;
        if (debugVoided.length < 8) debugVoided.push({ id: pick.id, pick_date: pick.pick_date, match: pick.match, stat: pick.stat, reason: 'no_verdict_old' });
      } else { skipped++; }
      continue;
    }
    await env.SB_DB.prepare(
      `UPDATE pick_history SET result = ?, auto_verified = 1, result_source = 'espn', updated_at = datetime('now') WHERE id = ?`
    ).bind(verdict, pick.id).run().catch(() => {});
    verified++;
  }
  return {
    verified,
    voided: voided + batchVoided + batchVoidedOld,
    skipped,
    batch_voided: batchVoided + batchVoidedOld,
    reopened: batchReopened,
    box_reopened: boxReopened,
    total_pending: pending.length,
    // Diagnóstico: data UTC JS vs re-abertura
    recovery_mode: recovery,
    box_recovery_mode: boxRecovery,
    debug_js_date: jsDateNow,
    debug_reopen_window: reopenWindowDate,
    debug_voided_sample: debugVoided,
    debug_reopen_sample: (debugReopenSample.results || []).map(r => ({ pick_date: r.pick_date, match: r.match, stat: r.stat })),
    sofascore: {
      cache_hits:   ssCacheHits,
      cache_misses: ssCacheMisses,
      jobs:         Object.keys(ssBoxStatsCache).length,
      status:       ssCacheHits > 0 ? 'active' : (ssCacheMisses > 0 ? 'live_fallback' : 'idle'),
    },
  };
}

// ── TIPSTER AUTO-VERIFY: resolve telegram_tips.result via ESPN scores ─────────
// Roda a cada hora no cron. Resolve picks de tipsters postados >4h atrás (jogo terminou).
// Unblocks: Wilson LCB, _has_real_wr, Bayesian inject — tudo depende de result W/L.
// Resolve tip markets that need box stats (corners / shots / cards)
// Returns W/L/null. Tries market + market_tag + selection for stat type + direction.
function _resolveTipMarketBoxStats(tip, boxStats) {
  if (!boxStats) return null
  const mkt = (tip.market || '').toUpperCase()
  const mt  = (tip.market_tag || tip.direction || '').toLowerCase()
  const sel = (tip.selection || '').toLowerCase()
  const line = tip.line != null ? parseFloat(tip.line) : null
  if (line == null || isNaN(line)) return null

  const isOver  = /^over|mais|^acima/.test(mt) || /mais de|over/.test(sel)
  const isUnder = /^under|menos|^abaixo/.test(mt) || /menos de|under/.test(sel)
  if (!isOver && !isUnder) return null

  // Determine which team's stats (home/away/total)
  const useHome = /^HT_CORNERS_HOME|^HT_SHOTS_HOME/i.test(mkt) ||
                  /home|casa|mandante/.test(mt)
  const useAway = /^HT_CORNERS_AWAY|^HT_SHOTS_AWAY/i.test(mkt) ||
                  /away|fora|visitante/.test(mt)
  const src = useHome ? boxStats.home : useAway ? boxStats.away : boxStats.total
  if (!src) return null

  let value = null
  if (/CORNER|ESCANTEIO|CANTO/i.test(mkt))           value = src.corners
  else if (/SOT|SHOT.*ON.*TARGET/i.test(mkt))         value = src.shots_on_target
  else if (/SHOT|CHUTE|FINALIZ/i.test(mkt))           value = src.shots
  else if (/YELLOW.*CARD|AMARELO/i.test(mkt))         value = src.yellow_cards
  else if (/RED.*CARD|VERMELHO/i.test(mkt))           value = src.red_cards
  else if (/CARD|CART/i.test(mkt))                    value = src.cards
  else if (/FOUL|FALTA/i.test(mkt))                   value = src.fouls
  if (value == null) return null
  return isOver ? (value > line ? 'W' : 'L') : (value < line ? 'W' : 'L')
}

function _resolveTipMarket(tip, home, away) {
  const mt = (tip.market_tag || '').toLowerCase()
  const mkt = (tip.market || '').toUpperCase()
  const line = tip.line != null ? parseFloat(tip.line) : null
  const total = home + away
  const btts = home > 0 && away > 0
  const homeWin = home > away, awayWin = away > home, isDraw = home === away

  // market_tag direto (mais confiável — específico)
  if (mt === 'home' || mt === '1')                    return homeWin  ? 'W' : 'L'
  if (mt === 'away' || mt === '2')                    return awayWin  ? 'W' : 'L'
  if (mt === 'draw' || mt === 'x')                    return isDraw   ? 'W' : 'L'
  if (mt === '1x'  || mt === 'dc_1x')                 return (homeWin || isDraw) ? 'W' : 'L'
  if (mt === 'x2'  || mt === 'dc_x2')                 return (awayWin || isDraw) ? 'W' : 'L'
  if (mt === '12'  || mt === 'dc_12')                 return !isDraw  ? 'W' : 'L'
  if (mt === 'btts' || mt === 'yes' || mt === 'sim')  return btts     ? 'W' : 'L'
  if (mt === 'no'  || mt === 'não'  || mt === 'nao')  return !btts    ? 'W' : 'L'
  if (/^over/.test(mt)  && line != null)              return total > line ? 'W' : 'L'
  if (/^under/.test(mt) && line != null)              return total < line ? 'W' : 'L'

  // market field fallback
  if (mkt === 'BTTS' || mkt === 'BOTH_TEAMS_SCORE') {
    const d = (tip.market_tag || '').toLowerCase()
    if (/^yes|^sim|btts_yes|over_btts/.test(d)) return btts  ? 'W' : 'L'
    if (/^no|^nao|btts_no/.test(d))              return !btts ? 'W' : 'L'
  }
  if (mkt === 'DOUBLE_CHANCE') {
    const d = (tip.market_tag || '').toLowerCase()
    if (d === '1x' || d === 'dc_1x') return (homeWin || isDraw) ? 'W' : 'L'
    if (d === 'x2' || d === 'dc_x2') return (awayWin || isDraw) ? 'W' : 'L'
    if (d === '12' || d === 'dc_12') return !isDraw ? 'W' : 'L'
  }
  if ((/^OVER_|^GOALS/.test(mkt) || mkt === 'OVER_UNDER') && line != null) {
    const d = (tip.market_tag || '').toLowerCase()
    if (/over|mais/.test(d))  return total > line ? 'W' : 'L'
    if (/under|menos/.test(d)) return total < line ? 'W' : 'L'
  }
  if (/^UNDER_/.test(mkt) && line != null) return total < line ? 'W' : 'L'
  return null
}

async function runTipsterAutoVerify(env) {
  if (!env.SB_DB) return { verified: 0, error: 'no_db' }
  // Adiciona auto_verified column se não existir (silent fail se já existe)
  await env.SB_DB.exec(`ALTER TABLE telegram_tips ADD COLUMN auto_verified INTEGER DEFAULT 0`).catch(() => {})

  const cutoff4h  = Date.now() - 4  * 3600_000   // postado >4h atrás → jogo terminou
  const cutoff5d  = Date.now() - 5  * 86400_000   // não tenta mais de 5 dias atrás
  const { results: pending } = await env.SB_DB.prepare(`
    SELECT id, teams, market, market_tag, line, odd, posted_at
    FROM telegram_tips
    WHERE result IS NULL AND auto_verified = 0 AND posted_at <= ? AND posted_at >= ?
    ORDER BY posted_at DESC LIMIT 300
  `).bind(cutoff4h, cutoff5d).all().catch(() => ({ results: [] }))

  if (!pending?.length) return { verified: 0, pending: 0 }

  // ── F2.19 Batch void: idade mínima de 48h ──
  // Antes (até F2.18): voidava qualquer tip postada antes de meia-noite BRT,
  // o que matava tips FAIXA postadas dom/seg para jogos meio de semana antes do jogo acontecer.
  // F2.18-AUDIT confirmou: 95.7% void rate em 14d, 70% dos voids em <12h de idade.
  // Agora: dá 48h pro resolver per-tip tentar (ESPN box stats vem em ~6h após jogo).
  // Após 48h, se ainda result IS NULL, assume genuinamente irrecuperável.
  const _ageThreshold = Date.now() - 48 * 3600_000
  await env.SB_DB.prepare(`
    UPDATE telegram_tips SET result = 'V', settled_at = ?, auto_verified = 1
    WHERE result IS NULL AND posted_at < ?
  `).bind(Date.now(), _ageThreshold).run().catch(() => {})

  // Agrupa por data pra fetch paralelo de scores ESPN + DB
  const dateMap = {}
  for (const tip of pending) {
    const d = new Date(tip.posted_at).toISOString().slice(0, 10)
    if (!dateMap[d]) dateMap[d] = []
    dateMap[d].push(tip)
  }
  const scoresByDate = {}
  await Promise.allSettled(
    Object.keys(dateMap).map(async d => {
      // 1) ESPN
      const espn = await fetchESPNScoresForDate(d).catch(() => ({}))
      // 2) Fallback: matches_raw do nosso DB para ligas sem cobertura ESPN
      let dbMap = {}
      try {
        const { results: dbRows } = await env.SB_DB.prepare(`
          SELECT home_team, away_team, home_score, away_score, match_id, league_slug
          FROM matches_raw
          WHERE match_date = ? AND status = 'post'
            AND home_score IS NOT NULL AND away_score IS NOT NULL
        `).bind(d).all()
        for (const r of (dbRows || [])) {
          const hN = normTeam(r.home_team || '')
          const aN = normTeam(r.away_team || '')
          if (hN && aN && !(espn[`${hN}|${aN}`])) {
            dbMap[`${hN}|${aN}`] = {
              home: +r.home_score, away: +r.away_score,
              eventId: r.match_id, slug: r.league_slug || 'bra.2'
            }
          }
        }
      } catch {}
      scoresByDate[d] = { ...dbMap, ...espn }  // ESPN wins on conflict
    })
  )

  let verified = 0, skipped = 0
  const tipBoxCache = {}  // eventId → ESPN box stats (cache para evitar fetches duplicados)
  for (const tip of pending) {
    const d = new Date(tip.posted_at).toISOString().slice(0, 10)
    const scoresMap = scoresByDate[d] || {}

    let teams = []
    try { teams = JSON.parse(tip.teams || '[]') } catch {}
    const [t1, t2] = teams
    if (!t1 || !t2) { skipped++; continue }

    // Lookup exato + fallback fuzzy — preserva eventId/slug para box stats
    const k1 = `${normTeam(t1)}|${normTeam(t2)}`
    const k2 = `${normTeam(t2)}|${normTeam(t1)}`
    let scores = scoresMap[k1] || null
    if (!scores && scoresMap[k2]) {
      const v = scoresMap[k2]
      scores = { home: v.away, away: v.home, eventId: v.eventId, slug: v.slug }
    }
    if (!scores) {
      const p1 = normTeam(t1).slice(0, 5), p2 = normTeam(t2).slice(0, 5)
      for (const [k, v] of Object.entries(scoresMap)) {
        const [h, a] = k.split('|')
        if (h.startsWith(p1) && a.startsWith(p2)) { scores = v; break }
        if (h.startsWith(p2) && a.startsWith(p1)) {
          scores = { home: v.away, away: v.home, eventId: v.eventId, slug: v.slug }; break
        }
      }
    }
    // Fuzzy fallback usando normTeam substring (igual ao runPickAutoVerify)
    if (!scores) {
      const fg = fuzzyFindGame(scoresMap, t1, t2)
      if (fg) scores = fg
    }
    if (!scores || scores.home == null || scores.away == null) { skipped++; continue }

    // Resolução 1: mercados de gols/BTTS/resultado
    const verdict = _resolveTipMarket(tip, scores.home, scores.away)
    if (verdict) {
      await env.SB_DB.prepare(
        `UPDATE telegram_tips SET result = ?, settled_at = ?, auto_verified = 1 WHERE id = ?`
      ).bind(verdict, Date.now(), tip.id).run().catch(() => {})
      verified++
      continue
    }

    // Resolução 2: mercados de corners/chutes/cartões via ESPN box stats
    const needsBoxStats = /CORNER|ESCANTEIO|SHOT|CHUTE|SOT|CARD|CART|FOUL|FALTA/i.test(tip.market || '')
    if (needsBoxStats && scores.eventId && scores.slug) {
      const cacheKey = scores.eventId
      if (!tipBoxCache[cacheKey]) {
        tipBoxCache[cacheKey] = await fetchESPNBoxStatsCached(scores.slug, scores.eventId, env).catch(() => null)
      }
      const boxStats = tipBoxCache[cacheKey]
      if (boxStats) {
        const v2 = _resolveTipMarketBoxStats(tip, boxStats)
        if (v2) {
          await env.SB_DB.prepare(
            `UPDATE telegram_tips SET result = ?, settled_at = ?, auto_verified = 1 WHERE id = ?`
          ).bind(v2, Date.now(), tip.id).run().catch(() => {})
          verified++
          continue
        }
      }
    }

    skipped++
  }
  return { verified, skipped, total_pending: pending.length }
}

// ── PICK HISTORY ROUTE HANDLER ────────────────────────────────────────────────
async function handlePickHistory(pathname, request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB not available' }), { status: 503, headers: corsHeaders() });
  }
  const method = request.method;

  // GET /v1/picks/history — retorna histórico completo (opcionalmente filtrado por sport)
  if (pathname === '/v1/picks/history' && method === 'GET') {
    const url = new URL(request.url);
    const sport = url.searchParams.get('sport');
    const resolved = url.searchParams.get('resolved');  // '1' = só W/L, '0' = só pendentes
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '800', 10), 5000);
    const conds = []; const binds = [];
    if (sport) { conds.push('sport = ?'); binds.push(sport); }
    if (resolved === '1') conds.push("result IN ('W','L')");
    else if (resolved === '0') conds.push("result IS NULL");
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sql = `SELECT * FROM pick_history ${where} ORDER BY pick_date DESC, saved_at DESC LIMIT ${limit}`;
    const { results } = binds.length
      ? await env.SB_DB.prepare(sql).bind(...binds).all()
      : await env.SB_DB.prepare(sql).all();
    return new Response(JSON.stringify({ ok: true, picks: results || [], count: (results || []).length }), {
      status: 200, headers: corsHeaders(),
    });
  }

  // GET /v1/picks/debug-espn-scores — debug: retorna o mapa de placares ESPN para uma data
  if (pathname === '/v1/picks/debug-espn-scores' && method === 'GET') {
    const url2 = new URL(request.url)
    const date = url2.searchParams.get('date') || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const slug = url2.searchParams.get('slug') || null
    // If slug specified, test single league fetch
    if (slug) {
      const dateStr = date.replace(/-/g, '')
      const dayMs2 = 86_400_000
      const baseMs2 = new Date(date + 'T12:00:00Z').getTime()
      const prevDay2 = new Date(baseMs2 - dayMs2).toISOString().slice(0, 10)
      const nextDay2 = new Date(baseMs2 + dayMs2).toISOString().slice(0, 10)
      const rangeDateStr2 = `${prevDay2.replace(/-/g, '')}-${nextDay2.replace(/-/g, '')}`
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${rangeDateStr2}&limit=50`, { signal: AbortSignal.timeout(12000) })
        const data = res.ok ? await res.json() : { events: [] }
        const events = (data.events || []).map(e => ({ name: e.shortName, date: e.date?.slice(0,10), state: e.status?.type?.state, scores: e.competitions?.[0]?.competitors?.map(c => `${c.homeAway}:${c.score}`) }))
        return new Response(JSON.stringify({ ok: true, slug, date, events_count: events.length, events: events.slice(0,20) }), { status: 200, headers: corsHeaders() })
      } catch (e2) { return new Response(JSON.stringify({ ok: false, error: String(e2) }), { status: 200, headers: corsHeaders() }) }
    }
    const map = await fetchESPNScoresForDate(date)
    const keys = Object.keys(map)
    // Se ?box=1, testa box stats para o primeiro jogo que tiver eventId
    const testBox = new URL(request.url).searchParams.get('box') === '1'
    if (testBox) {
      const entries = Object.entries(map).filter(([, v]) => v.eventId).slice(0, 5)
      const boxResults = await Promise.all(entries.map(async ([teams, v]) => {
        const bs = await fetchESPNBoxStatsCached(v.slug, v.eventId, env)
        return { teams, eventId: v.eventId, slug: v.slug, hasBoxStats: !!bs, corners: bs?.total?.corners, shots: bs?.total?.shots, cards: bs?.total?.cards }
      }))
      return new Response(JSON.stringify({ ok: true, date, count: keys.length, box_tests: boxResults }), { status: 200, headers: corsHeaders() })
    }
    return new Response(JSON.stringify({ ok: true, date, count: keys.length, teams: keys.slice(0, 150) }), { status: 200, headers: corsHeaders() })
  }

  // GET /v1/picks/debug-espn-raw — diagnóstico raw da resposta ESPN summary para um evento
  if (pathname === '/v1/picks/debug-espn-raw' && method === 'GET') {
    const url2 = new URL(request.url);
    const slug = url2.searchParams.get('slug') || 'conmebol.libertadores';
    const eventId = url2.searchParams.get('event_id') || '401865529';
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`,
        {
          signal: AbortSignal.timeout(8000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.espn.com/',
          }
        }
      );
      const raw = await res.text();
      const parsed = (() => { try { return JSON.parse(raw); } catch { return null; } })();
      const teams = parsed?.boxscore?.teams || [];
      return new Response(JSON.stringify({
        ok: true, status: res.status, slug, eventId,
        teams_count: teams.length,
        team0_stats_count: teams[0] ? (teams[0].statistics || []).length : 'no team',
        team1_stats_count: teams[1] ? (teams[1].statistics || []).length : 'no team',
        team0_keys: teams[0] ? Object.keys(teams[0]) : [],
        sample_stats: teams[0] ? (teams[0].statistics || []).slice(0, 3) : [],
        raw_length: raw.length,
        raw_snippet: raw.slice(0, 500),
      }), { status: 200, headers: corsHeaders() });
    } catch (e2) {
      return new Response(JSON.stringify({ ok: false, error: String(e2) }), { status: 200, headers: corsHeaders() });
    }
  }

  // GET /v1/picks/debug-sofascore — testa a API SofaScore diretamente do edge
  if (pathname === '/v1/picks/debug-sofascore' && method === 'GET') {
    const url2 = new URL(request.url);
    const date = url2.searchParams.get('date') || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const eventId = url2.searchParams.get('event_id');
    try {
      if (eventId) {
        // Testa box stats para um eventId específico
        const stats = await fetchSofaScoreBoxStats(eventId);
        return new Response(JSON.stringify({ ok: true, event_id: eventId, stats }), { status: 200, headers: corsHeaders() });
      }
      // Testa listagem de jogos para uma data
      const map = await fetchSofaScoreScoresForDate(date);
      const keys = Object.keys(map).filter(k => !k.includes('|') || k.split('|')[0] < k.split('|')[1]); // deduplica
      return new Response(JSON.stringify({ ok: true, date, count: keys.length, games: keys.slice(0, 50) }), { status: 200, headers: corsHeaders() });
    } catch (e2) {
      return new Response(JSON.stringify({ ok: false, error: String(e2) }), { status: 200, headers: corsHeaders() });
    }
  }

  // DELETE /v1/picks/cache-clear — limpa D1 score_map_cache para forçar re-fetch (admin)
  if (pathname === '/v1/picks/cache-clear' && method === 'POST') {
    const url2 = new URL(request.url)
    const date = url2.searchParams.get('date') // se omitido, limpa todos os últimos 7 dias
    try {
      let result
      if (date) {
        result = await env.SB_DB.prepare(`DELETE FROM score_map_cache WHERE date = ?`).bind(date).run()
      } else {
        const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
        result = await env.SB_DB.prepare(`DELETE FROM score_map_cache WHERE date >= ?`).bind(cutoff).run()
      }
      return new Response(JSON.stringify({ ok: true, deleted: result?.meta?.changes || 0, date: date || 'last7days' }), { status: 200, headers: corsHeaders() })
    } catch (e2) {
      return new Response(JSON.stringify({ ok: false, error: String(e2) }), { status: 500, headers: corsHeaders() })
    }
  }

  // GET /v1/picks/debug-cache — mostra conteúdo do D1 score_map_cache (admin debug)
  if (pathname === '/v1/picks/debug-cache' && method === 'GET') {
    try {
      const rows = await env.SB_DB.prepare(`SELECT date, cached_at, datetime(cached_at/1000,'unixepoch') as cached_at_utc, length(map_json) as size_bytes FROM score_map_cache ORDER BY date DESC LIMIT 20`).all().catch(() => ({ results: [] }))
      const url2 = new URL(request.url)
      const date = url2.searchParams.get('date')
      let mapContent = null
      if (date) {
        const row = await env.SB_DB.prepare(`SELECT map_json FROM score_map_cache WHERE date = ?`).bind(date).first().catch(() => null)
        mapContent = row?.map_json ? Object.keys(JSON.parse(row.map_json)).slice(0, 30) : null
      }
      // Also test resolution for one specific pick
      const testMatch = url2.searchParams.get('match') || 'Blooming v Bragantino'
      const testDate  = date || '2026-05-07'
      const testStat  = url2.searchParams.get('stat') || '1X2'
      const testDir   = url2.searchParams.get('dir')  || 'draw'
      let resolution = null
      if (date && mapContent) {
        const row2 = await env.SB_DB.prepare(`SELECT map_json FROM score_map_cache WHERE date = ?`).bind(date).first().catch(() => null)
        if (row2?.map_json) {
          const scMap = JSON.parse(row2.map_json)
          const parts = splitMatchString(testMatch)
          if (parts) {
            const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`
            const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`
            const gd = scMap[k1] || scMap[k2] || fuzzyFindGame(scMap, parts[0], parts[1])
            if (gd) {
              const v = resolvePickMarket(testStat, gd, testDir, null)
              resolution = { found: true, scores: { home: gd.home, away: gd.away }, verdict: v, k1, k2 }
            } else {
              resolution = { found: false, k1, k2, map_size: Object.keys(scMap).length, sample: Object.keys(scMap).slice(0,5) }
            }
          }
        }
      }
      return new Response(JSON.stringify({ ok: true, cache_entries: rows.results || [], map_teams: mapContent, resolution }), { status: 200, headers: corsHeaders() })
    } catch (e2) {
      return new Response(JSON.stringify({ ok: false, error: String(e2) }), { status: 500, headers: corsHeaders() })
    }
  }

  // GET /v1/picks/void-breakdown — agrupa voids por jogo/stat para diagnóstico completo
  if (pathname === '/v1/picks/void-breakdown' && method === 'GET') {
    try {
      if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'no_db' }), { status: 503, headers: corsHeaders() });
      const url2 = new URL(request.url);
      const date2 = url2.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      // Por jogo
      const { results: byMatch } = await env.SB_DB.prepare(
        `SELECT match, COUNT(*) as total FROM pick_history
         WHERE result = 'V' AND pick_date = ?
         GROUP BY match ORDER BY total DESC LIMIT 30`
      ).bind(date2).all();
      // Por stat
      const { results: byStat } = await env.SB_DB.prepare(
        `SELECT stat, COUNT(*) as total FROM pick_history
         WHERE result = 'V' AND pick_date = ?
         GROUP BY stat ORDER BY total DESC LIMIT 30`
      ).bind(date2).all();
      // Total
      const { results: totRow } = await env.SB_DB.prepare(
        `SELECT COUNT(*) as total FROM pick_history WHERE result='V' AND pick_date=?`
      ).bind(date2).all();
      return new Response(JSON.stringify({
        ok: true, date: date2,
        total_voids: totRow[0]?.total || 0,
        by_match: byMatch,
        by_stat: byStat,
      }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() });
    }
  }

  // GET /v1/picks/sample-voids — mostra amostra de picks void para diagnóstico
  if (pathname === '/v1/picks/sample-voids' && method === 'GET') {
    try {
      if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'no_db' }), { status: 503, headers: corsHeaders() });
      const url2 = new URL(request.url);
      const date2 = url2.searchParams.get('date') || '2026-05-06';
      const stat2 = url2.searchParams.get('stat') || '%';
      const { results: rows } = await env.SB_DB.prepare(
        `SELECT id, pick_date, match, stat, direction, line, result, auto_verified
         FROM pick_history
         WHERE result = 'V' AND pick_date = ? AND LOWER(stat) LIKE ?
           AND NOT (stat LIKE '%1T%' OR LOWER(stat) LIKE '%primeiro tempo%')
         ORDER BY saved_at DESC LIMIT 15`
      ).bind(date2, stat2.toLowerCase()).all();
      return new Response(JSON.stringify({ ok: true, date: date2, count: rows.length, picks: rows }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() });
    }
  }

  // POST /v1/picks/reactivate-old — reativa picks V de picks_date que não sejam HT/player-props
  // Usado para forçar re-verificação de jogos que foram voided antes do ESPN rodar corretamente
  if (pathname === '/v1/picks/reactivate-old' && method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}))
      const date = body.date || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      const result = await env.SB_DB.prepare(`
        UPDATE pick_history
        SET result = NULL, auto_verified = 0, updated_at = datetime('now')
        WHERE result = 'V' AND auto_verified = 1
          AND pick_date = ?
          AND NOT (
            stat LIKE '%1T%' OR stat LIKE '% 1t %' OR stat LIKE '%1T %' OR stat LIKE '% 1T%' OR
            LOWER(stat) LIKE '%primeiro tempo%' OR LOWER(stat) LIKE '%first half%' OR
            LOWER(stat) LIKE '%halftime%' OR LOWER(stat) LIKE '%pontos%' OR
            LOWER(stat) LIKE '%rebotes%' OR LOWER(stat) LIKE '%assistencias%' OR
            LOWER(stat) LIKE '%assists%' OR LOWER(stat) LIKE '%player_%' OR
            LOWER(stat) LIKE '%marca/assist%' OR LOWER(stat) LIKE '%score or assist%' OR
            LOWER(stat) LIKE '%desarme%' OR LOWER(stat) LIKE '%tackle%'
          )
      `).bind(date).run()
      const reactivated = result?.meta?.changes || 0
      return new Response(JSON.stringify({ ok: true, date, reactivated }), { status: 200, headers: corsHeaders() })
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
    }
  }

  // POST /v1/picks/force-reopen — re-abre TODOS voids auto do período sem verificar
  // Útil para reset em massa; a verificação acontece nos próximos crons
  if (pathname === '/v1/picks/force-reopen' && method === 'POST') {
    try {
      if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'no_db' }), { status: 503, headers: corsHeaders() });
      const HT_PLAYER_EXCLUSION = `NOT (
        stat LIKE '%1T%' OR LOWER(stat) LIKE '%primeiro tempo%' OR LOWER(stat) LIKE '%first half%' OR
        LOWER(stat) LIKE '%halftime%' OR LOWER(stat) LIKE '%pontos%' OR LOWER(stat) LIKE '%rebotes%' OR
        LOWER(stat) LIKE '%assistencias%' OR LOWER(stat) LIKE '%player_%' OR LOWER(stat) LIKE '%marca/assist%' OR
        LOWER(stat) LIKE '%score or assist%' OR LOWER(stat) LIKE '%desarme%' OR LOWER(stat) LIKE '%tackle%'
      )`;
      const r2 = await env.SB_DB.prepare(
        `UPDATE pick_history SET result = NULL, auto_verified = 0, updated_at = datetime('now')
         WHERE result = 'V' AND auto_verified = 1 AND pick_date >= date('now', '-7 days') AND ${HT_PLAYER_EXCLUSION}`
      ).run().catch(e => ({ error: e.message, meta: { changes: 0 } }));
      const reopened = r2?.meta?.changes || 0;
      return new Response(JSON.stringify({ ok: true, reopened, msg: `${reopened} picks re-abertos. Verificação ocorre nos próximos crons (~hora).` }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() });
    }
  }

  // GET /v1/picks/void-stats — diagnóstico de voids (stat breakdown)
  if (pathname === '/v1/picks/void-stats' && method === 'GET') {
    try {
      if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'no_db' }), { status: 503, headers: corsHeaders() });
      const url2 = new URL(request.url);
      const days2 = parseInt(url2.searchParams.get('days') || '7', 10);
      const cutoff2 = new Date(Date.now() - days2 * 86400000).toISOString().slice(0, 10);
      const { results: voidRows } = await env.SB_DB.prepare(
        `SELECT stat, direction, line, auto_verified, pick_date, COUNT(*) as cnt
         FROM pick_history
         WHERE result = 'V' AND pick_date >= ?
         GROUP BY stat, direction, line, auto_verified, pick_date
         ORDER BY cnt DESC LIMIT 100`
      ).bind(cutoff2).all();
      const { results: reopenCandidates } = await env.SB_DB.prepare(
        `SELECT COUNT(*) as cnt FROM pick_history
         WHERE result = 'V' AND auto_verified = 1 AND pick_date >= ?
           AND NOT (
             stat LIKE '%1T%' OR LOWER(stat) LIKE '%primeiro tempo%' OR LOWER(stat) LIKE '%first half%' OR
             LOWER(stat) LIKE '%halftime%' OR LOWER(stat) LIKE '%pontos%' OR LOWER(stat) LIKE '%rebotes%' OR
             LOWER(stat) LIKE '%assistencias%' OR LOWER(stat) LIKE '%player_%' OR LOWER(stat) LIKE '%marca/assist%' OR
             LOWER(stat) LIKE '%score or assist%' OR LOWER(stat) LIKE '%desarme%' OR LOWER(stat) LIKE '%tackle%'
           )`
      ).bind(cutoff2).all();
      return new Response(JSON.stringify({ ok: true, days: days2, reopen_candidates: reopenCandidates[0]?.cnt || 0, breakdown: voidRows }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() });
    }
  }

  // POST /v1/picks/auto-verify — força run da auto-verificação (público pra trigar manual via UI)
  // ?recovery=true — reabre TODOS os voids resolváveis dos últimos 14 dias e tenta resolver
  // ?box_recovery=true — reabre apenas voids de box stats (corners/shots/cards) para retentativa via SofaScore
  if (pathname === '/v1/picks/auto-verify' && method === 'POST') {
    try {
      const avUrl       = new URL(request.url);
      const recovery    = avUrl.searchParams.get('recovery')     === 'true';
      const boxRecovery = avUrl.searchParams.get('box_recovery') === 'true';
      const result = await runPickAutoVerify(env, recovery, boxRecovery);
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() });
    }
  }

  // POST /v1/picks/tipster-verify — força run da verificação de telegram_tips (corners/shots/cards)
  if (pathname === '/v1/picks/tipster-verify' && method === 'POST') {
    try {
      const result = await runTipsterAutoVerify(env);
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() });
    }
  }

  // POST /v1/picks/save — insere picks novos; se já existir, atualiza result/auto_verified se fornecidos
  if (pathname === '/v1/picks/save' && method === 'POST') {
    try {
      const body = await request.json().catch(() => ({}));
      // Schema novo (combo builder): body.legs OU body.savedAt → routear pro D1 user_picks handler
      if (Array.isArray(body.legs) || body.savedAt != null) {
        const { handlePicksSave } = await import('./routes/picksHistory.js');
        // Re-injetar body já consumido
        const req2 = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) });
        return handlePicksSave(req2, env);
      }
      const picks = Array.isArray(body.picks) ? body.picks : [];
      let inserted = 0;
      if (env.SB_DB) {
        // Garante colunas direction/line/home_team/away_team existem (idempotente)
        await Promise.all([
          env.SB_DB.exec(`ALTER TABLE pick_history ADD COLUMN direction  TEXT`).catch(() => {}),
          env.SB_DB.exec(`ALTER TABLE pick_history ADD COLUMN line       REAL`).catch(() => {}),
          env.SB_DB.exec(`ALTER TABLE pick_history ADD COLUMN home_team  TEXT`).catch(() => {}),
          env.SB_DB.exec(`ALTER TABLE pick_history ADD COLUMN away_team  TEXT`).catch(() => {}),
          env.SB_DB.exec(`ALTER TABLE pick_history ADD COLUMN match_id   TEXT`).catch(() => {}),
        ]);
        for (const p of picks) {
          if (!p.id || !p.pick_date || !p.match || !p.stat) continue;
          // Normaliza stat: remove nome duplicado (bug na geração)
          // Ex: "Total de Escanteios (90min) Total de Escanteios (90min) Mais de 9"
          //   → "Total de Escanteios (90min) Mais de 9"
          // Ex: "Chance Dupla Chance Dupla 12" → "Chance Dupla 12"
          let stat = p.stat || '';
          {
            const doubled = stat.match(/^(.{10,}?)\s+\1\s+((?:Mais|Menos|Over|Under|de).+)$/i);
            if (doubled) stat = `${doubled[1].trim()} ${doubled[2].trim()}`;
            else {
              const dcDoubled = stat.match(/^(Chance Dupla|Double Chance)\s+(?:Chance Dupla|Double Chance)\s+(.+)$/i);
              if (dcDoubled) stat = `${dcDoubled[1]} ${dcDoubled[2].trim()}`;
            }
          }
          // Parse line/direction from pick ID if not explicitly provided
          let { line, direction } = p;
          if ((line == null || direction == null) && p.id) {
            const segs = p.id.split('|');
            const last = segs[segs.length - 1] || '';
            // Over/Under com número: "o2 5" / "u3 0"
            const m = last.match(/^([ou])([\d]+)[\s.]?(\d*)/i);
            if (m) {
              direction = direction ?? (m[1].toLowerCase() === 'o' ? 'over' : 'under');
              line = line ?? parseFloat(m[2] + (m[3] ? '.' + m[3] : ''));
            }
            // Direções texto para mercados de resultado (1X2/DC/BTTS)
            if (!direction && /^(home|away|draw|1|2|x|1x|x2|12|win|yes|no|sim|nao|não)$/i.test(last)) {
              direction = last.toLowerCase();
            }
          }
          // Extrai direction/line do nome da stat para mercados com resultado embutido
          // Ex: "Chance Dupla 12" → direction="12"; "Chance Dupla Chance Dupla 1X" → direction="1x"
          if (!direction && /chance dupla|double chance/i.test(stat)) {
            // Pega a ÚLTIMA ocorrência de (1X|X2|12|1|2|X) na stat (funciona para stat doubled e simples)
            const dcDir = stat.match(/\b(1X|X2|12|1|2|X)\s*$/i);
            if (dcDir) direction = dcDir[1].toLowerCase();
          }
          await env.SB_DB.prepare(`
            INSERT INTO pick_history (id, pick_date, match, home_team, away_team, league, sport, stat, direction, line, conf, tier, real_odd, ev_real, match_id, result, auto_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              direction     = COALESCE(excluded.direction, direction),
              line          = COALESCE(excluded.line, line),
              result        = COALESCE(excluded.result, result),
              auto_verified = COALESCE(excluded.auto_verified, auto_verified),
              updated_at    = datetime('now')
          `).bind(
            p.id, p.pick_date, p.match,
            p.home_team ?? null, p.away_team ?? null,
            p.league || '', p.sport || 'football',
            stat, direction ?? null, line != null ? parseFloat(line) : null,
            p.conf || 0, p.tier || 'aggressive',
            p.real_odd ?? null, p.ev_real ?? null,
            p.match_id ?? null,
            p.result ?? null, p.auto_verified ?? 0
          ).run().catch(() => {});
          inserted++;
        }
      }
      return new Response(JSON.stringify({ ok: true, inserted }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'SAVE_FAILED', detail: String(e?.message || e) }), {
        status: 500, headers: corsHeaders(),
      });
    }
  }

  // GET /v1/calibration — computa shifts históricos (Fase 5, server-side)
  // Query: ?sport=football&window=30
  // Retorna: { byLeague, byMarket, byBracket, byLeagueMarket, sampleSize, windowDays }
  if (pathname === '/v1/calibration' && method === 'GET') {
    const url = new URL(request.url);
    const sport = url.searchParams.get('sport');
    const windowDays = parseInt(url.searchParams.get('window') || '30', 10);
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    let query = `SELECT league, stat, conf, result FROM pick_history
                 WHERE (result = 'W' OR result = 'L')
                 AND saved_at >= ?`;
    const args = [cutoff];
    if (sport) { query += ` AND sport = ?`; args.push(sport); }
    query += ` LIMIT 5000`;

    const { results } = await env.SB_DB.prepare(query).bind(...args).all();
    const resolved = results || [];

    // Normalizador de liga (mesma lógica do frontend)
    const normLg = (lg) => (lg || '').toLowerCase()
      .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
      .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
      .replace(/[^a-z0-9]/g,'').slice(0, 30) || 'unknown';

    const MIN_SAMPLE = 10;
    const computeShifts = (items, keyFn) => {
      const buckets = new Map();
      items.forEach(p => {
        const k = keyFn(p);
        if (!k) return;
        if (!buckets.has(k)) buckets.set(k, { wins: 0, total: 0, confSum: 0 });
        const b = buckets.get(k);
        b.total++;
        b.confSum += p.conf || 0;
        if (p.result === 'W') b.wins++;
      });
      const out = {};
      buckets.forEach((b, k) => {
        if (b.total < MIN_SAMPLE) return;
        const predicted = b.confSum / b.total;
        const actual = (b.wins / b.total) * 100;
        out[k] = {
          predicted: +predicted.toFixed(1),
          actual:    +actual.toFixed(1),
          shift:     +(actual - predicted).toFixed(1),
          sample:    b.total,
        };
      });
      return out;
    };

    const BRACKETS = [
      { label: '85+',   min: 85, max: 100 },
      { label: '80-84', min: 80, max: 84 },
      { label: '75-79', min: 75, max: 79 },
      { label: '70-74', min: 70, max: 74 },
      { label: '60-69', min: 60, max: 69 },
      { label: '<60',   min: 0,  max: 59 },
    ];
    const byBracket = {};
    BRACKETS.forEach(br => {
      const picks = resolved.filter(p => (p.conf || 0) >= br.min && (p.conf || 0) <= br.max);
      if (picks.length < 15) return;
      const wins = picks.filter(p => p.result === 'W').length;
      const avgConf = picks.reduce((a, p) => a + (p.conf || 0), 0) / picks.length;
      const actualWR = (wins / picks.length) * 100;
      byBracket[br.label] = {
        range: [br.min, br.max],
        avgConf: +avgConf.toFixed(1),
        actualWR: +actualWR.toFixed(1),
        shift: +(actualWR - avgConf).toFixed(1),
        sample: picks.length,
      };
    });

    const calibration = {
      byLeague:       computeShifts(resolved, p => normLg(p.league)),
      byMarket:       computeShifts(resolved, p => (p.stat || '').slice(0, 30)),
      byLeagueMarket: computeShifts(resolved, p => `${normLg(p.league)}|${(p.stat || '').slice(0, 20)}`),
      byBracket,
      sampleSize: resolved.length,
      windowDays,
      sport: sport || 'all',
      builtAt: Date.now(),
    };

    return new Response(JSON.stringify({ ok: true, calibration }), {
      status: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=900' }, // 15min
    });
  }

  // ── /v1/intelligence/implied-xg — deriva λ_home, λ_away dos markets capturados Bet365
  // Lê bet365_markets_snapshots pra fixture e resolve via Poisson reverso.
  if (pathname === '/v1/intelligence/implied-xg' && method === 'GET') {
    const url = new URL(request.url);
    const home = url.searchParams.get('home');
    const away = url.searchParams.get('away');
    const fid = url.searchParams.get('fixtureId');
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      const mkRow = await env.SB_DB.prepare(
        `SELECT payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`
      ).first()
      if (!mkRow) return new Response(JSON.stringify({ ok: false, error: 'no_snapshot' }), { status: 404, headers: corsHeaders() });
      const list = JSON.parse(mkRow.payload || '[]')
      const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
      const matched = list.filter(m => fid ? m.fixtureId === fid : (norm(m.home) === norm(home) && norm(m.away) === norm(away)))
      if (!matched.length) return new Response(JSON.stringify({ ok: false, error: 'fixture_not_in_capturado' }), { status: 404, headers: corsHeaders() });
      const M0 = matched[0]
      // Devig TOTAL_GOALS: pra cada par over/under, fairProb = (1/over)/sumImpl
      // λ_total inferido: P(>0.5) ≈ 1 - exp(-λ) → λ = -ln(1 - P(>0.5))
      const totals = matched.filter(r => r.market === 'TOTAL_GOALS' && r.over && r.under)
      let lambdaTotal = null
      const totalProbs = []
      for (const t of totals) {
        const sumImpl = 1/t.over + 1/t.under
        const fairOver = (1/t.over) / sumImpl
        totalProbs.push({ line: t.line, fairOver })
        // Pra linha 0.5 podemos inferir λ direto
        if (Math.abs(t.line - 0.5) < 0.01) lambdaTotal = -Math.log(1 - fairOver)
      }
      // Se 0.5 não disponível, usa 1.5 ou 2.5 com Poisson CDF reverso
      if (lambdaTotal == null && totalProbs.length) {
        // Pega linha mais próxima de 2.5 e resolve λ via busca
        const t25 = totalProbs.reduce((a, b) => Math.abs(b.line - 2.5) < Math.abs(a.line - 2.5) ? b : a)
        // Busca λ que satisfaça P(X > line) = fairOver
        let lo = 0.5, hi = 5
        for (let i = 0; i < 25; i++) {
          const mid = (lo + hi) / 2
          // P(X > line) via Poisson CDF
          let cum = 0
          for (let k = 0; k <= Math.floor(t25.line); k++) {
            let p = Math.exp(-mid)
            for (let j = 1; j <= k; j++) p *= mid / j
            cum += p
          }
          const pOver = 1 - cum
          if (pOver > t25.fairOver) hi = mid
          else lo = mid
        }
        lambdaTotal = (lo + hi) / 2
      }
      // Razão home/away via 1X2
      let ratio = 1.0
      const oneXtwo = matched.filter(r => r.market === '1X2')
      if (oneXtwo.length === 3) {
        const sumImpl = oneXtwo.reduce((s, r) => s + 1/r.odd, 0)
        const homeRow = oneXtwo.find(r => r.selection === 'home')
        const awayRow = oneXtwo.find(r => r.selection === 'away')
        if (homeRow && awayRow) {
          const pH = (1/homeRow.odd) / sumImpl
          const pA = (1/awayRow.odd) / sumImpl
          // Heurística: maior probabilidade de vitória → mais gols esperados
          ratio = pH / Math.max(0.05, pA)   // home/away ratio
        }
      }
      const lambdaHome = lambdaTotal ? +(lambdaTotal * ratio / (1 + ratio)).toFixed(2) : null
      const lambdaAway = lambdaTotal ? +(lambdaTotal / (1 + ratio)).toFixed(2) : null
      const bttsProb = (lambdaHome != null && lambdaAway != null)
        ? +((1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway))).toFixed(3)
        : null
      return new Response(JSON.stringify({
        ok: true,
        fixture: { home: M0.home, away: M0.away, competition: M0.competition, fixtureId: M0.fixtureId },
        lambda_total: lambdaTotal ? +lambdaTotal.toFixed(2) : null,
        lambda_home: lambdaHome,
        lambda_away: lambdaAway,
        btts_prob: bttsProb,
        derived_from: 'bet365_markets',
        sources: { totals_lines: totalProbs.length, has_1x2: oneXtwo.length === 3 },
      }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/intelligence/referee-bias/refresh — auto-derivado de pick_history (Fase C)
  if (pathname === '/v1/intelligence/referee-bias/refresh' && method === 'POST') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS referee_self_stats (name TEXT PRIMARY KEY, sample INTEGER, cards_per_game REAL, fouls_per_game REAL, pen_rate REAL, captured_at INTEGER)`).catch(() => {})
      // pick_history precisa ter referee field — placeholder por enquanto
      const { results } = await env.SB_DB.prepare(`
        SELECT referee, COUNT(*) as n, AVG(yellow_cards) as cards FROM pick_history
        WHERE referee IS NOT NULL GROUP BY referee HAVING n >= 8
      `).all().catch(() => ({ results: [] }))
      let saved = 0
      for (const r of (results || [])) {
        if (!r.referee) continue
        await env.SB_DB.prepare(`INSERT OR REPLACE INTO referee_self_stats VALUES (?,?,?,?,?,?)`)
          .bind(r.referee, r.n, r.cards || null, null, null, Date.now()).run()
        saved++
      }
      return new Response(JSON.stringify({ ok: true, refs_processed: saved, note: 'requires pick_history.referee field populated' }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/clv/auto-snapshot — varre user_picks abertos e captura closing line (Fase E)
  if (pathname === '/v1/clv/auto-snapshot' && method === 'POST') {
    const secret = request.headers.get('X-Ingest-Secret');
    if (secret !== env.SB_INGEST_SECRET) return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), { status: 401, headers: corsHeaders() });
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS pick_clv (id TEXT PRIMARY KEY, pick_id TEXT, opening_odd REAL, closing_odd REAL, clv_pct REAL, captured_at INTEGER)`).catch(() => {})
      // Pega último snapshot de markets pra matching
      const mkRow = await env.SB_DB.prepare(`SELECT payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`).first()
      const matches = mkRow ? JSON.parse(mkRow.payload || '[]') : []
      // Pra cada user_pick aberto cuja kickoff < 30min, snapshot
      const { results: openPicks } = await env.SB_DB.prepare(
        `SELECT id, payload FROM user_picks WHERE status IS NULL OR status = '' LIMIT 200`
      ).all().catch(() => ({ results: [] }))
      let snapped = 0
      for (const p of (openPicks || [])) {
        let payload = {}
        try { payload = JSON.parse(p.payload) } catch {}
        // Stub: salva snapshot only if pick has odd
        if (!payload.totalOdds && !payload.odds) continue
        // Closing line = mesma odd se mercado convergiu (placeholder simples)
        const closing = payload.totalOdds || payload.odds
        const opening = payload.openingOdd || closing
        const clv = opening > 0 ? +(((opening / closing) - 1) * 100).toFixed(2) : null
        await env.SB_DB.prepare(`INSERT OR REPLACE INTO pick_clv (id, pick_id, opening_odd, closing_odd, clv_pct, captured_at) VALUES (?,?,?,?,?,?)`)
          .bind(`${p.id}_clv`, p.id, opening, closing, clv, Date.now()).run().catch(() => {})
        snapped++
      }
      return new Response(JSON.stringify({ ok: true, snapped, sample: openPicks?.length || 0 }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/intelligence/team-form/refresh — calcula form dos times do pick_history
  if (pathname === '/v1/intelligence/team-form/refresh' && method === 'POST') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS team_self_form (team TEXT PRIMARY KEY, played INTEGER, wins INTEGER, draws INTEGER, losses INTEGER, gf REAL, ga REAL, win_rate REAL, last5_form TEXT, captured_at INTEGER)`).catch(() => {})
      const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString()
      // pick_history match field tem "Home vs Away"
      const { results } = await env.SB_DB.prepare(`
        SELECT match, result, conf, saved_at FROM pick_history
        WHERE saved_at >= ? AND (result='W' OR result='L') LIMIT 5000
      `).bind(cutoff).all()
      const teamAgg = {}
      for (const r of (results || [])) {
        const parts = (r.match || '').split(' vs ')
        if (parts.length < 2) continue
        for (const t of parts) {
          if (!teamAgg[t]) teamAgg[t] = { played: 0, wins: 0 }
          teamAgg[t].played++
          if (r.result === 'W') teamAgg[t].wins++
        }
      }
      let saved = 0
      for (const [team, agg] of Object.entries(teamAgg)) {
        if (agg.played < 3) continue
        const winRate = +(agg.wins / agg.played * 100).toFixed(1)
        await env.SB_DB.prepare(`INSERT OR REPLACE INTO team_self_form (team, played, wins, draws, losses, gf, ga, win_rate, last5_form, captured_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(team, agg.played, agg.wins, 0, agg.played - agg.wins, 0, 0, winRate, '', Date.now()).run()
        saved++
      }
      return new Response(JSON.stringify({ ok: true, teams_processed: saved }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/intelligence/arbitrage — Bet365 vs Bovada arbs ──
  if (pathname === '/v1/intelligence/arbitrage' && method === 'GET') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      const mkRow = await env.SB_DB.prepare(`SELECT payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`).first()
      const matches = mkRow ? JSON.parse(mkRow.payload || '[]') : []
      // Group por fixture
      const byFid = {}
      for (const m of matches) {
        if (!byFid[m.fixtureId]) byFid[m.fixtureId] = { home: m.home, away: m.away, league: m.competition, markets: [] }
        byFid[m.fixtureId].markets.push(m)
      }
      // Pra cada fixture, busca 1X2 e BTTS no Bet365 e Bovada
      // Cross via /v1/odds/all (Bovada) — mas fazer dentro deste handler é caro.
      // Stub: retorna fixtures matched em markets/analyzed que possam ter arb
      const arbs = []
      for (const [fid, F] of Object.entries(byFid)) {
        const oneXtwo = F.markets.filter(m => m.market === '1X2')
        if (oneXtwo.length === 3) {
          const sum = oneXtwo.reduce((s, m) => s + 1/m.odd, 0)
          if (sum < 1.0) {
            arbs.push({ fixtureId: fid, home: F.home, away: F.away, market: '1X2', total_implied: +sum.toFixed(4), arbitrage_pct: +((1 - sum) * 100).toFixed(2), source: 'bet365_internal' })
          }
        }
      }
      return new Response(JSON.stringify({ ok: true, arbs, note: 'Detecta arbs internas (vig negativo) — TODO: cruzar com Bovada' }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/intelligence/middles — Total Goals com linhas diferentes Bet365 ──
  if (pathname === '/v1/intelligence/middles' && method === 'GET') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      const mkRow = await env.SB_DB.prepare(`SELECT payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`).first()
      const matches = mkRow ? JSON.parse(mkRow.payload || '[]') : []
      const middles = []
      const byFid = {}
      for (const m of matches) {
        if (m.market !== 'TOTAL_GOALS') continue
        if (!byFid[m.fixtureId]) byFid[m.fixtureId] = []
        byFid[m.fixtureId].push(m)
      }
      for (const [fid, lines] of Object.entries(byFid)) {
        if (lines.length < 2) continue
        // Busca par Over X com Under Y onde Y > X+0.5
        for (let i = 0; i < lines.length; i++) {
          for (let j = 0; j < lines.length; j++) {
            if (i === j) continue
            const a = lines[i], b = lines[j]
            if (!a.over || !b.under) continue
            if (b.line - a.line < 0.5) continue
            // Middle: aposta Over X + Under Y. Ganha ambos se gols cair entre X e Y.
            // Combined cost ≈ 1/over_a + 1/under_b. Se < 1.0 + payout do middle, é +EV.
            const cost = 1/a.over + 1/b.under
            if (cost < 1.0) {
              middles.push({
                fixtureId: fid, home: a.home, away: a.away,
                buy: `Over ${a.line} @${a.over}`, sell: `Under ${b.line} @${b.under}`,
                middle_zone: `${Math.ceil(a.line)} a ${Math.floor(b.line)} gols`,
                combined_cost: +cost.toFixed(4), arb_pct: +((1 - cost) * 100).toFixed(2),
              })
            }
          }
        }
      }
      return new Response(JSON.stringify({ ok: true, middles }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/intelligence/alerts — picks HIGH +EV não vistos pelo user ──
  // Service Worker pode pollar isso pra notification background
  if (pathname === '/v1/intelligence/alerts' && method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      alerts: [],
      note: 'TODO: integrar com cache user-side de seenIds + cruzar com /v1/football/props/today HIGH conf',
    }), { status: 200, headers: corsHeaders() });
  }

  // ── /v1/intelligence/model-health — accuracy do modelo nos últimos 30d ──
  if (pathname === '/v1/intelligence/model-health' && method === 'GET') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString()
      const { results } = await env.SB_DB.prepare(`
        SELECT stat, conf, result FROM pick_history WHERE saved_at >= ? AND (result='W' OR result='L') LIMIT 3000
      `).bind(cutoff).all().catch(() => ({ results: [] }))
      const buckets = {}
      for (const r of (results || [])) {
        const k = (r.stat || 'unknown').slice(0, 30)
        if (!buckets[k]) buckets[k] = { n: 0, w: 0, confSum: 0 }
        buckets[k].n++
        buckets[k].confSum += r.conf || 0
        if (r.result === 'W') buckets[k].w++
      }
      const health = {}
      for (const [k, b] of Object.entries(buckets)) {
        if (b.n < 5) continue
        const predicted = b.confSum / b.n
        const actual = (b.w / b.n) * 100
        health[k] = {
          sample: b.n,
          predicted_conf: +predicted.toFixed(1),
          actual_hit_rate: +actual.toFixed(1),
          shift: +(actual - predicted).toFixed(1),
          status: Math.abs(actual - predicted) < 8 ? 'healthy' : actual > predicted ? 'underestimated' : 'overestimated',
        }
      }
      return new Response(JSON.stringify({ ok: true, period: '30d', health }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/clv/snapshot — registra closing line pra um pick ──
  // POST { pickId, closingOdd } → grava em pick_history.clv
  if (pathname === '/v1/clv/snapshot' && method === 'POST') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    const body = await request.json().catch(() => ({}));
    if (!body.pickId || !body.closingOdd) return new Response(JSON.stringify({ ok: false, error: 'pickId+closingOdd required' }), { status: 400, headers: corsHeaders() });
    try {
      await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS pick_clv (id TEXT PRIMARY KEY, pick_id TEXT, opening_odd REAL, closing_odd REAL, clv_pct REAL, captured_at INTEGER)`).catch(() => {})
      const row = await env.SB_DB.prepare(`SELECT real_odd FROM pick_history WHERE id = ?`).bind(body.pickId).first()
      if (!row) return new Response(JSON.stringify({ ok: false, error: 'pick not found' }), { status: 404, headers: corsHeaders() });
      const opening = row.real_odd
      const clvPct = opening ? +(((opening / body.closingOdd) - 1) * 100).toFixed(2) : null
      await env.SB_DB.prepare(`INSERT OR REPLACE INTO pick_clv (id, pick_id, opening_odd, closing_odd, clv_pct, captured_at) VALUES (?,?,?,?,?,?)`)
        .bind(`${body.pickId}_clv`, body.pickId, opening, body.closingOdd, clvPct, Date.now()).run()
      return new Response(JSON.stringify({ ok: true, clv_pct: clvPct }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/clv/summary — média CLV por mercado/liga ──
  if (pathname === '/v1/clv/summary' && method === 'GET') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    try {
      const { results } = await env.SB_DB.prepare(`
        SELECT ph.stat, ph.league, AVG(c.clv_pct) AS avg_clv, COUNT(*) AS n
        FROM pick_clv c JOIN pick_history ph ON c.pick_id = ph.id
        WHERE c.clv_pct IS NOT NULL GROUP BY ph.stat, ph.league HAVING n >= 3
      `).all().catch(() => ({ results: [] }))
      return new Response(JSON.stringify({ ok: true, summary: results || [] }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message, summary: [] }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/backtest/run — backtest stub: roda histórico × modelo atual ──
  if (pathname === '/v1/backtest/run' && method === 'GET') {
    if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB' }), { status: 503, headers: corsHeaders() });
    const url = new URL(request.url);
    const start = url.searchParams.get('start') || new Date(Date.now() - 30*86400_000).toISOString().slice(0,10)
    const end = url.searchParams.get('end') || new Date().toISOString().slice(0,10)
    try {
      const { results } = await env.SB_DB.prepare(`
        SELECT stat, conf, result, real_odd FROM pick_history
        WHERE pick_date >= ? AND pick_date <= ? AND (result='W' OR result='L')
      `).bind(start, end).all().catch(() => ({ results: [] }))
      const byStat = {}
      let totalStaked = 0, totalReturn = 0
      for (const r of (results || [])) {
        const k = (r.stat || 'unknown').slice(0,30)
        if (!byStat[k]) byStat[k] = { n:0, w:0, staked:0, returned:0 }
        byStat[k].n++
        if (r.result === 'W') byStat[k].w++
        const stake = 1
        byStat[k].staked += stake; totalStaked += stake
        if (r.result === 'W' && r.real_odd) {
          byStat[k].returned += stake * r.real_odd; totalReturn += stake * r.real_odd
        }
      }
      const accuracy = {}
      for (const [k, v] of Object.entries(byStat)) {
        accuracy[k] = { hit_rate: +(v.w/v.n*100).toFixed(1), roi_pct: +((v.returned - v.staked)/v.staked * 100).toFixed(1), sample: v.n }
      }
      return new Response(JSON.stringify({
        ok: true, period: { start, end }, total_picks: results?.length || 0,
        global_roi_pct: totalStaked ? +((totalReturn-totalStaked)/totalStaked*100).toFixed(1) : 0,
        by_market: accuracy,
      }), { status: 200, headers: corsHeaders() });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
    }
  }

  // ── /v1/live/picks — stub: picks de live in-play ──
  if (pathname === '/v1/live/picks' && method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      note: 'Live in-play picks — TODO: integrar com bet365 in-play API + modelo de prob ajustada por minuto',
      picks: [],
    }), { status: 200, headers: corsHeaders() });
  }

  // ── /v1/ml/predict — stub ML supervisionado ──
  if (pathname === '/v1/ml/predict' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    // Stub: retorna prob_ml = confidence/100 ajustado por uma regra simples
    // TODO: treinar XGBoost em pick_history features
    const conf = body.confidence || 50
    const edge = body.edge_pct || 0
    const probMl = Math.max(0.05, Math.min(0.95, (conf/100) + (edge > 0 ? 0.02 : -0.02)))
    return new Response(JSON.stringify({
      ok: true, prob_ml: +probMl.toFixed(3),
      note: 'Stub heurístico — substituir com XGBoost treinado em pick_history',
    }), { status: 200, headers: corsHeaders() });
  }

  // ── POST /v1/ml/upload-model — recebe modelo treinado localmente ──
  if (pathname === '/v1/ml/upload-model' && method === 'POST') {
    const secret = request.headers.get('X-Ingest-Secret')
    if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
    }
    try {
      const model = await request.json()
      if (!model.booster?.trees) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_model' }), { status: 400, headers: corsHeaders() })
      }
      // Drop+recreate pra garantir schema correto (versionar tabela seria overkill aqui)
      await env.SB_DB.exec(`DROP TABLE IF EXISTS ml_models`)
      await env.SB_DB.exec(
        `CREATE TABLE ml_models (id INTEGER PRIMARY KEY, version INTEGER, trained_at TEXT, payload TEXT, metrics TEXT)`
      )
      await env.SB_DB.prepare(
        `INSERT OR REPLACE INTO ml_models (id, version, trained_at, payload, metrics) VALUES (1, ?, ?, ?, ?)`
      ).bind(
        model.version || Date.now(),
        model.trained_at || new Date().toISOString(),
        JSON.stringify(model.booster),
        JSON.stringify(model.metrics || {})
      ).run()
      return new Response(JSON.stringify({ ok: true, version: model.version, metrics: model.metrics }), { status: 200, headers: corsHeaders() })
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
    }
  }
  // ── GET /v1/ml/model-info — retorna metadados do modelo atual ──
  if (pathname === '/v1/ml/model-info') {
    try {
      const row = await env.SB_DB.prepare(`SELECT version, trained_at, metrics FROM ml_models WHERE id = 1`).first()
      if (!row) return new Response(JSON.stringify({ ok: true, model: null }), { status: 200, headers: corsHeaders() })
      return new Response(JSON.stringify({
        ok: true,
        model: {
          version: row.version,
          trained_at: row.trained_at,
          metrics: row.metrics ? JSON.parse(row.metrics) : null,
        }
      }), { status: 200, headers: corsHeaders() })
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
    }
  }

  // PATCH /v1/picks/result — atualiza resultado de um pick
  if (pathname === '/v1/picks/result' && method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    const { id, result } = body;
    if (!id) return new Response(JSON.stringify({ ok: false, error: 'id required' }), { status: 400, headers: corsHeaders() });
    const validResults = ['W', 'L', 'V', 'P', null];
    if (!validResults.includes(result)) return new Response(JSON.stringify({ ok: false, error: 'invalid result' }), { status: 400, headers: corsHeaders() });
    await env.SB_DB.prepare(
      `UPDATE pick_history SET result = ?, auto_verified = 0, updated_at = datetime('now') WHERE id = ?`
    ).bind(result, id).run();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders() });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { status: 404, headers: corsHeaders() });
}

// ── AUTH TIER ENFORCEMENT ──────────────────────────────────────────────
async function resolveApiTier(request, env, pathname) {
  // Always-public routes
  const PUBLIC_PATHS = ['/health', '/v1/status', '/v1', '/'];
  if (PUBLIC_PATHS.includes(pathname)) return { tier: 'public', allowed: true };

  // Demo + docs routes — always public, no key needed
  if (pathname.startsWith('/v1/demo')) return { tier: 'demo', allowed: true };
  if (pathname.startsWith('/v1/docs')) return { tier: 'public', allowed: true };
  if (pathname.startsWith('/v1/parlay/')) return { tier: 'public', allowed: true };
  if (pathname.startsWith('/v1/match/') ||
      pathname.startsWith('/v1/lineups/') ||
      pathname.startsWith('/v1/weather/') ||
      pathname.startsWith('/v1/referee/') ||
      pathname.startsWith('/v1/players/')) return { tier: 'public', allowed: true };

  const apiKey = request.headers.get('X-SB-Key') ||
                 new URL(request.url).searchParams.get('key');

  // No master key configured → open/dev mode (free tier for all)
  if (!env.SB_MASTER_KEY) {
    return { tier: 'free', allowed: true };
  }

  if (apiKey) {
    // Check for sandbox prefix (sandbox keys: sb_sandbox_xxx)
    if (apiKey.startsWith('sb_sandbox_')) {
      return { tier: 'sandbox', allowed: true, sandbox: true };
    }

    // D1 key lookup
    try {
      const stmt = env.SB_DB.prepare(
        `SELECT plan, rate_limit, modules, active FROM api_keys
         WHERE key_hash = ? AND active = 1
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
      );
      const keyHash = simpleHash(apiKey);
      const row = await stmt.bind(keyHash).first();
      if (row) {
        return {
          tier:       row.plan,
          allowed:    true,
          rate_limit: row.rate_limit,
          modules:    JSON.parse(row.modules || '[]'),
          keyHash,
        };
      }
    } catch (e) {
      console.warn('[Auth] D1 lookup failed:', e.message);
    }
    return { tier: null, allowed: false, error: 'INVALID_KEY' };
  }

  // No key → free tier
  return { tier: 'free', allowed: true };
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Tier access matrix
// odds_delay_ms = atraso aplicado em /v1/odds/value etc (free = 15min para não canibalizar pro)
// odds_top_n    = cap de resultados em endpoints de edge
// realtime_ws   = acesso ao WebSocket /v1/realtime/odds
// debug_mode    = acesso a ?debug=1 nos endpoints premium
const TIER_ACCESS = {
  public:     { sports: [],                              intelligence: false, market: false, analytics: false, odds_delay_ms: 15 * 60 * 1000, odds_top_n: 3,   realtime_ws: false, clv_tracker: false, debug_mode: false },
  demo:       { sports: [],                              intelligence: false, market: false, analytics: false, odds_delay_ms: 15 * 60 * 1000, odds_top_n: 3,   realtime_ws: false, clv_tracker: false, debug_mode: false },
  sandbox:    { sports: ['football', 'basketball'],      intelligence: true,  market: false, analytics: false, odds_delay_ms: 15 * 60 * 1000, odds_top_n: 5,   realtime_ws: false, clv_tracker: false, debug_mode: false },
  free:       { sports: ['football', 'basketball'],      intelligence: true,  market: false, analytics: false, odds_delay_ms: 15 * 60 * 1000, odds_top_n: 3,   realtime_ws: false, clv_tracker: false, debug_mode: false },
  starter:    { sports: ['football', 'basketball'],      intelligence: true,  market: true,  analytics: false, odds_delay_ms: 5 * 60 * 1000,  odds_top_n: 20,  realtime_ws: false, clv_tracker: false, debug_mode: false },
  vip:        { sports: ['football', 'basketball'],      intelligence: true,  market: true,  analytics: false, odds_delay_ms: 0,              odds_top_n: 30,  realtime_ws: false, clv_tracker: false, debug_mode: false },
  pro:        { sports: ['football', 'basketball'],      intelligence: true,  market: true,  analytics: true,  odds_delay_ms: 0,              odds_top_n: 50,  realtime_ws: false, clv_tracker: false, debug_mode: false },
  sharp:      { sports: ['football', 'basketball', '*'], intelligence: true,  market: true,  analytics: true,  odds_delay_ms: 0,              odds_top_n: 100, realtime_ws: true,  clv_tracker: true,  debug_mode: false },
  enterprise: { sports: ['football', 'basketball', '*'], intelligence: true,  market: true,  analytics: true,  odds_delay_ms: 0,              odds_top_n: 500, realtime_ws: true,  clv_tracker: true,  debug_mode: false },
  internal:   { sports: ['football', 'basketball', '*'], intelligence: true,  market: true,  analytics: true,  odds_delay_ms: 0,              odds_top_n: 999, realtime_ws: true,  clv_tracker: true,  debug_mode: true  },
};

export function getTierLimits(tier) {
  return TIER_ACCESS[tier] || TIER_ACCESS['free'];
}

function canAccess(tier, type, sport = null) {
  const access = TIER_ACCESS[tier] || TIER_ACCESS['free'];
  if (type === 'sport') return sport && (access.sports.includes(sport) || access.sports.includes('*'));
  return access[type] || false;
}

// ── RESPONSE HEADERS ─────────────────────────────────────────────────
function addResponseHeaders(response, tier, startTime, layer = 'data') {
  const elapsed = Date.now() - startTime;
  const headers = new Headers(response.headers);

  headers.set('X-SB-Version', API_VERSION);
  headers.set('X-SB-Layer', layer);
  if (layer === 'intelligence') {
    headers.set('X-SB-Engine', `sportsbrain-intelligence/${API_VERSION}`);
  }

  const limit = { public: 50, demo: 20, sandbox: 50, free: 100, starter: 1000, vip: 208, pro: 4167, sharp: 60000, enterprise: 999999, internal: 999999 }[tier] || 100;
  headers.set('X-RateLimit-Limit', limit.toString());
  headers.set('X-RateLimit-Reset', (Math.floor(Date.now() / 1000) + 60).toString());
  headers.set('X-Response-Time', `${elapsed}ms`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── LOG USAGE ─────────────────────────────────────────────────────────
async function logUsage(env, ctx, { apiKey, endpoint, statusCode, responseTimeMs, sport, tier }) {
  if (!env.SB_DB) return;
  ctx.waitUntil(
    env.SB_DB.prepare(`
      INSERT INTO api_usage_log (api_key_hash, endpoint, status_code, response_time_ms, sport, tier)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(apiKey ? simpleHash(apiKey) : null, endpoint, statusCode, responseTimeMs, sport || null, tier).run()
      .catch(e => console.warn('[UsageLog]', e.message))
  );
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────
// Re-export OddsRoom Durable Object class (activates when binding added to wrangler.toml)
export { OddsRoom } from './routes/realtime.js';

export default {
  async fetch(request, env, ctx) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url      = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    // ── Proteção global de rotas /internal/* ─────────────────────────────
    // Todas as rotas /internal/* exigem X-Ingest-Secret ou SB_MASTER_KEY.
    // Rotas específicas podem ter auth própria adicional, mas isso garante
    // que nenhuma rota interna fique completamente sem autenticação.
    if (pathname.startsWith('/internal/')) {
      const _secret      = request.headers.get('X-Ingest-Secret');
      const _adminKey    = request.headers.get('X-Admin-Key') || request.headers.get('X-Master-Key');
      const _hasMaster   = env.SB_MASTER_KEY && (_adminKey === env.SB_MASTER_KEY || _secret === env.SB_MASTER_KEY);
      const _hasSecret   = env.SB_INGEST_SECRET && _secret === env.SB_INGEST_SECRET;
      // Whitelist: /internal/ingest tem tratamento próprio logo abaixo
      // Não bloqueamos aqui — deixamos o route handler checar. Mas logamos se sem auth.
      if (!_hasMaster && !_hasSecret && env.SB_MASTER_KEY) {
        // Rotas que têm auth própria (não bloqueamos — elas retornarão 401 se inválido)
        const _selfAuthRoutes = [
          '/internal/ingest',
          '/internal/ingest-pinnacle',
          '/internal/ingest-boosts',
          '/internal/ingest-live-snapshot',
          '/internal/ingest-mybets',
          '/internal/ingest-telegram-tips',
          '/internal/ingest-odds',
        ];
        if (!_selfAuthRoutes.some(r => pathname === r || pathname.startsWith(r))) {
          // Rota interna sem autenticação — bloqueia
          return new Response(JSON.stringify({
            ok: false,
            error: 'UNAUTHORIZED',
            message: 'Rotas /internal/* requerem X-Ingest-Secret ou X-Admin-Key.',
          }), { status: 401, headers: corsHeaders() });
        }
      }
    }

    // OpenAPI spec + interactive docs (public, no auth)
    if (pathname === '/openapi.json' || pathname === '/openapi') {
      const { handleOpenApiSpec } = await import('./routes/openapi.js');
      return handleOpenApiSpec(env);
    }
    if (pathname === '/docs' || pathname === '/reference') {
      const { handleDocsHtml } = await import('./routes/openapi.js');
      return handleDocsHtml();
    }

    // Internal ingest — POST only, authenticated by X-Ingest-Secret
    if (pathname === '/internal/ingest') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify(sbError('METHOD_NOT_ALLOWED', 'Use POST', 405)), {
          status: 405, headers: corsHeaders(),
        });
      }
      return handleIngest(request, env);
    }

    // ── /internal/ml/* e /v1/admin/ml/training/* — pipeline de training próprio ──
    if (pathname.startsWith('/internal/ml/') || pathname.startsWith('/v1/admin/ml/training') || pathname === '/v1/admin/cleanup/events') {
      const r = await handleMLTraining(pathname, request, env);
      if (r) return r;
    }

    // ── /v1/admin/ml/quality/* + /v1/admin/ml/calibration/* + /v1/admin/ml/selection/* ──
    if (pathname.startsWith('/v1/admin/ml/quality') ||
        pathname.startsWith('/v1/admin/ml/calibration') ||
        pathname.startsWith('/v1/admin/ml/selection')) {
      const r = await handleMLQuality(pathname, request, env);
      if (r) return r;
    }

    // ── /v1/picks/combos — gera combos (parlays) estilo FAIXA VIP ──
    if (pathname === '/v1/picks/combos') {
      const { handleComboBuilder } = await import('./routes/comboBuilder.js');
      return handleComboBuilder(request, env);
    }
    // ── /v1/picks/combos-faixa-style — IA aprende combos W e gera similares ──
    if (pathname === '/v1/picks/combos-faixa-style') {
      const { handleFaixaStyleGenerator } = await import('./routes/faixaStyleGenerator.js');
      return handleFaixaStyleGenerator(request, env);
    }

    // GET /v1/sofascore/team-intelligence/:teamId — features históricas de um time
    if (pathname.startsWith('/v1/sofascore/team-intelligence/') && request.method === 'GET') {
      const teamIdStr = pathname.split('/').pop();
      const teamId = parseInt(teamIdStr, 10);
      if (!teamId || isNaN(teamId)) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_team_id' }), { status: 400, headers: corsHeaders() });
      }
      try {
        const { getTeamFeatures } = await import('./services/sofascoreFeatures.js');
        const features = await getTeamFeatures(teamId, env);
        return new Response(JSON.stringify({ ok: true, ...features }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /v1/sofascore/historical-health — cobertura histórica + lista de times para o scraper
    if (pathname === '/v1/sofascore/historical-health' && request.method === 'GET') {
      try {
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }
        const [coverageRow, teamsRows, runRows] = await Promise.all([
          env.SB_DB.prepare(
            'SELECT COUNT(*) as total_matches, COUNT(DISTINCT ss_team_id) as teams_covered, MIN(event_date) as oldest_match, MAX(event_date) as newest_match FROM sofascore_team_matches'
          ).first().catch(() => null),
          env.SB_DB.prepare(
            'SELECT ss_team_id, team_name FROM sofascore_teams ORDER BY last_seen_at DESC'
          ).all().catch(() => ({ results: [] })),
          env.SB_DB.prepare(
            'SELECT ss_team_id, team_name, matches_inserted, status, started_at, finished_at FROM sofascore_backfill_runs ORDER BY id DESC LIMIT 20'
          ).all().catch(() => ({ results: [] })),
        ]);

        const coverage = coverageRow || { total_matches: 0, teams_covered: 0, oldest_match: null, newest_match: null };
        const teams    = (teamsRows.results || []).map(r => ({ ss_team_id: r.ss_team_id, team_name: r.team_name }));

        return new Response(JSON.stringify({
          ok: true,
          coverage: {
            total_matches:  coverage.total_matches  || 0,
            teams_covered:  coverage.teams_covered  || 0,
            oldest_match:   coverage.oldest_match   || null,
            newest_match:   coverage.newest_match   || null,
          },
          teams,
          recent_runs: runRows.results || [],
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/sofascore/daily-schedule — ingere agenda diária (self-hosted runner → D1)
    // Aceita home_ss_id / away_ss_id (IDs nativos do SofaScore) no payload.
    // Auto-registra times novos em sofascore_teams e devolve new_teams[] para backfill.
    if (pathname === '/internal/sofascore/daily-schedule' && request.method === 'POST') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        if (!env.SB_INGEST_SECRET || ingestSecret !== env.SB_INGEST_SECRET) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }
        const body      = await request.json();
        const dateParam = body.date || new Date().toISOString().slice(0, 10);
        const games     = (body.games || []).filter(g => g.home_team && g.away_team);

        if (games.length === 0) {
          return new Response(JSON.stringify({ ok: true, inserted: 0, date: dateParam, new_teams: [] }), { status: 200, headers: corsHeaders() });
        }

        const normTeam = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // Bulk-load known team IDs (by ss_team_id) to detect new teams
        const existingRows = await env.SB_DB.prepare('SELECT ss_team_id FROM sofascore_teams').all();
        const existingIds  = new Set((existingRows.results || []).map(r => r.ss_team_id));

        // Collect all unique teams with native IDs from the payload
        const seenTeamIds = new Map(); // ss_team_id → team_name
        for (const g of games) {
          if (g.home_ss_id && g.home_team) seenTeamIds.set(g.home_ss_id, g.home_team);
          if (g.away_ss_id && g.away_team) seenTeamIds.set(g.away_ss_id, g.away_team);
        }

        // Register new teams in sofascore_teams
        const newTeams = [];
        const toRegister = [];
        for (const [id, name] of seenTeamIds) {
          if (!existingIds.has(id)) {
            toRegister.push({ id, name });
            newTeams.push({ ss_team_id: id, team_name: name });
          }
        }
        if (toRegister.length > 0) {
          const REG_BATCH = 100;
          for (let i = 0; i < toRegister.length; i += REG_BATCH) {
            const slice = toRegister.slice(i, i + REG_BATCH);
            const stmts = slice.map(({ id, name }) =>
              env.SB_DB.prepare(
                `INSERT OR IGNORE INTO sofascore_teams (ss_team_id, team_name, team_name_norm)
                 VALUES (?, ?, ?)`
              ).bind(id, name, normTeam(name))
            );
            await env.SB_DB.batch(stmts);
          }
        }

        // Batch insert games — use native SS IDs directly (most reliable), fallback to name lookup
        // Refresh id map after possible new registrations
        const idMap = new Map(seenTeamIds); // ss_id → name (from payload)
        // Also build name→id map for fallback
        const nameMap = {};
        for (const [id, name] of idMap) nameMap[normTeam(name)] = id;
        // Pull any pre-existing name→id mappings not in today's payload
        const allTeamRows = await env.SB_DB.prepare('SELECT ss_team_id, team_name_norm FROM sofascore_teams').all();
        for (const r of (allTeamRows.results || [])) {
          if (!nameMap[r.team_name_norm]) nameMap[r.team_name_norm] = r.ss_team_id;
        }

        const BATCH = 100;
        let inserted = 0;
        for (let i = 0; i < games.length; i += BATCH) {
          const slice = games.slice(i, i + BATCH);
          const stmts = slice.map(g => {
            // Prefer native ID from payload, fallback to name lookup
            const homeId = g.home_ss_id ?? nameMap[normTeam(g.home_team)] ?? null;
            const awayId = g.away_ss_id ?? nameMap[normTeam(g.away_team)] ?? null;
            return env.SB_DB.prepare(
              `INSERT OR REPLACE INTO ss_daily_games
                 (game_date, home_team, away_team, home_team_id, away_team_id, league, kickoff_ts)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(dateParam, g.home_team, g.away_team, homeId, awayId, g.league || '', g.kickoff_ts ?? null);
          });
          const results = await env.SB_DB.batch(stmts);
          inserted += results.filter(r => r.success).length;
        }

        return new Response(JSON.stringify({
          ok: true, date: dateParam,
          total: games.length, inserted,
          new_teams_registered: newTeams.length,
          new_teams: newTeams,   // ← scraper usa para disparar backfill
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /v1/sofascore/daily-intel?date=YYYY-MM-DD — all football games today + match intelligence
    // Games are pre-loaded from ss_daily_games (populated by self-hosted runner).
    // Fallback: pick_history (Bet365 picks scraped today).
    if (pathname === '/v1/sofascore/daily-intel' && request.method === 'GET') {
      try {
        const dateParam      = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        const includeProfiles = url.searchParams.get('include_profiles') === '1' || url.searchParams.get('debug') === '1';
        const normTeam  = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // --- 1. Primary: ss_daily_games (pre-ingested by self-hosted runner) ---
        const allGames = [];
        const seen     = new Set();
        if (env.SB_DB) {
          try {
            const rows = await env.SB_DB.prepare(
              'SELECT home_team, away_team, home_team_id, away_team_id, league, kickoff_ts FROM ss_daily_games WHERE game_date = ?'
            ).bind(dateParam).all();
            for (const r of (rows.results || [])) {
              const key = `${normTeam(r.home_team)}|${normTeam(r.away_team)}`;
              if (!seen.has(key)) {
                seen.add(key);
                allGames.push({
                  home_team: r.home_team,
                  away_team: r.away_team,
                  league:    r.league || '',
                  kickoff:   r.kickoff_ts ? new Date(r.kickoff_ts * 1000).toISOString() : null,
                  source:    'sofascore',
                  homeId:    r.home_team_id,
                  awayId:    r.away_team_id,
                });
              }
            }
          } catch (_e) { /* table may not exist yet */ }
        }

        // --- 2. Fallback: picks from D1 (with team ID lookup) ---
        if (env.SB_DB) {
          try {
            // Only load teamMap if we need the fallback
            const teamMap = {};
            if (allGames.length === 0) {
              const teamRows = await env.SB_DB.prepare('SELECT ss_team_id, team_name_norm FROM sofascore_teams').all();
              for (const r of (teamRows.results || [])) teamMap[r.team_name_norm] = r.ss_team_id;
            }
            const pickRows = await env.SB_DB.prepare(
              "SELECT DISTINCT home_team, away_team FROM pick_history WHERE DATE(created_at) = ? AND sport = 'football'"
            ).bind(dateParam).all();
            for (const r of (pickRows.results || [])) {
              const key = `${normTeam(r.home_team)}|${normTeam(r.away_team)}`;
              if (!seen.has(key) && r.home_team && r.away_team) {
                seen.add(key);
                allGames.push({
                  home_team: r.home_team,
                  away_team: r.away_team,
                  league:    '',
                  kickoff:   null,
                  source:    'pick_history',
                  homeId:    teamMap[normTeam(r.home_team)] ?? null,
                  awayId:    teamMap[normTeam(r.away_team)] ?? null,
                });
              }
            }
          } catch (_e) { /* ignore */ }
        }

        // --- 3. Load match intelligence: bulk loader (primary) with capped-parallel fallback ---
        // P2.3: Bulk loader makes ~4-14 D1 queries total regardless of game count.
        // Eliminates the 421×5=2105 subrequests bottleneck (CF limit = 1000).
        let settled = [];
        let bulkCoverage = null;
        let intelMode = 'bulk';

        try {
          const { loadDailyIntelBulk } = await import('./services/sofascoreIntelBulk.js');
          const bulk = await loadDailyIntelBulk(allGames, env);
          bulkCoverage = bulk.coverage;

          // Map bulk results back to settled array shape (matching original index order)
          settled = allGames.map(g => {
            if (!g.homeId || !g.awayId) return { status: 'fulfilled', value: null };
            const intel = bulk.gameIntelMap.get(`${g.homeId}|${g.awayId}`);
            return { status: 'fulfilled', value: intel ?? null };
          });
        } catch (bulkErr) {
          // Fallback: capped parallel (same as P2.2 fix)
          intelMode = 'fallback_capped';
          console.warn('[daily-intel] bulk loader failed, falling back to capped parallel:', bulkErr?.message);
          const { getMatchIntelligence } = await import('./services/sofascoreFeatures.js');
          const INTEL_D1_BUDGET   = 990;
          const INTEL_QUERIES_PER = 5;
          const INTEL_MAX_GAMES   = Math.floor(INTEL_D1_BUDGET / INTEL_QUERIES_PER); // 198
          const intelGames    = allGames.slice(0, INTEL_MAX_GAMES);
          const settled_intel = await Promise.allSettled(
            intelGames.map(g =>
              g.homeId && g.awayId
                ? getMatchIntelligence(g.homeId, g.awayId, env)
                : Promise.resolve(null)
            )
          );
          settled = [
            ...settled_intel,
            ...allGames.slice(INTEL_MAX_GAMES).map(() => ({ status: 'fulfilled', value: null })),
          ];
        }

        // --- 4. Build response ---
        const results = allGames.map((g, i) => {
          const outcome = settled[i];
          const intel   = outcome?.status === 'fulfilled' ? outcome.value : null;

          let intel_summary = null;
          if (intel) {
            const homeAtHome = intel.homeAtHome || {};
            const awayOnRoad = intel.awayOnRoad || {};
            const combined   = intel.combined   || {};
            const homeRecent = (intel.home || {}).recentForm5 || {};
            const awayRecent = (intel.away || {}).recentForm5 || {};
            const h2h        = intel.h2h        || {};

            const bttsRate   = combined.bttsRate   ?? null;
            const over25Rate = combined.over25Rate  ?? null;
            const homeWR     = homeAtHome.winRate   ?? null;
            const awayWR     = awayOnRoad.winRate   ?? null;

            let recommendation = null;
            if (bttsRate !== null && bttsRate >= 0.60)          recommendation = 'BTTS';
            else if (over25Rate !== null && over25Rate >= 0.60)  recommendation = 'Over 2.5';
            else if (homeWR    !== null && homeWR    >= 0.60)    recommendation = 'Home Win';
            else if (awayWR    !== null && awayWR    >= 0.50)    recommendation = 'Away Win';
            else if (bttsRate  !== null && bttsRate  <= 0.35)    recommendation = 'Under / BTTS No';

            intel_summary = {
              confidence:             intel.confidence,  // P2.1: usa intel real em vez de h2h.totalMatches proxy
              h2h_confidence:         intel.h2h_confidence ?? null,
              home_win_rate_at_home:  homeWR,
              away_win_rate_on_road:  awayWR,
              btts_rate:              bttsRate,
              over25_rate:            over25Rate,
              home_in_form:           homeRecent.inForm ?? null,
              away_in_form:           awayRecent.inForm ?? null,
              h2h_matches:            h2h.totalMatches ?? 0,
              h2h_home_win_pct:       h2h.homeTeamWinRate ?? null,
              h2h_btts_pct:           h2h.bttsRate        ?? null,
              recommendation,
            };
          }

          const entry = {
            home_team:     g.home_team,
            away_team:     g.away_team,
            league:        g.league,
            kickoff:       g.kickoff,
            source:        g.source,
            homeId:        g.homeId,
            awayId:        g.awayId,
            matched:       !!(g.homeId && g.awayId && intel),
            intel_summary,
          };

          // P2.4: Include full match intelligence profile when explicitly requested
          if (includeProfiles && intel?.matchProfile) {
            entry.match_intelligence_profile = intel.matchProfile;
          }
          // Compact team profiles (labels + scores only, not full match profile)
          if (includeProfiles && intel) {
            if (intel.homeProfile) entry.home_profile_compact = {
              confidence: intel.homeProfile.data_quality?.confidence,
              dataQualityScore: intel.homeProfile.data_quality?.dataQualityScore,
              form_trend: intel.homeProfile.form?.trend,
              form_score: intel.homeProfile.form?.form_score,
              btts_rate: intel.homeProfile.btts?.rate,
              labels: intel.homeProfile.labels,
              summary_pt: intel.homeProfile.summary_pt,
            };
            if (intel.awayProfile) entry.away_profile_compact = {
              confidence: intel.awayProfile.data_quality?.confidence,
              dataQualityScore: intel.awayProfile.data_quality?.dataQualityScore,
              form_trend: intel.awayProfile.form?.trend,
              form_score: intel.awayProfile.form?.form_score,
              btts_rate: intel.awayProfile.btts?.rate,
              labels: intel.awayProfile.labels,
              summary_pt: intel.awayProfile.summary_pt,
            };
          }

          return entry;
        });

        // ── P2.3: historical coverage debug ──────────────────────────────────
        const withIntel     = results.filter(r => r.intel_summary);
        const highConf      = withIntel.filter(r => r.intel_summary.confidence === 'high').length;
        const lowConf       = withIntel.filter(r => r.intel_summary.confidence === 'low').length;
        const noneConf      = withIntel.filter(r => r.intel_summary.confidence === 'none').length;
        const withBtts      = withIntel.filter(r => r.intel_summary.btts_rate !== null).length;
        const withRec       = results.filter(r => r.intel_summary?.recommendation).length;
        const recBreakdown  = {};
        for (const r of results) {
          const rec = r.intel_summary?.recommendation;
          if (rec) recBreakdown[rec] = (recBreakdown[rec] || 0) + 1;
        }

        return new Response(JSON.stringify({
          ok:            true,
          date:          dateParam,
          total_games:   results.length,
          matched_games: results.filter(r => r.matched).length,
          coverage_debug: {
            mode: intelMode,
            total_games: results.length,
            processed_games: withIntel.length,
            skipped_games: results.length - withIntel.length,
            fallback_cap_used: intelMode !== 'bulk',
            ...(bulkCoverage ? {
              bulk_queries_used: bulkCoverage.queriesUsed,
              teams_requested: bulkCoverage.teamIdsRequested,
              teams_loaded: bulkCoverage.teamsLoaded,
              matches_loaded: bulkCoverage.matchesLoaded,
              avg_matches_per_team: bulkCoverage.avgMatchesPerTeam,
              h2h_pairs_requested: bulkCoverage.h2hPairsRequested,
              h2h_pairs_with_matches: bulkCoverage.h2hPairsWithMatches,
              h2h_coverage_pct: bulkCoverage.h2hPairsRequested > 0
                ? +(bulkCoverage.h2hPairsWithMatches / bulkCoverage.h2hPairsRequested * 100).toFixed(1)
                : 0,
              bulk_duration_ms: bulkCoverage.durationMs,
              // P2.4 profile stats
              profiles_built: bulkCoverage.profiles_built ?? null,
              profiles_high_confidence: bulkCoverage.profiles_high_confidence ?? null,
              profiles_low_data_quality: bulkCoverage.profiles_low_data_quality ?? null,
              avg_data_quality_score: bulkCoverage.avg_data_quality_score ?? null,
            } : { intel_max_games: 198 }),
            confidence_high: highConf,
            confidence_low:  lowConf,
            confidence_none: noneConf,
            with_btts_rate:    withBtts,
            missing_btts_rate: withIntel.length - withBtts,
            with_recommendation: withRec,
            recommendation_breakdown: recBreakdown,
          },
          games:         results,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/migrate — cria tabelas novas (one-time, idempotente)
    if (pathname === '/internal/admin/migrate' && request.method === 'POST') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        if (!env.SB_INGEST_SECRET || ingestSecret !== env.SB_INGEST_SECRET) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }
        await env.SB_DB.prepare(`CREATE TABLE IF NOT EXISTS ss_daily_games (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          game_date    TEXT NOT NULL,
          home_team    TEXT NOT NULL,
          away_team    TEXT NOT NULL,
          home_team_id INTEGER,
          away_team_id INTEGER,
          league       TEXT,
          kickoff_ts   INTEGER,
          created_at   TEXT DEFAULT (datetime('now'))
        )`).run();
        await env.SB_DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ss_daily_games_unique ON ss_daily_games(game_date, home_team, away_team)`).run();
        await env.SB_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ss_daily_games_date ON ss_daily_games(game_date)`).run();
        return new Response(JSON.stringify({ ok: true, message: 'ss_daily_games created/verified' }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/migrate-p33 — P3.3 audit columns migration (idempotent)
    if (pathname === '/internal/admin/migrate-p33' && request.method === 'POST') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        const adminKey     = request.headers.get('X-Admin-Key') || '';
        const hasMaster    = env.SB_MASTER_KEY && (adminKey === env.SB_MASTER_KEY || ingestSecret === env.SB_MASTER_KEY || ingestSecret === env.SB_INGEST_SECRET);
        if (!hasMaster) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }

        // Run each ALTER TABLE in its own try-catch so duplicate columns don't abort the batch
        const results = [];
        const stmts = [
          // premium_pick_exposures — audit columns
          `ALTER TABLE premium_pick_exposures ADD COLUMN trust_level TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN pick_audit_status TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN can_post INTEGER`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN source_family TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN generated_by TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN odds_source TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN source_confidence TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN data_quality_score REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN golden_support_score REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN golden_score REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN golden_audit_status TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN resolvability_status TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN audit_reasons_json TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN evidence_missing_json TEXT`,
          // indexes for premium_pick_exposures
          `CREATE INDEX IF NOT EXISTS idx_ppe_audit_status ON premium_pick_exposures(pick_audit_status)`,
          `CREATE INDEX IF NOT EXISTS idx_ppe_trust_level ON premium_pick_exposures(trust_level)`,
          `CREATE INDEX IF NOT EXISTS idx_ppe_source_family ON premium_pick_exposures(source_family)`,
          `CREATE INDEX IF NOT EXISTS idx_ppe_golden_status ON premium_pick_exposures(golden_audit_status)`,
          `CREATE INDEX IF NOT EXISTS idx_ppe_can_post ON premium_pick_exposures(can_post)`,
          // premium_combo_exposures — audit columns
          `ALTER TABLE premium_combo_exposures ADD COLUMN trust_level TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN pick_audit_status TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN can_post INTEGER`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN source_family TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN odds_source TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN source_confidence TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN min_data_quality_score REAL`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN avg_data_quality_score REAL`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN min_golden_support_score REAL`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN avg_golden_support_score REAL`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN golden_score REAL`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN golden_audit_status TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN estimated_return_050 REAL`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN weak_legs_count INTEGER DEFAULT 0`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN blocked_legs_count INTEGER DEFAULT 0`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN partial_legs_count INTEGER DEFAULT 0`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN audit_reasons_json TEXT`,
          // indexes for premium_combo_exposures
          `CREATE INDEX IF NOT EXISTS idx_pce_audit_status ON premium_combo_exposures(pick_audit_status)`,
          `CREATE INDEX IF NOT EXISTS idx_pce_trust_level ON premium_combo_exposures(trust_level)`,
          `CREATE INDEX IF NOT EXISTS idx_pce_source_family ON premium_combo_exposures(source_family)`,
        ];

        for (const sql of stmts) {
          try {
            await env.SB_DB.prepare(sql).run();
            results.push({ sql: sql.slice(0, 60), ok: true });
          } catch (e) {
            // "duplicate column" = already migrated → treat as ok
            const isDup = /duplicate column/i.test(e.message || '');
            results.push({ sql: sql.slice(0, 60), ok: isDup, skipped: isDup, error: isDup ? undefined : e.message });
          }
        }

        const failed = results.filter(r => !r.ok);
        return new Response(JSON.stringify({
          ok: failed.length === 0,
          total: stmts.length,
          applied: results.filter(r => r.ok && !r.skipped).length,
          skipped: results.filter(r => r.skipped).length,
          failed: failed.length,
          results,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/migrate-p35 — P3.5 / DM3 Market Availability migration (idempotent)
    if (pathname === '/internal/admin/migrate-p35' && request.method === 'POST') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        const adminKey     = request.headers.get('X-Admin-Key') || '';
        const hasMaster    = env.SB_MASTER_KEY && (adminKey === env.SB_MASTER_KEY || ingestSecret === env.SB_MASTER_KEY || ingestSecret === env.SB_INGEST_SECRET);
        if (!hasMaster) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }

        const results = [];
        const stmts = [
          // market_availability table
          `CREATE TABLE IF NOT EXISTS market_availability (
            id TEXT PRIMARY KEY,
            fixture_id TEXT,
            bet365_event_id TEXT,
            sport TEXT,
            league TEXT,
            bookmaker TEXT NOT NULL,
            market TEXT NOT NULL,
            normalized_market TEXT,
            selection TEXT,
            normalized_selection TEXT,
            line REAL,
            period TEXT,
            player_name TEXT,
            normalized_player_name TEXT,
            team_name TEXT,
            normalized_team_name TEXT,
            available INTEGER NOT NULL DEFAULT 1,
            first_seen_at TEXT,
            last_seen_at TEXT,
            source TEXT,
            source_confidence TEXT,
            raw_ref TEXT,
            raw_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          // indexes
          `CREATE INDEX IF NOT EXISTS idx_mav_fixture ON market_availability(fixture_id)`,
          `CREATE INDEX IF NOT EXISTS idx_mav_bet365_event ON market_availability(bet365_event_id)`,
          `CREATE INDEX IF NOT EXISTS idx_mav_market ON market_availability(normalized_market)`,
          `CREATE INDEX IF NOT EXISTS idx_mav_selection ON market_availability(normalized_selection)`,
          `CREATE INDEX IF NOT EXISTS idx_mav_bookmaker ON market_availability(bookmaker)`,
          `CREATE INDEX IF NOT EXISTS idx_mav_last_seen ON market_availability(last_seen_at)`,
          `CREATE INDEX IF NOT EXISTS idx_mav_player ON market_availability(normalized_player_name)`,
        ];

        for (const sql of stmts) {
          try {
            await env.SB_DB.prepare(sql).run();
            results.push({ sql: sql.slice(0, 60), ok: true });
          } catch (e) {
            const isExisting = /already exists|duplicate/i.test(e.message || '');
            results.push({ sql: sql.slice(0, 60), ok: isExisting, skipped: isExisting, error: isExisting ? undefined : e.message });
          }
        }

        const failed = results.filter(r => !r.ok);
        return new Response(JSON.stringify({
          ok: failed.length === 0,
          total: stmts.length,
          applied: results.filter(r => r.ok && !r.skipped).length,
          skipped: results.filter(r => r.skipped).length,
          failed: failed.length,
          results,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/migrate-p351 — P3.5.1 Fixture Identity columns (idempotent)
    if (pathname === '/internal/admin/migrate-p351' && request.method === 'POST') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        const adminKey     = request.headers.get('X-Admin-Key') || '';
        const hasMaster    = env.SB_MASTER_KEY && (adminKey === env.SB_MASTER_KEY || ingestSecret === env.SB_MASTER_KEY || ingestSecret === env.SB_INGEST_SECRET);
        if (!hasMaster) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }

        const results = [];
        const stmts = [
          // premium_pick_exposures — fixture identity columns
          `ALTER TABLE premium_pick_exposures ADD COLUMN bet365_event_id TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN source_event_id TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN identity_confidence TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN identity_source TEXT`,
          // indexes
          `CREATE INDEX IF NOT EXISTS idx_ppe_bet365_event ON premium_pick_exposures(bet365_event_id)`,
          `CREATE INDEX IF NOT EXISTS idx_ppe_identity_conf ON premium_pick_exposures(identity_confidence)`,
          // premium_combo_exposures — fixture identity columns
          `ALTER TABLE premium_combo_exposures ADD COLUMN fixture_ids_json TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN bet365_event_ids_json TEXT`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN identity_missing_count INTEGER DEFAULT 0`,
          `ALTER TABLE premium_combo_exposures ADD COLUMN identity_confidence_min TEXT`,
          // indexes
          `CREATE INDEX IF NOT EXISTS idx_pce_identity_conf ON premium_combo_exposures(identity_confidence_min)`,
        ];

        for (const sql of stmts) {
          try {
            await env.SB_DB.prepare(sql).run();
            results.push({ sql: sql.slice(0, 60), ok: true });
          } catch (e) {
            const isDup = /duplicate column|already exists/i.test(e.message || '');
            results.push({ sql: sql.slice(0, 60), ok: isDup, skipped: isDup, error: isDup ? undefined : e.message });
          }
        }

        const failed = results.filter(r => !r.ok);
        return new Response(JSON.stringify({
          ok: failed.length === 0,
          total: stmts.length,
          applied: results.filter(r => r.ok && !r.skipped).length,
          skipped: results.filter(r => r.skipped).length,
          failed: failed.length,
          results,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/365scores-backfill — F2.53: shots play-by-play (BR-A/B + CONMEBOL Lib/Sud)
    if (pathname === '/internal/admin/365scores-backfill' && request.method === 'POST') {
      try {
        const adminKey = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key') || '';
        const hasMaster = !env.SB_MASTER_KEY || adminKey === env.SB_MASTER_KEY;
        if (!hasMaster) return new Response('Unauthorized', { status: 401 });
        const url = new URL(request.url);
        const fromDate = url.searchParams.get('from');
        const toDate = url.searchParams.get('to');
        const compsParam = url.searchParams.get('competitions');
        const competitionIds = compsParam ? compsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite) : null;
        const { backfill365Scores } = await import('./cron/scores365Ingest.js');
        const result = await backfill365Scores(env, {
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          competitionIds,
        });
        return new Response(JSON.stringify({ ok: true, ...result }, null, 2), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack?.slice(0, 500) }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/cartola-backfill — F2.52: Brasileirão player stats via Cartola FC
    if (pathname === '/internal/admin/cartola-backfill' && request.method === 'POST') {
      try {
        const adminKey = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key') || '';
        const hasMaster = !env.SB_MASTER_KEY || adminKey === env.SB_MASTER_KEY;
        if (!hasMaster) return new Response('Unauthorized', { status: 401 });
        const url = new URL(request.url);
        const fromRodada = parseInt(url.searchParams.get('from') || '1', 10);
        const toRodada = parseInt(url.searchParams.get('to') || '38', 10);
        const season = url.searchParams.get('season') ? parseInt(url.searchParams.get('season'), 10) : null;
        const { backfillCartola } = await import('./cron/cartolaIngest.js');
        const result = await backfillCartola(env, { fromRodada, toRodada, season });
        return new Response(JSON.stringify({ ok: true, ...result }, null, 2), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack?.slice(0, 500) }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/boxscore-backfill — F2.51: re-fetcha ESPN /summary p/ jogos status=post sem mtm
    if (pathname === '/internal/admin/boxscore-backfill' && request.method === 'POST') {
      try {
        const adminKey = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key') || '';
        const hasMaster = !env.SB_MASTER_KEY || adminKey === env.SB_MASTER_KEY;
        if (!hasMaster) return new Response('Unauthorized', { status: 401 });
        const url = new URL(request.url);
        const limit = parseInt(url.searchParams.get('limit') || '80', 10);
        const leaguesParam = url.searchParams.get('leagues');
        const leagueFilter = leaguesParam ? leaguesParam.split(',').map(s => s.trim()).filter(Boolean) : null;
        const { runBoxscoreBackfill } = await import('./cron/ingestMatches.js');
        const result = await runBoxscoreBackfill(env, { leagueFilter, limit });
        return new Response(JSON.stringify({ ok: true, ...result }, null, 2), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack?.slice(0, 500) }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /internal/admin/stats-tables-check — F2.50: verifica match_team_metrics + shot_events + corner_events
    if (pathname === '/internal/admin/stats-tables-check' && request.method === 'GET') {
      try {
        const adminKey = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key') || '';
        const hasMaster = !env.SB_MASTER_KEY || adminKey === env.SB_MASTER_KEY;
        if (!hasMaster) return new Response('Unauthorized', { status: 401 });
        if (!env.SB_DB) return new Response(JSON.stringify({ error: 'no db' }), { status: 500, headers: corsHeaders() });

        const safe = (q, p = []) => env.SB_DB.prepare(q).bind(...p).first().catch(e => ({ _err: e.message }));
        const safeAll = (q, p = []) => env.SB_DB.prepare(q).bind(...p).all().catch(e => ({ results: [], _err: e.message }));

        const [mtmTotal, mtmBrazil, seTotal, ceTotal, brazilSample] = await Promise.all([
          safe('SELECT COUNT(*) as n FROM match_team_metrics'),
          safe(`SELECT COUNT(*) as n FROM match_team_metrics WHERE team_norm LIKE '%palmeiras%' OR team_norm LIKE '%flamengo%' OR team_norm LIKE '%cruzeiro%' OR team_norm LIKE '%fluminense%' OR team_norm LIKE '%botafogo%' OR team_norm LIKE '%corinthians%' OR team_norm LIKE '%santos%' OR team_norm LIKE '%gremio%' OR team_norm LIKE '%internacional%'`),
          safe('SELECT COUNT(*) as n FROM shot_events'),
          safe('SELECT COUNT(*) as n FROM corner_events'),
          safeAll(`SELECT team_norm, shots, shots_on_target, corners, match_id FROM match_team_metrics WHERE (team_norm LIKE '%palmeiras%' OR team_norm LIKE '%cruzeiro%' OR team_norm LIKE '%flamengo%') ORDER BY id DESC LIMIT 10`),
        ]);

        return new Response(JSON.stringify({
          ok: true,
          match_team_metrics: { total: mtmTotal?.n ?? 0, brazilian: mtmBrazil?.n ?? 0, err: mtmTotal?._err ?? mtmBrazil?._err ?? null },
          shot_events:        { total: seTotal?.n ?? 0, err: seTotal?._err ?? null },
          corner_events:      { total: ceTotal?.n ?? 0, err: ceTotal?._err ?? null },
          brazilian_sample:   brazilSample?.results ?? [],
        }, null, 2), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /internal/admin/market-avail-check — diagnose market_availability table (P3.5.1)
    if (pathname === '/internal/admin/market-avail-check' && request.method === 'GET') {
      try {
        const adminKey = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key') || '';
        const hasMaster = !env.SB_MASTER_KEY || adminKey === env.SB_MASTER_KEY;
        if (!hasMaster) return new Response('Unauthorized', { status: 401 });
        if (!env.SB_DB) return new Response(JSON.stringify({ error: 'no db' }), { status: 500, headers: corsHeaders() });

        const [total, withB365, withFixId, sample] = await Promise.all([
          env.SB_DB.prepare('SELECT COUNT(*) as n FROM market_availability').first().catch(e => ({ n: 0, err: e.message })),
          env.SB_DB.prepare('SELECT COUNT(*) as n FROM market_availability WHERE bet365_event_id IS NOT NULL').first().catch(e => ({ n: 0 })),
          env.SB_DB.prepare('SELECT COUNT(*) as n FROM market_availability WHERE fixture_id IS NOT NULL').first().catch(e => ({ n: 0 })),
          env.SB_DB.prepare('SELECT * FROM market_availability LIMIT 3').all().catch(e => ({ results: [], err: e.message })),
        ]);

        // Test ingest with a real dummy pick
        const { ingestMarketAvailabilityBatch, extractMarketRecordsFromPick } = await import('./services/marketAvailability.js');
        const testPick = {
          // P3.9 R6K-B: market label trocado para "Resultado Final" (consistente
          // com premiumPicks.js mapper). Test dummy, sem impacto em produção.
          stat: '1X2', market: 'Resultado Final',
          selection: 'home', direction: 'home',
          bet365_event_id: 'TEST_9999', fixture_id: null,
          bet365: true, _is_direct_b365: true, source: 'test',
        };
        const testRecords = extractMarketRecordsFromPick(testPick);
        let ingestResult = null;
        if (testRecords.length > 0) {
          ingestResult = await ingestMarketAvailabilityBatch(testRecords, env);
          // Clean up test record
          await env.SB_DB.prepare("DELETE FROM market_availability WHERE bet365_event_id = 'TEST_9999'").run().catch(() => {});
        }

        return new Response(JSON.stringify({
          ok: true,
          total_rows: total?.n ?? 0,
          with_bet365_event_id: withB365?.n ?? 0,
          with_fixture_id: withFixId?.n ?? 0,
          sample_rows: sample?.results ?? [],
          table_error: total?.err ?? null,
          test_extract_records: testRecords.length,
          test_ingest_result: ingestResult,
        }, null, 2), { status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/migrate-p36 — P3.6 / DM2 Odds Snapshots migration (idempotent)
    if (pathname === '/internal/admin/migrate-p36' && request.method === 'POST') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        const adminKey     = request.headers.get('X-Admin-Key') || '';
        const hasMaster    = env.SB_MASTER_KEY && (adminKey === env.SB_MASTER_KEY || ingestSecret === env.SB_MASTER_KEY || ingestSecret === env.SB_INGEST_SECRET);
        if (!hasMaster) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }

        const results = [];
        const stmts = [
          // ── market_odds_snapshots table ────────────────────────────────────
          `CREATE TABLE IF NOT EXISTS market_odds_snapshots (
            id TEXT PRIMARY KEY,
            fixture_id TEXT,
            bet365_event_id TEXT,
            source_event_id TEXT,
            sport TEXT,
            league TEXT,
            bookmaker TEXT NOT NULL,
            market TEXT NOT NULL,
            normalized_market TEXT,
            selection TEXT,
            normalized_selection TEXT,
            line REAL,
            period TEXT,
            player_name TEXT,
            normalized_player_name TEXT,
            odd REAL NOT NULL,
            implied_probability REAL,
            captured_at TEXT NOT NULL,
            source TEXT,
            source_confidence TEXT,
            raw_ref TEXT,
            raw_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          // ── indexes ────────────────────────────────────────────────────────
          `CREATE INDEX IF NOT EXISTS idx_odds_snap_fixture   ON market_odds_snapshots(fixture_id)`,
          `CREATE INDEX IF NOT EXISTS idx_odds_snap_bet365    ON market_odds_snapshots(bet365_event_id)`,
          `CREATE INDEX IF NOT EXISTS idx_odds_snap_market    ON market_odds_snapshots(normalized_market)`,
          `CREATE INDEX IF NOT EXISTS idx_odds_snap_selection ON market_odds_snapshots(normalized_selection)`,
          `CREATE INDEX IF NOT EXISTS idx_odds_snap_bookmaker ON market_odds_snapshots(bookmaker)`,
          `CREATE INDEX IF NOT EXISTS idx_odds_snap_captured  ON market_odds_snapshots(captured_at)`,
          `CREATE INDEX IF NOT EXISTS idx_odds_snap_bk_mkt_time ON market_odds_snapshots(bookmaker, normalized_market, captured_at)`,
          // ── CLV columns on premium_pick_exposures ──────────────────────────
          `ALTER TABLE premium_pick_exposures ADD COLUMN entry_odd REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN entry_line REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN entry_captured_at TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN odds_snapshot_id TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN opening_odd REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN latest_odd REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN closing_odd REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN clv_pct REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN clv_status TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN odds_movement_direction TEXT`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN odds_movement_pct REAL`,
          `ALTER TABLE premium_pick_exposures ADD COLUMN snapshots_count INTEGER`,
        ];

        for (const sql of stmts) {
          try {
            await env.SB_DB.prepare(sql).run();
            results.push({ sql: sql.trim().slice(0, 70), ok: true });
          } catch (e) {
            // "duplicate column" / "already exists" = already migrated → ok
            const isDup = /duplicate column|already exists/i.test(e.message || '');
            results.push({ sql: sql.trim().slice(0, 70), ok: isDup, skipped: isDup, error: isDup ? undefined : e.message });
          }
        }

        const failed = results.filter(r => !r.ok);
        return new Response(JSON.stringify({
          ok: failed.length === 0,
          total: stmts.length,
          applied: results.filter(r => r.ok && !r.skipped).length,
          skipped: results.filter(r => r.skipped).length,
          failed: failed.length,
          results,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // POST /internal/admin/migrate-p37 — P3.7 Shadow Betting migration (idempotent)
    if (pathname === '/internal/admin/migrate-p37' && request.method === 'POST') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        const adminKey     = request.headers.get('X-Admin-Key') || '';
        const hasMaster    = env.SB_MASTER_KEY && (adminKey === env.SB_MASTER_KEY || ingestSecret === env.SB_MASTER_KEY || ingestSecret === env.SB_INGEST_SECRET);
        if (!hasMaster) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }

        const results = [];
        const stmts = [
          // ── shadow_bets table ──────────────────────────────────────────────
          `CREATE TABLE IF NOT EXISTS shadow_bets (
            id TEXT PRIMARY KEY,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            pick_date TEXT,
            source_pick_id TEXT,
            source_combo_id TEXT,
            fixture_id TEXT,
            bet365_event_id TEXT,
            sport TEXT,
            league TEXT,
            home_team TEXT,
            away_team TEXT,
            kickoff TEXT,
            tier TEXT,
            source_family TEXT,
            method_family TEXT,
            is_combo INTEGER DEFAULT 0,
            legs_count INTEGER,
            market TEXT,
            selection TEXT,
            line REAL,
            period TEXT,
            player_name TEXT,
            odd REAL,
            combined_odd REAL,
            stake_simulated REAL DEFAULT 0.50,
            potential_return REAL,
            potential_profit REAL,
            audit_status TEXT,
            trust_level TEXT,
            can_post INTEGER,
            bet_confidence_score REAL,
            bet_confidence_tier TEXT,
            golden_score REAL,
            golden_support_score REAL,
            premium_quality_score REAL,
            combo_quality_score REAL,
            data_quality_score REAL,
            market_available INTEGER,
            availability_confidence TEXT,
            odds_snapshot_id TEXT,
            entry_odd REAL,
            entry_line REAL,
            entry_captured_at TEXT,
            latest_odd REAL,
            closing_odd REAL,
            clv_pct REAL,
            clv_status TEXT,
            result_status TEXT DEFAULT 'pending',
            result_source TEXT,
            result_confidence TEXT,
            profit_unit REAL,
            profit_brl REAL,
            settled_at TEXT,
            training_eligible INTEGER DEFAULT 0,
            monetization_eligible INTEGER DEFAULT 0,
            notes_json TEXT
          )`,
          // ── indexes ────────────────────────────────────────────────────────
          `CREATE INDEX IF NOT EXISTS idx_shadow_bets_pick_date   ON shadow_bets(pick_date)`,
          `CREATE INDEX IF NOT EXISTS idx_shadow_bets_status      ON shadow_bets(result_status)`,
          `CREATE INDEX IF NOT EXISTS idx_shadow_bets_src_family  ON shadow_bets(source_family)`,
          `CREATE INDEX IF NOT EXISTS idx_shadow_bets_confidence  ON shadow_bets(bet_confidence_tier)`,
          `CREATE INDEX IF NOT EXISTS idx_shadow_bets_audit       ON shadow_bets(audit_status, trust_level)`,
          `CREATE INDEX IF NOT EXISTS idx_shadow_bets_fixture     ON shadow_bets(fixture_id)`,
          // ── bankroll_sessions table ────────────────────────────────────────
          `CREATE TABLE IF NOT EXISTS bankroll_sessions (
            id TEXT PRIMARY KEY,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            date TEXT,
            bankroll_start REAL,
            bankroll_current REAL,
            bankroll_currency TEXT DEFAULT 'BRL',
            daily_loss_limit REAL,
            daily_win_stop REAL,
            max_bets_per_day INTEGER,
            bets_taken INTEGER DEFAULT 0,
            profit_brl REAL DEFAULT 0,
            status TEXT DEFAULT 'active'
          )`,
        ];

        for (const sql of stmts) {
          try {
            await env.SB_DB.prepare(sql).run();
            results.push({ sql: sql.trim().slice(0, 70), ok: true });
          } catch (e) {
            const isDup = /duplicate column|already exists/i.test(e.message || '');
            results.push({ sql: sql.trim().slice(0, 70), ok: isDup, skipped: isDup, error: isDup ? undefined : e.message });
          }
        }

        const failed = results.filter(r => !r.ok);
        return new Response(JSON.stringify({
          ok: failed.length === 0,
          total: stmts.length,
          applied: results.filter(r => r.ok && !r.skipped).length,
          skipped: results.filter(r => r.skipped).length,
          failed: failed.length,
          results,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // DELETE /internal/sofascore/teams — remove garbage teams from D1
    if (pathname === '/internal/sofascore/teams' && request.method === 'DELETE') {
      try {
        const ingestSecret = request.headers.get('X-Ingest-Secret') || '';
        if (!env.SB_INGEST_SECRET || ingestSecret !== env.SB_INGEST_SECRET) {
          return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
        }
        if (!env.SB_DB) {
          return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
        }
        const body = await request.json().catch(() => ({}));
        const ids = (body.team_ids || []).map(Number).filter(n => n > 0);
        if (ids.length === 0) {
          return new Response(JSON.stringify({ ok: false, error: 'team_ids array required' }), { status: 400, headers: corsHeaders() });
        }
        const placeholders = ids.map(() => '?').join(',');
        const [r1, r2] = await Promise.all([
          env.SB_DB.prepare(`DELETE FROM sofascore_teams WHERE ss_team_id IN (${placeholders})`).bind(...ids).run(),
          env.SB_DB.prepare(`DELETE FROM sofascore_team_matches WHERE ss_team_id IN (${placeholders})`).bind(...ids).run(),
        ]);
        return new Response(JSON.stringify({
          ok: true,
          teams_deleted: r1.meta?.changes ?? 0,
          matches_deleted: r2.meta?.changes ?? 0,
          deleted_ids: ids,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /v1/admin/historical-intel-debug?teams=Tottenham,Leeds — testa pipeline de intel
    if (pathname === '/v1/admin/historical-intel-debug' && request.method === 'GET') {
      try {
        const teamsParam = url.searchParams.get('teams') || 'Tottenham,Leeds United';
        const names = teamsParam.split(',').map(s => s.trim()).filter(Boolean);
        const _normTeam = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const _coreTeamName = s => {
          const n = _normTeam(s);
          const prefixes = ['ssc','afc','rsc','bsc','fck','vfb','vfl','rb','cd','ud','cf','nk','sk','fk','rfk','ac','as','ss','sc','fc','rfc','psc','csf','svfc','svww','fca','rcf'];
          for (const pfx of prefixes) { if (n.startsWith(pfx) && n.length > pfx.length) return n.slice(pfx.length); }
          const suffixes = ['hotspur','united','city','town','rovers','wanderers','athletic','villa','county','rangers','dynamo','sporting','lokomotiv'];
          for (const sfx of suffixes) { if (n.endsWith(sfx) && n.length > sfx.length + 3) return n.slice(0, n.length - sfx.length); }
          return n;
        };
        const teamRows = await env.SB_DB.prepare('SELECT ss_team_id, team_name FROM sofascore_teams').all();
        const total_teams_in_db = teamRows.results?.length || 0;
        const teamIdByNorm = {};
        const teamIdByCore = {};
        for (const t of (teamRows.results || [])) {
          const full = _normTeam(t.team_name);
          const core = _coreTeamName(t.team_name);
          teamIdByNorm[full] = t.ss_team_id;
          if (core !== full && !teamIdByCore[core]) teamIdByCore[core] = t.ss_team_id;
          const words = (t.team_name || '').split(/\s+/);
          if (words.length > 1) { const fw = _normTeam(words[0]); if (fw.length >= 4 && !teamIdByNorm[fw] && !teamIdByCore[fw]) teamIdByCore[fw] = t.ss_team_id; }
        }
        const resolveTeamId = (name) => {
          const n = _normTeam(name); const nc = _coreTeamName(name);
          if (teamIdByNorm[n]) return { id: teamIdByNorm[n], via: 'exact' };
          if (teamIdByCore[n]) return { id: teamIdByCore[n], via: 'core' };
          if (teamIdByNorm[nc]) return { id: teamIdByNorm[nc], via: 'nc-norm' };
          if (teamIdByCore[nc]) return { id: teamIdByCore[nc], via: 'nc-core' };
          for (const [full, id] of Object.entries(teamIdByNorm)) {
            if (full.startsWith(n) && n.length >= 5) return { id, via: 'startsWith:'+full };
            if (n.startsWith(full) && full.length >= 5) return { id, via: 'startsWith2:'+full };
          }
          return null;
        };
        const resolveResults = {};
        for (const name of names) {
          resolveResults[name] = resolveTeamId(name);
        }
        // Test getMatchIntelligence if we have exactly 2 names
        let intelResult = null;
        if (names.length === 2) {
          const homeR = resolveTeamId(names[0]);
          const awayR = resolveTeamId(names[1]);
          if (homeR && awayR) {
            const { getMatchIntelligence } = await import('./services/sofascoreFeatures.js');
            const intel = await getMatchIntelligence(homeR.id, awayR.id, env).catch(e => ({ error: e.message }));
            intelResult = intel ? { combined: intel.combined, homeAtHome: intel.homeAtHome, awayOnRoad: intel.awayOnRoad } : null;
          }
        }
        // Count matches per team in D1
        const matchCounts = {};
        if (names.length <= 4) {
          for (const name of names) {
            const r = resolveTeamId(name);
            if (r?.id) {
              const mc = await env.SB_DB.prepare('SELECT COUNT(*) as c FROM sofascore_team_matches WHERE ss_team_id = ?').bind(r.id).first().catch(() => null);
              matchCounts[name] = mc?.c ?? 0;
            }
          }
        }
        // Test computePickAlignment with fake picks for the 2 teams
        const alignmentTests = [];
        if (names.length === 2) {
          const homeR = resolveTeamId(names[0]);
          const awayR = resolveTeamId(names[1]);
          if (homeR && awayR && intelResult) {
            const { computePickAlignment, getMatchIntelligence: gmi } = await import('./services/sofascoreFeatures.js');
            const fullIntel = await gmi(homeR.id, awayR.id, env).catch(() => null);
            if (fullIntel) {
              const testPicks = [
                { stat: '1X2', direction: 'draw', home_team: names[0], away_team: names[1] },
                { stat: '1X2', direction: 'home', home_team: names[0], away_team: names[1] },
                { stat: 'BTTS', direction: 'no',  home_team: names[0], away_team: names[1] },
                { stat: 'BTTS', direction: 'yes', home_team: names[0], away_team: names[1] },
                { stat: 'result', direction: '12', home_team: names[0], away_team: names[1] },
              ];
              for (const tp of testPicks) {
                alignmentTests.push({ pick: `${tp.stat}/${tp.direction}`, result: computePickAlignment(tp, fullIntel) });
              }
            }
          }
        }
        return new Response(JSON.stringify({ ok: true, total_teams_in_db, resolve: resolveResults, match_counts: matchCounts, intel_sample: intelResult, alignment_tests: alignmentTests }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /v1/system/health — health check rico com SofaScore + ESPN + D1
    if ((pathname === '/v1/system/health' || pathname === '/v2/system/health') && request.method === 'GET') {
      try {
        const { getSofaScoreHealth } = await import('./services/sofascore.js');
        const ssHealth = await getSofaScoreHealth(env);

        // D1 ping
        let d1Status = 'unknown';
        try {
          await env.SB_DB?.prepare('SELECT 1').first();
          d1Status = 'ok';
        } catch { d1Status = 'down'; }

        // SofaScore D1 stats
        let ssStats = { events_total: 0, stats_total: 0, latest_date: null };
        if (env.SB_DB) {
          const [evRow, stRow] = await Promise.allSettled([
            env.SB_DB.prepare(`SELECT count(*) as n, max(event_date) as latest FROM sofascore_events`).first().catch(() => null),
            env.SB_DB.prepare(`SELECT count(*) as n FROM sofascore_stats`).first().catch(() => null),
          ]);
          if (evRow.status === 'fulfilled' && evRow.value) {
            ssStats.events_total = evRow.value.n || 0;
            ssStats.latest_date  = evRow.value.latest || null;
          }
          if (stRow.status === 'fulfilled' && stRow.value) {
            ssStats.stats_total = stRow.value.n || 0;
          }
        }

        return new Response(JSON.stringify({
          ok: true,
          timestamp: new Date().toISOString(),
          d1: { status: d1Status },
          sofascore: {
            ...(ssHealth || { status: 'unknown' }),
            events_in_d1: ssStats.events_total,
            stats_in_d1:  ssStats.stats_total,
            latest_date:  ssStats.latest_date,
          },
          espn: {
            status: 'ok',
            note: 'primary source, fetched via Workers cron',
          },
        }), { status: 200, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500, headers: corsHeaders(),
        });
      }
    }

    // ── /v2/* — SportsBrain API v2 (versão comercial, envelope padronizado) ───
    if (pathname.startsWith('/v2/')) {
      // /v2/system/* — sempre públicos (sem auth obrigatória)
      if (pathname === '/v2/system/health') {
        const { handleV2Health } = await import('./routes/v2/system.js');
        return handleV2Health(request, env);
      }
      if (pathname === '/v2/system/status') {
        const { handleV2Status } = await import('./routes/v2/system.js');
        return handleV2Status(request, env);
      }
      if (pathname === '/v2/system/plans') {
        const { handleV2Plans } = await import('./routes/v2/system.js');
        return handleV2Plans(request, env);
      }
      // /v2/picks/premium — picks curados com schema rico
      if (pathname === '/v2/picks/premium') {
        const { handleV2Premium } = await import('./routes/v2/premium.js');
        return handleV2Premium(request, env, ctx);
      }
      // Rota v2 não encontrada
      return new Response(JSON.stringify({
        ok: false,
        data: null,
        meta: { version: 'v2', generated_at: new Date().toISOString() },
        error: { code: 'NOT_FOUND', message: `Endpoint v2 não encontrado: ${pathname}`, docs_url: 'https://docs.sportsbrain.app/v2' },
      }), { status: 404, headers: corsHeaders() });
    }

    // ── /v1/picks/premium — 3-tier curado (Daily Singles + Combo + Jackpot) ──
    if (pathname === '/v1/picks/premium') {
      // Proteção de segurança: ?debug=1 expõe dados internos — exige plano internal ou master key
      const _debugParam = new URL(request.url).searchParams.get('debug');
      if (_debugParam === '1') {
        const _masterKey  = request.headers.get('X-Admin-Key') || request.headers.get('X-Master-Key');
        const _apiKey     = request.headers.get('X-SB-Key') || new URL(request.url).searchParams.get('key');
        const _hasMaster  = env.SB_MASTER_KEY && _masterKey === env.SB_MASTER_KEY;
        // Verifica se tem key de plano internal no D1
        let _isInternal = _hasMaster;
        if (!_isInternal && _apiKey && env.SB_DB) {
          try {
            let _h = 0;
            for (let _i = 0; _i < _apiKey.length; _i++) { _h = ((_h << 5) - _h) + _apiKey.charCodeAt(_i); _h |= 0; }
            const _kHash = Math.abs(_h).toString(36);
            const _kRow  = await env.SB_DB.prepare(
              `SELECT plan FROM api_keys WHERE key_hash = ? AND active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`
            ).bind(_kHash).first().catch(() => null);
            _isInternal = _kRow?.plan === 'internal';
          } catch {}
        }
        if (!_isInternal) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'DEBUG_FORBIDDEN',
            message: 'O parâmetro debug=1 expõe dados internos. Use X-Admin-Key (master key) ou uma API key de plano internal.',
          }), { status: 403, headers: corsHeaders() });
        }
      }
      const { handlePremiumPicks } = await import('./routes/premiumPicks.js');
      return handlePremiumPicks(request, env, ctx);
    }
    // ── /v1/picks/premium/tier1 — endpoint fast tier1 only (P3.9 R6J-B6) ──
    // Wrapper non-breaking sobre handlePremiumPicks: chama o legacy, parseia,
    // extrai apenas tier1 + metadata. Cache próprio (TTL 60s), debug=1 gate
    // idêntico ao legacy.
    if (pathname === '/v1/picks/premium/tier1') {
      const _debugParam = new URL(request.url).searchParams.get('debug');
      if (_debugParam === '1') {
        const _masterKey  = request.headers.get('X-Admin-Key') || request.headers.get('X-Master-Key');
        const _apiKey     = request.headers.get('X-SB-Key') || new URL(request.url).searchParams.get('key');
        const _hasMaster  = env.SB_MASTER_KEY && _masterKey === env.SB_MASTER_KEY;
        let _isInternal = _hasMaster;
        if (!_isInternal && _apiKey && env.SB_DB) {
          try {
            let _h = 0;
            for (let _i = 0; _i < _apiKey.length; _i++) { _h = ((_h << 5) - _h) + _apiKey.charCodeAt(_i); _h |= 0; }
            const _kHash = Math.abs(_h).toString(36);
            const _kRow  = await env.SB_DB.prepare(
              `SELECT plan FROM api_keys WHERE key_hash = ? AND active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`
            ).bind(_kHash).first().catch(() => null);
            _isInternal = _kRow?.plan === 'internal';
          } catch {}
        }
        if (!_isInternal) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'DEBUG_FORBIDDEN',
            message: 'O parâmetro debug=1 expõe dados internos. Use X-Admin-Key (master key) ou uma API key de plano internal.',
          }), { status: 403, headers: corsHeaders() });
        }
      }
      const { handlePremiumTier1 } = await import('./routes/premiumPicksSplit.js');
      return handlePremiumTier1(request, env, ctx);
    }
    // ── /v1/picks/premium/combos — endpoint paginado por section (P3.9 R6J-B6) ──
    // Params: section (obrigatório), page (default 1), page_size (default 25, max 50).
    // Sections válidas: tier2, tier3, tier4, results_acca, top_picks_today,
    // bet_builder_light, bet_builder_mid, bet_builder_plus.
    if (pathname === '/v1/picks/premium/combos') {
      const _debugParam = new URL(request.url).searchParams.get('debug');
      if (_debugParam === '1') {
        const _masterKey  = request.headers.get('X-Admin-Key') || request.headers.get('X-Master-Key');
        const _apiKey     = request.headers.get('X-SB-Key') || new URL(request.url).searchParams.get('key');
        const _hasMaster  = env.SB_MASTER_KEY && _masterKey === env.SB_MASTER_KEY;
        let _isInternal = _hasMaster;
        if (!_isInternal && _apiKey && env.SB_DB) {
          try {
            let _h = 0;
            for (let _i = 0; _i < _apiKey.length; _i++) { _h = ((_h << 5) - _h) + _apiKey.charCodeAt(_i); _h |= 0; }
            const _kHash = Math.abs(_h).toString(36);
            const _kRow  = await env.SB_DB.prepare(
              `SELECT plan FROM api_keys WHERE key_hash = ? AND active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`
            ).bind(_kHash).first().catch(() => null);
            _isInternal = _kRow?.plan === 'internal';
          } catch {}
        }
        if (!_isInternal) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'DEBUG_FORBIDDEN',
            message: 'O parâmetro debug=1 expõe dados internos. Use X-Admin-Key (master key) ou uma API key de plano internal.',
          }), { status: 403, headers: corsHeaders() });
        }
      }
      const { handlePremiumCombos } = await import('./routes/premiumPicksSplit.js');
      return handlePremiumCombos(request, env, ctx);
    }
    // ── /v1/premium/results — picks do dia anterior com resultado W/L ──
    if (pathname === '/v1/premium/results') {
      const { handlePremiumResults } = await import('./routes/premiumResults.js');
      return handlePremiumResults(request, env);
    }

    // ── /v1/premium/validation — dashboard interno de validação pre-monetização ──
    if (pathname === '/v1/premium/validation') {
      const { handlePremiumValidation } = await import('./routes/premiumValidation.js');
      return handlePremiumValidation(request, env);
    }

    // ── /v1/premium/proof — social proof (greens reais, ROI, Telegram summary) ──
    if (pathname === '/v1/premium/proof') {
      const { handlePremiumProof } = await import('./routes/premiumValidation.js');
      return handlePremiumProof(request, env);
    }

    // ── P3.9 R6K-F3 — Performance IA (read-only WR/ROI/convergência) ──
    // Mede a IA contra pick_history. Retorna sample/WR/ROI/streak agrupado
    // por method/tier/origin/market/odd_bucket/math_verdict/design_verdict
    // + verdict_calibration (n<30 = insufficient_sample, NÃO bloqueia
    // auto-sustentável) + convergence (ready=true não ativa nada).
    // Schema ensurePickHistoryF3Schema (ALTER TABLE idempotente) roda no
    // path normal do request.
    if (pathname === '/v1/premium/performance-ia') {
      const { handlePerformanceIa } = await import('./routes/performanceIA.js');
      return handlePerformanceIa(request, env);
    }

    // ── /internal/resolve-premium — força resolução manual das exposures ──
    if (pathname === '/internal/resolve-premium' && request.method === 'POST') {
      const { handleResolvePremium } = await import('./routes/premiumValidation.js');
      return handleResolvePremium(request, env);
    }

    // POST /internal/backfill-sofascore-results
    // Tenta resolver picks unknown/pendentes usando dados SofaScore já no D1.
    if (pathname === '/internal/backfill-sofascore-results' && request.method === 'POST') {
      const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key');
      if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
      }

      try {
        const u2 = new URL(request.url);
        const limit = Math.min(parseInt(u2.searchParams.get('limit') || '200', 10), 500);
        const daysBack = Math.min(parseInt(u2.searchParams.get('days') || '30', 10), 90);
        const cutoff = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

        const { results: oldPending } = await env.SB_DB.prepare(`
          SELECT id, pick_date, match, stat, direction, line
          FROM pick_history
          WHERE result IS NULL
            AND pick_date >= ?
            AND (sport = 'football' OR sport IS NULL)
            AND (
              LOWER(stat) LIKE '%corner%' OR LOWER(stat) LIKE '%escantei%' OR
              LOWER(stat) LIKE '%shot%'   OR LOWER(stat) LIKE '%chute%' OR
              LOWER(stat) LIKE '%card%'   OR LOWER(stat) LIKE '%cart%'
            )
          LIMIT ?
        `).bind(cutoff, limit).all().catch(() => ({ results: [] }));

        let resolved = 0;
        let noData = 0;

        for (const pick of oldPending) {
          const parts = splitMatchString(pick.match || '');
          if (!parts) { noData++; continue; }

          const k1 = `${normTeam(parts[0])}|${normTeam(parts[1])}`;
          const k2 = `${normTeam(parts[1])}|${normTeam(parts[0])}`;

          const ssEv = await env.SB_DB.prepare(
            `SELECT ss_event_id FROM sofascore_events WHERE (norm_key = ? OR norm_key = ?) AND event_date = ? AND sport = 'football' LIMIT 1`
          ).bind(k1, k2, pick.pick_date).first().catch(() => null);

          if (!ssEv?.ss_event_id) { noData++; continue; }

          const { fetchSofaScoreBoxStatsCached: ssBoxCached } = await import('./services/sofascore.js');
          const stats = await ssBoxCached(ssEv.ss_event_id, env, null);
          if (!stats) { noData++; continue; }

          let pickLine = pick.line, pickDir = pick.direction;
          if (pickLine == null && pick.id) {
            const seg = (pick.id || '').split('|').pop() || '';
            const m = seg.match(/^([ou])([\d]+)[\s.]?(\d*)/i);
            if (m) {
              pickDir = pickDir || (m[1].toLowerCase() === 'o' ? 'over' : 'under');
              pickLine = parseFloat(m[2] + (m[3] ? '.' + m[3] : ''));
            }
          }

          const verdict = resolveCornerCardShotPickFn(pick.stat, pickLine, pickDir, stats, pick.match);
          if (!verdict) { noData++; continue; }

          await env.SB_DB.prepare(
            `UPDATE pick_history SET result = ?, auto_verified = 1, result_source = 'sofascore', updated_at = datetime('now') WHERE id = ?`
          ).bind(verdict, pick.id).run().catch(() => {});
          resolved++;
        }

        return new Response(JSON.stringify({
          ok: true,
          processed: oldPending.length,
          resolved,
          no_data: noData,
          cutoff,
          limit,
        }), { status: 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // ── /v2/premium/validation — versão v2 com envelope padronizado ──
    // (alias do v1 com wrapper v2 aplicado)
    if (pathname === '/v2/premium/validation') {
      const { handlePremiumValidation } = await import('./routes/premiumValidation.js');
      const v1Res  = await handlePremiumValidation(request, env);
      const v1Body = await v1Res.json();
      const { v2ok, makeRequestId } = await import('./middleware/response.js');
      return v2ok(v1Body, { reqId: makeRequestId(), plan: 'internal', cache: 'bypass' });
    }
    // GET /v1/picks/curated — TIPS PREMIUM Bayesian-verified (Wilson LCB > 65%)
    if (pathname === '/v1/picks/curated') {
      const { handleCuratedPicks } = await import('./routes/curatedPicks.js');
      return handleCuratedPicks(request, env);
    }
    // ── Match Analytics (P2) ──────────────────────────────────────────────
    if (pathname.startsWith('/v1/analysis/match/')) {
      const fixtureId = pathname.replace('/v1/analysis/match/', '');
      const { handleMatchAnalysis } = await import('./routes/matchAnalysis.js');
      return handleMatchAnalysis(request, env, fixtureId);
    }
    if (pathname === '/internal/upsert-analytics' && request.method === 'POST') {
      const { handleUpsertAnalytics } = await import('./routes/matchAnalysis.js');
      return handleUpsertAnalytics(request, env);
    }
    // POST /internal/ingest-pinnacle — Pinnacle odds ingest (sharpest book, fallback Bet365)
    if (pathname === '/internal/ingest-pinnacle' && request.method === 'POST') {
      const secret = request.headers.get('X-Ingest-Secret')
      if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
      }
      try {
        const { markets } = await request.json()
        if (!Array.isArray(markets) || !markets.length) {
          return new Response(JSON.stringify({ ok: false, error: 'no_markets' }), { status: 400, headers: corsHeaders() })
        }
        await env.SB_DB.exec(
          `CREATE TABLE IF NOT EXISTS pinnacle_markets_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at INTEGER NOT NULL, count INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`
        ).catch(() => {})
        const ts = Date.now()
        await env.SB_DB.prepare(
          `INSERT INTO pinnacle_markets_snapshots (captured_at, count, payload, created_at) VALUES (?,?,?,?)`
        ).bind(ts, markets.length, JSON.stringify(markets), ts).run()
        // Cleanup older que 7 dias
        await env.SB_DB.prepare(`DELETE FROM pinnacle_markets_snapshots WHERE created_at < ?`)
          .bind(ts - 7 * 86400_000).run().catch(() => {})
        return new Response(JSON.stringify({ ok: true, count: markets.length, capturedAt: ts }), {
          status: 200, headers: corsHeaders(),
        })
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() })
      }
    }
    // POST /internal/sofascore-ingest — recebe dados SofaScore do self-hosted runner
    if (pathname === '/internal/sofascore-ingest' && request.method === 'POST') {
      try {
        return await handleSofaScoreIngest(request, env);
      } catch (e) {
        console.error('[sofascore-ingest] unhandled exception:', e.message, e.stack);
        return new Response(JSON.stringify({ ok: false, error: 'unhandled', message: e.message }), {
          status: 500, headers: corsHeaders(),
        });
      }
    }
    // POST /internal/sofascore/ingest-team-history — histórico de times do self-hosted runner
    if (pathname === '/internal/sofascore/ingest-team-history' && request.method === 'POST') {
      try {
        return await handleSofaScoreHistoricalIngest(request, env);
      } catch (e) {
        console.error('[sofascore/ingest-team-history] unhandled:', e.message, e.stack);
        return new Response(JSON.stringify({ ok: false, error: 'unhandled', message: e.message }), {
          status: 500, headers: corsHeaders(),
        });
      }
    }

    // F2.46: POST /internal/apif/ingest-date?date=YYYY-MM-DD&cap=50
    // Substituto temporário do Sofascore — api-football ingest (não precisa runner).
    if (pathname === '/internal/apif/ingest-date' && request.method === 'POST') {
      const auth = request.headers.get('X-Ingest-Secret');
      if (auth !== env.SB_INGEST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
      }
      const date = url.searchParams.get('date') || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const cap = parseInt(url.searchParams.get('cap') || '50', 10);
      try {
        const r = await ingestApifDate(env, date, cap);
        return new Response(JSON.stringify({ ok: !r.error, ...r }), { status: r.error ? 500 : 200, headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // F2.46: POST /internal/apif/backfill?days=7&cap=30
    if (pathname === '/internal/apif/backfill' && request.method === 'POST') {
      const auth = request.headers.get('X-Ingest-Secret');
      if (auth !== env.SB_INGEST_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() });
      }
      const days = parseInt(url.searchParams.get('days') || '7', 10);
      const cap = parseInt(url.searchParams.get('cap') || '30', 10);
      try {
        const results = await backfillApifLastNDays(env, days, cap);
        const totalInserted = results.reduce((acc, r) => acc + (r.matches_inserted || 0), 0);
        const totalPlayers = results.reduce((acc, r) => acc + (r.player_stats_inserted || 0), 0);
        return new Response(JSON.stringify({ ok: true, days, results, total_matches: totalInserted, total_players: totalPlayers }), { headers: corsHeaders() });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /v1/admin/pinnacle-debug — inspecionar Pinnacle markets
    if (pathname === '/v1/admin/pinnacle-debug') {
      try {
        const row = await env.SB_DB.prepare(
          `SELECT payload, created_at FROM pinnacle_markets_snapshots ORDER BY created_at DESC LIMIT 1`
        ).first()
        if (!row?.payload) return new Response(JSON.stringify({ ok: false, error: 'no_snapshot' }), { status: 404, headers: corsHeaders() })
        const markets = JSON.parse(row.payload)
        const byMarket = {}
        const byFid = {}
        for (const m of markets) {
          byMarket[m.market || '?'] = (byMarket[m.market || '?'] || 0) + 1
          byFid[m.fixtureId] = (byFid[m.fixtureId] || 0) + 1
        }
        return new Response(JSON.stringify({
          ok: true, captured_at: row.created_at,
          age_min: Math.round((Date.now() - row.created_at) / 60000),
          total_markets: markets.length,
          unique_fixtures: Object.keys(byFid).length,
          markets_by_type: byMarket,
        }, null, 2), { status: 200, headers: corsHeaders({ 'Content-Type': 'application/json' }) })
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() })
      }
    }
    // GET /v1/telegram/tipster-bayesian — ranking Bayesian (Wilson LCB) dos tipsters
    if (pathname === '/v1/telegram/tipster-bayesian') {
      const { handleTipsterBayesian } = await import('./routes/tipsterBayesian.js');
      return handleTipsterBayesian(request, env);
    }
    // GET /v1/admin/markets-debug — inspecionar bet365 markets stored (debug matching)
    if (pathname === '/v1/admin/markets-debug') {
      try {
        const row = await env.SB_DB.prepare(
          `SELECT payload, created_at FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`
        ).first()
        if (!row?.payload) return new Response(JSON.stringify({ ok: false, error: 'no_snapshot' }), { status: 404, headers: corsHeaders() })
        const parsed = JSON.parse(row.payload)
        // Payload é array direto OU objeto com .markets
        const markets = Array.isArray(parsed) ? parsed : (parsed.markets || [])
        // Stats por market type
        const byMarket = {}
        for (const m of markets) {
          const k = m.market || '?'
          if (!byMarket[k]) byMarket[k] = { count: 0, samples: [] }
          byMarket[k].count++
          if (byMarket[k].samples.length < 3) byMarket[k].samples.push({
            market: m.market, selection: m.selection, line: m.line, odd: m.odd, side: m.side, fixtureId: m.fixtureId,
          })
        }
        // Stats por fixture
        const byFid = {}
        for (const m of markets) {
          const fid = m.fixtureId
          byFid[fid] = (byFid[fid] || 0) + 1
        }
        // Build fixture list with team names from markets
        const fixtureNames = {}
        for (const m of markets) {
          if (!m.fixtureId) continue
          if (!fixtureNames[m.fixtureId]) {
            fixtureNames[m.fixtureId] = {
              fid: m.fixtureId,
              home: m.home || m.homeTeam || '',
              away: m.away || m.awayTeam || '',
              kickoff: m.startTime || m.kickoff || m.start_time || m.fixtureStartTime || null,
            }
          }
        }
        // Cross-ref with bet365_matches_snapshots for better names/kickoffs
        try {
          const mRow = await env.SB_DB.prepare(`SELECT payload FROM bet365_matches_snapshots ORDER BY created_at DESC LIMIT 1`).first()
          if (mRow?.payload) {
            const mMatches = JSON.parse(mRow.payload) || []
            for (const f of mMatches) {
              const fid = f.id || f.fixtureId
              if (!fid) continue
              const kick = f.startTime || f.kickoff || f.start_time
              if (!fixtureNames[fid]) fixtureNames[fid] = { fid, home: f.home || f.homeTeam || '', away: f.away || f.awayTeam || '', kickoff: kick }
              else if (kick) fixtureNames[fid].kickoff = kick
              if (f.home || f.homeTeam) fixtureNames[fid].home = f.home || f.homeTeam
              if (f.away || f.awayTeam) fixtureNames[fid].away = f.away || f.awayTeam
              if (f.competition || f.league) fixtureNames[fid].league = f.competition || f.league
            }
          }
        } catch (_) {}
        return new Response(JSON.stringify({
          ok: true,
          captured_at: row.created_at,
          age_min: Math.round((Date.now() - row.created_at) / 60000),
          total_markets: markets.length,
          unique_fixtures: Object.keys(byFid).length,
          fixtures: Object.values(fixtureNames).sort((a, b) => (a.kickoff || '') < (b.kickoff || '') ? -1 : 1),
          markets_by_type: Object.fromEntries(
            Object.entries(byMarket).sort((a, b) => b[1].count - a[1].count)
          ),
          markets_per_fixture_p50: Object.values(byFid).sort((a, b) => a - b)[Math.floor(Object.values(byFid).length / 2)] || 0,
        }, null, 2), { status: 200, headers: corsHeaders({ 'Content-Type': 'application/json' }) })
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() })
      }
    }
    // /internal/update-patterns — Pattern Generator aggregator (cron daily, P1)
    if (pathname === '/internal/update-patterns') {
      const { handleUpdatePatterns } = await import('./routes/patternGenerator.js')
      return handleUpdatePatterns(request, env)
    }

    // POST /internal/update-model-probs — recebe buckets do train_model.py (cron semanal)
    if (pathname === '/internal/update-model-probs' && request.method === 'POST') {
      const { handleUpdateModelProbs } = await import('./routes/modelProbs.js')
      return handleUpdateModelProbs(request, env)
    }

    // POST /internal/cache-picks-today — cron envia top_props pra cache D1
    if (pathname === '/internal/cache-picks-today' && request.method === 'POST') {
      const secret = request.headers.get('X-Ingest-Secret')
      if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
      }
      try {
        const { sport, top_props } = await request.json()
        if (!sport || !Array.isArray(top_props)) {
          return new Response(JSON.stringify({ ok: false, error: 'bad_payload' }), { status: 400, headers: corsHeaders() })
        }
        await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS picks_cache_today (sport TEXT PRIMARY KEY, generated_at INTEGER, payload TEXT)`).catch(()=>{})
        await env.SB_DB.prepare(
          `INSERT OR REPLACE INTO picks_cache_today (sport, generated_at, payload) VALUES (?, ?, ?)`
        ).bind(sport, Date.now(), JSON.stringify({ top_props: top_props.slice(0, 1500) })).run()
        return new Response(JSON.stringify({ ok: true, sport, count: top_props.length }), { status: 200, headers: corsHeaders() })
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
      }
    }
    // ── /v1/picks/daily — gera picks ensemble (CLV + Elo/Poisson + Kelly) ──
    if (pathname === '/v1/picks/daily') {
      const q = new URL(request.url).searchParams;
      const { generatePicks } = await import('./services/picks.js');
      const r = await generatePicks(env, {
        minEdge:      parseFloat(q.get('min_edge') || '2.5'),
        maxPicks:     parseInt(q.get('max') || '10', 10),
        persist:      q.get('persist') !== '0',
        pushTelegram: q.get('push') === '1',
        hoursAhead:   parseInt(q.get('hours') || '24', 10),
      });
      return new Response(JSON.stringify(r, null, 2), {
        status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // ── /v1/picks/list|update|delete — D1 user_picks (sync cross-device) ──
    // /v1/picks/save é tratado dentro de handlePickHistory (line ~209) com
    // detecção de schema novo (body.legs/savedAt) → roteia pro handlePicksSave
    if (pathname === '/v1/picks/list') {
      const { handlePicksList } = await import('./routes/picksHistory.js');
      return handlePicksList(request, env);
    }
    if (pathname === '/v1/picks/update') {
      const { handlePicksUpdate } = await import('./routes/picksHistory.js');
      return handlePicksUpdate(request, env);
    }
    if (pathname === '/v1/picks/delete') {
      const { handlePicksDelete } = await import('./routes/picksHistory.js');
      return handlePicksDelete(request, env);
    }
    // GET /v1/tips/resolved — telegram_tips com W/L para treino do modelo ML
    if (pathname === '/v1/tips/resolved' && request.method === 'GET') {
      try {
        const qurl = new URL(request.url);
        const limit = Math.min(parseInt(qurl.searchParams.get('limit') || '5000', 10), 10000);
        await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS telegram_tips (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT, channel_name TEXT, message_id TEXT, posted_at INTEGER, raw_text TEXT, sport TEXT, market TEXT, market_tag TEXT, line REAL, odd REAL, stake REAL, stake_type TEXT, teams TEXT, confidence_score REAL, result TEXT, settled_at INTEGER, matched_pick_id TEXT, created_at INTEGER)`).catch(() => {});
        const { results } = await env.SB_DB.prepare(
          `SELECT id, channel_name, market, odd, result, stake, teams, posted_at
           FROM telegram_tips
           WHERE result IN ('W','L') AND odd IS NOT NULL AND odd > 1.0
           ORDER BY posted_at DESC LIMIT ?`
        ).bind(limit).all();
        return new Response(JSON.stringify({ ok: true, tips: results || [], count: (results || []).length }), {
          status: 200, headers: corsHeaders(),
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() });
      }
    }

    // GET /v1/picks/greens — picks vencedores (prova social) — ANTES do catch-all
    if (pathname === '/v1/picks/greens') {
      const { handlePicksGreens } = await import('./routes/telegramTips.js');
      return handlePicksGreens(request, env);
    }
    // ── /v1/picks/* — suporta GET, POST, PATCH (pick history + auto-verify) ──
    if (pathname.startsWith('/v1/picks')) {
      return handlePickHistory(pathname, request, env);
    }
    // ── /v1/intelligence/* + /v1/clv/* + /v1/backtest/* + /v1/live/* + /v1/ml/* ──
    // Estão dentro de handlePickHistory (mesmo file scope) — dispatch também
    if (pathname.startsWith('/v1/intelligence/') || pathname.startsWith('/v1/clv/') ||
        pathname.startsWith('/v1/backtest/') || pathname.startsWith('/v1/live/') ||
        pathname.startsWith('/v1/ml/')) {
      return handlePickHistory(pathname, request, env);
    }

    // ── /v1/admin/source-coverage — P3.4 Data Moat dashboard ──────────────
    if (pathname === '/v1/admin/source-coverage') {
      const { handleSourceCoverage } = await import('./routes/sourceCoverage.js');
      return handleSourceCoverage(request, env);
    }

    // ── /v1/admin/shadow-monitor — P3.8.1 Shadow Accumulation Monitor ──────
    if (pathname === '/v1/admin/shadow-monitor') {
      const { handleShadowMonitor } = await import('./routes/shadowMonitor.js');
      return handleShadowMonitor(request, env);
    }

    // ── /v1/admin/shadow-bets-check — P3.8.2 D1 table diagnostic ───────────
    if (pathname === '/v1/admin/shadow-bets-check') {
      const { handleShadowBetsCheck } = await import('./routes/shadowBetsCheck.js');
      return handleShadowBetsCheck(request, env);
    }

    // ── /v1/admin/operator-report-preview — P3.8.19 admin export preview ────
    if (pathname === '/v1/admin/operator-report-preview') {
      return handleOperatorReportPreview(request, env);
    }

    // ── /v1/admin/pick-resolve-audit — F2.20-AUDIT read-only pick_history diagnostic ──
    // Auth: X-Admin-Key ou ?key= = SB_MASTER_KEY. Apenas SELECT, sem write.
    // Investiga por que picks da IA não estão sendo resolvidos pelo runPickAutoVerify.
    if (pathname === '/v1/admin/pick-resolve-audit' && request.method === 'GET') {
      const _key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key') || '';
      if (!env.SB_MASTER_KEY || _key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      if (!env.SB_DB) {
        return new Response(JSON.stringify({ ok: false, error: 'no_db' }), {
          status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      try {
        const _u = new URL(request.url);
        const _days = Math.min(parseInt(_u.searchParams.get('days') || '14', 10), 30);
        const _sport = _u.searchParams.get('sport') || 'football';

        const _brMs = Date.now() - 3 * 3600_000;
        const _yesterday = new Date(_brMs - 86_400_000).toISOString().slice(0, 10);
        const _cutoffDate = new Date(_brMs - _days * 86_400_000).toISOString().slice(0, 10);

        // Q1: status por dia (últimos N dias)
        const _q1 = env.SB_DB.prepare(`
          SELECT pick_date,
            SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN result = 'W'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN result = 'L'  THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN result = 'V'  THEN 1 ELSE 0 END) AS voids,
            COUNT(*) AS total
          FROM pick_history
          WHERE pick_date >= ? AND sport = ?
          GROUP BY pick_date
          ORDER BY pick_date DESC
        `).bind(_cutoffDate, _sport).all().catch(e => ({ error: String(e), results: [] }));

        // Q2: pending por stat (só ontem) — qual tipo de market não resolve?
        const _q2 = env.SB_DB.prepare(`
          SELECT stat, COUNT(*) AS n
          FROM pick_history
          WHERE result IS NULL AND pick_date = ? AND sport = ?
          GROUP BY stat
          ORDER BY n DESC
          LIMIT 30
        `).bind(_yesterday, _sport).all().catch(e => ({ error: String(e), results: [] }));

        // Q3: sample 20 picks pendentes de ontem
        const _q3 = env.SB_DB.prepare(`
          SELECT id, pick_date, match, league, stat, direction, line, saved_at, auto_verified
          FROM pick_history
          WHERE result IS NULL AND pick_date = ? AND sport = ?
          ORDER BY saved_at DESC
          LIMIT 20
        `).bind(_yesterday, _sport).all().catch(e => ({ error: String(e), results: [] }));

        // Q4: sofascore_health — última ingest, resolver vivo?
        const _q4 = env.SB_DB.prepare(`
          SELECT * FROM sofascore_health WHERE id = 1
        `).first().catch(e => ({ error: String(e) }));

        // Q5: cobertura matches_raw de ontem (jogos com score finalizado)
        // Schema real: score_home/score_away (não home_score/away_score)
        const _q5 = env.SB_DB.prepare(`
          SELECT
            COUNT(*) AS total_matches,
            SUM(CASE WHEN status = 'post' AND score_home IS NOT NULL THEN 1 ELSE 0 END) AS finished_with_score,
            SUM(CASE WHEN status = 'post' THEN 1 ELSE 0 END) AS finished_total,
            SUM(CASE WHEN score_home IS NOT NULL THEN 1 ELSE 0 END) AS any_with_score
          FROM matches_raw
          WHERE match_date = ?
        `).bind(_yesterday).first().catch(e => ({ error: String(e) }));

        // Q6: totais agregados da janela (sanity check)
        const _q6 = env.SB_DB.prepare(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN result = 'W'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN result = 'L'  THEN 1 ELSE 0 END) AS losses,
            SUM(CASE WHEN result = 'V'  THEN 1 ELSE 0 END) AS voids,
            SUM(CASE WHEN auto_verified = 1 THEN 1 ELSE 0 END) AS auto_verified_count
          FROM pick_history
          WHERE pick_date >= ? AND sport = ?
        `).bind(_cutoffDate, _sport).first().catch(e => ({ error: String(e) }));

        const [q1, q2, q3, q4, q5, q6] = await Promise.all([_q1, _q2, _q3, _q4, _q5, _q6]);

        return new Response(JSON.stringify({
          ok: true,
          tag: 'F2.20-AUDIT',
          window_days: _days,
          sport: _sport,
          yesterday: _yesterday,
          cutoff_date: _cutoffDate,
          totals: q6 || null,
          by_date: q1.results || [],
          yesterday_pending_by_stat: q2.results || [],
          yesterday_pending_sample: q3.results || [],
          sofascore_health: q4 || null,
          yesterday_matches_raw: q5 || null,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
    }

    // ── /v1/admin/void-audit — F2.18-INSTRUMENT read-only void diagnostic ──
    // Auth: X-Admin-Key ou ?key= = SB_MASTER_KEY. Apenas SELECT, sem write.
    if (pathname === '/v1/admin/void-audit' && request.method === 'GET') {
      const _key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key') || '';
      if (!env.SB_MASTER_KEY || _key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      if (!env.SB_DB) {
        return new Response(JSON.stringify({ ok: false, error: 'no_db' }), {
          status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      try {
        // Janela de análise: últimos 14 dias (foco em comportamento recente do resolver)
        const _windowStart = Date.now() - 14 * 86400_000;

        // Q1: distribuição de idade no momento do void (settled_at − posted_at)
        // Bucketiza pra ver se o batch (que mata por "data anterior a hoje") domina.
        const _q1 = env.SB_DB.prepare(`
          SELECT
            CASE
              WHEN (settled_at - posted_at) < 4  * 3600000 THEN '0_lt_4h'
              WHEN (settled_at - posted_at) < 12 * 3600000 THEN '1_4_12h'
              WHEN (settled_at - posted_at) < 24 * 3600000 THEN '2_12_24h'
              WHEN (settled_at - posted_at) < 48 * 3600000 THEN '3_24_48h'
              WHEN (settled_at - posted_at) < 96 * 3600000 THEN '4_48_96h'
              ELSE                                              '5_gt_96h'
            END AS age_bucket,
            COUNT(*) AS n
          FROM telegram_tips
          WHERE result = 'V' AND auto_verified = 1 AND posted_at >= ?
          GROUP BY age_bucket
          ORDER BY age_bucket
        `).bind(_windowStart).all().catch(e => ({ error: String(e), results: [] }));

        // Q2: void por canal (top 20). Total + Voids + %.
        const _q2 = env.SB_DB.prepare(`
          SELECT channel_name,
            SUM(CASE WHEN result = 'V'  THEN 1 ELSE 0 END) AS voids,
            SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN result IN ('W','L') THEN 1 ELSE 0 END) AS resolved,
            COUNT(*) AS total
          FROM telegram_tips
          WHERE posted_at >= ?
          GROUP BY channel_name
          ORDER BY voids DESC
          LIMIT 20
        `).bind(_windowStart).all().catch(e => ({ error: String(e), results: [] }));

        // Q3: void por market (top 20).
        const _q3 = env.SB_DB.prepare(`
          SELECT market, COUNT(*) AS voids
          FROM telegram_tips
          WHERE result = 'V' AND posted_at >= ?
          GROUP BY market
          ORDER BY voids DESC
          LIMIT 20
        `).bind(_windowStart).all().catch(e => ({ error: String(e), results: [] }));

        // Q4: sample 15 tips FAIXA voidadas pra inspeção manual.
        // Match flexível (LOWER LIKE '%faixa%') — não depende de coluna is_faixa nem de string exata.
        const _q4 = env.SB_DB.prepare(`
          SELECT id, channel_name, teams, market, market_tag, line, odd,
                 posted_at, settled_at, (settled_at - posted_at) AS age_ms,
                 auto_verified
          FROM telegram_tips
          WHERE result = 'V' AND LOWER(channel_name) LIKE '%faixa%' AND posted_at >= ?
          ORDER BY settled_at DESC
          LIMIT 15
        `).bind(_windowStart).all().catch(e => ({ error: String(e), results: [] }));

        // Q5: totais globais — sanity check vs as proporções da investigação.
        const _q5 = env.SB_DB.prepare(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN result = 'V'  THEN 1 ELSE 0 END) AS voids,
            SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN result IN ('W','L') THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN result = 'V' AND auto_verified = 1 THEN 1 ELSE 0 END) AS voids_auto
          FROM telegram_tips
          WHERE posted_at >= ?
        `).bind(_windowStart).first().catch(e => ({ error: String(e) }));

        const [q1, q2, q3, q4, q5] = await Promise.all([_q1, _q2, _q3, _q4, _q5]);

        return new Response(JSON.stringify({
          ok: true,
          tag: 'F2.18-INSTRUMENT',
          window_days: 14,
          window_start: _windowStart,
          totals: q5 || null,
          age_distribution: q1.results || [],
          by_channel: q2.results || [],
          by_market: q3.results || [],
          faixa_sample: q4.results || [],
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
    }

    // ── /internal/admin/resolve-shadow-bets — P3.8.4.4 manual resolver trigger ──
    if (pathname === '/internal/admin/resolve-shadow-bets') {
      const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key') || '';
      if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      const { resolveShadowBets } = await import('./routes/premiumValidation.js');
      const result = await resolveShadowBets(env).catch(e => ({ error: e.message }));
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // ── /internal/admin/resync-confidence-scores — P3.8.5/P3.8.6.7 manual resync ──
    // Recomputes bet_confidence_score from stored DB fields for rows with score=0.
    // P3.8.6.7: Also attempts to update audit fields for rows with audit_status='unknown'
    // using buildPickAudit with reconstructed pseudo-picks (no live _availMap — partial audit).
    if (pathname === '/internal/admin/resync-confidence-scores') {
      const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key') || '';
      if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      if (!env?.SB_DB) {
        return new Response(JSON.stringify({ ok: false, error: 'DB_NOT_CONFIGURED' }), {
          status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
      try {
        const t0 = Date.now();
        const { explainBetConfidenceScore } = await import('./services/betConfidence.js');
        const { buildPickAudit } = await import('./services/pickAudit.js');
        // P3.9 R6K-F1: guard refinado para proteger contra DADOS CORROMPIDOS
        // (no_fixture/no_market/no_selection/audit_unknown_zero/score_absurd).
        // NÃO bloqueia mais por mercado arriscado ou score<40 — esses casos
        // viram badge no payload Premium (R6K-F2 annotate-don't-filter).
        // Função pura, testada em tests/adminPromotionGuardR6KF1.test.js.
        const { shouldAdminPromoteStaleCandidate } = await import('./services/adminPromotionGuard.js');
        let r6hgBlocked = 0;
        const r6hgBlockedReasons = {};

        // Step 1: Confidence resync — rows with score=0
        const confRows = await env.SB_DB.prepare(`
          SELECT id, audit_status, trust_level, can_post, market_available,
                 availability_confidence, clv_status, golden_score, golden_support_score,
                 odd, legs_count, source_family, odds_snapshot_id
          FROM shadow_bets
          WHERE COALESCE(bet_confidence_score, 0) = 0
          LIMIT 500
        `).all();
        const toUpdate = confRows?.results || [];
        let updated = 0, confErrors = 0;
        const CHUNK = 50;
        // Track before state
        const auditBeforeAll = await env.SB_DB.prepare(
          `SELECT audit_status, COUNT(*) as cnt FROM shadow_bets GROUP BY audit_status`
        ).all().catch(() => ({ results: [] }));
        const trainingBeforeAll = await env.SB_DB.prepare(
          `SELECT training_eligible, COUNT(*) as cnt FROM shadow_bets GROUP BY training_eligible`
        ).all().catch(() => ({ results: [] }));

        for (let i = 0; i < toUpdate.length; i += CHUNK) {
          const chunk = toUpdate.slice(i, i + CHUNK);
          const stmts = chunk.map(row => {
            const pseudo = {
              audit_status:            row.audit_status || null,
              trust_level:             row.trust_level  || null,
              can_post:                row.can_post === 1,
              market_available:        row.market_available === 1 ? true
                                     : row.market_available === 0 ? false : null,
              availability_confidence: row.availability_confidence || null,
              odds_snapshot_id:        row.odds_snapshot_id || null,
              clv_status:              row.clv_status || null,
              golden_score:            row.golden_score ?? null,
              golden_support_score:    row.golden_support_score ?? null,
              odd:                     row.odd ?? null,
              legs_count:              row.legs_count ?? 1,
              source_family:           row.source_family || null,
            };
            const ex = explainBetConfidenceScore(pseudo);
            return env.SB_DB.prepare(
              `UPDATE shadow_bets SET bet_confidence_score = ?, bet_confidence_tier = ? WHERE id = ?`
            ).bind(ex.score, ex.tier, row.id);
          });
          const results = await env.SB_DB.batch(stmts);
          updated += results.filter(r => r.success !== false).length;
          confErrors += results.filter(r => r.success === false).length;
        }

        // Step 2: Audit resync — rows with audit_status='unknown'
        // Uses buildPickAudit with reconstructed pseudo-pick (no _availMap, no matchIntel).
        // Provides partial audit based on source_family, odd, fixture presence.
        const auditRows = await env.SB_DB.prepare(`
          SELECT id, home_team, away_team, market, selection, line, odd,
                 source_family, bet365_event_id, fixture_id, kickoff,
                 market_available, availability_confidence,
                 bet_confidence_score, bet_confidence_tier, odds_snapshot_id
          FROM shadow_bets
          WHERE audit_status = 'unknown'
          LIMIT 500
        `).all();
        const toAudit = auditRows?.results || [];
        let auditUpdated = 0, auditErrors = 0;

        for (let i = 0; i < toAudit.length; i += CHUNK) {
          const chunk = toAudit.slice(i, i + CHUNK);
          const stmts = [];
          for (const row of chunk) {
            try {
              const pseudo = {
                home_team:            row.home_team || null,
                away_team:            row.away_team || null,
                market:               row.market || null,
                stat:                 row.market || null,
                selection:            row.selection || null,
                direction:            row.selection || null,
                line:                 row.line ?? null,
                odd:                  row.odd ?? null,
                source_family:        row.source_family || null,
                source:               row.source_family || null,
                bet365_event_id:      row.bet365_event_id || null,
                fixture_id:           row.fixture_id || null,
                kickoff:              row.kickoff || null,
                market_available:     row.market_available === 1 ? true
                                    : row.market_available === 0 ? false : null,
                availability_confidence: row.availability_confidence || null,
                bet_confidence_score: row.bet_confidence_score ?? null,
                odds_snapshot_id:     row.odds_snapshot_id || null,
                _is_direct_b365:      !!(row.source_family === 'bet365_direct' || row.bet365_event_id),
              };
              const _audit = buildPickAudit(pseudo, null);
              const auditObj = _audit.audit_status || {};
              const pickAuditStatus = typeof auditObj === 'string' ? auditObj
                : (auditObj.pickAuditStatus || 'unknown');
              const trustLevel = auditObj.trust_level || 'unknown';
              const canPost = auditObj.can_post ?? false;
              const trainingEligible = (
                pickAuditStatus === 'valid' &&
                ['verified', 'supported'].includes(trustLevel) &&
                canPost &&
                pseudo.market_available !== false &&
                _audit.resolvability?.can_resolve === true
              ) ? 1 : 0;
              // P3.9 R6K-F1: guard contra promoção em rows com DADOS CORROMPIDOS.
              // Bloqueia se: sem fixture, sem market, sem selection,
              // audit=unknown+trust=unknown+score=0, ou score absurdo (0 ou >100).
              // NÃO toca pickAuditStatus/trustLevel — apenas zera can_post/training
              // se o guard bloquear. Mercado arriscado e score baixo não disparam
              // mais (vão como badge no payload R6K-F2).
              const _r6f1Guard = shouldAdminPromoteStaleCandidate({
                row: {
                  market:     row.market,
                  selection:  row.selection,
                  fixture_id: row.fixture_id,
                },
                audit: { pickAuditStatus, trustLevel, canPost, trainingEligible },
                confidence: {
                  score: row.bet_confidence_score,
                  tier:  row.bet_confidence_tier,
                },
              });
              const _finalCanPost = _r6f1Guard.canPost;
              const _finalTraining = _r6f1Guard.trainingEligible;
              if (_r6f1Guard.blocked) {
                r6hgBlocked++;
                r6hgBlockedReasons[_r6f1Guard.reason] = (r6hgBlockedReasons[_r6f1Guard.reason] || 0) + 1;
              }
              stmts.push(env.SB_DB.prepare(
                `UPDATE shadow_bets SET audit_status=?, trust_level=?, can_post=?,
                 training_eligible=?
                 WHERE id=? AND audit_status='unknown'`
              ).bind(pickAuditStatus, trustLevel, _finalCanPost, _finalTraining, row.id));
            } catch (_e) {
              auditErrors++;
            }
          }
          if (stmts.length > 0) {
            const res = await env.SB_DB.batch(stmts);
            auditUpdated += res.filter(r => r?.meta?.changes > 0).length;
            auditErrors  += res.filter(r => r.success === false).length;
          }
        }

        // Collect after state
        const auditAfterAll = await env.SB_DB.prepare(
          `SELECT audit_status, COUNT(*) as cnt FROM shadow_bets GROUP BY audit_status`
        ).all().catch(() => ({ results: [] }));
        const trainingAfterAll = await env.SB_DB.prepare(
          `SELECT training_eligible, COUNT(*) as cnt FROM shadow_bets GROUP BY training_eligible`
        ).all().catch(() => ({ results: [] }));

        const _dist = (rows) => Object.fromEntries((rows?.results || []).map(r => [r.audit_status ?? r.training_eligible, r.cnt]));

        return new Response(JSON.stringify({
          ok: true,
          rows_found:            toUpdate.length,
          updated,
          errors:                confErrors,
          audit_rows_found:      toAudit.length,
          audit_updated:         auditUpdated,
          audit_errors:          auditErrors,
          audit_status_before:   _dist(auditBeforeAll),
          audit_status_after:    _dist(auditAfterAll),
          training_eligible_before: _dist(trainingBeforeAll),
          training_eligible_after:  _dist(trainingAfterAll),
          // P3.9 R6H-G: observabilidade do guard. Conta quantas rows tiveram
          // can_post/training_eligible bloqueados na promoção admin, por motivo.
          r6hg_promotion_blocked:      r6hgBlocked,
          r6hg_blocked_reasons:        r6hgBlockedReasons,
          duration_ms: Date.now() - t0,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }
    }

    // ── /v1/admin/* — gerenciamento de API keys (método agnóstico, auth próprio) ──
    if (pathname.startsWith('/v1/admin')) {
      return handleAdmin(pathname, request, env);
    }

    // ── /admin/lt/health — Neon ping (público pra debug) ──
    if (pathname === '/admin/lt/health') {
      const { ltPing } = await import('./storage/longterm.js');
      const r = await ltPing(env);
      return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    // ── /admin/lt/backfill — copia D1 → Neon (auth: X-Admin-Key) ──
    if (pathname === '/admin/lt/backfill') {
      const { handleBackfillLT } = await import('./routes/backfillLT.js');
      return handleBackfillLT(request, env);
    }

    // ── /admin/enrich/upcoming — builds team_features for next 48h (auth) ──
    if (pathname === '/admin/enrich/upcoming') {
      const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key');
      if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      }
      const u = new URL(request.url);
      const hoursAhead = parseInt(u.searchParams.get('hours') || '48', 10);
      const maxEvents = parseInt(u.searchParams.get('max') || '30', 10);
      const { enrichUpcomingEvents } = await import('./enrich/teamFeatures.js');
      const r = await enrichUpcomingEvents(env, { hoursAhead, maxEvents });
      return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    // ── /admin/cron/run — manual cron trigger (auth: SB_MASTER_KEY or ?key=) ──
    if (pathname === '/admin/cron/run') {
      const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key');
      if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      }
      const job = new URL(request.url).searchParams.get('job') || 'form';
      let result;
      if (job === 'form')    result = await collectForm(env).catch(e => ({ ok: false, error: e.message }))
      else if (job === 'ingest') result = await ingestMatches(env, { daysBack: 30, includeFuture: false }).catch(e => ({ ok: false, error: e.message }))
      else if (job === 'steam')  result = await detectSteam(env).catch(e => ({ ok: false, error: e.message }))
      else if (job === 'autoverify') result = await runPickAutoVerify(env).catch(e => ({ ok: false, error: e.message }))
      else if (job === 'autoverify-recovery') result = await runPickAutoVerify(env, true).catch(e => ({ ok: false, error: e.message }))
      else if (job === 'warm-cache') result = await warmYesterdayCache(env).catch(e => ({ ok: false, error: e.message }))
      else if (job === 'diagnose') {
        const [formRows, matchRows, signalRows] = await Promise.all([
          env.SB_DB.prepare(`SELECT team_name_norm, home_away, last5_scored, form_pts FROM team_form_cache ORDER BY updated_at DESC LIMIT 10`).all().catch(() => ({ results: [] })),
          env.SB_DB.prepare(`SELECT home_team_norm, away_team_norm, match_date, score_home, score_away FROM matches_raw ORDER BY match_date DESC LIMIT 10`).all().catch(() => ({ results: [] })),
          env.SB_DB.prepare(`SELECT id, signal_factor, is_steam FROM odds_signals LIMIT 5`).all().catch(() => ({ results: [] })),
        ])
        result = { form_cache: formRows.results, recent_matches: matchRows.results, odds_signals: signalRows.results }
      }
      else result = { ok: false, error: `unknown job: ${job}. use form|ingest|steam|diagnose` }
      return new Response(JSON.stringify({ ok: true, job, result }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    // ── /admin/calibration/build — rebuild isotonic curves (auth) ──
    if (pathname === '/admin/calibration/build') {
      const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key');
      if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      }
      const { buildAllCurves } = await import('./ml/calibration.js');
      const r = await buildAllCurves(env);
      return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    // ── /admin/ml/upload — XGBoost model upload (auth via handler) ──
    if (pathname === '/admin/ml/upload' || pathname === '/v1/admin/ml/upload') {
      const { handleXGBUpload } = await import('./ml/xgb.js');
      return handleXGBUpload(request, env);
    }

    // ── /v1/ml/predict-soccer-xg?event_id=... — Poisson+xG prediction ──
    if (pathname === '/v1/ml/predict-soccer-xg') {
      const eid = new URL(request.url).searchParams.get('event_id');
      if (!eid) return new Response(JSON.stringify({ ok: false, error: 'event_id required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      const ev = await env.SB_DB.prepare(
        `SELECT id, sport, league, league_slug, home, away, commence_time FROM odds_events WHERE id = ? LIMIT 1`
      ).bind(eid).first();
      if (!ev) return new Response(JSON.stringify({ ok: false, error: 'event_not_found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      const { predictSoccerXG } = await import('./ml/poissonXG.js');
      const { calibrate } = await import('./ml/calibration.js');
      const pred = await predictSoccerXG(env, ev);
      if (!pred) return new Response(JSON.stringify({ ok: false, error: 'no_prediction' }), { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
      const calibrated = pred.h2h ? {
        home: await calibrate(env, 'soccer', 'h2h', pred.h2h.home),
        draw: await calibrate(env, 'soccer', 'h2h', pred.h2h.draw),
        away: await calibrate(env, 'soccer', 'h2h', pred.h2h.away),
      } : {};
      return new Response(JSON.stringify({ ok: true, raw: pred, calibrated }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }

    // ── /admin/performance + /admin/picks/* — CLV dashboard ──
    if (pathname.startsWith('/admin/performance') || pathname.startsWith('/admin/picks/')) {
      const { handleAdminPerformance } = await import('./routes/adminPerformance.js');
      return handleAdminPerformance(pathname, request, env);
    }

    // ── /admin/* — health dashboard interno (HTML + JSON) ──
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      const { handleAdminHealth } = await import('./routes/adminHealth.js');
      return handleAdminHealth(pathname, request, env);
    }

    // ── /internal/ingest-odds — HMAC-authed external ingest (GH Actions / VPS) ──
    if (pathname === '/internal/ingest-odds') {
      return handleOddsEngine(pathname, request, env);
    }

    // ── /internal/ingest-boosts — Bet365 boost daily ingest (cron 2am BR) ──
    if (pathname === '/internal/ingest-boosts') {
      const { handleAumentadasIngest } = await import('./routes/aumentadas.js');
      return handleAumentadasIngest(request, env);
    }
    // ── /v1/aumentadas/latest — frontend reads daily boosts ──
    if (pathname === '/v1/aumentadas/latest') {
      const { handleAumentadasLatest } = await import('./routes/aumentadas.js');
      return handleAumentadasLatest(request, env);
    }
    // ── /v1/aumentadas/trigger — POST to dispatch GH Actions workflow now ──
    if (pathname === '/v1/aumentadas/trigger') {
      const { handleAumentadasTrigger } = await import('./routes/aumentadas.js');
      return handleAumentadasTrigger(request, env);
    }
    // ── /v1/bet365/matches/latest — Bet365 schedule snapshot (matches w/ 1X2 odds) ──
    if (pathname === '/v1/bet365/matches/latest') {
      const { handleBet365MatchesLatest } = await import('./routes/aumentadas.js');
      return handleBet365MatchesLatest(request, env);
    }
    // ── /v1/bet365/markets/latest — full markets (1X2/O-U/BTTS/Player Props) ──
    if (pathname === '/v1/bet365/markets/latest') {
      const { handleBet365MarketsLatest } = await import('./routes/aumentadas.js');
      return handleBet365MarketsLatest(request, env);
    }
    // ── /v1/bet365/markets/analyzed — markets c/ devig + EV vs cross-book ──
    if (pathname === '/v1/bet365/markets/analyzed') {
      const { handleBet365MarketsAnalyzed } = await import('./routes/bet365Markets.js');
      return handleBet365MarketsAnalyzed(request, env);
    }
    // ── /v1/bet365/markets/history — trajetória de odds (últimos N snapshots) ──
    if (pathname === '/v1/bet365/markets/history') {
      const { handleBet365MarketsHistory } = await import('./routes/bet365Markets.js');
      return handleBet365MarketsHistory(request, env);
    }
    // ── /v1/bet365/markets/suggested-combos — combos +EV gerados auto ──
    if (pathname === '/v1/bet365/markets/suggested-combos') {
      const { handleBet365SuggestedCombos } = await import('./routes/bet365Markets.js');
      return handleBet365SuggestedCombos(request, env);
    }
    // ── /v1/picks/* — picks history (D1 persistent, sync cross-device) ──
    // (rotas /v1/picks/list|update|delete movidas pra cima — antes do startsWith legacy)
    // ── /v1/ai/learning — analisa W/L history + retorna ajustes confidence ──
    if (pathname === '/v1/ai/learning') {
      const { handleAILearning } = await import('./routes/aiLearning.js');
      return handleAILearning(request, env);
    }
    // ── /v1/ai/bayesian — Bayesian shrinkage v2 (funciona com poucas amostras) ──
    if (pathname === '/v1/ai/bayesian') {
      const { handleBayesianLearning } = await import('./routes/bayesianLearning.js');
      return handleBayesianLearning(request, env);
    }
    // ── /v1/bet365/markets/mispriced — odds desajustadas (steam + cross-book) ──
    if (pathname === '/v1/bet365/markets/mispriced') {
      const { handleBet365Mispriced } = await import('./routes/mispricedDetector.js');
      return handleBet365Mispriced(request, env);
    }
    // ── /internal/ingest-mybets — recebe scrape de Minhas Apostas Bet365 ──
    if (pathname === '/internal/ingest-mybets') {
      const { handleMyBetsIngest } = await import('./routes/userBets.js');
      return handleMyBetsIngest(request, env);
    }
    // ── /v1/banca/snapshot — frontend lê saldo + apostas recentes ──
    if (pathname === '/v1/banca/snapshot') {
      const { handleBancaSnapshot } = await import('./routes/userBets.js');
      return handleBancaSnapshot(request, env);
    }
    // ── POST /v1/banca/manual-balance — user override quando scraper falha ──
    if (pathname === '/v1/banca/manual-balance' && request.method === 'POST') {
      const { handleBancaManualBalance } = await import('./routes/userBets.js');
      return handleBancaManualBalance(request, env);
    }
    // ── POST /internal/cleanup-zombie-bets — limpa bets com IDs antigos ──
    if (pathname === '/internal/cleanup-zombie-bets' && request.method === 'POST') {
      const { handleCleanupZombieBets } = await import('./routes/userBets.js');
      return handleCleanupZombieBets(request, env);
    }
    // ── Telegram Tips (4 endpoints) ──
    if (pathname === '/internal/ingest-telegram-tips' && request.method === 'POST') {
      const { handleIngestTelegramTips } = await import('./routes/telegramTips.js');
      return handleIngestTelegramTips(request, env);
    }
    if (pathname === '/v1/telegram/tipsters') {
      const { handleTipstersLeaderboard } = await import('./routes/telegramTips.js');
      return handleTipstersLeaderboard(request, env);
    }
    if (pathname === '/v1/telegram/tips-feed') {
      const { handleTipsFeed } = await import('./routes/telegramTips.js');
      return handleTipsFeed(request, env);
    }
    if (pathname === '/v1/telegram/consensus') {
      const { handleConsensus } = await import('./routes/telegramTips.js');
      return handleConsensus(request, env);
    }
    if (pathname === '/v1/telegram/report') {
      const { handleTelegramReport } = await import('./routes/telegramTips.js');
      return handleTelegramReport(request, env);
    }
    if (pathname === '/v1/telegram/ml-features') {
      const { handleTelegramMLFeatures } = await import('./routes/telegramTips.js');
      return handleTelegramMLFeatures(request, env);
    }
    if (pathname === '/v1/telegram/tipster-quality-score') {
      const { handleTipsterQualityScore } = await import('./routes/telegramTips.js');
      return handleTipsterQualityScore(request, env);
    }
    if (pathname === '/v1/telegram/follow-tipster') {
      const { handleFollowTipster } = await import('./routes/telegramTips.js');
      return handleFollowTipster(request, env);
    }
    if (pathname === '/v1/telegram/combos-grouped') {
      const { handleCombosGrouped } = await import('./routes/telegramTips.js');
      return handleCombosGrouped(request, env);
    }
    if (pathname === '/internal/group-combos' && request.method === 'POST') {
      const { handleGroupCombos } = await import('./routes/telegramTips.js');
      return handleGroupCombos(request, env);
    }
    if (pathname === '/internal/update-tips-results' && request.method === 'POST') {
      const { handleUpdateTipsResults } = await import('./routes/telegramTips.js');
      return handleUpdateTipsResults(request, env);
    }
    if (pathname === '/internal/cleanup-standalone-greens' && request.method === 'POST') {
      const { handleCleanupStandaloneGreens } = await import('./routes/telegramTips.js');
      return handleCleanupStandaloneGreens(request, env);
    }
    // ── /internal/ingest-live-snapshot — recebe odds tracker live (75s polling) ──
    if (pathname === '/internal/ingest-live-snapshot' && request.method === 'POST') {
      const secret = request.headers.get('X-Ingest-Secret')
      if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
      }
      try {
        const body = await request.json()
        const snapshots = body.snapshots || []
        if (!snapshots.length) return new Response(JSON.stringify({ ok: true, saved: 0 }), { headers: corsHeaders() })
        await env.SB_DB.exec(
          `CREATE TABLE IF NOT EXISTS live_odds_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at INTEGER, fixture_id TEXT, payload TEXT)`
        )
        let saved = 0
        for (const s of snapshots) {
          await env.SB_DB.prepare(
            `INSERT INTO live_odds_snapshots (captured_at, fixture_id, payload) VALUES (?, ?, ?)`
          ).bind(body.capturedAt || Date.now(), s.fixtureId, JSON.stringify(s)).run().catch(() => {})
          saved++
        }
        // Prune snapshots >24h
        await env.SB_DB.prepare(`DELETE FROM live_odds_snapshots WHERE captured_at < ?`).bind(Date.now() - 86400_000).run().catch(()=>{})
        return new Response(JSON.stringify({ ok: true, saved }), { status: 200, headers: corsHeaders() })
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
      }
    }

    // ── /v1/history/* — long-term Neon queries (snapshots, picks) ──
    if (pathname.startsWith('/v1/history/')) {
      const { handleHistory } = await import('./routes/history.js');
      return handleHistory(pathname, request, env);
    }

    // ── /v1/ai/copilot — BYO-key AI assistant (POST) ──
    if (pathname === '/v1/ai/copilot') {
      const { handleAiCopilot } = await import('./routes/aiCopilot.js');
      return handleAiCopilot(request, env);
    }

    // ── /v1/context/:event_id — injuries/weather/referee/rest aggregator ──
    if (pathname.startsWith('/v1/context/')) {
      const { handleContext } = await import('./routes/context.js');
      return handleContext(pathname, request, env);
    }

    // ── /v1/portfolio/* — pick tracker + CLV stats (GET/POST/PATCH) ──
    if (pathname.startsWith('/v1/portfolio/')) {
      const { handlePortfolio } = await import('./routes/portfolio.js');
      return handlePortfolio(pathname, request, env);
    }

    // ── /v1/backtest — strategy backtester ──
    if (pathname === '/v1/backtest') {
      const { handleBacktest } = await import('./routes/backtest.js');
      return handleBacktest(request, env);
    }

    // ── /v1/realtime/odds — WebSocket push (Durable Object) ──
    // Gated: tier precisa de realtime_ws=true (Sharp/Enterprise)
    if (pathname === '/v1/realtime/odds') {
      const authWs = await resolveApiTier(request, env, pathname);
      const wsLimits = getTierLimits(authWs.tier);
      if (!wsLimits.realtime_ws) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'TIER_REQUIRED',
          message: 'Realtime WebSocket requer tier Sharp+',
          your_tier: authWs.tier,
          required_tier: 'sharp',
        }), { status: 402, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
      }
      const { handleRealtimeWS } = await import('./routes/realtime.js');
      return handleRealtimeWS(request, env);
    }

    // Only GET for all other public routes (parlay aceita POST)
    const POST_ALLOWED = new Set(['/v1/odds/refresh', '/v1/ai/copilot', '/v1/portfolio/pick']);
    if (request.method !== 'GET' && !pathname.startsWith('/v1/parlay/') && !POST_ALLOWED.has(pathname) && !/^\/v1\/portfolio\/pick\/\d+$/.test(pathname)) {
      return new Response(JSON.stringify(sbError('METHOD_NOT_ALLOWED', 'Only GET is supported', 405)), {
        status: 405, headers: corsHeaders(),
      });
    }
    const start    = Date.now();

    // Services
    const cache      = new CacheService(env);
    const football   = new FootballService(env, cache);
    const basketball = new BasketballService(env, cache);
    const odds       = new OddsService(env, cache);
    const persist    = new PersistenceService(env);
    const services   = { cache, football, basketball, odds, persist };

    // Auth
    const auth = await resolveApiTier(request, env, pathname);
    if (!auth.allowed) {
      console.error('[Auth]', auth.error, pathname);
      return new Response(JSON.stringify(sbError('UNAUTHORIZED', 'Invalid or missing API key', 401)), {
        status: 401, headers: corsHeaders(),
      });
    }

    // ── Rate-limit enforcement (keys autenticadas com plano) ─────────────
    if (auth.keyHash && auth.rate_limit) {
      const rl = await checkRateLimit(env, auth.keyHash, auth.rate_limit);
      if (!rl.allowed) {
        return new Response(JSON.stringify(sbError(
          'RATE_LIMIT_EXCEEDED',
          `Rate limit ${rl.limit}/hour exceeded (${rl.used} used). Tier: ${auth.tier}. Upgrade: /v1/docs/pricing`,
          429
        )), {
          status: 429,
          headers: {
            ...corsHeaders(),
            'X-RateLimit-Limit':     String(rl.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Used':      String(rl.used),
            'Retry-After':           '3600',
          },
        });
      }
    }

    // Determine sport for access check + logging
    let reqSport = null;
    if (pathname.startsWith('/v1/football'))   reqSport = 'football';
    if (pathname.startsWith('/v1/basketball')) reqSport = 'basketball';

    // Sport tier check (skip for demo/public/intelligence/market/analytics)
    if (reqSport && !['public', 'demo'].includes(auth.tier) && !canAccess(auth.tier, 'sport', reqSport)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', `${reqSport} not available on ${auth.tier} tier`, 403)), {
        status: 403, headers: corsHeaders(),
      });
    }

    // Market tier check
    if (pathname.startsWith('/v1/market') && !canAccess(auth.tier, 'market')) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Market Intelligence requires starter tier or higher', 403)), {
        status: 403, headers: corsHeaders(),
      });
    }

    // Analytics tier check
    if (pathname.startsWith('/v1/analytics') && !canAccess(auth.tier, 'analytics')) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Analytics requires pro tier or higher', 403)), {
        status: 403, headers: corsHeaders(),
      });
    }

    let status = 200;

    try {
      // ── /health ────────────────────────────────────────────────────
      if (pathname === '/health' || pathname === '/') {
        const res = await handleHealth(request, env, services);
        return addResponseHeaders(res, auth.tier, start, 'data');
      }

      // ── /v1/status ─────────────────────────────────────────────────
      if (pathname === '/v1/status') {
        const res = new Response(JSON.stringify({
          api:       'SportsBrain Data API',
          version:   API_VERSION,
          status:    'operational',
          tier:      auth.tier,
          layers:    ['data', 'intelligence', 'market', 'analytics'],
          timestamp: new Date().toISOString(),
        }, null, 2), { status: 200, headers: corsHeaders() });
        return addResponseHeaders(res, auth.tier, start, 'data');
      }

      // ── /v1/demo/* (public, no auth) ────────────────────────────────
      if (pathname.startsWith('/v1/demo')) {
        const res = handleDemo(pathname);
        return res;
      }

      // ── /v1/docs/* (public — transparência/model-card/pricing) ──────
      if (pathname.startsWith('/v1/docs')) {
        return handleDocs(pathname);
      }

      // ── /v1/parlay/* (parlay pricing com correla\u00e7\u00e3o) ─────────────
      if (pathname.startsWith('/v1/parlay/')) {
        return await handleParlay(pathname, request);
      }

      // ── /v1/match|lineups|weather|players/* (detail propriet\u00e1rio) ─
      if (pathname.startsWith('/v1/match/') ||
          pathname.startsWith('/v1/lineups/') ||
          pathname.startsWith('/v1/referee/') ||
          pathname.startsWith('/v1/weather/') ||
          pathname.startsWith('/v1/players/')) {
        return await handleDetail(pathname, request, env);
      }

      // ── /v1/xg* (SportsBrain proprietary xG — D1 + nosso modelo) ──────
      if (pathname === '/v1/xg' || pathname.startsWith('/v1/xg/')) {
        const res = await handleXG(pathname, request, env);
        const resp = addResponseHeaders(res, auth.tier, start, 'data');
        ctx.waitUntil(logUsage(env, ctx, {
          apiKey: request.headers.get('X-SB-Key'),
          endpoint: pathname, statusCode: res.status,
          responseTimeMs: Date.now() - start, sport: 'football', tier: auth.tier,
        }));
        return resp;
      }

      // ── /v1/briefing/:home/:away (produto principal vendável) ───────
      if (pathname.startsWith('/v1/briefing/')) {
        const res = await handleBriefing(pathname, request, env, services);
        const resp = addResponseHeaders(res, auth.tier, start, 'intelligence');
        ctx.waitUntil(logUsage(env, ctx, {
          apiKey: request.headers.get('X-SB-Key'),
          endpoint: pathname, statusCode: res.status,
          responseTimeMs: Date.now() - start, sport: 'football', tier: auth.tier,
        }));
        return resp;
      }

      // ── /v1/matches  (unified matches endpoint — real data) ────────
      if (pathname === '/v1/matches' || pathname === '/v1/matches/today') {
        const q          = url.searchParams;
        const dateParam  = q.get('date') || null;
        const sportFilt  = (q.get('sport') || '').toLowerCase();
        const statusFilt = (q.get('status') || '').toUpperCase();
        const page       = parseInt(q.get('page') || '1', 10);
        const perPage    = Math.min(parseInt(q.get('per_page') || '50', 10), 200);

        // Country map: API-Football league name → country
        const COUNTRY_MAP = {
          'Premier League':'England','La Liga':'Spain','Bundesliga':'Germany',
          'Serie A':'Italy','Ligue 1':'France','Brasileirão A':'Brazil',
          'Brasileirão B':'Brazil','Brasileiro Série A':'Brazil',
          'Copa Libertadores':'S. America','Copa do Brasil':'Brazil',
          'UEFA Champions League':'UEFA','Champions League':'UEFA',
          'Europa League':'UEFA','Conference League':'UEFA',
          'MLS':'USA','Primeira Liga':'Portugal','Eredivisie':'Netherlands',
          'Liga Argentina':'Argentina','Liga Profesional Argentina':'Argentina',
        };

        // Map internal status → status_meta object (matches format FtProps expects)
        function toStatusMeta(status) {
          const s = (status || '').toLowerCase();
          if (s === 'ft' || s === 'finished')  return { isLive:false,isHT:false,isFin:true, isPre:false,isActive:false,label:'Encerrado' };
          if (s === 'live')                     return { isLive:true, isHT:false,isFin:false,isPre:false,isActive:true, label:'Ao Vivo'  };
          if (s === 'ht')                       return { isLive:false,isHT:true, isFin:false,isPre:false,isActive:true, label:'Intervalo'};
          if (s === 'postponed')                return { isLive:false,isHT:false,isFin:false,isPre:false,isActive:false,label:'Adiado'  };
          return                                       { isLive:false,isHT:false,isFin:false,isPre:true, isActive:false,label:'Agendado'};
        }

        const result = await football.getTodayGames(dateParam);
        let matches = (result.games || []).map(g => ({
          ...g,
          home_team:    g.home_team,
          away_team:    g.away_team,
          league:       g.league,
          league_country: COUNTRY_MAP[g.league] || g.league_country || g.country || null,
          country:      COUNTRY_MAP[g.league] || g.league_country || g.country || null,
          status:       (g.status || 'scheduled').toUpperCase().replace('SCHEDULED','NS'),
          status_meta:  toStatusMeta(g.status),
        }));

        // Filters
        if (sportFilt && sportFilt !== 'football') matches = []; // only football here
        if (statusFilt) matches = matches.filter(m => m.status === statusFilt);

        // Pagination
        const total  = matches.length;
        const sliced = matches.slice((page - 1) * perPage, page * perPage);

        return new Response(JSON.stringify({
          ok: true,
          matches: sliced,
          meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage), date: result.date, source: result.source },
          ts: Date.now(),
        }), { status: 200, headers: corsHeaders() });
      }

      // ── /v1/odds/* (PROPRIETARY ODDS ENGINE — multi-book scrapers + D1) ─
      // Substitui o proxy TheOddsAPI. Dados vêm de Betfair/Pinnacle/Betano/Superbet
      // via scrapers próprios, persistidos em D1 (odds_snapshots/odds_consensus).
      if (pathname === '/v1/odds/all' ||
          pathname === '/v1/odds/books' ||
          pathname === '/v1/odds/refresh' ||
          pathname === '/v1/odds/_debug' ||
          pathname === '/v1/odds/value' ||
          pathname === '/v1/odds/arbitrage' ||
          pathname === '/v1/odds/middles' ||
          pathname === '/v1/odds/hold' ||
          pathname === '/v1/odds/no_vig' ||
          pathname === '/v1/odds/widest' ||
          pathname.startsWith('/v1/odds/event/') ||
          pathname.startsWith('/v1/odds/movement/') ||
          pathname.startsWith('/v1/odds/steam/') ||
          pathname.startsWith('/v1/odds/opening/')) {
        const res = await handleOddsEngine(pathname, request, env, { tier: auth.tier, limits: getTierLimits(auth.tier) });
        return addResponseHeaders(res, auth.tier, start, 'market');
      }

      // ── /v1/featured — jogos com odds abertas no engine proprietário ─
      if (pathname === '/v1/featured') {
        const result = await odds.getAllEvents();
        const events = result.events || [];
        const featured = events
          .filter(ev => (ev.bookmakers || []).length > 0)
          .map(ev => ({
            home_team: ev.home_team,
            away_team: ev.away_team,
            sport:     ev.sport_key,
            commence:  ev.commence_time,
          }));
        const res = new Response(JSON.stringify({
          ok:      true,
          matches: featured,
          count:   featured.length,
          source:  result.source,
          ts:      Date.now(),
        }), { status: 200, headers: corsHeaders() });
        return addResponseHeaders(res, auth.tier, start, 'market');
      }

      // ── /v1/football/* ─────────────────────────────────────────────
      if (pathname.startsWith('/v1/football')) {
        const res = await handleFootball(pathname, request, env, services, ctx);
        status = res.status;
        const resp = addResponseHeaders(res, auth.tier, start, 'data');
        ctx.waitUntil(logUsage(env, ctx, {
          apiKey: request.headers.get('X-SB-Key'),
          endpoint: pathname, statusCode: status,
          responseTimeMs: Date.now() - start, sport: 'football', tier: auth.tier,
        }));
        return resp;
      }

      // ── /v1/basketball/* ───────────────────────────────────────────
      if (pathname.startsWith('/v1/basketball')) {
        const res = await handleBasketball(pathname, request, env, services, ctx);
        status = res.status;
        const resp = addResponseHeaders(res, auth.tier, start, 'data');
        ctx.waitUntil(logUsage(env, ctx, {
          apiKey: request.headers.get('X-SB-Key'),
          endpoint: pathname, statusCode: status,
          responseTimeMs: Date.now() - start, sport: 'basketball', tier: auth.tier,
        }));
        return resp;
      }

      // ── /v1/intelligence/* and /v1/recommendations/* and /v1/meta/* ─
      if (pathname.startsWith('/v1/intelligence') ||
          pathname.startsWith('/v1/recommendations') ||
          pathname.startsWith('/v1/meta')) {
        const res = await handleIntelligence(pathname, request, env, services);
        status = res.status;
        const resp = addResponseHeaders(res, auth.tier, start, 'intelligence');
        ctx.waitUntil(logUsage(env, ctx, {
          apiKey: request.headers.get('X-SB-Key'),
          endpoint: pathname, statusCode: status,
          responseTimeMs: Date.now() - start, sport: null, tier: auth.tier,
        }));
        return resp;
      }

      // ── /v1/market/* ────────────────────────────────────────────────
      if (pathname.startsWith('/v1/market')) {
        const res = await handleMarket(pathname, request, env, services);
        status = res.status;
        const resp = addResponseHeaders(res, auth.tier, start, 'market');
        ctx.waitUntil(logUsage(env, ctx, {
          apiKey: request.headers.get('X-SB-Key'),
          endpoint: pathname, statusCode: status,
          responseTimeMs: Date.now() - start, sport: null, tier: auth.tier,
        }));
        return resp;
      }

      // ── /v1/analytics/* ─────────────────────────────────────────────
      if (pathname.startsWith('/v1/analytics')) {
        const res = await handleAnalytics(pathname, request, env, services);
        status = res.status;
        const resp = addResponseHeaders(res, auth.tier, start, 'analytics');
        ctx.waitUntil(logUsage(env, ctx, {
          apiKey: request.headers.get('X-SB-Key'),
          endpoint: pathname, statusCode: status,
          responseTimeMs: Date.now() - start, sport: null, tier: auth.tier,
        }));
        return resp;
      }

      // ── /v1 (API index) ─────────────────────────────────────────────
      if (pathname === '/v1') {
        const res = new Response(JSON.stringify({
          api:     'SportsBrain Data API',
          version: API_VERSION,
          docs:    'https://sportsbrain.io/api/docs',
          demo:    'GET /v1/demo — explore schema without auth',
          tier:    auth.tier,
          layers: {
            data: {
              description: 'Raw sports data — games, players, teams, props',
              tiers: 'free+',
              endpoints: {
                football_games:   'GET /v1/football/games/today',
                football_props:   'GET /v1/football/props/today',
                basketball_games: 'GET /v1/basketball/games/today',
                basketball_props: 'GET /v1/basketball/props/today',
                basketball_player: 'GET /v1/basketball/player/:name/stats',
              },
            },
            intelligence: {
              description: 'Calculated projections, edge, EV, conviction tiers',
              tiers: 'free+',
              endpoints: {
                picks_today:   'GET /v1/intelligence/picks/today',
                recommendations: 'GET /v1/recommendations?sport=&min_confidence=&min_ev=',
                projection:    'GET /v1/intelligence/projection?avg=&stat=&line=&is_home=',
                edge:          'GET /v1/intelligence/edge?avg=&line=&stat=&odds_over=',
                streaks:       'GET /v1/intelligence/streaks/:sport',
              },
            },
            market: {
              description: 'Line movement, consensus, market signals',
              tiers: 'starter+',
              endpoints: {
                lines:     'GET /v1/market/lines/:sport',
                movement:  'GET /v1/market/movement/:prop_key',
                consensus: 'GET /v1/market/consensus',
              },
            },
            analytics: {
              description: 'Deep historical profiles and performance tracking',
              tiers: 'pro+',
              endpoints: {
                team_profile:   'GET /v1/analytics/team/:team_id',
                player_profile: 'GET /v1/analytics/player/:player_id',
                my_performance: 'GET /v1/analytics/performance/me',
              },
            },
          },
        }, null, 2), { status: 200, headers: corsHeaders() });
        return addResponseHeaders(res, auth.tier, start, 'data');
      }

      // Signal status debug endpoint
      if (pathname === '/v1/signals/status') return handleSignalStatus(request, env)

      // ── /v1/track-record — Ledger de transparência total (Estratégia de Dominância) ──
      // Dashboard público: picks verificados, ROI real por mercado/liga, drawdown honesto.
      // O que NENHUM tipster brasileiro tem — nossa maior arma de marketing e credibilidade.
      if (pathname === '/v1/track-record') return handleTrackRecord(request, env)

      // GET /v1/shadow-bets/summary — Shadow betting performance summary (simulated only)
      if (pathname === '/v1/shadow-bets/summary' && request.method === 'GET') {
        try {
          if (!env.SB_DB) {
            return new Response(JSON.stringify({ ok: false, error: 'db_unavailable' }), { status: 503, headers: corsHeaders() });
          }
          const days   = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10)));
          const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

          const [totRow, tierCountRow, tierRoiRow] = await Promise.all([
            env.SB_DB.prepare(
              `SELECT COUNT(*) as n,
                      SUM(CASE WHEN result_status='resolved' AND profit_unit > 0 THEN 1 ELSE 0 END) as wins,
                      SUM(CASE WHEN result_status='resolved' AND profit_unit < 0 THEN 1 ELSE 0 END) as losses,
                      SUM(CASE WHEN result_status='pending'  THEN 1 ELSE 0 END) as pending,
                      SUM(stake_simulated) as total_staked,
                      SUM(profit_brl) as total_profit
               FROM shadow_bets WHERE pick_date >= ?`
            ).bind(cutoff).first().catch(() => null),
            env.SB_DB.prepare(
              `SELECT bet_confidence_tier, COUNT(*) as n
               FROM shadow_bets WHERE pick_date >= ?
               GROUP BY bet_confidence_tier ORDER BY n DESC`
            ).bind(cutoff).all().catch(() => ({ results: [] })),
            env.SB_DB.prepare(
              `SELECT bet_confidence_tier, SUM(profit_unit) as profit_units
               FROM shadow_bets WHERE pick_date >= ? AND result_status='resolved'
               GROUP BY bet_confidence_tier`
            ).bind(cutoff).all().catch(() => ({ results: [] })),
          ]);

          const by_tier       = Object.fromEntries((tierCountRow?.results || []).map(r => [r.bet_confidence_tier, r.n]));
          const roi_by_tier   = Object.fromEntries(
            (tierRoiRow?.results || []).map(r => [r.bet_confidence_tier, +(r.profit_units ?? 0).toFixed(2)])
          );

          const betaMetrics = await queryBetaReadinessMetrics(env, days)
          const betaReadiness = computeBetaReadinessScore(betaMetrics)
          const bankrollCfg = getBankrollTestConfig()

          return new Response(JSON.stringify({
            ok: true,
            days,
            total_bets:       totRow?.n       ?? 0,
            wins:             totRow?.wins     ?? 0,
            losses:           totRow?.losses   ?? 0,
            pending:          totRow?.pending  ?? 0,
            total_staked_brl: +(totRow?.total_staked ?? 0).toFixed(2),
            total_profit_brl: +(totRow?.total_profit ?? 0).toFixed(2),
            by_confidence_tier: by_tier,
            roi_by_tier,
            note: 'Simulated only — not real money',
            beta_readiness: {
              score: betaReadiness.score,
              status: betaReadiness.status,
              can_micro_test: betaReadiness.can_micro_test,
              can_beta: betaReadiness.can_beta,
              can_sell: betaReadiness.can_sell,
              components: betaReadiness.components,
              metrics: betaMetrics,
              bankroll_config: bankrollCfg,
              safety_disclaimer: bankrollCfg.safety_disclaimer,
              note: 'Simulated only — not real money',
            },
          }), { status: 200, headers: corsHeaders() });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // GET /v1/beta-readiness — Beta readiness score + real money protocol gate
      if (pathname === '/v1/beta-readiness' && request.method === 'GET') {
        try {
          const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)))
          const metrics = await queryBetaReadinessMetrics(env, days)
          const microTestEnabled = env?.MICRO_TEST_ENABLED === 'true'
          const readiness = computeBetaReadinessScore(metrics, { micro_test_enabled: microTestEnabled })
          const bankrollCfg = getBankrollTestConfig()
          const rv = metrics?.resolved_valid ?? 0
          const microTestReport = await queryMicroTestReport(env, readiness, days)
          const microTestPolicy = evaluateMicroTestPolicy(microTestReport)
          const segmentHealth = evaluateSegmentHealth(microTestReport, microTestPolicy)
          const betaAdmission = evaluateBetaAdmission({
            micro_test_report:          microTestReport,
            micro_test_policy:          microTestPolicy,
            candidate_segments:         segmentHealth.candidate_segments,
            risk_segments:              segmentHealth.risk_segments,
            controlled_expansion_review: segmentHealth.controlled_expansion_review,
            beta_hold_review:           segmentHealth.beta_hold_review,
            micro_test_active:          readiness.micro_test_active,
            can_sell:                   false,
          }, {
            beta_manual_approval:              env?.BETA_MANUAL_APPROVAL === 'true',
            private_cohort_simulation_enabled: env?.PRIVATE_COHORT_SIMULATION_ENABLED === 'true',
            private_cohort_size:               parseInt(env?.PRIVATE_COHORT_SIZE || '0', 10),
            private_cohort_max_daily_picks:    parseInt(env?.PRIVATE_COHORT_MAX_DAILY_PICKS || '0', 10),
          })
          const sandbox = evaluatePrivateBetaSandbox({
            beta_admission_contract:   betaAdmission.beta_admission_contract,
            manual_approval_gate:      betaAdmission.manual_approval_gate,
            private_cohort_simulation: betaAdmission.private_cohort_simulation,
            beta_admission_review:     betaAdmission.beta_admission_review,
            candidate_segments:        segmentHealth.candidate_segments,
            risk_segments:             segmentHealth.risk_segments,
            micro_test_active:         readiness.micro_test_active,
            micro_test_report:         microTestReport,
            micro_test_policy:         microTestPolicy,
            can_sell:                  false,
            can_start_public_beta:     false,
          }, {
            private_beta_sandbox_enabled: env?.PRIVATE_BETA_SANDBOX_ENABLED === 'true',
            max_ledger_entries:           parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_LEDGER_ENTRIES || '25', 10),
            max_picks_per_run:            parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_PICKS_PER_RUN || '3', 10),
            strict_mode:                  env?.PRIVATE_BETA_SANDBOX_STRICT_MODE !== 'false',
          })
          const cohortMonitor = evaluateSimulatedCohortMonitor({
            private_beta_sandbox:      sandbox.private_beta_sandbox,
            sandbox_delivery_policy:   sandbox.sandbox_delivery_policy,
            sandbox_risk_controls:     sandbox.sandbox_risk_controls,
            simulated_delivery_ledger: sandbox.simulated_delivery_ledger,
            sandbox_audit_summary:     sandbox.sandbox_audit_summary,
            operator_review_console:   sandbox.operator_review_console,
            beta_admission_contract:   betaAdmission.beta_admission_contract,
            manual_approval_gate:      betaAdmission.manual_approval_gate,
            private_cohort_simulation: betaAdmission.private_cohort_simulation,
            beta_admission_review:     betaAdmission.beta_admission_review,
            candidate_segments:        segmentHealth.candidate_segments,
            risk_segments:             segmentHealth.risk_segments,
            micro_test_active:         readiness.micro_test_active,
            micro_test_report:         microTestReport,
            micro_test_policy:         microTestPolicy,
            can_sell:                  false,
            can_start_public_beta:     false,
          }, {
            max_ledger_entries: parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_LEDGER_ENTRIES || '25', 10),
            max_picks_per_run:  parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_PICKS_PER_RUN  || '3', 10),
          })
          const decisionPacket = evaluateOperatorDecisionPacket({
            resolved_valid:               rv,
            micro_test_threshold:         readiness.micro_test_threshold,
            can_micro_test:               readiness.can_micro_test,
            micro_test_active:            readiness.micro_test_active,
            micro_test_report:            microTestReport,
            micro_test_policy:            microTestPolicy,
            segment_health_matrix:        segmentHealth.segment_health_matrix,
            candidate_segments:           segmentHealth.candidate_segments,
            risk_segments:                segmentHealth.risk_segments,
            beta_admission_review:        betaAdmission.beta_admission_review,
            beta_admission_contract:      betaAdmission.beta_admission_contract,
            manual_approval_gate:         betaAdmission.manual_approval_gate,
            private_beta_sandbox:         sandbox.private_beta_sandbox,
            sandbox_audit_summary:        sandbox.sandbox_audit_summary,
            simulated_delivery_ledger:    sandbox.simulated_delivery_ledger,
            operator_review_console:      sandbox.operator_review_console,
            simulated_cohort_monitor:     cohortMonitor.simulated_cohort_monitor,
            ledger_health:                cohortMonitor.ledger_health,
            ledger_exposure:              cohortMonitor.ledger_exposure,
            delivery_drift_report:        cohortMonitor.delivery_drift_report,
            operator_approval_checklist:  cohortMonitor.operator_approval_checklist,
            cohort_monitoring_review:     cohortMonitor.cohort_monitoring_review,
            can_beta:                     false,
            can_sell:                     false,
            real_users:                   false,
            real_delivery:                false,
          })
          const reviewGovernance = evaluateManualReviewGovernance({
            operator_decision_packet:    decisionPacket.operator_decision_packet,
            launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
            beta_dry_run_report:         decisionPacket.beta_dry_run_report,
            launch_governance:           decisionPacket.launch_governance,
            governance_audit_summary:    decisionPacket.governance_audit_summary,
            micro_test_report:           microTestReport,
            micro_test_policy:           microTestPolicy,
            micro_test_active:           readiness.micro_test_active,
            candidate_segments:          segmentHealth.candidate_segments,
            risk_segments:               segmentHealth.risk_segments,
            beta_admission_review:       betaAdmission.beta_admission_review,
            private_beta_sandbox:        sandbox.private_beta_sandbox,
            simulated_delivery_ledger:   sandbox.simulated_delivery_ledger,
            simulated_cohort_monitor:    cohortMonitor.simulated_cohort_monitor,
            operator_approval_checklist: cohortMonitor.operator_approval_checklist,
            cohort_monitoring_review:    cohortMonitor.cohort_monitoring_review,
            can_beta:                    false,
            can_sell:                    false,
            real_users:                  false,
            real_delivery:               false,
          })
          const evidenceExport = evaluateEvidenceExport({
            operator_decision_packet:    decisionPacket.operator_decision_packet,
            launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
            beta_dry_run_report:         decisionPacket.beta_dry_run_report,
            launch_governance:           decisionPacket.launch_governance,
            governance_audit_summary:    decisionPacket.governance_audit_summary,
            operator_next_actions:       decisionPacket.operator_next_actions,
            micro_test_report:           microTestReport,
            micro_test_policy:           microTestPolicy,
            micro_test_active:           readiness.micro_test_active,
            micro_test_status:           readiness.micro_test_status,
            can_micro_test:              readiness.can_micro_test,
            resolved_valid:              rv,
            candidate_segments:          segmentHealth.candidate_segments,
            risk_segments:               segmentHealth.risk_segments,
            beta_admission_review:       betaAdmission.beta_admission_review,
            beta_admission_contract:     betaAdmission.beta_admission_contract,
            private_beta_sandbox:        sandbox.private_beta_sandbox,
            simulated_delivery_ledger:   sandbox.simulated_delivery_ledger,
            simulated_cohort_monitor:    cohortMonitor.simulated_cohort_monitor,
            operator_approval_checklist: cohortMonitor.operator_approval_checklist,
            cohort_monitoring_review:    cohortMonitor.cohort_monitoring_review,
            manual_review_artifact:      reviewGovernance.manual_review_artifact,
            approval_simulation:         reviewGovernance.approval_simulation,
            no_launch_governance:        reviewGovernance.no_launch_governance,
            release_hard_locks:          reviewGovernance.release_hard_locks,
            operator_review_audit_trail: reviewGovernance.operator_review_audit_trail,
            manual_review_summary:       reviewGovernance.manual_review_summary,
            can_beta:                    false,
            can_sell:                    false,
            real_users:                  false,
            real_delivery:               false,
          })
          const exportContractResult = evaluateExportContract({
            evidence_export_packet:      evidenceExport.evidence_export_packet,
            operator_report_render:      evidenceExport.operator_report_render,
            operator_report_summary:     evidenceExport.operator_report_summary,
            decision_fingerprint:        evidenceExport.decision_fingerprint,
            export_validation_summary:   evidenceExport.export_validation_summary,
            governance_regression_suite: evidenceExport.governance_regression_suite,
            manual_review_artifact:      reviewGovernance.manual_review_artifact,
            approval_simulation:         reviewGovernance.approval_simulation,
            no_launch_governance:        reviewGovernance.no_launch_governance,
            release_hard_locks:          reviewGovernance.release_hard_locks,
            manual_review_summary:       reviewGovernance.manual_review_summary,
            operator_decision_packet:    decisionPacket.operator_decision_packet,
            launch_governance:           decisionPacket.launch_governance,
            launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
            can_beta:                    false,
            can_sell:                    false,
          })
          const snapshotSimResult = evaluateSnapshotSimulation({
            decision_fingerprint:        evidenceExport.decision_fingerprint,
            launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
            manual_review_artifact:      reviewGovernance.manual_review_artifact,
            no_launch_governance:        reviewGovernance.no_launch_governance,
            can_beta:                    false,
            can_sell:                    false,
          })
          const regressionLockdownResult = evaluateRegressionLockdown({
            download_enabled:            false,
            download_publicly_available: false,
            can_beta:                    false,
            can_sell:                    false,
            release_allowed:             false,
            export_allows_beta:          false,
            export_allows_sell:          false,
            commercial_claims_allowed:   false,
            real_users:                  false,
            real_delivery:               false,
            commercial_claims_guard:     exportContractResult.commercial_claims_guard,
            historical_snapshot_simulation: snapshotSimResult.historical_snapshot_simulation,
            no_launch_governance:        reviewGovernance.no_launch_governance,
            governance_regression_suite: evidenceExport.governance_regression_suite,
          })
          const adminExportPreviewResult = evaluateAdminExportPreview({
            admin_key_present:           false,
            operator_report_render:      evidenceExport.operator_report_render,
            decision_fingerprint:        evidenceExport.decision_fingerprint,
            launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
            manual_review_artifact:      reviewGovernance.manual_review_artifact,
            no_launch_governance:        reviewGovernance.no_launch_governance,
            commercial_claims_guard:     exportContractResult.commercial_claims_guard,
            operator_report_download_contract: exportContractResult.operator_report_download_contract,
            regression_lockdown:         regressionLockdownResult.regression_lockdown,
            can_beta:                    false,
            can_sell:                    false,
          })
          const redactionResult = evaluateReportRedaction({
            operator_report_render:  evidenceExport.operator_report_render,
            internal_report_preview: adminExportPreviewResult.internal_report_preview,
          })
          const abuseResult = evaluateExportAbuseProtection({
            redacted_operator_report: redactionResult.redacted_operator_report,
            commercial_claims_guard:  exportContractResult.commercial_claims_guard,
            regression_lockdown:      regressionLockdownResult.regression_lockdown,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
          })
          const uxResult = evaluateAdminPreviewUx({
            admin_export_access_control:   adminExportPreviewResult.admin_export_access_control,
            internal_download_preflight:   abuseResult.internal_download_preflight,
            report_redaction_policy:       redactionResult.report_redaction_policy,
            export_abuse_protection:       abuseResult.export_abuse_protection,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
            launch_no_launch_decision:     decisionPacket.launch_no_launch_decision,
            manual_review_artifact:        reviewGovernance.manual_review_artifact,
            export_integrity_contract:     exportContractResult.export_integrity_contract,
            regression_lockdown:           regressionLockdownResult.regression_lockdown,
            commercial_claims_guard:       exportContractResult.commercial_claims_guard,
          })
          const rendererResult = evaluateInternalExportRenderer({
            operator_report_render:        evidenceExport.operator_report_render,
            decision_fingerprint:          evidenceExport.decision_fingerprint,
            launch_no_launch_decision:     decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:      decisionPacket.decision_evidence_matrix,
            manual_review_artifact:        reviewGovernance.manual_review_artifact,
            no_launch_governance:          reviewGovernance.no_launch_governance,
            regression_lockdown:           regressionLockdownResult.regression_lockdown,
            commercial_claims_guard:       exportContractResult.commercial_claims_guard,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
            operator_next_actions:         decisionPacket.operator_next_actions,
            evidence_export_packet:        evidenceExport.evidence_export_packet,
          })
          const dryRunResult = evaluateAdminDownloadDryRun({
            format:               'json',
            _rendered_content:    rendererResult._rendered_content,
            decision_fingerprint: evidenceExport.decision_fingerprint,
          })
          const regressionLockResult = evaluateRedactionRegressionLock({
            rendered_export_formats: rendererResult._rendered_content,
            report_redaction_policy: redactionResult.report_redaction_policy,
          })
          const archiveResult = evaluateAdminExportArchive({
            internal_export_renderer:      rendererResult.internal_export_renderer,
            rendered_export_formats:       rendererResult.rendered_export_formats,
            export_format_validation:      rendererResult.export_format_validation,
            format_render_summary:         rendererResult.format_render_summary,
            download_response_contract:    dryRunResult.download_response_contract,
            admin_download_dry_run:        dryRunResult.admin_download_dry_run,
            redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
            decision_fingerprint:          evidenceExport.decision_fingerprint,
          })
          const historyResult = evaluateReportHistorySimulation({
            decision_fingerprint:        evidenceExport.decision_fingerprint,
            launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
          })
          const accessAuditResult = evaluateAdminAccessAudit({
            authorized:            false,
            admin_key_present:     false,
            admin_key_valid:       false,
            sb_master_key_present: false,
            selected_format:       'json',
            selected_mode:         'compact',
          })
          const storageResult = evaluateInternalExportStorage({
            redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
            export_format_validation:      rendererResult.export_format_validation,
            internal_export_renderer:      rendererResult.internal_export_renderer,
          })
          const replayResult = evaluateAdminAccessReplay({})
          const freezeResult = evaluateReleaseFreezeSentinel({
            regression_lockdown:       regressionLockdownResult.regression_lockdown,
            redaction_regression_lock: regressionLockResult.redaction_regression_lock,
          })
          const baselineResult = evaluateReleaseFreezeBaseline({
            release_freeze_policy:         freezeResult.release_freeze_policy,
            freeze_baseline:               freezeResult.freeze_baseline,
            freeze_diff_report:            freezeResult.freeze_diff_report,
            release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
            freeze_enforcement_summary:    freezeResult.freeze_enforcement_summary,
            internal_export_storage_contract: storageResult.internal_export_storage_contract,
            storage_write_simulation:      storageResult.storage_write_simulation,
            admin_access_replay_simulation: replayResult.admin_access_replay_simulation,
            admin_access_pattern_review:   replayResult.admin_access_pattern_review,
            redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
          })
          const invariantResult = evaluateSafetyInvariantSnapshot({})
          const unfreezeResult = evaluateControlledUnfreezeDesign({
            release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
            redaction_regression_lock:     regressionLockResult.redaction_regression_lock,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
            admin_access_audit:            accessAuditResult.admin_access_audit,
            regression_lockdown:           regressionLockdownResult.regression_lockdown,
          })
          // ── P3.8.25 services ───────────────────────────────────────────────
          const matrixResult = evaluateCapabilityUnlockMatrix({
            release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
            freeze_enforcement_summary:    freezeResult.freeze_enforcement_summary,
            controlled_unfreeze_design:    unfreezeResult.controlled_unfreeze_design,
            unfreeze_preconditions_matrix: unfreezeResult.unfreeze_preconditions_matrix,
            immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
          })
          const simulationResult = evaluateControlledUnfreezeSimulation({
            capability_unlock_matrix:      matrixResult.capability_unlock_matrix,
            capability_risk_profile:       matrixResult.capability_risk_profile,
            controlled_unfreeze_design:    unfreezeResult.controlled_unfreeze_design,
            release_freeze_sentinel:       freezeResult.release_freeze_sentinel,
          })
          const gateResult = evaluatePreBetaGovernanceGate({
            release_freeze_baseline_registry: baselineResult.release_freeze_baseline_registry,
            baseline_comparison_report:       baselineResult.baseline_comparison_report,
            safety_invariant_snapshot:        invariantResult.safety_invariant_snapshot,
            safety_invariant_validation:      invariantResult.safety_invariant_validation,
            controlled_unfreeze_design:       unfreezeResult.controlled_unfreeze_design,
            capability_unlock_matrix:         matrixResult.capability_unlock_matrix,
            controlled_unfreeze_simulation:   simulationResult.controlled_unfreeze_simulation,
            immutable_no_sell_enforcement:    adminExportPreviewResult.immutable_no_sell_enforcement,
          })
          // ── P3.8.26 services ───────────────────────────────────────────────
          const councilResult = evaluatePreBetaReadinessCouncil({
            pre_beta_governance_gate:         gateResult.pre_beta_governance_gate,
            pre_beta_blocker_matrix:          gateResult.pre_beta_blocker_matrix,
            pre_beta_operator_review:         gateResult.pre_beta_operator_review,
            final_pre_beta_summary:           gateResult.final_pre_beta_summary,
            capability_unlock_matrix:         matrixResult.capability_unlock_matrix,
            controlled_unfreeze_simulation:   simulationResult.controlled_unfreeze_simulation,
            release_freeze_sentinel:          freezeResult.release_freeze_sentinel,
            release_freeze_baseline_registry: baselineResult.release_freeze_baseline_registry,
            safety_invariant_snapshot:        invariantResult.safety_invariant_snapshot,
            can_beta:                         false,
            can_sell:                         false,
          })
          const signoffResult = evaluateOperatorSignoffSimulation({}, {
            OPERATOR_SIGNOFF_SIMULATION_ENABLED: false,
            SIGNOFF_NO_OVERRIDE_LOCK:            true,
          })
          const nonDeliveryResult = evaluatePrivateBetaNonDelivery({
            can_beta: false,
            can_sell: false,
          })
          // ── P3.8.27 services ───────────────────────────────────────────────
          const cohortResult = evaluateNonUserCohortContract({})
          const invitationResult = evaluatePrivateBetaInvitationSimulation({
            real_invites_created: false,
            users_created:        false,
          })
          const killSwitchResult = evaluateDeliveryKillSwitch({
            real_delivery: false,
          })
          // ── P3.8.28 services ───────────────────────────────────────────────
          const cohortReviewResult = evaluateSyntheticCohortReview({
            non_user_cohort_contract:           cohortResult.non_user_cohort_contract,
            non_user_cohort_members:            cohortResult.non_user_cohort_members,
            non_user_cohort_audit:              cohortResult.non_user_cohort_audit,
            non_user_cohort_summary:            cohortResult.non_user_cohort_summary,
            private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
            simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
            can_beta: false, can_sell: false, real_users: false, real_delivery: false,
          })
          const dryInviteResult = evaluatePrivateBetaDryInviteReport({
            non_user_cohort_contract:           cohortResult.non_user_cohort_contract,
            non_user_cohort_members:            cohortResult.non_user_cohort_members,
            synthetic_cohort_review:            cohortReviewResult.synthetic_cohort_review,
            synthetic_member_safety_matrix:     cohortReviewResult.synthetic_member_safety_matrix,
            private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
            simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
            invitation_channel_policy:          invitationResult.invitation_channel_policy,
            delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
            channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
            private_beta_non_delivery_contract: nonDeliveryResult.private_beta_non_delivery_contract,
            non_delivery_enforcement:           nonDeliveryResult.non_delivery_enforcement,
            pre_beta_readiness_council:         councilResult.pre_beta_readiness_council,
            operator_signoff_simulation:        signoffResult.operator_signoff_simulation,
            can_beta: false, can_sell: false,
          })
          const drillResult = evaluateDeliveryIncidentDrill({
            delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
            channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
            delivery_kill_switch_audit:         killSwitchResult.delivery_kill_switch_audit,
            private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
            simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
            invitation_channel_policy:          invitationResult.invitation_channel_policy,
            non_delivery_enforcement:           nonDeliveryResult.non_delivery_enforcement,
            can_beta: false, can_sell: false, real_delivery: false,
            email_delivery_enabled: false, webhook_enabled: false,
          })
          // ── P3.8.29 services ───────────────────────────────────────────────
          const ledgerResult = evaluateBetaSafetyIncidentLedger({
            delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
            channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
            private_beta_invitation_simulation: invitationResult.private_beta_invitation_simulation,
            simulated_invitation_ledger:        invitationResult.simulated_invitation_ledger,
            delivery_incident_scenarios:        drillResult.delivery_incident_scenarios,
            delivery_incident_drill:            drillResult.delivery_incident_drill,
            incident_real_action_taken:         false,
            real_actions_taken:                 false,
          })
          const recoveryResult = evaluateIncidentRecoverySimulation({
            beta_safety_incident_ledger:        ledgerResult.beta_safety_incident_ledger,
            simulated_incident_records:         ledgerResult.simulated_incident_records,
            incident_severity_matrix:           ledgerResult.incident_severity_matrix,
            delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
            channel_kill_switch_matrix:         killSwitchResult.channel_kill_switch_matrix,
            recovery_real_action_taken:         false,
            operator_notified_externally:       false,
          })
          const escalationResult = evaluateOperatorEscalationProtocol({
            incident_recovery_simulation:       recoveryResult.incident_recovery_simulation,
            recovery_action_plan:               recoveryResult.recovery_action_plan,
            recovery_verification_checklist:    recoveryResult.recovery_verification_checklist,
            beta_safety_incident_ledger:        ledgerResult.beta_safety_incident_ledger,
            incident_severity_matrix:           ledgerResult.incident_severity_matrix,
            external_escalation_sent:           false,
            operator_notified_externally:       false,
          })
          // ── P3.8.30 services ───────────────────────────────────────────────
          const closureResult = evaluateP38GovernanceClosure({
            delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
            private_beta_non_delivery_contract: nonDeliveryResult.private_beta_non_delivery_contract,
            beta_safety_incident_ledger:        ledgerResult.beta_safety_incident_ledger,
            incident_recovery_simulation:       recoveryResult.incident_recovery_simulation,
            operator_escalation_protocol:       escalationResult.operator_escalation_protocol,
            pre_beta_governance_gate:           gateResult.pre_beta_governance_gate,
            can_beta:                           false,
            can_sell:                           false,
          })
          const finalizationResult = evaluateP38SafetyFinalization({
            delivery_kill_switch:               killSwitchResult.delivery_kill_switch,
            can_beta:                           false,
            can_sell:                           false,
            delivery_allowed:                   false,
            real_delivery:                      false,
            operator_notified_externally:       false,
          })
          const transitionResult = evaluateP39TransitionPlan({
            resolved_valid:                     rv,
            auto_activate_micro_test:           false,
            can_beta:                           false,
            can_sell:                           false,
          })
          const sampleAuditResult = evaluateResolvedSampleAudit({
            training_eligible_total:            rv,
            resolved_valid:                     rv,
            green_count:                        metrics?.wins ?? 0,
            red_count:                          metrics?.losses ?? 0,
            pending_training_eligible:          0,
            unknown_result_count:               0,
            by_trust_level:                     [],
          })
          const activationResult = evaluateMicroTestActivationReadiness({
            resolved_sample_audit:              sampleAuditResult.resolved_sample_audit,
            resolved_valid:                     rv,
            micro_test_enabled:                 microTestEnabled,
            micro_test_active:                  readiness.micro_test_active,
            micro_test_status:                  readiness.micro_test_status,
            can_micro_test:                     readiness.can_micro_test,
            auto_activate_micro_test:           false,
            can_beta:                           false,
            can_sell:                           false,
          })
          const kickoffResult = evaluateQualityProofKickoff({
            resolved_sample_audit:              sampleAuditResult.resolved_sample_audit,
            resolved_sample_distribution:       sampleAuditResult.resolved_sample_distribution,
            micro_test_activation_readiness:    activationResult.micro_test_activation_readiness,
            micro_test_report:                  microTestReport,
            micro_test_policy:                  microTestPolicy,
            can_beta:                           false,
            can_sell:                           false,
          })
          const guardResult = evaluateMicroTestManualActivationGuard({
            resolved_sample_audit:                    sampleAuditResult.resolved_sample_audit,
            micro_test_activation_readiness:          activationResult.micro_test_activation_readiness,
            activation_prerequisites:                 activationResult.activation_prerequisites,
            micro_test_manual_activation_checklist:   activationResult.micro_test_manual_activation_checklist,
            resolved_valid:                           rv,
            micro_test_threshold:                     30,
            micro_test_enabled:                       microTestEnabled,
            micro_test_active:                        readiness.micro_test_active,
            micro_test_status:                        readiness.micro_test_status,
            can_micro_test:                           readiness.can_micro_test,
            can_beta:                                 false,
            can_sell:                                 false,
          })
          const monitorResult = evaluatePostActivationMonitor({
            micro_test_env_state:               guardResult.micro_test_env_state,
            micro_test_manual_activation_guard: guardResult.micro_test_manual_activation_guard,
            micro_test_report:                  microTestReport,
            micro_test_policy:                  microTestPolicy,
            resolved_sample_audit:              sampleAuditResult.resolved_sample_audit,
            resolved_quality_seed_report:       kickoffResult.resolved_quality_seed_report,
            quality_proof_kickoff:              kickoffResult.quality_proof_kickoff,
            resolved_valid:                     rv,
            micro_test_active:                  readiness.micro_test_active,
            can_beta:                           false,
            can_sell:                           false,
          })
          const snapshotResult = evaluateFirstRealQualitySnapshot({
            resolved_sample_audit:              sampleAuditResult.resolved_sample_audit,
            resolved_sample_distribution:       sampleAuditResult.resolved_sample_distribution,
            resolved_quality_seed_report:       kickoffResult.resolved_quality_seed_report,
            micro_test_report:                  microTestReport,
            micro_test_policy:                  microTestPolicy,
            segment_health_matrix:              segmentHealth.segment_health_matrix,
            candidate_segments:                 segmentHealth.candidate_segments,
            risk_segments:                      segmentHealth.risk_segments,
            post_activation_monitor:            monitorResult.post_activation_monitor,
            micro_test_active:                  readiness.micro_test_active,
            can_beta:                           false,
            can_sell:                           false,
          })
          const p39ActivationSummary = {
            status:              guardResult.micro_test_manual_activation_guard.status,
            headline:            guardResult.micro_test_manual_activation_guard.status === 'active_monitoring'
              ? 'Micro-test ativo e monitorado.'
              : guardResult.micro_test_manual_activation_guard.activation_allowed_now
              ? 'Pronto para ativação manual do micro-test.'
              : 'Micro-test ainda não deve ser ativado.',
            summary_text:        'A ativação continua manual e controlada pelo operador.',
            operator_instruction: guardResult.micro_test_manual_activation_guard.activation_allowed_now
              ? 'Pode setar MICRO_TEST_ENABLED=true agora.'
              : 'Não alterar MICRO_TEST_ENABLED até activation_allowed_now=true.',
            activation_allowed_now: guardResult.micro_test_manual_activation_guard.activation_allowed_now,
            micro_test_active:   monitorResult.post_activation_monitor.micro_test_active,
            has_quality_snapshot: monitorResult.post_activation_monitor.has_first_quality_snapshot,
            can_beta:            false,
            can_sell:            false,
            next_action:         guardResult.micro_test_manual_activation_guard.status === 'waiting_for_threshold'
              ? 'Continuar acumulando resultados green/red.'
              : guardResult.micro_test_manual_activation_guard.status === 'ready_for_manual_activation'
              ? 'Setar MICRO_TEST_ENABLED=true para ativar.'
              : 'Monitorar qualidade e resultados do micro-test.',
          }
          // P3.9.2 — segment quality, break-even, exclusion recommendations
          const qualityProofResult = evaluateSegmentQualityProof({
            resolved_sample_audit:         sampleAuditResult.resolved_sample_audit,
            resolved_sample_distribution:  sampleAuditResult.resolved_sample_distribution,
            first_real_quality_snapshot:   snapshotResult.first_real_quality_snapshot,
            quality_snapshot_distribution: snapshotResult.quality_snapshot_distribution,
            can_beta:                      false,
            can_sell:                      false,
          })
          const breakEvenResult = evaluateBreakEvenOddsReview({
            resolved_sample_distribution:  sampleAuditResult.resolved_sample_distribution,
            can_beta:                      false,
            can_sell:                      false,
          })
          const exclusionResult = evaluateSegmentExclusionRecommendations({
            segment_break_even_matrix:     breakEvenResult.segment_break_even_matrix,
            segment_quality_proof:         qualityProofResult.segment_quality_proof,
            first_real_quality_snapshot:   snapshotResult.first_real_quality_snapshot,
            can_beta:                      false,
            can_sell:                      false,
          })
          // P3.9.3 — dry-run (index.js has no raw rows, so resolved_rows=[])
          const exclusionDryRunResult = evaluateSegmentExclusionDryRun({
            segment_exclusion_recommendations: exclusionResult.segment_exclusion_recommendations,
            segment_watchlist:                 exclusionResult.segment_watchlist,
            segment_break_even_matrix:         breakEvenResult.segment_break_even_matrix,
            resolved_rows:                     [],
            resolved_sample_audit:             sampleAuditResult.resolved_sample_audit,
            first_real_quality_snapshot:       snapshotResult.first_real_quality_snapshot,
            can_beta:                          false,
            can_sell:                          false,
          })
          // P3.9.3 — reweight proposal
          const reweightProposalResult = evaluateQualityReweightProposal({
            segment_quality_rankings:          qualityProofResult.segment_quality_rankings,
            segment_break_even_matrix:         breakEvenResult.segment_break_even_matrix,
            segment_exclusion_recommendations: exclusionResult.segment_exclusion_recommendations,
            segment_watchlist:                 exclusionResult.segment_watchlist,
            confidence_calibration_review:     qualityProofResult.confidence_calibration_review,
            can_beta:                          false,
            can_sell:                          false,
          })
          // P3.9.3 — shadow policy
          const shadowP393PolicyResult = evaluateShadowRecommendationPolicy({
            segment_exclusion_dry_run:       exclusionDryRunResult.segment_exclusion_dry_run,
            quality_reweight_proposal:       reweightProposalResult.quality_reweight_proposal,
            segment_recommendation_policy:   exclusionResult.segment_recommendation_policy,
            segment_exclusion_summary:       exclusionResult.segment_exclusion_summary,
            can_beta:                        false,
            can_sell:                        false,
          })
          // P3.9.4 — shadow reweight backtest (no raw rows in this route)
          const p394BacktestResult = evaluateShadowReweightBacktest({
            resolved_rows:                   [],
            proposed_weight_changes:         reweightProposalResult.proposed_weight_changes,
            quality_reweight_proposal:       reweightProposalResult.quality_reweight_proposal,
            quality_reweight_impact_simulation: reweightProposalResult.quality_reweight_impact_simulation,
            segment_quality_rankings:        qualityProofResult.segment_quality_rankings,
            segment_break_even_matrix:       breakEvenResult.segment_break_even_matrix,
            shadow_recommendation_policy:    shadowP393PolicyResult.shadow_recommendation_policy,
            shadow_policy_enforcement:       shadowP393PolicyResult.shadow_policy_enforcement,
            can_beta:                        false,
            can_sell:                        false,
          })
          // P3.9.4 — recommendation stability check
          const p394StabilityResult = evaluateRecommendationStabilityCheck({
            segment_exclusion_recommendations: exclusionResult.segment_exclusion_recommendations,
            segment_watchlist:                 exclusionResult.segment_watchlist,
            quality_reweight_proposal:         reweightProposalResult.quality_reweight_proposal,
            proposed_weight_changes:           reweightProposalResult.proposed_weight_changes,
            segment_quality_proof:             qualityProofResult.segment_quality_proof,
            break_even_odds_review:            breakEvenResult.break_even_odds_review,
            can_beta:                          false,
            can_sell:                          false,
          })
          // P3.9.4 — quality proof decision gate
          const p394GateResult = evaluateQualityProofDecisionGate({
            resolved_sample_audit:             sampleAuditResult.resolved_sample_audit,
            first_real_quality_snapshot:       snapshotResult.first_real_quality_snapshot,
            quality_snapshot_risk_flags:       snapshotResult.quality_snapshot_risk_flags,
            segment_quality_proof:             qualityProofResult.segment_quality_proof,
            break_even_odds_review:            breakEvenResult.break_even_odds_review,
            segment_exclusion_recommendations: exclusionResult.segment_exclusion_recommendations,
            segment_exclusion_dry_run:         exclusionDryRunResult.segment_exclusion_dry_run,
            quality_reweight_proposal:         reweightProposalResult.quality_reweight_proposal,
            shadow_reweight_backtest:          p394BacktestResult.shadow_reweight_backtest,
            recommendation_stability_check:    p394StabilityResult.recommendation_stability_check,
            shadow_policy_enforcement:         shadowP393PolicyResult.shadow_policy_enforcement,
            can_beta:                          false,
            can_sell:                          false,
          })
          // P3.9.5 — Quality Proof Trend Monitor
          const p395TrendResult = evaluateQualityProofTrendMonitor({
            quality_proof_decision_gate:    p394GateResult.quality_proof_decision_gate,
            quality_proof_gate_evidence:    p394GateResult.quality_proof_gate_evidence,
            p39_quality_decision_summary:   p394GateResult.p39_quality_decision_summary,
            first_real_quality_snapshot:    snapshotResult.first_real_quality_snapshot,
            quality_snapshot_risk_flags:    snapshotResult.quality_snapshot_risk_flags,
            segment_quality_proof:          qualityProofResult.segment_quality_proof,
            break_even_odds_review:         breakEvenResult.break_even_odds_review,
            recommendation_stability_check: p394StabilityResult.recommendation_stability_check,
            shadow_reweight_backtest:       p394BacktestResult.shadow_reweight_backtest,
            can_beta:                       false,
            can_sell:                       false,
          })
          // P3.9.5 — Segment Decision History
          const p395SegHistResult = evaluateSegmentDecisionHistory({
            segment_exclusion_recommendations: exclusionResult.segment_exclusion_recommendations,
            segment_watchlist:                 exclusionResult.segment_watchlist,
            recommendation_stability_matrix:   p394StabilityResult.recommendation_stability_matrix,
            recommendation_stability_check:    p394StabilityResult.recommendation_stability_check,
            segment_quality_rankings:          qualityProofResult.segment_quality_rankings,
            quality_reweight_proposal:         reweightProposalResult.quality_reweight_proposal,
            proposed_weight_changes:           reweightProposalResult.proposed_weight_changes,
            can_beta:                          false,
            can_sell:                          false,
          })
          // P3.9.5 — Beta Simulation Readiness
          const p395BetaSimResult = evaluateBetaSimulationReadiness({
            quality_proof_trend_monitor:         p395TrendResult.quality_proof_trend_monitor,
            quality_gate_trend_report:           p395TrendResult.quality_gate_trend_report,
            segment_decision_history_simulation: p395SegHistResult.segment_decision_history_simulation,
            recommendation_stability_check:      p394StabilityResult.recommendation_stability_check,
            quality_proof_decision_gate:         p394GateResult.quality_proof_decision_gate,
            shadow_policy_enforcement:           shadowP393PolicyResult.shadow_policy_enforcement,
            micro_test_activation_readiness:     activationResult.micro_test_activation_readiness,
            post_activation_monitor:             monitorResult.post_activation_monitor,
            first_real_quality_snapshot:         snapshotResult.first_real_quality_snapshot,
            can_beta:                            false,
            can_sell:                            false,
          })
          // P3.9.6 — Beta Simulation Cohort Plan
          const p396CohortResult = evaluateBetaSimulationCohortPlan({
            beta_simulation_readiness_review: p395BetaSimResult.beta_simulation_readiness_review,
            beta_simulation_blocker_matrix:   p395BetaSimResult.beta_simulation_blocker_matrix,
            p39_beta_simulation_summary:      p395BetaSimResult.p39_beta_simulation_summary,
            can_beta:                         false,
            can_sell:                         false,
          })
          // P3.9.6 — Synthetic Delivery UX Contract
          const p396UxContractResult = evaluateSyntheticDeliveryUxContract({
            beta_simulation_cohort_plan:   p396CohortResult.beta_simulation_cohort_plan,
            synthetic_beta_cohort_members: p396CohortResult.synthetic_beta_cohort_members,
            can_beta:                      false,
            can_sell:                      false,
          })
          // P3.9.6 — Quality Proof Review Board
          const p396ReviewBoardResult = evaluateQualityProofReviewBoard({
            quality_proof_decision_gate:         p394GateResult.quality_proof_decision_gate,
            quality_proof_trend_monitor:         p395TrendResult.quality_proof_trend_monitor,
            quality_gate_trend_report:           p395TrendResult.quality_gate_trend_report,
            segment_decision_history_simulation: p395SegHistResult.segment_decision_history_simulation,
            beta_simulation_readiness_review:    p395BetaSimResult.beta_simulation_readiness_review,
            beta_simulation_cohort_plan:         p396CohortResult.beta_simulation_cohort_plan,
            synthetic_delivery_ux_contract:      p396UxContractResult.synthetic_delivery_ux_contract,
            shadow_policy_enforcement:           shadowP393PolicyResult.shadow_policy_enforcement,
            p39_quality_decision_summary:        p394GateResult.p39_quality_decision_summary,
            p39_beta_simulation_summary:         p395BetaSimResult.p39_beta_simulation_summary,
            can_beta:                            false,
            can_sell:                            false,
          })
          // P3.9.7 — Internal Pick Card Contract
          const p397PickCardResult = evaluateInternalPickCardContract({
            synthetic_delivery_ux_contract: p396UxContractResult.synthetic_delivery_ux_contract,
            beta_simulation_cohort_plan:    p396CohortResult.beta_simulation_cohort_plan,
            quality_proof_review_board:     p396ReviewBoardResult.quality_proof_review_board,
            can_beta:                       false,
            can_sell:                       false,
          })
          // P3.9.7 — Synthetic Beta Experience Preview
          const p397ExperienceResult = evaluateSyntheticBetaExperiencePreview({
            internal_pick_card_contract:   p397PickCardResult.internal_pick_card_contract,
            pick_card_safety_validation:   p397PickCardResult.pick_card_safety_validation,
            synthetic_beta_cohort_members: p396CohortResult.synthetic_beta_cohort_members,
            can_beta:                      false,
            can_sell:                      false,
          })
          // P3.9.7 — Synthetic Feedback Loop
          const p397FeedbackResult = evaluateSyntheticFeedbackLoop({
            synthetic_beta_experience_preview: p397ExperienceResult.synthetic_beta_experience_preview,
            synthetic_pick_card_examples:      p397ExperienceResult.synthetic_pick_card_examples,
            pick_card_safety_validation:       p397PickCardResult.pick_card_safety_validation,
            quality_proof_review_board:        p396ReviewBoardResult.quality_proof_review_board,
            can_beta:                          false,
            can_sell:                          false,
          })
          return new Response(JSON.stringify({
            ok: true,
            days_window: days,
            score: readiness.score,
            status: readiness.status,
            resolved_valid: rv,
            remaining_to_micro_test: readiness.remaining_to_micro_test,
            micro_test_threshold: readiness.micro_test_threshold,
            can_micro_test: readiness.can_micro_test,
            micro_test_status: readiness.micro_test_status,
            micro_test_active: readiness.micro_test_active,
            can_beta: readiness.can_beta,
            can_sell: readiness.can_sell,
            activation_requirements: {
              resolved_valid_gte_threshold: rv >= readiness.micro_test_threshold,
              can_micro_test: readiness.can_micro_test,
              micro_test_enabled: microTestEnabled,
            },
            micro_test_report: microTestReport,
            micro_test_policy: microTestPolicy,
            micro_test_quality_score: microTestPolicy.quality_score,
            micro_test_quality_grade: microTestPolicy.quality_grade,
            micro_test_decision_state: microTestPolicy.decision_state,
            micro_test_guardrails: microTestPolicy.guardrails,
            micro_test_risks: microTestPolicy.risks,
            micro_test_decision_summary: microTestPolicy.summary,
            segment_health_matrix:        segmentHealth.segment_health_matrix,
            candidate_segments:           segmentHealth.candidate_segments,
            risk_segments:                segmentHealth.risk_segments,
            controlled_expansion_review:  segmentHealth.controlled_expansion_review,
            beta_hold_review:             segmentHealth.beta_hold_review,
            beta_admission_contract:      betaAdmission.beta_admission_contract,
            manual_approval_gate:         betaAdmission.manual_approval_gate,
            private_cohort_simulation:    betaAdmission.private_cohort_simulation,
            beta_admission_review:        betaAdmission.beta_admission_review,
            beta_admission_summary:       betaAdmission.beta_admission_summary,
            private_beta_sandbox:         sandbox.private_beta_sandbox,
            sandbox_delivery_policy:      sandbox.sandbox_delivery_policy,
            sandbox_risk_controls:        sandbox.sandbox_risk_controls,
            sandbox_allowed_segments:     sandbox.sandbox_allowed_segments,
            sandbox_blocked_segments:     sandbox.sandbox_blocked_segments,
            simulated_delivery_ledger:    sandbox.simulated_delivery_ledger,
            sandbox_audit_summary:        sandbox.sandbox_audit_summary,
            operator_review_console:      sandbox.operator_review_console,
            simulated_cohort_monitor:    cohortMonitor.simulated_cohort_monitor,
            ledger_health:               cohortMonitor.ledger_health,
            ledger_exposure:             cohortMonitor.ledger_exposure,
            delivery_drift_report:       cohortMonitor.delivery_drift_report,
            sandbox_performance_summary: cohortMonitor.sandbox_performance_summary,
            operator_approval_checklist: cohortMonitor.operator_approval_checklist,
            cohort_monitoring_review:    cohortMonitor.cohort_monitoring_review,
            operator_decision_packet:    decisionPacket.operator_decision_packet,
            beta_dry_run_report:         decisionPacket.beta_dry_run_report,
            launch_governance:           decisionPacket.launch_governance,
            launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
            decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
            operator_next_actions:       decisionPacket.operator_next_actions,
            governance_audit_summary:    decisionPacket.governance_audit_summary,
            manual_review_artifact:      reviewGovernance.manual_review_artifact,
            approval_simulation:         reviewGovernance.approval_simulation,
            no_launch_governance:        reviewGovernance.no_launch_governance,
            release_hard_locks:          reviewGovernance.release_hard_locks,
            operator_review_audit_trail: reviewGovernance.operator_review_audit_trail,
            manual_review_summary:       reviewGovernance.manual_review_summary,
            evidence_export_packet:      evidenceExport.evidence_export_packet,
            operator_report_render:      evidenceExport.operator_report_render,
            operator_report_summary:     evidenceExport.operator_report_summary,
            decision_fingerprint:        evidenceExport.decision_fingerprint,
            export_validation_summary:   evidenceExport.export_validation_summary,
            governance_regression_suite:          evidenceExport.governance_regression_suite,
            operator_report_download_contract:    exportContractResult.operator_report_download_contract,
            safe_export_manifest:                 exportContractResult.safe_export_manifest,
            commercial_claims_guard:              exportContractResult.commercial_claims_guard,
            export_integrity_contract:            exportContractResult.export_integrity_contract,
            download_readiness_summary:           exportContractResult.download_readiness_summary,
            historical_snapshot_simulation:       snapshotSimResult.historical_snapshot_simulation,
            snapshot_diff_report:                 snapshotSimResult.snapshot_diff_report,
            regression_lockdown:                  regressionLockdownResult.regression_lockdown,
            admin_export_access_control:          adminExportPreviewResult.admin_export_access_control,
            protected_export_route_contract:      adminExportPreviewResult.protected_export_route_contract,
            admin_preview_summary:                adminExportPreviewResult.admin_preview_summary,
            immutable_no_sell_enforcement:        adminExportPreviewResult.immutable_no_sell_enforcement,
            report_redaction_policy:              redactionResult.report_redaction_policy,
            preview_payload_limits:               abuseResult.preview_payload_limits,
            export_abuse_protection:              abuseResult.export_abuse_protection,
            internal_download_preflight:          abuseResult.internal_download_preflight,
            admin_preview_ux_contract:            uxResult.admin_preview_ux_contract,
            admin_preview_modes:                  uxResult.admin_preview_modes,
            admin_preview_health:                 uxResult.admin_preview_health,
            internal_export_renderer:             rendererResult.internal_export_renderer,
            rendered_export_formats:              rendererResult.rendered_export_formats,
            export_format_validation:             rendererResult.export_format_validation,
            format_render_summary:                rendererResult.format_render_summary,
            download_response_contract:           dryRunResult.download_response_contract,
            admin_download_dry_run:               dryRunResult.admin_download_dry_run,
            download_dry_run_audit:               dryRunResult.download_dry_run_audit,
            redaction_regression_lock:            regressionLockResult.redaction_regression_lock,
            admin_export_archive_contract:        archiveResult.admin_export_archive_contract,
            report_version_manifest:              archiveResult.report_version_manifest,
            archive_integrity_summary:            archiveResult.archive_integrity_summary,
            archive_simulation_summary:           archiveResult.archive_simulation_summary,
            admin_access_risk_review:             accessAuditResult.admin_access_risk_review,
            access_audit_summary:                 accessAuditResult.access_audit_summary,
            internal_export_storage_contract:     storageResult.internal_export_storage_contract,
            storage_write_simulation:             storageResult.storage_write_simulation,
            storage_retention_policy:             storageResult.storage_retention_policy,
            storage_safety_manifest:              storageResult.storage_safety_manifest,
            admin_access_replay_simulation:       replayResult.admin_access_replay_simulation,
            admin_access_pattern_review:          replayResult.admin_access_pattern_review,
            release_freeze_policy:                freezeResult.release_freeze_policy,
            freeze_baseline:                      freezeResult.freeze_baseline,
            freeze_diff_report:                   freezeResult.freeze_diff_report,
            release_freeze_sentinel:              freezeResult.release_freeze_sentinel,
            freeze_enforcement_summary:           freezeResult.freeze_enforcement_summary,
            release_freeze_baseline_registry:     baselineResult.release_freeze_baseline_registry,
            baseline_comparison_report:           baselineResult.baseline_comparison_report,
            freeze_baseline_audit:                baselineResult.freeze_baseline_audit,
            freeze_registry_summary:              baselineResult.freeze_registry_summary,
            safety_invariant_snapshot:            invariantResult.safety_invariant_snapshot,
            safety_invariant_validation:          invariantResult.safety_invariant_validation,
            safety_invariant_summary:             invariantResult.safety_invariant_summary,
            controlled_unfreeze_design:           unfreezeResult.controlled_unfreeze_design,
            unfreeze_preconditions_matrix:        unfreezeResult.unfreeze_preconditions_matrix,
            unfreeze_risk_assessment:             unfreezeResult.unfreeze_risk_assessment,
            unfreeze_simulation_guard:            unfreezeResult.unfreeze_simulation_guard,
            controlled_unfreeze_summary:          unfreezeResult.controlled_unfreeze_summary,
            capability_unlock_matrix:             matrixResult.capability_unlock_matrix,
            capability_risk_profile:              matrixResult.capability_risk_profile,
            capability_unlock_summary:            matrixResult.capability_unlock_summary,
            controlled_unfreeze_simulation:       simulationResult.controlled_unfreeze_simulation,
            capability_unlock_attempts:           simulationResult.capability_unlock_attempts,
            unlock_rollback_plan:                 simulationResult.unlock_rollback_plan,
            unlock_simulation_audit:              simulationResult.unlock_simulation_audit,
            pre_beta_governance_gate:             gateResult.pre_beta_governance_gate,
            pre_beta_blocker_matrix:              gateResult.pre_beta_blocker_matrix,
            pre_beta_operator_review:             gateResult.pre_beta_operator_review,
            final_pre_beta_summary:               gateResult.final_pre_beta_summary,
            pre_beta_readiness_council:           councilResult.pre_beta_readiness_council,
            readiness_council_votes:              councilResult.readiness_council_votes,
            pre_beta_decision_record:             councilResult.pre_beta_decision_record,
            pre_beta_council_summary:             councilResult.pre_beta_council_summary,
            operator_signoff_simulation:          signoffResult.operator_signoff_simulation,
            signoff_effectiveness_policy:         signoffResult.signoff_effectiveness_policy,
            signoff_audit_trail:                  signoffResult.signoff_audit_trail,
            signoff_summary:                      signoffResult.signoff_summary,
            private_beta_non_delivery_contract:   nonDeliveryResult.private_beta_non_delivery_contract,
            non_delivery_enforcement:             nonDeliveryResult.non_delivery_enforcement,
            non_delivery_checklist:               nonDeliveryResult.non_delivery_checklist,
            non_delivery_audit:                   nonDeliveryResult.non_delivery_audit,
            non_delivery_summary:                 nonDeliveryResult.non_delivery_summary,
            non_user_cohort_contract:             cohortResult.non_user_cohort_contract,
            non_user_cohort_members:              cohortResult.non_user_cohort_members,
            non_user_cohort_audit:                cohortResult.non_user_cohort_audit,
            non_user_cohort_summary:              cohortResult.non_user_cohort_summary,
            invitation_channel_policy:            invitationResult.invitation_channel_policy,
            private_beta_invitation_simulation:   invitationResult.private_beta_invitation_simulation,
            simulated_invitation_ledger:          invitationResult.simulated_invitation_ledger,
            invitation_simulation_audit:          invitationResult.invitation_simulation_audit,
            invitation_simulation_summary:        invitationResult.invitation_simulation_summary,
            delivery_kill_switch:                 killSwitchResult.delivery_kill_switch,
            channel_kill_switch_matrix:           killSwitchResult.channel_kill_switch_matrix,
            delivery_kill_switch_audit:           killSwitchResult.delivery_kill_switch_audit,
            delivery_kill_switch_summary:         killSwitchResult.delivery_kill_switch_summary,
            synthetic_cohort_review:              cohortReviewResult.synthetic_cohort_review,
            synthetic_member_safety_matrix:       cohortReviewResult.synthetic_member_safety_matrix,
            synthetic_cohort_findings:            cohortReviewResult.synthetic_cohort_findings,
            synthetic_cohort_review_summary:      cohortReviewResult.synthetic_cohort_review_summary,
            private_beta_dry_invite_report:       dryInviteResult.private_beta_dry_invite_report,
            dry_invite_evidence_packet:           dryInviteResult.dry_invite_evidence_packet,
            dry_invite_readiness_checklist:       dryInviteResult.dry_invite_readiness_checklist,
            dry_invite_operator_summary:          dryInviteResult.dry_invite_operator_summary,
            delivery_incident_scenarios:          drillResult.delivery_incident_scenarios,
            delivery_incident_drill:              drillResult.delivery_incident_drill,
            incident_response_plan:               drillResult.incident_response_plan,
            kill_switch_drill_report:             drillResult.kill_switch_drill_report,
            incident_drill_summary:               drillResult.incident_drill_summary,
            beta_safety_incident_ledger:          ledgerResult.beta_safety_incident_ledger,
            simulated_incident_records:           ledgerResult.simulated_incident_records,
            incident_severity_matrix:             ledgerResult.incident_severity_matrix,
            incident_ledger_summary:              ledgerResult.incident_ledger_summary,
            incident_recovery_simulation:         recoveryResult.incident_recovery_simulation,
            recovery_action_plan:                 recoveryResult.recovery_action_plan,
            recovery_verification_checklist:      recoveryResult.recovery_verification_checklist,
            incident_response_summary:            recoveryResult.incident_response_summary,
            operator_escalation_protocol:         escalationResult.operator_escalation_protocol,
            escalation_decision_matrix:           escalationResult.escalation_decision_matrix,
            internal_escalation_audit:            escalationResult.internal_escalation_audit,
            escalation_protocol_summary:          escalationResult.escalation_protocol_summary,
            p38_governance_closure_packet:        closureResult.p38_governance_closure_packet,
            p38_completion_matrix:                closureResult.p38_completion_matrix,
            p38_open_risks_register:              closureResult.p38_open_risks_register,
            p38_closure_audit:                    closureResult.p38_closure_audit,
            p38_closure_summary:                  closureResult.p38_closure_summary,
            p38_safety_freeze_finalization:       finalizationResult.p38_safety_freeze_finalization,
            final_safety_invariant_check:         finalizationResult.final_safety_invariant_check,
            final_no_sell_no_delivery_check:      finalizationResult.final_no_sell_no_delivery_check,
            p38_safety_finalization_summary:      finalizationResult.p38_safety_finalization_summary,
            p39_transition_plan:                  transitionResult.p39_transition_plan,
            p39_micro_test_activation_plan:       transitionResult.p39_micro_test_activation_plan,
            p39_quality_proof_requirements:       transitionResult.p39_quality_proof_requirements,
            p39_operator_checklist:               transitionResult.p39_operator_checklist,
            p38_to_p39_operator_summary:          transitionResult.p38_to_p39_operator_summary,
            resolved_sample_audit:                sampleAuditResult.resolved_sample_audit,
            resolved_sample_distribution:         sampleAuditResult.resolved_sample_distribution,
            pending_resolution_queue:             sampleAuditResult.pending_resolution_queue,
            resolved_audit_summary:               sampleAuditResult.resolved_audit_summary,
            micro_test_activation_readiness:      activationResult.micro_test_activation_readiness,
            activation_prerequisites:             activationResult.activation_prerequisites,
            micro_test_manual_activation_checklist: activationResult.micro_test_manual_activation_checklist,
            activation_risk_review:               activationResult.activation_risk_review,
            resolved_quality_seed_report:         kickoffResult.resolved_quality_seed_report,
            quality_proof_kickoff:                kickoffResult.quality_proof_kickoff,
            quality_proof_initial_questions:      kickoffResult.quality_proof_initial_questions,
            p39_quality_kickoff_summary:          kickoffResult.p39_quality_kickoff_summary,
            micro_test_env_state:                 guardResult.micro_test_env_state,
            micro_test_manual_activation_guard:   guardResult.micro_test_manual_activation_guard,
            manual_activation_guard_checks:       guardResult.manual_activation_guard_checks,
            activation_guard_audit:               guardResult.activation_guard_audit,
            post_activation_monitor:              monitorResult.post_activation_monitor,
            micro_test_progress_tracker:          monitorResult.micro_test_progress_tracker,
            post_activation_checks:               monitorResult.post_activation_checks,
            post_activation_operator_notes:       monitorResult.post_activation_operator_notes,
            first_real_quality_snapshot:          snapshotResult.first_real_quality_snapshot,
            quality_snapshot_distribution:        snapshotResult.quality_snapshot_distribution,
            quality_snapshot_risk_flags:          snapshotResult.quality_snapshot_risk_flags,
            quality_snapshot_summary:             snapshotResult.quality_snapshot_summary,
            p39_activation_operator_summary:      p39ActivationSummary,
            break_even_odds_review:               breakEvenResult.break_even_odds_review,
            segment_break_even_matrix:            breakEvenResult.segment_break_even_matrix,
            segment_quality_proof:                qualityProofResult.segment_quality_proof,
            segment_quality_rankings:             qualityProofResult.segment_quality_rankings,
            confidence_calibration_review:        qualityProofResult.confidence_calibration_review,
            segment_exclusion_recommendations:    exclusionResult.segment_exclusion_recommendations,
            segment_watchlist:                    exclusionResult.segment_watchlist,
            segment_recommendation_policy:        exclusionResult.segment_recommendation_policy,
            segment_exclusion_summary:            exclusionResult.segment_exclusion_summary,
            p39_segment_quality_summary:          qualityProofResult.p39_segment_quality_summary,
            segment_exclusion_dry_run:            exclusionDryRunResult.segment_exclusion_dry_run,
            dry_run_excluded_segments:            exclusionDryRunResult.dry_run_excluded_segments,
            segment_exclusion_impact_report:      exclusionDryRunResult.segment_exclusion_impact_report,
            segment_exclusion_dry_run_summary:    exclusionDryRunResult.segment_exclusion_dry_run_summary,
            quality_reweight_proposal:            reweightProposalResult.quality_reweight_proposal,
            proposed_weight_changes:              reweightProposalResult.proposed_weight_changes,
            quality_reweight_impact_simulation:   reweightProposalResult.quality_reweight_impact_simulation,
            quality_reweight_summary:             reweightProposalResult.quality_reweight_summary,
            shadow_recommendation_policy:         shadowP393PolicyResult.shadow_recommendation_policy,
            shadow_policy_enforcement:            shadowP393PolicyResult.shadow_policy_enforcement,
            segment_policy_audit:                 shadowP393PolicyResult.segment_policy_audit,
            p39_shadow_policy_summary:            shadowP393PolicyResult.p39_shadow_policy_summary,
            shadow_reweight_backtest:             p394BacktestResult.shadow_reweight_backtest,
            shadow_ranking_delta_report:          p394BacktestResult.shadow_ranking_delta_report,
            shadow_backtest_audit:                p394BacktestResult.shadow_backtest_audit,
            shadow_backtest_summary:              p394BacktestResult.shadow_backtest_summary,
            recommendation_stability_check:       p394StabilityResult.recommendation_stability_check,
            recommendation_stability_matrix:      p394StabilityResult.recommendation_stability_matrix,
            recommendation_stability_summary:     p394StabilityResult.recommendation_stability_summary,
            quality_proof_gate_evidence:          p394GateResult.quality_proof_gate_evidence,
            quality_proof_decision_gate:          p394GateResult.quality_proof_decision_gate,
            quality_proof_operator_actions:       p394GateResult.quality_proof_operator_actions,
            p39_quality_decision_summary:         p394GateResult.p39_quality_decision_summary,
            quality_proof_trend_monitor:          p395TrendResult.quality_proof_trend_monitor,
            quality_gate_trend_report:            p395TrendResult.quality_gate_trend_report,
            quality_trend_operator_actions:       p395TrendResult.quality_trend_operator_actions,
            segment_decision_history_simulation:  p395SegHistResult.segment_decision_history_simulation,
            segment_decision_history_matrix:      p395SegHistResult.segment_decision_history_matrix,
            segment_decision_history_summary:     p395SegHistResult.segment_decision_history_summary,
            beta_simulation_readiness_review:     p395BetaSimResult.beta_simulation_readiness_review,
            beta_simulation_blocker_matrix:       p395BetaSimResult.beta_simulation_blocker_matrix,
            beta_simulation_readiness_evidence:   p395BetaSimResult.beta_simulation_readiness_evidence,
            p39_beta_simulation_summary:          p395BetaSimResult.p39_beta_simulation_summary,
            beta_simulation_cohort_plan:          p396CohortResult.beta_simulation_cohort_plan,
            synthetic_beta_cohort_members:        p396CohortResult.synthetic_beta_cohort_members,
            beta_cohort_risk_review:              p396CohortResult.beta_cohort_risk_review,
            beta_simulation_cohort_summary:       p396CohortResult.beta_simulation_cohort_summary,
            synthetic_delivery_ux_contract:       p396UxContractResult.synthetic_delivery_ux_contract,
            synthetic_delivery_channel_matrix:    p396UxContractResult.synthetic_delivery_channel_matrix,
            synthetic_ux_artifacts:               p396UxContractResult.synthetic_ux_artifacts,
            synthetic_delivery_ux_summary:        p396UxContractResult.synthetic_delivery_ux_summary,
            quality_proof_review_board:           p396ReviewBoardResult.quality_proof_review_board,
            quality_review_board_votes:           p396ReviewBoardResult.quality_review_board_votes,
            beta_simulation_governance_packet:    p396ReviewBoardResult.beta_simulation_governance_packet,
            p39_beta_simulation_operator_summary: p396ReviewBoardResult.p39_beta_simulation_operator_summary,
            internal_pick_card_contract:          p397PickCardResult.internal_pick_card_contract,
            pick_card_allowed_fields:             p397PickCardResult.pick_card_allowed_fields,
            pick_card_forbidden_fields:           p397PickCardResult.pick_card_forbidden_fields,
            pick_card_safety_validation:          p397PickCardResult.pick_card_safety_validation,
            internal_pick_card_contract_summary:  p397PickCardResult.internal_pick_card_contract_summary,
            synthetic_beta_experience_preview:    p397ExperienceResult.synthetic_beta_experience_preview,
            synthetic_pick_card_examples:         p397ExperienceResult.synthetic_pick_card_examples,
            experience_preview_safety_notes:      p397ExperienceResult.experience_preview_safety_notes,
            synthetic_experience_preview_summary: p397ExperienceResult.synthetic_experience_preview_summary,
            synthetic_feedback_loop:              p397FeedbackResult.synthetic_feedback_loop,
            simulated_feedback_entries:           p397FeedbackResult.simulated_feedback_entries,
            feedback_loop_analysis:               p397FeedbackResult.feedback_loop_analysis,
            feedback_loop_operator_summary:       p397FeedbackResult.feedback_loop_operator_summary,
            p39_experience_preview_summary:       p397FeedbackResult.p39_experience_preview_summary,
            components: readiness.components,
            metrics: metrics ?? { note: 'No shadow bet data yet — accumulating' },
            bankroll_config: bankrollCfg,
            safety_disclaimer: bankrollCfg.safety_disclaimer,
            note: 'Simulated only — not real money',
          }), { status: 200, headers: corsHeaders() })
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders() })
        }
      }

      // 404
      status = 404;
      return new Response(JSON.stringify(sbError('NOT_FOUND', `Route ${pathname} not found`, 404)), {
        status: 404, headers: corsHeaders(),
      });

    } catch (err) {
      status = 500;
      console.error('[Error]', 500, pathname, err.message);
      return new Response(JSON.stringify(sbError('INTERNAL_ERROR', 'Internal server error', 500)), {
        status: 500, headers: corsHeaders(),
      });
    }
  },

  // ── CRON: roda a cada hora (auto-verify) + diariamente (ingest) ──────────
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    console.log('[Cron] Triggered at:', now, '| cron:', event.cron);

    // F2.86b: warm cache D-1/D-2 ANTES do auto-verify — só no tick `*/15`.
    // Roda em isolamento (sem outras tarefas no mesmo waitUntil) → budget pleno.
    // Próximo runPickAutoVerify (5min depois) usa cache warm sem precisar fresh fetch.
    if (event.cron === '*/15 * * * *') {
      ctx.waitUntil(
        warmYesterdayCache(env)
          .then(r => console.log('[Cron] F2.86b warm cache:', JSON.stringify(r)))
          .catch(e => console.error('[Cron] F2.86b warm cache error:', e.message))
      );
    }

    // Auto-verificação de picks pendentes — roda em TODOS os crons (toda hora)
    ctx.waitUntil(
      runPickAutoVerify(env)
        .then(r  => console.log('[Cron] Auto-verify picks:', JSON.stringify(r)))
        .catch(e => console.error('[Cron] Auto-verify error:', e.message))
    );

    // Auto-verifica telegram_tips (resolve W/L via ESPN) → unblocks Wilson LCB + _has_real_wr
    ctx.waitUntil(
      runTipsterAutoVerify(env)
        .then(r  => console.log('[Cron] Tipster auto-verify:', JSON.stringify(r)))
        .catch(e => console.error('[Cron] Tipster auto-verify error:', e.message))
    );

    // Resolve premium_pick_exposures (tracking de validação) — toda hora
    ctx.waitUntil(
      (async () => {
        try {
          const { resolvePremiumExposures } = await import('./routes/premiumValidation.js');
          const r = await resolvePremiumExposures(env);
          console.log('[Cron] Premium exposure resolve:', JSON.stringify(r));
        } catch (e) {
          console.error('[Cron] Premium exposure resolve error:', e.message);
        }
      })()
    );

    // P3.8.3.7 — Resolve shadow_bets (simulated, reutiliza lógica ESPN) — toda hora
    ctx.waitUntil(
      (async () => {
        try {
          const { resolveShadowBets } = await import('./routes/premiumValidation.js');
          const r = await resolveShadowBets(env);
          console.log('[Cron] Shadow bets resolve:', JSON.stringify(r));
        } catch (e) {
          console.error('[Cron] Shadow bets resolve error:', e.message);
        }
      })()
    );

    // Ingest propriet\u00e1rio ESPN → D1 (matches_raw + shot_events + officials)
    // Roda a cada hora. Pega jogos de ontem + hoje (s\u00f3 salva quem acabou/est\u00e1 rolando).
    // F2.25.1 — Gate ingestMatches no tick hourly apenas
    // Antes: rodava em TODO cron tick (5min, 15min, etc.) — paralelo com snapshotOdds,
    //        detectSteam, valueAlertScan etc., excedendo limite de subrequests do Worker
    //        (errors="Too many subrequests by single Worker invocation" em todos runs).
    // Agora: só no tick `0 * * * *`. Esse tick nao tem snapshotOdds nem outros heavy
    //        (que vivem em `*/5 * * * *`), liberando subrequests budget para ingestMatches.
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(
        ingestMatches(env, { daysBack: 1, includeFuture: false })
          .then(async r => {
            console.log('[Cron] Proprietary ingest:', JSON.stringify(r));
            const season = String(new Date().getFullYear());
            const agg = await recomputeTeamXG(env, season);
            console.log('[Cron] xG rolling recomputed:', JSON.stringify(agg));
            const cornersAgg = await recomputeTeamCorners(env, season);
            console.log('[Cron] Corners recomputed:', JSON.stringify(cornersAgg));
          })
          .catch(e => console.error('[Cron] Proprietary ingest error:', e.message))
      );
    }

    // Ingest di\u00e1rio de hist\u00f3rico — roda apenas no cron das 05:00 UTC
    if (event.cron === '0 5 * * *') {
      const history = new HistoryService(env);
      ctx.waitUntil(
        history.runDailyIngest()
          .then(s  => console.log('[Cron] Ingest complete:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Ingest error:', e.message))
      );
      // F2.46: api-football ingest (ontem) — substitui Sofascore enquanto bloqueado
      ctx.waitUntil(
        (async () => {
          const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          const r = await ingestApifDate(env, d, 30);
          console.log('[Cron] apif-ingest:', JSON.stringify(r));
        })().catch(e => console.error('[Cron] apif-ingest error:', e.message))
      );
      // Deep historical ingest: last 30 days → populates matches_raw for form signal
      ctx.waitUntil(
        ingestMatches(env, { daysBack: 30, includeFuture: false })
          .then(s => console.log('[Cron] Deep ingest (30d):', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Deep ingest error:', e.message))
      );
      // Prune snapshots antigos ≥14d (só 1x/dia)
      ctx.waitUntil(
        pruneOldSnapshots(env)
          .then(s => console.log('[Cron] Prune odds snapshots:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Prune error:', e.message))
      );
      // Rebuild isotonic calibration daily (uses accumulated picks_closed)
      ctx.waitUntil(
        (async () => {
          const { buildAllCurves } = await import('./ml/calibration.js');
          return buildAllCurves(env);
        })()
          .then(s => console.log('[Cron] Calibration rebuild:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Calibration error:', e.message))
      );
      // Ensure Neon next-month partition exists (1x/day)
      ctx.waitUntil(
        (async () => {
          const { ltEnsureNextMonthPartition } = await import('./storage/longterm.js');
          return ltEnsureNextMonthPartition(env);
        })()
          .then(r => console.log('[Cron] Next-month partition:', r))
          .catch(e => console.error('[Cron] Partition error:', e.message))
      );
      // S5 Referee: fetch ESPN referee + classify card tendency for today's fixtures
      ctx.waitUntil(
        collectReferees(env)
          .then(s => console.log('[Cron] Referee collector:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Referee collector error:', e.message))
      )
      // Atualiza padrões Wilson LCB (telegram_tips + pick_history) — aprendizado da IA
      ctx.waitUntil(
        (async () => {
          const { handleUpdatePatterns } = await import('./routes/patternGenerator.js')
          const fakeReq = new Request('https://worker/internal/update-patterns', {
            method: 'POST',
            headers: { 'X-Admin-Key': env.SB_MASTER_KEY || env.SB_INGEST_SECRET || '' }
          })
          const r = await handleUpdatePatterns(fakeReq, env)
          const data = await r.json()
          console.log('[Cron] Update patterns:', JSON.stringify(data))
        })()
          .catch(e => console.error('[Cron] Update patterns error:', e.message))
      )
    }

    // Snapshot odds: roda a cada 5min (cron '*/5 * * * *')
    // Scrape Betfair/Pinnacle/Betano/Superbet → D1 → consensus
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(
        snapshotOdds(env)
          .then(s  => console.log('[Cron] Odds snapshot:', s.ok ? `${s.events_total}ev/${s.snapshots_total}sn` : s.error))
          .catch(e => console.error('[Cron] Odds snapshot error:', e.message))
      );
      // Value alert scan — sub-segundo pro Telegram quando edge ≥ 5%
      ctx.waitUntil(
        (async () => {
          const { runValueAlertScan } = await import('./services/alerts.js');
          return runValueAlertScan(env, { minEdge: 5.0, maxAlerts: 10 });
        })()
          .then(s => console.log('[Cron] Value alert scan:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Value alert scan error:', e.message))
      );
      // CLV tracker — captura closing lines pra picks próximos do kickoff
      ctx.waitUntil(
        (async () => {
          const { captureClosingLines } = await import('./services/clv.js');
          return captureClosingLines(env);
        })()
          .then(s => console.log('[Cron] Capture closing lines:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Capture closing error:', e.message))
      );
      // S3 Steam: compute Pinnacle price movement signals every 5 min
      ctx.waitUntil(
        detectSteam(env)
          .then(s => console.log('[Cron] Steam detector:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Steam detector error:', e.message))
      )
    }

    // Hourly cron (padrão 0 * * * *) — ingest results + daily picks às 11h UTC (08 BR)
    if (event.cron === '0 * * * *' || event.cron === '0 5 * * *') {
      ctx.waitUntil(
        (async () => {
          const { ingestResults } = await import('./services/clv.js');
          return ingestResults(env);
        })()
          .then(s => console.log('[Cron] Ingest results:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Ingest results error:', e.message))
      );

      // Enrichment: build team_features for upcoming events (xG/weather/lineups/referee/rest)
      ctx.waitUntil(
        (async () => {
          const { enrichUpcomingEvents } = await import('./enrich/teamFeatures.js');
          return enrichUpcomingEvents(env, { hoursAhead: 48, maxEvents: 20 });
        })()
          .then(s => console.log('[Cron] Enrich upcoming:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Enrich error:', e.message))
      );

      // F2.53: 365Scores daily ingest — refresca shots PBP de BR-A/B + Lib/Sud
      // dos últimos 2 dias. Cobre ~5 jogos brasileiros + 0-2 sulamericanos = ~25 fetches.
      if (event.cron === '0 5 * * *') {
        ctx.waitUntil(
          (async () => {
            const { backfill365Scores } = await import('./cron/scores365Ingest.js');
            const today = new Date();
            const twoDaysAgo = new Date(today.getTime() - 2 * 86_400_000);
            return backfill365Scores(env, { fromDate: twoDaysAgo, toDate: today, bucketDays: 3 });
          })()
            .then(s => console.log('[Cron] 365Scores refresh:', JSON.stringify(s)))
            .catch(e => console.error('[Cron] 365Scores error:', e.message))
        );
      }

      // F2.52: Cartola FC daily refresh — última rodada do Brasileirão A.
      // Roda só no tick das 05:00 UTC (cron já agendado), light request (3 fetches/rodada).
      if (event.cron === '0 5 * * *') {
        ctx.waitUntil(
          (async () => {
            const { backfillCartola } = await import('./cron/cartolaIngest.js');
            // Sem from/to → pega só rodada atual (currentRodada == toRodada == 38, mas só 1 rodada nova)
            // Pra ser eficiente: pega últimas 2 rodadas (refresca pendente + nova)
            const status = await fetch('https://api.cartola.globo.com/mercado/status').then(r => r.json()).catch(() => null);
            const current = status?.rodada_atual || 1;
            return backfillCartola(env, { fromRodada: Math.max(1, current - 1), toRodada: current });
          })()
            .then(s => console.log('[Cron] Cartola refresh:', JSON.stringify(s)))
            .catch(e => console.error('[Cron] Cartola error:', e.message))
        );
      }

      // F2.51: backfill boxscore para jogos brasileiros/sulamericanos sem mtm.
      // Cap 20/tick — caber em CF subrequest budget. Vai esvaziando o pending
      // ao longo de algumas horas (~125 pending / 20 per tick = 7 ticks).
      ctx.waitUntil(
        (async () => {
          const { runBoxscoreBackfill } = await import('./cron/ingestMatches.js');
          return runBoxscoreBackfill(env, { limit: 20 });
        })()
          .then(s => console.log('[Cron] Boxscore backfill:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Boxscore backfill error:', e.message))
      );

      // Gera palpites do dia quando hora UTC === 11 (08:00 BRT)
      if (new Date().getUTCHours() === 11) {
        ctx.waitUntil(
          (async () => {
            const { generatePicks } = await import('./services/picks.js');
            return generatePicks(env, { minEdge: 2.5, maxPicks: 10, persist: true, pushTelegram: true });
          })()
            .then(s => console.log('[Cron] Daily picks:', s.ok ? `saved=${s.saved} pushed=${s.pushed}` : s.error))
            .catch(e => console.error('[Cron] Daily picks error:', e.message))
        );
      }
    }

    // Health monitor: a cada 15min, checa books stale + registra alertas
    if (event.cron === '*/15 * * * *') {
      ctx.waitUntil(
        (async () => {
          const { runStaleBookCheck } = await import('./routes/adminHealth.js');
          return runStaleBookCheck(env);
        })()
          .then(s => console.log('[Cron] Stale check:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Stale check error:', e.message))
      );
      // S2 Lineup: fetch ESPN lineups for games kicking off in 45–120min
      ctx.waitUntil(
        collectLineups(env)
          .then(s => console.log('[Cron] Lineup collector:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Lineup collector error:', e.message))
      )
    }

    // Form collector: every 3h — fetches last-5 form from API-Football
    if (event.cron === '0 */3 * * *') {
      ctx.waitUntil(
        collectForm(env)
          .then(s => console.log('[Cron] Form collector:', JSON.stringify(s)))
          .catch(e => console.error('[Cron] Form collector error:', e.message))
      )
    }

  },
};
