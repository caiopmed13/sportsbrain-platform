/**
 * ML Training Pipeline — endpoints para montar histórico próprio.
 * ──────────────────────────────────────────────────────────────────────
 *   POST /internal/ml/collect        (X-Ingest-Secret)  body: { samples: [...] }
 *   POST /internal/ml/fill-result    (X-Ingest-Secret)  body: { results: [...] }
 *   GET  /v1/admin/ml/training/stats (X-Admin-Key)
 *   GET  /v1/admin/ml/training/export?sport=..&market=..&format=csv (X-Admin-Key)
 *
 * Fluxo:
 *   1. Gateway roda /ml/collect algumas horas antes do jogo com features+closing
 *   2. Quando jogo encerra, gateway roda /ml/fill-result com placar
 *   3. Script de training baixa CSV via /training/export e treina XGBoost
 */
import { sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';

function checkIngestAuth(request, env) {
  const provided = request.headers.get('X-Ingest-Secret');
  return env.SB_MASTER_KEY && provided === env.SB_MASTER_KEY;
}
function checkAdminAuth(request, env) {
  const provided = request.headers.get('X-Admin-Key');
  return env.SB_MASTER_KEY && provided === env.SB_MASTER_KEY;
}

// ── Label calculators ────────────────────────────────────────────────────────
// Retorna { label, draw_label } dado market + scores + closing_json
function computeLabel(market, homeScore, awayScore, closing) {
  const h = Number(homeScore), a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return { label: null, draw_label: null };

  switch ((market || '').toLowerCase()) {
    case 'spread': {
      // closing.line = linha do home (ex: -5.5). home cobre se (h - a) > -line? Convenção:
      // spread aplica ao home: home_score + spread_home > away_score
      const line = Number(closing?.line);
      if (!Number.isFinite(line)) return { label: null, draw_label: null };
      const margin = (h + line) - a;
      if (margin === 0) return { label: null, draw_label: null }; // push
      return { label: margin > 0 ? 1 : 0, draw_label: null };
    }
    case 'total': {
      const line = Number(closing?.line);
      if (!Number.isFinite(line)) return { label: null, draw_label: null };
      const diff = (h + a) - line;
      if (diff === 0) return { label: null, draw_label: null };
      return { label: diff > 0 ? 1 : 0, draw_label: null };
    }
    case 'h2h':
    case 'moneyline': {
      if (h === a) return { label: null, draw_label: 1 };
      return { label: h > a ? 1 : 0, draw_label: 0 };
    }
    case 'btts': {
      return { label: (h > 0 && a > 0) ? 1 : 0, draw_label: null };
    }
    default:
      return { label: null, draw_label: null };
  }
}

// ── CSV serializer ───────────────────────────────────────────────────────────
function toCSV(rows) {
  if (rows.length === 0) return '';
  // Union de chaves de features + colunas fixas
  const featKeys = new Set();
  for (const r of rows) {
    let f = {}; try { f = JSON.parse(r.features_json || '{}'); } catch {}
    Object.keys(f).forEach(k => featKeys.add(k));
  }
  const featCols = [...featKeys].sort();
  const closingCols = ['closing_line', 'closing_home_odd', 'closing_away_odd', 'closing_draw_odd'];
  const headerCols = [
    'event_id', 'sport', 'market', 'league', 'home_team', 'away_team',
    'commence_time', 'home_score', 'away_score', 'label', 'draw_label',
    ...closingCols,
    ...featCols.map(k => `f_${k}`),
  ];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headerCols.join(',')];
  for (const r of rows) {
    let f = {}, c = {};
    try { f = JSON.parse(r.features_json || '{}'); } catch {}
    try { c = JSON.parse(r.closing_json || '{}'); } catch {}
    const row = [
      r.event_id, r.sport, r.market, r.league, r.home_team, r.away_team,
      r.commence_time, r.home_score, r.away_score, r.label, r.draw_label,
      c.line, c.home_odd ?? c.home, c.away_odd ?? c.away, c.draw_odd ?? c.draw,
      ...featCols.map(k => f[k]),
    ].map(escape);
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

// ── Route handler ────────────────────────────────────────────────────────────
export async function handleMLTraining(pathname, request, env) {
  const method = request.method;
  if (!env.SB_DB) {
    return new Response(JSON.stringify(sbError('DB_UNAVAILABLE', 'D1 not bound', 503)),
      { status: 503, headers: corsHeaders() });
  }

  // ── POST /internal/ml/collect ────────────────────────────────────────────
  if (pathname === '/internal/ml/collect' && method === 'POST') {
    if (!checkIngestAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Ingest secret required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    let body; try { body = await request.json(); } catch { body = {}; }
    const samples = Array.isArray(body.samples) ? body.samples : [];
    if (samples.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0 }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    const now = Date.now();
    const stmt = env.SB_DB.prepare(
      `INSERT INTO ml_training_samples
         (sport, market, event_id, league, home_team, away_team, commence_time,
          features_json, closing_json, collected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, market) DO UPDATE SET
         features_json = excluded.features_json,
         closing_json  = excluded.closing_json,
         collected_at  = excluded.collected_at`
    );
    let inserted = 0, errors = 0;
    for (const s of samples) {
      try {
        await stmt.bind(
          s.sport, s.market, s.event_id, s.league ?? null,
          s.home_team ?? null, s.away_team ?? null,
          Number(s.commence_time) || now,
          JSON.stringify(s.features || {}),
          JSON.stringify(s.closing || {}),
          now,
        ).run();
        inserted++;
      } catch (e) { errors++; }
    }
    return new Response(JSON.stringify({ ok: true, inserted, errors }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  // ── POST /internal/ml/fill-result ────────────────────────────────────────
  if (pathname === '/internal/ml/fill-result' && method === 'POST') {
    if (!checkIngestAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Ingest secret required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    let body; try { body = await request.json(); } catch { body = {}; }
    const results = Array.isArray(body.results) ? body.results : [];
    const now = Date.now();
    let filled = 0, skipped = 0;
    for (const r of results) {
      // Pega TODAS as linhas desse event_id (markets diferentes), calcula label por market
      const { results: rows } = await env.SB_DB.prepare(
        `SELECT id, market, closing_json FROM ml_training_samples
         WHERE event_id = ? AND label IS NULL AND draw_label IS NULL`
      ).bind(r.event_id).all();
      for (const row of (rows || [])) {
        let closing = {}; try { closing = JSON.parse(row.closing_json || '{}'); } catch {}
        const { label, draw_label } = computeLabel(row.market, r.home_score, r.away_score, closing);
        if (label == null && draw_label == null) { skipped++; continue; }
        await env.SB_DB.prepare(
          `UPDATE ml_training_samples
             SET label = ?, draw_label = ?, home_score = ?, away_score = ?, resulted_at = ?
           WHERE id = ?`
        ).bind(label, draw_label, Number(r.home_score), Number(r.away_score), now, row.id).run();
        filled++;
      }
    }
    return new Response(JSON.stringify({ ok: true, filled, skipped }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  // ── GET /v1/admin/ml/training/stats ──────────────────────────────────────
  if (pathname === '/v1/admin/ml/training/stats' && method === 'GET') {
    if (!checkAdminAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    const { results } = await env.SB_DB.prepare(
      `SELECT sport, market,
              COUNT(*) AS total,
              SUM(CASE WHEN label IS NOT NULL OR draw_label IS NOT NULL THEN 1 ELSE 0 END) AS resulted,
              SUM(CASE WHEN label = 1 THEN 1 ELSE 0 END) AS positives,
              MIN(commence_time) AS earliest,
              MAX(commence_time) AS latest
         FROM ml_training_samples
         GROUP BY sport, market
         ORDER BY total DESC`
    ).all();
    return new Response(JSON.stringify({ ok: true, stats: results || [] }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  // ── GET /v1/admin/ml/training/export ─────────────────────────────────────
  if (pathname === '/v1/admin/ml/training/export' && method === 'GET') {
    if (!checkAdminAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    const sport  = url.searchParams.get('sport');
    const market = url.searchParams.get('market');
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    const onlyResulted = url.searchParams.get('all') !== '1';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10000', 10), 50000);

    const where = [], args = [];
    if (sport)  { where.push('sport = ?');  args.push(sport); }
    if (market) { where.push('market = ?'); args.push(market); }
    if (onlyResulted) where.push('(label IS NOT NULL OR draw_label IS NOT NULL)');
    const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { results } = await env.SB_DB.prepare(
      `SELECT * FROM ml_training_samples ${whereSQL}
       ORDER BY commence_time ASC LIMIT ?`
    ).bind(...args, limit).all();

    const rows = results || [];
    if (format === 'json') {
      return new Response(JSON.stringify({ ok: true, count: rows.length, rows }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    const csv = toCSV(rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ml_training_${sport || 'all'}_${market || 'all'}.csv"`,
        ...corsHeaders(),
      },
    });
  }

  // ── POST /v1/admin/cleanup/events — purga eventos-lixo do D1 ──────────
  if (pathname === '/v1/admin/cleanup/events' && method === 'POST') {
    if (!checkAdminAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    // Padrão de lixo: nomes de time que na verdade são menus/saldo/etc
    // Schema real: colunas são "home" e "away" (não home_team/away_team)
    const LIXO = `(
      home LIKE 'Saldo%' OR home LIKE 'Minhas%' OR home LIKE 'Menu%'
      OR home LIKE '%recuperar%' OR home LIKE '%dep_sit%'
      OR home LIKE 'Apostas%' OR home LIKE 'Promo%' OR home LIKE 'Cassino%'
      OR home LIKE 'Esportes%' OR home LIKE 'Futebol%' OR home LIKE 'Basquete%'
      OR home LIKE 'Minhas Apostas%' OR home LIKE 'Carregando%'
      OR away LIKE 'Saldo%' OR away LIKE 'Minhas%' OR away LIKE 'Menu%'
      OR away LIKE '%recuperar%' OR away LIKE '%dep_sit%'
      OR away LIKE 'Apostas%' OR away LIKE 'Promo%' OR away LIKE 'Cassino%'
      OR away LIKE 'Esportes%' OR away LIKE 'Futebol%' OR away LIKE 'Basquete%'
      OR away LIKE 'Minhas Apostas%' OR away LIKE 'Carregando%'
      OR LENGTH(home) < 3 OR LENGTH(away) < 3
      OR home = away
    )`;
    const stats = {};
    try {
      const cnt = await env.SB_DB.prepare(
        `SELECT COUNT(*) as n FROM odds_events WHERE ${LIXO}`
      ).first();
      stats.willDelete = cnt?.n || 0;
      // Pega IDs pra cascatear em snapshots/consensus
      const { results: ids } = await env.SB_DB.prepare(
        `SELECT id FROM odds_events WHERE ${LIXO} LIMIT 2000`
      ).all();
      const idList = (ids || []).map(r => r.id);
      if (idList.length > 0) {
        const placeholders = idList.map(() => '?').join(',');
        await env.SB_DB.prepare(`DELETE FROM odds_snapshots WHERE event_id IN (${placeholders})`).bind(...idList).run();
        await env.SB_DB.prepare(`DELETE FROM odds_consensus WHERE event_id IN (${placeholders})`).bind(...idList).run();
        await env.SB_DB.prepare(`DELETE FROM odds_events    WHERE id       IN (${placeholders})`).bind(...idList).run();
        stats.deleted = idList.length;
      } else {
        stats.deleted = 0;
      }
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    return new Response(JSON.stringify({ ok: true, ...stats }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  return null; // sem match — deixa outros handlers tentarem
}
