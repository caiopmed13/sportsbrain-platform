// ════════════════════════════════════════════════════════════════════
// Admin Health Dashboard — monitoring interno dos scrapers
// ════════════════════════════════════════════════════════════════════
// GET /admin/health        → JSON com status por book
// GET /admin/health/html   → Dashboard HTML (stand-alone)
// GET /admin/alerts        → Lista última 50 alertas (odds_alerts)
//
// Auth: header X-Admin-Key === env.SB_MASTER_KEY
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';

const STALE_THRESHOLD_MIN = 30;  // >30min sem tick = book stale

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json', ...extra },
  });
}

function unauth() {
  return json({ ok: false, error: 'UNAUTHORIZED', hint: 'send X-Admin-Key header' }, 401);
}

function checkAuth(request, env) {
  const key = request.headers.get('X-Admin-Key') ||
              new URL(request.url).searchParams.get('admin_key');
  if (!env.SB_MASTER_KEY) return true;  // dev mode open
  return key && key === env.SB_MASTER_KEY;
}

// Core: status por book → último tick, contagem de snapshots, lag médio
async function computeHealth(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };

  // NOTE: odds_snapshots.ts é armazenado em milissegundos (Date.now()).
  const now = Date.now();

  // Último tick por book (últimas 24h pra não estourar)
  const since24h = now - 24 * 3600 * 1000;

  const { results: perBook } = await env.SB_DB.prepare(`
    SELECT book,
           COUNT(*) AS n,
           MAX(ts) AS last_ts,
           MIN(ts) AS first_ts
    FROM odds_snapshots
    WHERE ts >= ?
    GROUP BY book
    ORDER BY last_ts DESC
  `).bind(since24h).all().catch(() => ({ results: [] }));

  const books = (perBook || []).map(b => {
    const lastTs = +b.last_ts || 0;
    const staleMin = lastTs ? Math.round((now - lastTs) / 60000) : Infinity;
    const isStale = staleMin > STALE_THRESHOLD_MIN;
    return {
      book: b.book,
      snapshots_24h: b.n,
      last_tick_ts: lastTs,
      last_tick_iso: lastTs ? new Date(lastTs).toISOString() : null,
      stale_minutes: Number.isFinite(staleMin) ? staleMin : null,
      status: isStale ? 'STALE' : staleMin > 15 ? 'WARN' : 'OK',
    };
  });

  // Totais
  const totalRow = await env.SB_DB.prepare(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT event_id) AS events, COUNT(DISTINCT book) AS books
    FROM odds_snapshots
    WHERE ts >= ?
  `).bind(since24h).first().catch(() => ({ n: 0, events: 0, books: 0 }));

  // Snapshots/hora última hora (taxa de ingestão)
  const lastHour = now - 3600 * 1000;
  const hourRow = await env.SB_DB.prepare(
    'SELECT COUNT(*) AS n FROM odds_snapshots WHERE ts >= ?'
  ).bind(lastHour).first().catch(() => ({ n: 0 }));

  // Alertas recentes
  const { results: alerts } = await env.SB_DB.prepare(`
    SELECT kind, severity, detail, created_at
    FROM odds_alerts
    ORDER BY id DESC
    LIMIT 20
  `).all().catch(() => ({ results: [] }));

  return {
    ok: true,
    now_ts: now,
    now_iso: new Date(now).toISOString(),
    threshold_stale_min: STALE_THRESHOLD_MIN,
    totals_24h: {
      snapshots: totalRow?.n || 0,
      events:    totalRow?.events || 0,
      books:     totalRow?.books || 0,
    },
    rate_last_hour: hourRow?.n || 0,
    books,
    stale_books: books.filter(b => b.status === 'STALE').map(b => b.book),
    alerts_recent: alerts || [],
  };
}

function renderHtml(data) {
  const badge = (s) => {
    if (s === 'OK')    return '<span style="background:rgba(0,224,143,.15);color:#00e08f;padding:3px 10px;border-radius:6px;font-weight:700">OK</span>';
    if (s === 'WARN')  return '<span style="background:rgba(255,184,48,.15);color:#ffb830;padding:3px 10px;border-radius:6px;font-weight:700">WARN</span>';
    return '<span style="background:rgba(255,79,106,.15);color:#ff4f6a;padding:3px 10px;border-radius:6px;font-weight:700">STALE</span>';
  };
  const rows = data.books.map(b => `
    <tr>
      <td><strong>${b.book}</strong></td>
      <td>${badge(b.status)}</td>
      <td style="text-align:right">${b.snapshots_24h.toLocaleString()}</td>
      <td style="text-align:right">${b.stale_minutes == null ? '—' : b.stale_minutes + ' min'}</td>
      <td style="font-family:monospace;font-size:11px;color:#64748b">${b.last_tick_iso || '—'}</td>
    </tr>`).join('');

  const alertRows = (data.alerts_recent || []).map(a => `
    <tr>
      <td style="font-family:monospace;font-size:11px">${a.created_at}</td>
      <td><strong>${a.kind}</strong></td>
      <td style="color:${a.severity==='critical'?'#ff4f6a':a.severity==='warning'?'#ffb830':'#64748b'}">${a.severity}</td>
      <td style="color:#94a3b8">${(a.detail||'').slice(0,160)}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>SportsBrain — Admin Health</title>
<style>
body{background:#07090f;color:#e2e8f0;font-family:-apple-system,system-ui,sans-serif;margin:0;padding:32px;line-height:1.5}
h1{font-size:22px;margin:0 0 6px;background:linear-gradient(135deg,#fff 30%,#00e08f);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#64748b;font-size:12px;margin-bottom:24px;font-family:monospace}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.kpi{background:#0d1117;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:16px}
.kpi .num{font-size:26px;font-weight:900;font-family:'JetBrains Mono',monospace;color:#00e08f}
.kpi .lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#0d1117;border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden;margin-bottom:24px}
th{background:#131820;color:#64748b;font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:10px;text-align:left}
td{padding:10px;border-top:1px solid rgba(255,255,255,.05);font-size:13px}
.note{background:rgba(74,158,255,.06);border:1px solid rgba(74,158,255,.2);border-radius:8px;padding:12px;font-size:12px;color:#94a3b8;margin-bottom:24px}
h2{font-size:14px;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin:24px 0 12px}
</style></head><body>
<h1>🛰 SportsBrain — Admin Health</h1>
<div class="sub">${data.now_iso} · threshold stale: ${data.threshold_stale_min}min</div>

<div class="kpis">
  <div class="kpi"><div class="num">${data.totals_24h.snapshots.toLocaleString()}</div><div class="lbl">Snapshots 24h</div></div>
  <div class="kpi"><div class="num">${data.totals_24h.events}</div><div class="lbl">Events 24h</div></div>
  <div class="kpi"><div class="num">${data.totals_24h.books}</div><div class="lbl">Books 24h</div></div>
  <div class="kpi"><div class="num">${data.rate_last_hour}</div><div class="lbl">Snaps / última hora</div></div>
  <div class="kpi"><div class="num" style="color:${data.stale_books.length?'#ff4f6a':'#00e08f'}">${data.stale_books.length}</div><div class="lbl">Books stale</div></div>
</div>

${data.stale_books.length ? `<div class="note" style="background:rgba(255,79,106,.08);border-color:rgba(255,79,106,.25);color:#ff4f6a">⚠ Books stale: <strong>${data.stale_books.join(', ')}</strong></div>` : ''}

<h2>Books — últimas 24h</h2>
<table>
  <thead><tr><th>Book</th><th>Status</th><th style="text-align:right">Snapshots 24h</th><th style="text-align:right">Lag</th><th>Último tick</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px">Nenhum dado ainda</td></tr>'}</tbody>
</table>

<h2>Alertas recentes (${(data.alerts_recent||[]).length})</h2>
<table>
  <thead><tr><th>Quando</th><th>Tipo</th><th>Sev.</th><th>Detalhe</th></tr></thead>
  <tbody>${alertRows || '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:24px">Nenhum alerta — saúde ok</td></tr>'}</tbody>
</table>

<div class="note" style="margin-top:24px">
  🔄 Dashboard atualiza via refresh manual. Auto-refresh a cada 60s habilitado.
</div>
<script>setTimeout(()=>location.reload(),60000)</script>
</body></html>`;
}

export async function handleAdminHealth(pathname, request, env) {
  if (!checkAuth(request, env)) return unauth();

  if (pathname === '/admin/health' || pathname === '/admin/health/json') {
    const data = await computeHealth(env);
    return json(data);
  }

  if (pathname === '/admin/health/html' || pathname === '/admin') {
    const data = await computeHealth(env);
    return new Response(renderHtml(data), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (pathname === '/admin/alerts') {
    if (!env.SB_DB) return json({ ok: false, error: 'no_db' }, 503);
    const { results } = await env.SB_DB.prepare(
      'SELECT * FROM odds_alerts ORDER BY id DESC LIMIT 100'
    ).all().catch(() => ({ results: [] }));
    return json({ ok: true, alerts: results || [] });
  }

  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}

// ── Cron: detecta books stale e registra em odds_alerts ─────────────
export async function runStaleBookCheck(env) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };
  const data = await computeHealth(env);
  if (!data.ok) return data;

  const stale = data.books.filter(b => b.status === 'STALE');
  let inserted = 0;

  for (const b of stale) {
    // Evita duplicar alerta em janela de 1h
    const recent = await env.SB_DB.prepare(`
      SELECT id FROM odds_alerts
      WHERE kind = 'book_stale' AND detail LIKE ?
        AND created_at > datetime('now', '-1 hour')
      LIMIT 1
    `).bind(`%${b.book}%`).first().catch(() => null);

    if (recent) continue;

    await env.SB_DB.prepare(`
      INSERT INTO odds_alerts (event_id, market, outcome, line, kind, severity, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      'system',
      'health',
      b.book,
      null,
      'book_stale',
      b.stale_minutes > 120 ? 'critical' : 'warning',
      `Book ${b.book} sem tick há ${b.stale_minutes}min (último: ${b.last_tick_iso || 'nunca'})`
    ).run().catch(() => {});
    inserted++;
  }

  // Push: Telegram + webhook via dispatcher central
  if (inserted) {
    const { sendAlert } = await import('../services/alerts.js');
    for (const b of stale) {
      await sendAlert(env, {
        kind: 'book_stale',
        severity: b.stale_minutes > 120 ? 'critical' : 'warning',
        title: `Book ${b.book} stale (${b.stale_minutes}min)`,
        detail: `Último tick: ${b.last_tick_iso || 'nunca'}`,
        meta: { book: b.book },
        dedup: false, // já deduplicamos acima via odds_alerts
      });
    }
  }

  return { ok: true, stale_count: stale.length, new_alerts: inserted };
}
