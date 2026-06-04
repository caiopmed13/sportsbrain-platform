/**
 * SportsBrain — Source Coverage & Data Moat Dashboard (P3.4)
 * ─────────────────────────────────────────────────────────
 * GET /v1/admin/source-coverage
 *
 * Retorna:
 *   - source_inventory: metadados estáticos de cada fonte
 *   - coverage: stats dinâmicas do D1 por fonte
 *   - data_quality_score: 0-100 global
 *   - golden_data_coverage: cobertura específica do produto Golden
 *   - gaps: lacunas identificadas
 *   - roadmap: DM1-DM6 priorizado
 *
 * Auth: X-Admin-Key (SB_MASTER_KEY) ou sem key em dev
 */

import { corsHeaders } from './health.js';
import { computeOddsFreshness } from '../services/oddsSnapshots.js';
import { queryShadowBetStats } from '../services/shadowBets.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function checkAuth(request, env) {
  const key = request.headers.get('X-Admin-Key') ||
              new URL(request.url).searchParams.get('admin_key');
  if (!env.SB_MASTER_KEY) return true;  // dev mode open
  return key && key === env.SB_MASTER_KEY;
}

// ── Static source inventory ────────────────────────────────────────────────
const SOURCE_INVENTORY = {
  bet365: {
    source_name:           'Bet365 Scraper',
    source_type:           'odds_scraper',
    data_collected:        ['odds', 'lines', 'markets', 'selections', 'kickoff', 'fixtures'],
    update_frequency:      'every_15min',
    coverage_sports:       ['football', 'basketball'],
    coverage_markets:      ['1x2', 'btts', 'over_under', 'asian_handicap', 'corners', 'cards', 'player_props', 'ht'],
    reliability:           'high',
    failure_modes:         ['rate_limit', 'ip_block', 'market_removal', 'auth_expiry'],
    cache_strategy:        'odds_snapshots D1 (15min TTL)',
    backfill_strategy:     'none — snapshot only, no historical odds',
    legal_risk_level:      'medium',
    technical_risk_level:  'high',
    usefulness_score:      10,
    current_gaps:          ['no opening odds', 'no closing odds', 'no line movement history', 'no market availability timestamp'],
  },
  sofascore: {
    source_name:           'SofaScore Ingest + Historical Backfill',
    source_type:           'historical_stats',
    data_collected:        ['team_matches_180d', 'h2h_2y', 'scores', 'ht_scores', 'corners', 'team_ids'],
    update_frequency:      'daily_cron + on-demand',
    coverage_sports:       ['football'],
    coverage_markets:      ['result', 'btts', 'over_under', 'ht_result', 'corners'],
    reliability:           'high',
    failure_modes:         ['api_changes', 'rate_limit', 'team_id_mismatch'],
    cache_strategy:        'sofascore_team_matches D1 (180d rolling)',
    backfill_strategy:     'sofascore-historical-backfill GitHub Actions (max_pages configurable)',
    legal_risk_level:      'medium',
    technical_risk_level:  'medium',
    usefulness_score:      10,
    current_gaps:          ['no player stats', 'no lineup data', 'no referee data', 'no period stats', 'no shots on target', 'no xG'],
  },
  espn: {
    source_name:           'ESPN Scores + Box Stats',
    source_type:           'result_resolver',
    data_collected:        ['match_scores', 'final_result'],
    update_frequency:      'on-demand (cron resolve)',
    coverage_sports:       ['football', 'basketball'],
    coverage_markets:      ['result', 'btts', 'over_under'],
    reliability:           'high',
    failure_modes:         ['league_not_covered', 'team_name_mismatch', 'delayed_results', 'api_down'],
    cache_strategy:        'none — fetched live during resolve',
    backfill_strategy:     'none',
    legal_risk_level:      'low',
    technical_risk_level:  'low',
    usefulness_score:      9,
    current_gaps:          ['only supports ~16 leagues', 'no player stats', 'no period scores from ESPN API', 'team name normalization errors'],
  },
  telegram_tipsters: {
    source_name:           'Telegram Tipsters',
    source_type:           'signal_source',
    data_collected:        ['picks', 'odds', 'markets', 'confidence'],
    update_frequency:      'real-time (webhook/polling)',
    coverage_sports:       ['football'],
    coverage_markets:      ['tipster-variable'],
    reliability:           'low',
    failure_modes:         ['no_track_record', 'phantom_odds', 'unresolvable_markets', 'no_source_trace'],
    cache_strategy:        'premium_pick_exposures D1',
    backfill_strategy:     'manual',
    legal_risk_level:      'low',
    technical_risk_level:  'low',
    usefulness_score:      5,
    current_gaps:          ['no performance history per tipster', 'unverified odds', 'audit_status partial/weak for most'],
  },
  ml_model: {
    source_name:           'ML Internal Model',
    source_type:           'signal_generator',
    data_collected:        ['probability_scores', 'picks'],
    update_frequency:      'on-demand',
    coverage_sports:       ['football'],
    coverage_markets:      ['result', 'btts', 'over_under'],
    reliability:           'medium',
    failure_modes:         ['small_sample', 'data_drift', 'feature_staleness'],
    cache_strategy:        'ml_training_samples D1',
    backfill_strategy:     'ml_training_samples from pick_history',
    legal_risk_level:      'low',
    technical_risk_level:  'medium',
    usefulness_score:      7,
    current_gaps:          ['small training set', 'no audit-filtered training yet', 'no feature versioning'],
  },
  premium_exposures: {
    source_name:           'Premium Exposures D1',
    source_type:           'internal_audit_log',
    data_collected:        ['picks_shown', 'audit_status', 'trust_level', 'source_family', 'results', 'roi'],
    update_frequency:      'on_every_premium_load',
    coverage_sports:       ['football'],
    coverage_markets:      ['all_premium_markets'],
    reliability:           'high',
    failure_modes:         ['D1 write failure (non-fatal)', 'legacy nulls pre-P3.3'],
    cache_strategy:        'premium_pick_exposures + premium_combo_exposures D1',
    backfill_strategy:     'auto-resolve via /internal/resolve-premium cron',
    legal_risk_level:      'none',
    technical_risk_level:  'low',
    usefulness_score:      10,
    current_gaps:          ['audit columns null for rows before P3.3 migration (2026-05-12)', 'VIP combos may have null audit'],
  },
};

// ── D1 coverage queries (all parallel, non-fatal) ─────────────────────────
async function queryCoverageStats(env) {
  if (!env.SB_DB) return {};

  const now = Date.now();
  const since24h  = now - 24 * 3600_000;
  const since7d   = now - 7  * 86400_000;
  const since30d  = now - 30 * 86400_000;

  const [
    oddsRow,
    oddsToday,
    sfRow,
    ppRow,
    ppAuditRow,
    ppResolvedRow,
    historyRow,
    mlSamplesRow,
    lineupsRow,
    refereeRow,
  ] = await Promise.all([
    // Bet365: last snapshot + count 24h
    env.SB_DB.prepare(
      'SELECT COUNT(*) as n, MAX(ts) as last_ts, COUNT(DISTINCT book) as books FROM odds_snapshots WHERE ts >= ?'
    ).bind(since24h).first().catch(() => null),

    // Bet365: distinct events with odds today
    env.SB_DB.prepare(
      'SELECT COUNT(DISTINCT event_id) as events FROM odds_snapshots WHERE ts >= ?'
    ).bind(since24h).first().catch(() => null),

    // SofaScore team matches
    env.SB_DB.prepare(
      'SELECT COUNT(*) as total_matches, COUNT(DISTINCT ss_team_id) as teams_covered, MIN(event_date) as oldest_match, MAX(event_date) as newest_match FROM sofascore_team_matches'
    ).first().catch(() => null),

    // Premium exposures total
    env.SB_DB.prepare(
      'SELECT COUNT(*) as total, COUNT(DISTINCT pick_date) as distinct_days FROM premium_pick_exposures'
    ).first().catch(() => null),

    // Premium exposures with audit columns populated (P3.3+)
    env.SB_DB.prepare(
      'SELECT COUNT(*) as audited FROM premium_pick_exposures WHERE pick_audit_status IS NOT NULL'
    ).first().catch(() => null),

    // Premium exposures resolved
    env.SB_DB.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN result_status IN ('green','red','void','half_green','half_red') THEN 1 ELSE 0 END) as resolved,
         SUM(CASE WHEN result_status = 'unknown' THEN 1 ELSE 0 END) as unknown_count,
         SUM(CASE WHEN result_status = 'pending' THEN 1 ELSE 0 END) as pending_count
       FROM premium_pick_exposures WHERE shown_at >= ?`
    ).bind(since30d).first().catch(() => null),

    // Pick history
    env.SB_DB.prepare(
      'SELECT COUNT(*) as total, SUM(CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END) as resolved FROM pick_history WHERE saved_at >= ?'
    ).bind(since30d).first().catch(() => null),

    // ML training samples
    env.SB_DB.prepare(
      'SELECT COUNT(*) as total FROM ml_training_samples'
    ).first().catch(() => null),

    // Match lineups
    env.SB_DB.prepare(
      'SELECT COUNT(*) as total, COUNT(DISTINCT fixture_id) as fixtures FROM match_lineups'
    ).first().catch(() => null),

    // Referee signals
    env.SB_DB.prepare(
      'SELECT COUNT(*) as total FROM referee_signals'
    ).first().catch(() => null),
  ]);

  return {
    odds: {
      snapshots_24h:   oddsRow?.n ?? 0,
      last_snapshot_ts: oddsRow?.last_ts ?? null,
      last_snapshot_iso: oddsRow?.last_ts ? new Date(+oddsRow.last_ts).toISOString() : null,
      last_snapshot_age_min: oddsRow?.last_ts ? Math.round((now - +oddsRow.last_ts) / 60000) : null,
      books_active_24h:  oddsRow?.books ?? 0,
      events_today:      oddsToday?.events ?? 0,
    },
    sofascore: {
      total_matches:    sfRow?.total_matches ?? 0,
      teams_covered:    sfRow?.teams_covered ?? 0,
      oldest_match:     sfRow?.oldest_match ?? null,
      newest_match:     sfRow?.newest_match ?? null,
      depth_days:       sfRow?.oldest_match
        ? Math.round((now - new Date(sfRow.oldest_match).getTime()) / 86400_000)
        : null,
    },
    premium_exposures: {
      total_picks:       ppRow?.total ?? 0,
      distinct_days:     ppRow?.distinct_days ?? 0,
      audited_p33:       ppAuditRow?.audited ?? 0,
      audit_coverage_pct: ppRow?.total ? +((ppAuditRow?.audited ?? 0) / ppRow.total * 100).toFixed(1) : 0,
      resolved_30d:      ppResolvedRow?.resolved ?? 0,
      unknown_30d:       ppResolvedRow?.unknown_count ?? 0,
      pending_30d:       ppResolvedRow?.pending_count ?? 0,
      total_30d:         ppResolvedRow?.total ?? 0,
      resolution_rate_pct: ppResolvedRow?.total
        ? +((ppResolvedRow.resolved ?? 0) / Math.max(1, ppResolvedRow.total - (ppResolvedRow.pending_count ?? 0)) * 100).toFixed(1)
        : null,
    },
    pick_history: {
      total_30d:    historyRow?.total ?? 0,
      resolved_30d: historyRow?.resolved ?? 0,
    },
    ml_training: {
      total_samples: mlSamplesRow?.total ?? 0,
    },
    lineups: {
      total_rows:  lineupsRow?.total ?? 0,
      fixtures:    lineupsRow?.fixtures ?? 0,
    },
    referee: {
      total_signals: refereeRow?.total ?? 0,
    },
  };
}

// ── Market availability stats (P3.5 / DM3) ───────────────────────────────
async function queryMarketAvailabilityStats(env) {
  if (!env.SB_DB) return null;

  const now24h = Date.now() - 24 * 3600_000;
  const nowIso = new Date(now24h).toISOString();

  const [totalRow, highConfRow, byBookmakerRow, bySportRow, staleRow, todayFixRow] = await Promise.all([
    // Total markets
    env.SB_DB.prepare('SELECT COUNT(*) as total, MAX(last_seen_at) as last_seen FROM market_availability WHERE available = 1')
      .first().catch(() => null),

    // High confidence markets
    env.SB_DB.prepare("SELECT COUNT(*) as n FROM market_availability WHERE available = 1 AND source_confidence = 'high'")
      .first().catch(() => null),

    // By bookmaker
    env.SB_DB.prepare('SELECT bookmaker, COUNT(*) as n FROM market_availability WHERE available = 1 GROUP BY bookmaker')
      .all().catch(() => ({ results: [] })),

    // By sport
    env.SB_DB.prepare('SELECT sport, COUNT(*) as n FROM market_availability WHERE available = 1 GROUP BY sport')
      .all().catch(() => ({ results: [] })),

    // Stale markets (last_seen > 24h ago)
    env.SB_DB.prepare('SELECT COUNT(*) as n FROM market_availability WHERE available = 1 AND last_seen_at < ?')
      .bind(nowIso).first().catch(() => null),

    // Fixtures with markets seen today
    env.SB_DB.prepare('SELECT COUNT(DISTINCT fixture_id) as n FROM market_availability WHERE last_seen_at >= ? AND fixture_id IS NOT NULL')
      .bind(nowIso).first().catch(() => null),
  ]).catch(() => [null, null, { results: [] }, { results: [] }, null, null]);

  const total = totalRow?.total ?? 0;
  const highConf = highConfRow?.n ?? 0;
  const high_confidence_pct = total > 0 ? +(highConf / total * 100).toFixed(1) : 0;

  const markets_by_bookmaker = {};
  for (const r of (byBookmakerRow?.results || [])) markets_by_bookmaker[r.bookmaker] = r.n;

  const markets_by_sport = {};
  for (const r of (bySportRow?.results || [])) markets_by_sport[r.sport || 'unknown'] = r.n;

  // Coverage score (0-10): scales with total markets and high-conf pct
  let coverage_score = 0;
  if (total >= 5000 && high_confidence_pct >= 80)       coverage_score = 10;
  else if (total >= 2000 && high_confidence_pct >= 70)  coverage_score = 8;
  else if (total >= 500  && high_confidence_pct >= 60)  coverage_score = 6;
  else if (total >= 100  && high_confidence_pct >= 40)  coverage_score = 4;
  else if (total >= 20)                                  coverage_score = 2;
  else if (total > 0)                                    coverage_score = 1;

  const status = total === 0 ? 'EMPTY' :
                 coverage_score >= 6 ? 'OK' :
                 coverage_score >= 3 ? 'PARTIAL' : 'WEAK';

  return {
    status,
    total_markets:              total,
    high_confidence_count:      highConf,
    high_confidence_pct,
    fixtures_with_markets_today: todayFixRow?.n ?? 0,
    markets_by_sport,
    markets_by_bookmaker,
    stale_markets_count:        staleRow?.n ?? 0,
    last_seen_at:               totalRow?.last_seen ?? null,
    coverage_score,
    gaps: total === 0 ? ['market_availability table empty — run migrate-p35 then make a premium request to populate'] : [],
  };
}

// ── Odds snapshot stats (P3.6 / DM2) ─────────────────────────────────────
async function queryOddsSnapshotStats(env) {
  if (!env.SB_DB) return null;
  try {
    const todayISO = new Date().toISOString().slice(0, 10);
    const [totRow, todayRow, bookRow] = await Promise.all([
      env.SB_DB.prepare(
        'SELECT COUNT(*) as n, MAX(captured_at) as last FROM market_odds_snapshots'
      ).first().catch(() => null),
      env.SB_DB.prepare(
        `SELECT COUNT(DISTINCT bet365_event_id) as fixtures,
                COUNT(DISTINCT normalized_market) as markets,
                COUNT(*) as n
         FROM market_odds_snapshots
         WHERE captured_at >= ?`
      ).bind(`${todayISO}T00:00:00.000Z`).first().catch(() => null),
      env.SB_DB.prepare(
        'SELECT bookmaker, COUNT(*) as n FROM market_odds_snapshots GROUP BY bookmaker ORDER BY n DESC LIMIT 5'
      ).all().catch(() => ({ results: [] })),
    ]);

    const total    = totRow?.n ?? 0;
    const last_at  = totRow?.last ?? null;
    const freshness_minutes = computeOddsFreshness(last_at);
    const todayCount = todayRow?.n ?? 0;

    let status, coverage_score;
    if (total === 0) {
      status = 'EMPTY'; coverage_score = 0;
    } else if (todayCount > 0) {
      status = freshness_minutes != null && freshness_minutes < 60 ? 'OK' : 'STALE';
      coverage_score = Math.min(10, Math.round(Math.min(todayCount / 20, 1) * 10));
    } else {
      status = 'STALE'; coverage_score = 1;
    }

    const snapshotsByBookmaker = Object.fromEntries(
      (bookRow?.results || []).map(r => [r.bookmaker, r.n])
    );

    const gaps = [];
    if (coverage_score === 0)
      gaps.push('no snapshots yet — run Premium request after migrate-p36');
    else if (freshness_minutes != null && freshness_minutes > 120)
      gaps.push(`odds snapshots stale: ${freshness_minutes}min since last capture`);

    return {
      status,
      total_snapshots:               total,
      fixtures_with_snapshots_today: todayRow?.fixtures ?? 0,
      markets_with_snapshots_today:  todayRow?.markets  ?? 0,
      snapshots_today:               todayCount,
      snapshots_by_bookmaker:        snapshotsByBookmaker,
      last_snapshot_at:              last_at,
      freshness_minutes,
      coverage_score,
      gaps,
    };
  } catch (e) {
    if (/no such table/i.test(e?.message || ''))
      return { status: 'TABLE_MISSING', coverage_score: 0, total_snapshots: 0, table_missing: true,
               gaps: ['table not yet created — run /internal/admin/migrate-p36'] };
    return null;
  }
}

// ── Golden data coverage (from premium_pick_exposures) ────────────────────
async function queryGoldenCoverage(env) {
  if (!env.SB_DB) return null;

  const since30d = Date.now() - 30 * 86400_000;

  const [goldenRow, goldenAuditRow, goldenResultRow] = await Promise.all([
    // All golden candidates
    env.SB_DB.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN odd IS NOT NULL AND odd > 0 THEN 1 ELSE 0 END) as with_real_odd,
              SUM(CASE WHEN data_quality_score IS NOT NULL THEN 1 ELSE 0 END) as with_dq_score,
              SUM(CASE WHEN golden_support_score IS NOT NULL THEN 1 ELSE 0 END) as with_gs_score,
              AVG(data_quality_score) as avg_dq,
              AVG(golden_support_score) as avg_gs,
              SUM(CASE WHEN odds_snapshot_id IS NOT NULL THEN 1 ELSE 0 END) as with_odds_snapshot,
              SUM(CASE WHEN odds_movement_direction IS NOT NULL THEN 1 ELSE 0 END) as with_odds_movement,
              SUM(CASE WHEN clv_status IS NOT NULL AND clv_status != 'unknown' THEN 1 ELSE 0 END) as with_clv_known
       FROM premium_pick_exposures
       WHERE (source_family = 'golden' OR golden_audit_status IS NOT NULL) AND shown_at >= ?`
    ).bind(since30d).first().catch(() => null),

    // Golden by audit status
    env.SB_DB.prepare(
      `SELECT pick_audit_status, trust_level, COUNT(*) as n
       FROM premium_pick_exposures
       WHERE (source_family = 'golden' OR golden_audit_status IS NOT NULL) AND shown_at >= ?
       GROUP BY pick_audit_status, trust_level`
    ).bind(since30d).all().catch(() => ({ results: [] })),

    // Golden with results
    env.SB_DB.prepare(
      `SELECT result_status, COUNT(*) as n
       FROM premium_pick_exposures
       WHERE (source_family = 'golden' OR golden_audit_status IS NOT NULL)
         AND shown_at >= ?
         AND result_status IN ('green','red','void','pending','unknown')
       GROUP BY result_status`
    ).bind(since30d).all().catch(() => ({ results: [] })),
  ]);

  const auditBreakdown = {};
  for (const r of (goldenAuditRow.results || [])) {
    const key = r.pick_audit_status || 'legacy_unknown';
    auditBreakdown[key] = (auditBreakdown[key] || 0) + r.n;
  }

  const resultBreakdown = {};
  for (const r of (goldenResultRow.results || [])) {
    resultBreakdown[r.result_status] = r.n;
  }

  return {
    candidates_30d:         goldenRow?.total ?? 0,
    with_real_odd:           goldenRow?.with_real_odd ?? 0,
    with_data_quality_score: goldenRow?.with_dq_score ?? 0,
    with_golden_support_score: goldenRow?.with_gs_score ?? 0,
    avg_data_quality_score:  goldenRow?.avg_dq != null ? +goldenRow.avg_dq.toFixed(1) : null,
    avg_golden_support_score: goldenRow?.avg_gs != null ? +goldenRow.avg_gs.toFixed(1) : null,
    // P3.5: with_market_availability now derived from market_availability table (set via queryMarketAvailabilityStats)
    with_market_availability: 0,       // populated in handleSourceCoverage after queryMarketAvailabilityStats runs
    with_line_movement:       0,        // DM2 — não implementado ainda
    with_h2h:                 0,        // depende do lookup no momento da geração — não armazenado
    with_odds_snapshot:       goldenRow?.with_odds_snapshot ?? 0,
    with_odds_movement:       goldenRow?.with_odds_movement ?? 0,
    with_clv_known:           goldenRow?.with_clv_known ?? 0,
    with_result_path:         (goldenRow?.with_real_odd ?? 0) > 0 ? goldenRow.with_real_odd : 0,
    audit_breakdown:          auditBreakdown,
    result_breakdown:         resultBreakdown,
    valid_count:              auditBreakdown['valid'] ?? 0,
    observation_count:        (auditBreakdown['observation'] ?? 0) + (auditBreakdown['observation-forte'] ?? 0),
    blocked_count:            auditBreakdown['blocked'] ?? 0,
    legacy_unknown_count:     auditBreakdown['legacy_unknown'] ?? 0,
  };
}

// ── Data Quality Score (0-100) ────────────────────────────────────────────
function computeDataQualityScore(coverage, marketAvailStats = null, fixtureIdentityStats = null, oddsSnapshotStats = null, shadowBetStats = null) {
  const MAX = {
    bet365_freshness:          20,
    sofascore_historical:      20,
    team_profile:              15,
    h2h_coverage:              10,
    result_validation:         15,
    market_availability:       10,
    fixture_identity_coverage:  5,
    odds_snapshots_coverage:   10,
    shadow_betting_coverage:    5,
    player_lineup:              5,
    advanced_data:              5,
  };
  const scores = {};

  // 1. Bet365 odds freshness (20 pts)
  const ageMins = coverage.odds?.last_snapshot_age_min;
  if (ageMins == null)            scores.bet365_freshness = 0;
  else if (ageMins < 30)         scores.bet365_freshness = 20;
  else if (ageMins < 60)         scores.bet365_freshness = 15;
  else if (ageMins < 180)        scores.bet365_freshness = 10;
  else if (ageMins < 1440)       scores.bet365_freshness = 5;
  else                            scores.bet365_freshness = 0;

  // 2. SofaScore historical coverage (20 pts)
  const sfTeams   = coverage.sofascore?.teams_covered ?? 0;
  const sfMatches = coverage.sofascore?.total_matches ?? 0;
  const sfDepth   = coverage.sofascore?.depth_days ?? 0;
  if (sfTeams >= 800 && sfMatches >= 18000 && sfDepth >= 170)  scores.sofascore_historical = 20;
  else if (sfTeams >= 600 && sfMatches >= 12000 && sfDepth >= 90) scores.sofascore_historical = 14;
  else if (sfTeams >= 300 && sfMatches >= 5000)                scores.sofascore_historical = 8;
  else if (sfTeams >= 50)                                       scores.sofascore_historical = 4;
  else                                                          scores.sofascore_historical = 0;

  // 3. Team profile coverage (15 pts) — derived from sofascore coverage
  if (sfTeams >= 800)       scores.team_profile = 15;
  else if (sfTeams >= 500)  scores.team_profile = 10;
  else if (sfTeams >= 200)  scores.team_profile = 6;
  else if (sfTeams >= 50)   scores.team_profile = 3;
  else                       scores.team_profile = 0;

  // 4. H2H coverage (10 pts) — computed on-the-fly from sofascore_team_matches (opponent_team_id)
  // With 18k+ matches and 800+ teams, H2H coverage is ~47% per P2.3 results
  if (sfMatches >= 18000)     scores.h2h_coverage = 8;   // ~47% coverage
  else if (sfMatches >= 10000) scores.h2h_coverage = 6;
  else if (sfMatches >= 5000)  scores.h2h_coverage = 4;
  else                          scores.h2h_coverage = 0;

  // 5. Result validation coverage (15 pts)
  const total30  = coverage.premium_exposures?.total_30d ?? 0;
  const resolved = coverage.premium_exposures?.resolved_30d ?? 0;
  const pending  = coverage.premium_exposures?.pending_30d ?? 0;
  const settleable = total30 - pending;
  const resPct = settleable > 0 ? resolved / settleable : 0;
  if (resPct >= 0.85 && total30 >= 50)       scores.result_validation = 15;
  else if (resPct >= 0.70 && total30 >= 30)  scores.result_validation = 10;
  else if (resPct >= 0.50 && total30 >= 10)  scores.result_validation = 6;
  else if (total30 > 0)                       scores.result_validation = 2;
  else                                         scores.result_validation = 0;

  // 6. Market availability coverage (10 pts) — DM3 (P3.5)
  // Uses coverage_score computed from market_availability table stats
  scores.market_availability = marketAvailStats?.coverage_score ?? 0;

  // 6b. Fixture identity coverage (5 pts) — P3.5.1
  scores.fixture_identity_coverage = fixtureIdentityStats?.identity_score ?? 0;

  // 6c. Odds snapshots coverage (10 pts) — DM2 (P3.6)
  scores.odds_snapshots_coverage = oddsSnapshotStats?.coverage_score ?? 0;

  // 6d. Shadow betting coverage (5 pts) — P3.7
  scores.shadow_betting_coverage = shadowBetStats?.coverage_score ?? 0;

  // 7. Player/lineup coverage (5 pts)
  const lineupFixtures = coverage.lineups?.fixtures ?? 0;
  if (lineupFixtures >= 500)       scores.player_lineup = 5;
  else if (lineupFixtures >= 100)  scores.player_lineup = 3;
  else if (lineupFixtures >= 10)   scores.player_lineup = 1;
  else                              scores.player_lineup = 0;

  // 8. Injury/referee/advanced data (5 pts)
  const refereeSignals = coverage.referee?.total_signals ?? 0;
  if (refereeSignals >= 200)      scores.advanced_data = 5;
  else if (refereeSignals >= 50)  scores.advanced_data = 3;
  else if (refereeSignals >= 5)   scores.advanced_data = 1;
  else                             scores.advanced_data = 0;

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const max   = Object.values(MAX).reduce((a, b) => a + b, 0);

  return {
    total_score:      total,
    max_score:        max,
    pct:              +(total / max * 100).toFixed(1),
    label:            total >= 75 ? 'Strong' : total >= 50 ? 'Moderate' : total >= 30 ? 'Basic' : 'Weak',
    components:       Object.fromEntries(
      Object.keys(MAX).map(k => [k, { score: scores[k] ?? 0, max: MAX[k], pct: +((scores[k] ?? 0) / MAX[k] * 100).toFixed(0) }])
    ),
  };
}

// ── Gaps analysis ─────────────────────────────────────────────────────────
function buildGapsAnalysis(coverage, qualityScore, oddsSnapshotStats = null, shadowBetStats = null) {
  const gaps = [];
  const c = qualityScore.components;

  if (c.bet365_freshness.score < 15)
    gaps.push({ area: 'bet365_freshness', severity: 'high', description: 'Odds snapshots desatualizadas ou Bet365 offline. Impact: Singles/Golden precision.', dm_target: 'DM2' });

  if (c.sofascore_historical.score < 15)
    gaps.push({ area: 'sofascore_coverage', severity: 'high', description: `Cobertura SofaScore insuficiente (${coverage.sofascore?.teams_covered ?? 0} times, ${coverage.sofascore?.total_matches ?? 0} matches). Impact: Team profiles, Golden, H2H.`, dm_target: 'DM1' });

  if (c.market_availability.score === 0)
    gaps.push({ area: 'market_availability', severity: 'high', description: 'Tabela market_availability vazia ou não criada. Execute /internal/admin/migrate-p35 e faça uma request Premium para popular. Impact: market_validation, resolvability, Golden.', dm_target: 'DM3' });
  else if (c.market_availability.score < 6)
    gaps.push({ area: 'market_availability', severity: 'medium', description: `Market availability com cobertura baixa (coverage_score=${c.market_availability.score}/10). Mais requests Premium aumentarão a cobertura. Impact: market_validation accuracy.`, dm_target: 'DM3' });

  if (!c.fixture_identity_coverage || c.fixture_identity_coverage.score === 0)
    gaps.push({ area: 'fixture_identity', severity: 'high', description: 'Fixture identity missing — bet365_event_id not flowing through pipeline. Run P3.5.1 pipeline (Premium request). Impact: market_availability ingest, DM2 readiness.', dm_target: 'DM3.1' });
  else if (c.fixture_identity_coverage.score < 3)
    gaps.push({ area: 'fixture_identity', severity: 'medium', description: `Fixture identity partial coverage (score=${c.fixture_identity_coverage.score}/5). Some picks lack bet365_event_id — check devig/steam sources.`, dm_target: 'DM3.1' });

  if (!oddsSnapshotStats || oddsSnapshotStats.status === 'EMPTY' || oddsSnapshotStats.status === 'TABLE_MISSING')
    gaps.push({ area: 'odds_snapshots', severity: 'high',
      description: 'Tabela market_odds_snapshots vazia ou não criada. Execute /internal/admin/migrate-p36 e faça uma request Premium para popular. Impact: line movement, CLV, Steam detection, Golden boost.',
      dm_target: 'DM2' });
  else if (oddsSnapshotStats?.freshness_minutes != null && oddsSnapshotStats.freshness_minutes > 120)
    gaps.push({ area: 'odds_freshness', severity: 'medium',
      description: `Odds snapshots desatualizados (${oddsSnapshotStats.freshness_minutes}min desde última captura). Impact: CLV precision, steam detection.`,
      dm_target: 'DM2' });

  if (!shadowBetStats || shadowBetStats.status === 'EMPTY' || shadowBetStats.status === 'TABLE_MISSING')
    gaps.push({ area: 'shadow_betting', severity: 'medium',
      description: 'Shadow betting não iniciado. Execute /internal/admin/migrate-p37 e faça uma request Premium. Impact: sem simulação de ROI, sem Bet Confidence tracking.',
      dm_target: 'P3.7' });

  if (c.result_validation.score < 10)
    gaps.push({ area: 'result_validation', severity: 'medium', description: `Taxa de resolução baixa (${coverage.premium_exposures?.resolution_rate_pct ?? 0}%). Impact: ROI confiável, ML training.`, dm_target: 'DM1' });

  if (c.player_lineup.score < 3)
    gaps.push({ area: 'lineup_data', severity: 'medium', description: 'Poucos dados de lineup/escalação. Impact: player props, basquete, análise de ausências.', dm_target: 'DM4' });

  if (c.advanced_data.score < 3)
    gaps.push({ area: 'referee_data', severity: 'low', description: 'Dados de árbitros/lesões/suspensões inexistentes ou mínimos. Impact: BINGO, cartões, análise de risco.', dm_target: 'DM5' });

  gaps.push({
    area:        'odds_snapshots_history',
    severity:    'high',
    description: 'Não há histórico de odds (abertura/fechamento/movimento). Impossível calcular CLV. Impact: edge analysis, steam detection qualitativo.',
    dm_target:   'DM2',
  });

  gaps.push({
    area:        'ml_feature_store',
    severity:    'medium',
    description: `ML com ${coverage.ml_training?.total_samples ?? 0} amostras. Sem versioning, sem audit_status filter ativo, sem feature store reproduzível.`,
    dm_target:   'DM6',
  });

  return gaps.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
  });
}

// ── Data Moat Roadmap ─────────────────────────────────────────────────────
const DATA_MOAT_ROADMAP = [
  {
    id: 'DM1',
    title: 'Source Coverage & Data Quality',
    priority: 'immediate',
    status: 'in_progress',
    tasks: [
      'Mapear todas as fontes ✅',
      'Criar /v1/admin/source-coverage ✅',
      'sportsBrainDataQualityScore ✅',
      'Identificar lacunas ✅',
    ],
    impact: ['health monitoring', 'gap visibility', 'monetization readiness signal'],
    effort: 'low',
  },
  {
    id: 'DM2',
    title: 'Odds Snapshots & Line Movement',
    priority: 'high',
    status: 'in_progress',
    tasks: [
      'Criar tabela market_odds_snapshots',
      'Capturar odds em intervalos regulares (pré-kick)',
      'Calcular opening/closing/current',
      'Steam indicator baseado em movimento',
      'Preparar infraestrutura para CLV futuro',
    ],
    impact: ['CLV preparation', 'edge confidence', 'Golden precision'],
    effort: 'medium',
    tables_needed: ['market_odds_snapshots'],
  },
  {
    id: 'DM3',
    title: 'Market Availability',
    priority: 'high',
    status: 'in_progress',
    tasks: [
      'Criar tabela market_availability ✅ (P3.5)',
      'Normalização de mercado/seleção ✅ (marketNormalization.js)',
      'UPSERT automático em cada request Premium ✅',
      'Bulk lookup para audit de picks ✅ (buildMarketValidation)',
      'Integrado com market_validation + buildAuditStatus ✅',
      'can_post=false quando market_available=false ✅',
      'Fonte coverage atualizado com market_availability block ✅',
      'DQ Score inclui market_availability ✅ (+0-10pts)',
      'Registrar quando cada mercado foi visto por última vez ✅',
      'Melhorar resolvability para mercados raros — parcial (via market_available gate)',
    ],
    impact: ['market_validation', 'resolvability', 'Golden audit quality', 'can_post gate', '+10 DQ score'],
    effort: 'medium',
    tables_needed: ['market_availability'],
  },
  {
    id: 'DM4',
    title: 'Player & Lineup Data',
    priority: 'medium',
    status: 'planned',
    tasks: [
      'Capturar escalações prováveis/confirmadas',
      'Registrar disponibilidade por jogador',
      'Melhorar basquete player props',
      'Análise de ausências chave',
    ],
    impact: ['player_props accuracy', 'basketball', 'injury analysis'],
    effort: 'high',
    tables_needed: ['team_lineups', 'player_availability', 'player_profiles'],
  },
  {
    id: 'DM5',
    title: 'Advanced Context (Referee, Injuries, Calendar)',
    priority: 'medium',
    status: 'planned',
    tasks: [
      'Perfis de árbitros (cartões/faltas)',
      'Lesões/suspensões com fonte',
      'Calendário/fadiga (dias entre jogos)',
      'Stats por período (1T/2T)',
    ],
    impact: ['BINGO', 'cards markets', 'CHUTES', 'risk analysis'],
    effort: 'high',
    tables_needed: ['referee_profiles', 'team_absences', 'team_schedule_load'],
  },
  {
    id: 'DM6',
    title: 'ML Feature Store',
    priority: 'medium',
    status: 'planned',
    tasks: [
      'Filtrar training por shouldTrainMainModel (P3.3)',
      'Versionar features por data',
      'Dataset reproduzível com audit_status',
      'Separar treino por source_family/trust_level',
    ],
    impact: ['ML accuracy', 'model reliability', 'bias reduction'],
    effort: 'medium',
    tables_needed: ['team_intelligence_snapshots (opcional)'],
  },
];

// ── Main handler ──────────────────────────────────────────────────────────
export async function handleSourceCoverage(request, env) {
  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  try {
    const [coverage, goldenCoverage, marketAvailStats, oddsSnapshotStats, shadowBetStats] = await Promise.all([
      queryCoverageStats(env),
      queryGoldenCoverage(env),
      queryMarketAvailabilityStats(env),   // P3.5 / DM3
      queryOddsSnapshotStats(env),         // P3.6 / DM2
      queryShadowBetStats(env),            // P3.7
    ]);

    // ── Fixture identity coverage (from market_availability table) ─────────────
    let fixtureIdentityStats = null;
    if (env.SB_DB) {
      try {
        const [fiAll, fiWithFixId, fiWithB365Id, fiHighConf] = await Promise.all([
          env.SB_DB.prepare('SELECT COUNT(*) as n FROM market_availability').first(),
          env.SB_DB.prepare('SELECT COUNT(*) as n FROM market_availability WHERE fixture_id IS NOT NULL').first(),
          env.SB_DB.prepare('SELECT COUNT(*) as n FROM market_availability WHERE bet365_event_id IS NOT NULL').first(),
          env.SB_DB.prepare("SELECT COUNT(*) as n FROM market_availability WHERE source_confidence = 'high'").first(),
        ]);
        const total         = fiAll?.n ?? 0;
        const withFixId     = fiWithFixId?.n ?? 0;
        const withB365Id    = fiWithB365Id?.n ?? 0;
        const highConf      = fiHighConf?.n ?? 0;
        const withAnyId     = Math.max(withFixId, withB365Id);  // approximate — rows can have both
        const missingId     = Math.max(0, total - withAnyId);
        const coveragePct   = total > 0 ? +(withAnyId / total * 100).toFixed(1) : 0;
        const highConfPct   = total > 0 ? +(highConf / total * 100).toFixed(1) : 0;

        // Score 0-5:
        //   0 = no data
        //   1 = has data but <25% identity
        //   2 = 25-49% identity
        //   3 = 50-74% identity
        //   4 = 75-89% identity
        //   5 = ≥90% identity coverage
        const identityScore = total === 0 ? 0
          : coveragePct >= 90 ? 5
          : coveragePct >= 75 ? 4
          : coveragePct >= 50 ? 3
          : coveragePct >= 25 ? 2
          : 1;

        fixtureIdentityStats = {
          status:                   total === 0 ? 'EMPTY' : coveragePct >= 90 ? 'GOOD' : coveragePct >= 50 ? 'PARTIAL' : 'LOW',
          total_items_checked:      total,
          with_fixture_id:          withFixId,
          with_bet365_event_id:     withB365Id,
          with_fallback_identity:   0,   // fallback not stored in market_availability (pipeline-only)
          missing_identity:         missingId,
          identity_coverage_pct:    coveragePct,
          high_confidence_identity_pct: highConfPct,
          identity_score:           identityScore,
          gaps: total === 0
            ? ['market_availability table empty — run P3.5.1 pipeline to populate fixture identity']
            : coveragePct < 50
            ? ['Low identity coverage — many market_availability rows lack fixture_id/bet365_event_id']
            : [],
        };
      } catch (e) {
        console.warn('[sourceCoverage] fixtureIdentity query error:', e.message);
      }
    }

    const qualityScore  = computeDataQualityScore(coverage, marketAvailStats, fixtureIdentityStats, oddsSnapshotStats, shadowBetStats);
    const gaps          = buildGapsAnalysis(coverage, qualityScore, oddsSnapshotStats, shadowBetStats);

    // Compute P3.4.4 live coverage object
    const sourceCoverage = {
      bet365: {
        status:               coverage.odds?.last_snapshot_age_min != null
          ? (coverage.odds.last_snapshot_age_min < 30 ? 'OK' : coverage.odds.last_snapshot_age_min < 60 ? 'WARN' : 'STALE')
          : 'UNKNOWN',
        events_today:         coverage.odds?.events_today ?? 0,
        snapshots_24h:        coverage.odds?.snapshots_24h ?? 0,
        books_active:         coverage.odds?.books_active_24h ?? 0,
        last_snapshot_at:     coverage.odds?.last_snapshot_iso ?? null,
        odds_freshness_min:   coverage.odds?.last_snapshot_age_min ?? null,
        gaps:                 SOURCE_INVENTORY.bet365.current_gaps,
      },
      sofascore: {
        status:               coverage.sofascore?.total_matches > 15000 ? 'OK' : coverage.sofascore?.total_matches > 5000 ? 'PARTIAL' : 'WEAK',
        teams_with_history:   coverage.sofascore?.teams_covered ?? 0,
        matches_in_d1:        coverage.sofascore?.total_matches ?? 0,
        oldest_match:         coverage.sofascore?.oldest_match ?? null,
        newest_match:         coverage.sofascore?.newest_match ?? null,
        depth_days:           coverage.sofascore?.depth_days ?? null,
        gaps:                 SOURCE_INVENTORY.sofascore.current_gaps,
      },
      espn: {
        status:               coverage.premium_exposures?.resolution_rate_pct > 70 ? 'OK' : 'PARTIAL',
        result_resolution_pct: coverage.premium_exposures?.resolution_rate_pct ?? null,
        picks_resolved_30d:   coverage.premium_exposures?.resolved_30d ?? 0,
        unknown_30d:          coverage.premium_exposures?.unknown_30d ?? 0,
        gaps:                 SOURCE_INVENTORY.espn.current_gaps,
      },
      validation: {
        exposures_total:       coverage.premium_exposures?.total_picks ?? 0,
        exposures_audited_p33: coverage.premium_exposures?.audited_p33 ?? 0,
        audit_coverage_pct:    coverage.premium_exposures?.audit_coverage_pct ?? 0,
        unknown_30d:           coverage.premium_exposures?.unknown_30d ?? 0,
        pending_30d:           coverage.premium_exposures?.pending_30d ?? 0,
        resolution_rate_pct:   coverage.premium_exposures?.resolution_rate_pct ?? null,
      },
      // P3.5 / DM3 — Market Availability
      market_availability: {
        status:                    marketAvailStats?.status ?? 'EMPTY',
        total_markets:             marketAvailStats?.total_markets ?? 0,
        high_confidence_count:     marketAvailStats?.high_confidence_count ?? 0,
        high_confidence_pct:       marketAvailStats?.high_confidence_pct ?? 0,
        fixtures_with_markets_today: marketAvailStats?.fixtures_with_markets_today ?? 0,
        markets_by_sport:          marketAvailStats?.markets_by_sport ?? {},
        markets_by_bookmaker:      marketAvailStats?.markets_by_bookmaker ?? {},
        stale_markets_count:       marketAvailStats?.stale_markets_count ?? 0,
        last_seen_at:              marketAvailStats?.last_seen_at ?? null,
        coverage_score:            marketAvailStats?.coverage_score ?? 0,
        gaps:                      marketAvailStats?.gaps ?? ['market_availability table not yet populated'],
        requires_fixture_identity: true,
        identity_ready:            (fixtureIdentityStats?.identity_coverage_pct ?? 0) >= 50,
      },
      // P3.6 / DM2 — Odds Snapshots
      odds_snapshots: {
        status:                         oddsSnapshotStats?.status ?? 'UNKNOWN',
        total_snapshots:                oddsSnapshotStats?.total_snapshots ?? 0,
        fixtures_with_snapshots_today:  oddsSnapshotStats?.fixtures_with_snapshots_today ?? 0,
        markets_with_snapshots_today:   oddsSnapshotStats?.markets_with_snapshots_today ?? 0,
        snapshots_today:                oddsSnapshotStats?.snapshots_today ?? 0,
        snapshots_by_bookmaker:         oddsSnapshotStats?.snapshots_by_bookmaker ?? {},
        last_snapshot_at:               oddsSnapshotStats?.last_snapshot_at ?? null,
        freshness_minutes:              oddsSnapshotStats?.freshness_minutes ?? null,
        coverage_score:                 oddsSnapshotStats?.coverage_score ?? 0,
        gaps:                           oddsSnapshotStats?.gaps ?? ['no snapshot data'],
        migration_required:             oddsSnapshotStats?.status === 'TABLE_MISSING',
      },
      // P3.7 — Shadow Betting
      shadow_betting: {
        status:            shadowBetStats?.status        ?? 'UNKNOWN',
        total_bets:        shadowBetStats?.total_bets    ?? 0,
        main_bets:         shadowBetStats?.main_bets     ?? 0,
        pending:           shadowBetStats?.pending       ?? 0,
        resolved:          shadowBetStats?.resolved      ?? 0,
        by_tier_7d:        shadowBetStats?.by_tier_7d    ?? {},
        coverage_score:    shadowBetStats?.coverage_score ?? 0,
        migration_required: shadowBetStats?.status === 'TABLE_MISSING',
      },
      // P3.5.1 — Fixture Identity
      fixture_identity: {
        status:                       fixtureIdentityStats?.status ?? 'EMPTY',
        total_items_checked:          fixtureIdentityStats?.total_items_checked ?? 0,
        with_fixture_id:              fixtureIdentityStats?.with_fixture_id ?? 0,
        with_bet365_event_id:         fixtureIdentityStats?.with_bet365_event_id ?? 0,
        with_fallback_identity:       fixtureIdentityStats?.with_fallback_identity ?? 0,
        missing_identity:             fixtureIdentityStats?.missing_identity ?? 0,
        identity_coverage_pct:        fixtureIdentityStats?.identity_coverage_pct ?? 0,
        high_confidence_identity_pct: fixtureIdentityStats?.high_confidence_identity_pct ?? 0,
        identity_score:               fixtureIdentityStats?.identity_score ?? 0,
        gaps:                         fixtureIdentityStats?.gaps ?? ['no data'],
      },
      ml: {
        training_samples:      coverage.ml_training?.total_samples ?? 0,
        lineups_fixtures:      coverage.lineups?.fixtures ?? 0,
        referee_signals:       coverage.referee?.total_signals ?? 0,
      },
      data_moat: {
        coverage_score:        qualityScore.total_score,
        coverage_pct:          qualityScore.pct,
        coverage_label:        qualityScore.label,
        strongest_areas:       Object.entries(qualityScore.components)
          .filter(([, v]) => v.pct >= 70)
          .map(([k]) => k),
        weakest_areas:         Object.entries(qualityScore.components)
          .filter(([, v]) => v.pct < 40)
          .map(([k]) => k),
        next_data_targets:     gaps.filter(g => g.severity === 'high').slice(0, 3).map(g => g.area),
      },
    };

    return json({
      ok: true,
      generated_at: new Date().toISOString(),

      // ── P3.4.4 Source Coverage ─────────────────────────────────────────
      source_coverage: sourceCoverage,

      // ── P3.4.5 Data Quality Score ──────────────────────────────────────
      data_quality_score: qualityScore,

      // ── P3.5 Golden Data Coverage (updated with market availability) ──
      golden_data_coverage: goldenCoverage ? {
        ...goldenCoverage,
        // P3.5: with_market_availability now computable if we have market_availability data
        with_market_availability: marketAvailStats?.total_markets > 0
          ? goldenCoverage.with_real_odd   // picks that have real_odd are candidates for market lookup
          : 0,
        with_high_confidence_availability: marketAvailStats?.high_confidence_count > 0
          ? Math.round((goldenCoverage.with_real_odd ?? 0) * (marketAvailStats.high_confidence_pct / 100))
          : 0,
      } : goldenCoverage,

      // ── P3.4.1 Source Inventory ────────────────────────────────────────
      source_inventory: SOURCE_INVENTORY,

      // ── Gaps ───────────────────────────────────────────────────────────
      gaps,

      // ── P3.4.7 Data Moat Roadmap ───────────────────────────────────────
      roadmap: DATA_MOAT_ROADMAP,

      // ── Raw coverage stats ─────────────────────────────────────────────
      _raw_coverage: coverage,
    });

  } catch (e) {
    return json({ ok: false, error: e.message, stack: e.stack }, 500);
  }
}
