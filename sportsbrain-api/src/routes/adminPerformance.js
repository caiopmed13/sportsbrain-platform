// ════════════════════════════════════════════════════════════════════
// Admin Performance Dashboard — CLV, ROI, hit rate por bucket
// ════════════════════════════════════════════════════════════════════
// GET /admin/performance        → HTML dashboard
// GET /admin/performance/json   → dados estruturados
// GET /admin/picks/recent       → últimos 50 picks (todos, resolvidos ou não)
// GET /admin/picks/pending      → picks ainda sem closing/result
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';
import { computePerformance } from '../services/clv.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function checkAuth(request, env) {
  const key = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key');
  if (!env.SB_MASTER_KEY) return true;
  return key && key === env.SB_MASTER_KEY;
}

export async function handleAdminPerformance(pathname, request, env) {
  if (!checkAuth(request, env)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  if (pathname === '/admin/performance/json' || pathname === '/admin/performance.json') {
    const q = new URL(request.url).searchParams;
    const data = await computePerformance(env, { sport: q.get('sport') });
    return json(data);
  }

  if (pathname === '/admin/picks/recent') {
    const { results } = await env.SB_DB.prepare(`
      SELECT id, event_id, sport, league, market, outcome, book,
             price_at_pick, fair_price_at_pick, edge_pct,
             closing_price, closing_fair, clv_pct,
             model_prob, ensemble_prob, confidence, kelly_frac, explain,
             result, pnl_units, actual_score,
             commence_time, picked_at, closed_at, resolved_at
      FROM picks_closed ORDER BY id DESC LIMIT 50
    `).all().catch(() => ({ results: [] }));
    return json({ ok: true, picks: results || [] });
  }

  if (pathname === '/admin/picks/pending') {
    const { results } = await env.SB_DB.prepare(`
      SELECT id, event_id, market, outcome, book, edge_pct, confidence,
             commence_time, picked_at,
             CASE WHEN closed_at IS NULL THEN 'awaiting_closing'
                  WHEN resolved_at IS NULL THEN 'awaiting_result'
                  ELSE 'done' END AS stage
      FROM picks_closed
      WHERE closed_at IS NULL OR resolved_at IS NULL
      ORDER BY commence_time ASC LIMIT 100
    `).all().catch(() => ({ results: [] }));
    return json({ ok: true, picks: results || [] });
  }

  // HTML dashboard (default)
  const perf = await computePerformance(env);
  return new Response(renderHtml(perf), {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function renderHtml(p) {
  if (!p.ok) return `<html><body style="background:#07090f;color:#e2e8f0;font-family:system-ui;padding:40px"><h1>Performance</h1><p>Erro: ${p.error}</p></body></html>`;

  const t = p.totals || {};
  const roiColor = (t.roi_pct || 0) > 0 ? '#00e08f' : (t.roi_pct || 0) < 0 ? '#ff4f6a' : '#64748b';
  const clvColor = (t.avg_clv || 0) > 0 ? '#00e08f' : (t.avg_clv || 0) < 0 ? '#ff4f6a' : '#64748b';

  const bucketRow = (name, lbl, b) => `
    <tr>
      <td><strong>${lbl}</strong></td>
      <td style="text-align:right">${b.n.toLocaleString()}</td>
      <td style="text-align:right;color:${b.win_rate > 50 ? '#00e08f' : b.win_rate < 45 ? '#ff4f6a' : '#ffb830'}">${b.win_rate}%</td>
      <td style="text-align:right;color:${b.roi_pct > 0 ? '#00e08f' : b.roi_pct < 0 ? '#ff4f6a' : '#64748b'}">${b.roi_pct > 0 ? '+' : ''}${b.roi_pct}%</td>
      <td style="text-align:right;color:${b.avg_clv > 0 ? '#00e08f' : b.avg_clv < 0 ? '#ff4f6a' : '#64748b'}">${b.avg_clv != null ? (b.avg_clv > 0 ? '+' : '') + b.avg_clv + '%' : '—'}</td>
    </tr>`;

  const bookRows = (p.by_book || []).slice(0, 20).map(b => `
    <tr>
      <td><strong>${b.book}</strong></td>
      <td style="text-align:right">${b.n.toLocaleString()}</td>
      <td style="text-align:right">${b.win_rate}%</td>
      <td style="text-align:right;color:${b.roi_pct > 0 ? '#00e08f' : b.roi_pct < 0 ? '#ff4f6a' : '#64748b'}">${b.roi_pct > 0 ? '+' : ''}${b.roi_pct}%</td>
      <td style="text-align:right">${b.avg_clv != null ? (b.avg_clv > 0 ? '+' : '') + b.avg_clv + '%' : '—'}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>SportsBrain — Performance</title>
<style>
body{background:#07090f;color:#e2e8f0;font-family:-apple-system,system-ui,sans-serif;margin:0;padding:32px;line-height:1.5}
h1{font-size:22px;margin:0 0 6px;background:linear-gradient(135deg,#fff 30%,#00e08f);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{color:#64748b;font-size:12px;margin-bottom:24px;font-family:monospace}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.kpi{background:#0d1117;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:16px}
.kpi .num{font-size:28px;font-weight:900;font-family:'JetBrains Mono',monospace}
.kpi .lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px}
h2{font-size:14px;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin:32px 0 12px}
table{width:100%;border-collapse:collapse;background:#0d1117;border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden}
th{background:#131820;color:#64748b;font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:10px;text-align:left}
td{padding:10px;border-top:1px solid rgba(255,255,255,.05);font-size:13px}
.note{background:rgba(74,158,255,.06);border:1px solid rgba(74,158,255,.2);border-radius:8px;padding:12px;font-size:12px;color:#94a3b8;margin-top:16px}
.empty{background:rgba(255,184,48,.06);border:1px solid rgba(255,184,48,.2);color:#ffb830;padding:16px;border-radius:10px;font-size:12px;margin-bottom:16px}
</style></head><body>
<h1>📊 SportsBrain — Performance</h1>
<div class="sub">${new Date().toISOString()} · CLV tracker feedback loop</div>

${t.n_picks === 0 ? '<div class="empty">⏳ Nenhum pick resolvido ainda. Dashboard preenche à medida que picks completam: publicação → closing line (cron 5min) → resultado (cron 1h).</div>' : ''}

<div class="kpis">
  <div class="kpi"><div class="num" style="color:#00e08f">${(t.n_picks||0).toLocaleString()}</div><div class="lbl">Picks resolvidos</div></div>
  <div class="kpi"><div class="num" style="color:${t.win_rate>50?'#00e08f':t.win_rate<45?'#ff4f6a':'#ffb830'}">${t.win_rate||0}%</div><div class="lbl">Win rate</div></div>
  <div class="kpi"><div class="num" style="color:${roiColor}">${(t.roi_pct||0)>0?'+':''}${t.roi_pct||0}%</div><div class="lbl">ROI</div></div>
  <div class="kpi"><div class="num" style="color:${clvColor}">${t.avg_clv!=null?(t.avg_clv>0?'+':'')+t.avg_clv+'%':'—'}</div><div class="lbl">Avg CLV</div></div>
  <div class="kpi"><div class="num" style="color:#4a9eff">${(t.avg_edge||0).toFixed(2)}%</div><div class="lbl">Avg edge</div></div>
  <div class="kpi"><div class="num" style="color:#00e08f">${(t.pnl_units||0)>0?'+':''}${t.pnl_units||0}</div><div class="lbl">PnL units</div></div>
</div>

<h2>Hit rate por edge bucket</h2>
<table>
  <thead><tr><th>Edge range</th><th style="text-align:right">N</th><th style="text-align:right">Win rate</th><th style="text-align:right">ROI</th><th style="text-align:right">Avg CLV</th></tr></thead>
  <tbody>
    ${bucketRow('1_3', '1-3%', p.by_edge_bucket['1_3'])}
    ${bucketRow('3_5', '3-5%', p.by_edge_bucket['3_5'])}
    ${bucketRow('5_7', '5-7%', p.by_edge_bucket['5_7'])}
    ${bucketRow('7_plus', '7%+', p.by_edge_bucket['7_plus'])}
  </tbody>
</table>

<h2>Performance por book</h2>
<table>
  <thead><tr><th>Book</th><th style="text-align:right">N</th><th style="text-align:right">Win rate</th><th style="text-align:right">ROI</th><th style="text-align:right">Avg CLV</th></tr></thead>
  <tbody>${bookRows || '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px">Sem picks por book ainda</td></tr>'}</tbody>
</table>

<div class="note">
  📈 <strong>CLV &gt; 0</strong> = você bate a linha de fechamento (proxy de alpha real).<br>
  📉 <strong>CLV &lt; 0</strong> = preço piora após você apostar — sinal de que o engine está atrasado ou fair_price está enviesado.<br>
  Atualize a página pra refrescar. Auto-refresh a cada 2min.
</div>
<script>setTimeout(()=>location.reload(),120000)</script>
</body></html>`;
}
