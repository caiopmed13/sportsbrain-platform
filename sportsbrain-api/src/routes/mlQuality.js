/**
 * ML Quality — Phases 2 & 3 do roadmap de qualidade.
 * ────────────────────────────────────────────────────────────────────
 *  Phase 2: baseline no-vig + Brier + log-loss + accuracy
 *    GET /v1/admin/ml/quality/baseline?sport=&market=&min_resulted=20
 *    GET /v1/admin/ml/quality/calibration?sport=&market=&bins=10
 *
 *  Phase 3: Platt scaling (calibração logística)
 *    POST /v1/admin/ml/calibration/fit   body: { sport, market }
 *          → fita params (a,b) tal que p_cal = sigmoid(a*logit(p) + b)
 *          → persiste em KV SB_CACHE: "cal:<sport>:<market>"
 *    GET  /v1/admin/ml/calibration/apply?sport=&market=&p=0.65
 *          → devolve p_calibrated
 *
 *  Phase 5 (utilitário server-side):
 *    POST /v1/admin/ml/selection/filter  body: { picks: [...] }
 *          → aplica edge/vig/volume filters + Kelly ajustado
 *
 * Observações:
 *  - Se base de amostras < threshold, retorna {status:"insufficient_data", n}
 *    em vez de erro — caller trata UI.
 *  - Brier score: média de (p - y)^2, onde p é prob prevista e y ∈ {0,1}.
 *  - Log-loss: -mean(y*log(p) + (1-y)*log(1-p)), clamp p ∈ [1e-6, 1-1e-6].
 */
import { sbError } from '../schemas/base.js';
import { corsHeaders } from './health.js';

function checkAdminAuth(request, env) {
  const provided = request.headers.get('X-Admin-Key');
  return env.SB_MASTER_KEY && provided === env.SB_MASTER_KEY;
}

// ── math helpers ────────────────────────────────────────────────────────────
function clamp(p, lo = 1e-6, hi = 1 - 1e-6) {
  return Math.max(lo, Math.min(hi, p));
}
function logit(p) { const q = clamp(p); return Math.log(q / (1 - q)); }
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

// Probabilidade implícita no-vig: 1/odd normalizado pela soma do mercado.
function impliedNoVig(closing, market, outcome /* 'home'|'away'|'draw'|'over'|'under' */) {
  if (!closing) return null;
  let h = null, a = null, d = null, ov = null, un = null;
  if (market === 'h2h' || market === 'moneyline') {
    h = closing.home_odd ?? closing.home;
    a = closing.away_odd ?? closing.away;
    d = closing.draw_odd ?? closing.draw;
  } else if (market === 'spread') {
    h = closing.home_odd ?? closing.home;
    a = closing.away_odd ?? closing.away;
  } else if (market === 'total') {
    ov = closing.home_odd ?? closing.over;
    un = closing.away_odd ?? closing.under;
  }
  const ih = h ? 1 / h : 0, ia = a ? 1 / a : 0, id = d ? 1 / d : 0;
  const io = ov ? 1 / ov : 0, iu = un ? 1 / un : 0;
  if (market === 'total') {
    const s = io + iu; if (!s) return null;
    return outcome === 'over' ? io / s : iu / s;
  }
  const s = ih + ia + id; if (!s) return null;
  if (outcome === 'home') return ih / s;
  if (outcome === 'away') return ia / s;
  if (outcome === 'draw') return id / s;
  return null;
}

// Deriva (p, y) por amostra — probabilidade prevista (baseline market) vs label.
// Para spread/total: label=1 significa home-cover / over.
// Para h2h: label=1=home win, label=0=away win (empate → draw_label=1).
function samplesToPY(rows) {
  const out = []; // [{p, y, market, sport}]
  for (const r of rows) {
    let c = {}; try { c = JSON.parse(r.closing_json || '{}'); } catch {}
    const m = (r.market || '').toLowerCase();
    if (m === 'spread' || m === 'total') {
      if (r.label == null) continue;
      const p = impliedNoVig(c, m, m === 'total' ? 'over' : 'home');
      if (p == null) continue;
      out.push({ p, y: Number(r.label), market: m, sport: r.sport });
    } else if (m === 'h2h' || m === 'moneyline') {
      // Binário home-win vs not (inclui draw em 0 pra simplificar binary case)
      if (r.label == null && r.draw_label == null) continue;
      const p = impliedNoVig(c, 'h2h', 'home');
      if (p == null) continue;
      const y = r.label === 1 ? 1 : 0;
      out.push({ p, y, market: m, sport: r.sport });
    }
  }
  return out;
}

function brier(py)  { return py.length ? py.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / py.length : null; }
function logLoss(py) {
  if (!py.length) return null;
  return -py.reduce((s, { p, y }) => {
    const q = clamp(p);
    return s + (y * Math.log(q) + (1 - y) * Math.log(1 - q));
  }, 0) / py.length;
}
function accuracy(py, threshold = 0.5) {
  if (!py.length) return null;
  const hits = py.filter(({ p, y }) => (p >= threshold ? 1 : 0) === y).length;
  return hits / py.length;
}

// Curva de calibração: bucketiza por p em `bins` faixas, retorna (bin_center, avg_p, win_rate, n)
function calibrationCurve(py, bins = 10) {
  const buckets = Array.from({ length: bins }, () => ({ sum_p: 0, sum_y: 0, n: 0 }));
  for (const { p, y } of py) {
    const idx = Math.min(bins - 1, Math.floor(p * bins));
    buckets[idx].sum_p += p;
    buckets[idx].sum_y += y;
    buckets[idx].n++;
  }
  return buckets.map((b, i) => ({
    bin_lo: i / bins,
    bin_hi: (i + 1) / bins,
    avg_p: b.n ? b.sum_p / b.n : null,
    win_rate: b.n ? b.sum_y / b.n : null,
    n: b.n,
  }));
}

// ── Platt scaling: fit via gradient descent ────────────────────────────────
// Modelo: p_cal = sigmoid(a * logit(p) + b). Otimiza log-loss.
function fitPlatt(py, iters = 200, lr = 0.05) {
  if (py.length < 10) return null;
  let a = 1, b = 0;
  const X = py.map(({ p }) => logit(p));
  const Y = py.map(({ y }) => y);
  const n = py.length;
  for (let it = 0; it < iters; it++) {
    let gA = 0, gB = 0;
    for (let i = 0; i < n; i++) {
      const z = a * X[i] + b;
      const ph = sigmoid(z);
      const err = ph - Y[i];
      gA += err * X[i];
      gB += err;
    }
    a -= lr * gA / n;
    b -= lr * gB / n;
  }
  // Calcula log-loss pós-fit
  const postPY = py.map(({ p, y }) => ({ p: sigmoid(a * logit(p) + b), y }));
  return { a, b, n, log_loss_before: logLoss(py), log_loss_after: logLoss(postPY) };
}

async function loadResultedSamples(env, sport, market, limit = 10000) {
  const where = ['(label IS NOT NULL OR draw_label IS NOT NULL)'];
  const args = [];
  if (sport)  { where.push('sport = ?');  args.push(sport); }
  if (market) { where.push('market = ?'); args.push(market); }
  const sql = `SELECT sport, market, closing_json, label, draw_label
               FROM ml_training_samples
               WHERE ${where.join(' AND ')}
               ORDER BY commence_time DESC LIMIT ?`;
  const { results } = await env.SB_DB.prepare(sql).bind(...args, limit).all();
  return results || [];
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function handleMLQuality(pathname, request, env) {
  const method = request.method;
  if (!env.SB_DB) {
    return new Response(JSON.stringify(sbError('DB_UNAVAILABLE', 'D1 not bound', 503)),
      { status: 503, headers: corsHeaders() });
  }
  const url = new URL(request.url);

  // ── Phase 2: baseline (Brier / log-loss / accuracy no-vig) ──────────────
  if (pathname === '/v1/admin/ml/quality/baseline' && method === 'GET') {
    if (!checkAdminAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    const sport  = url.searchParams.get('sport') || null;
    const market = url.searchParams.get('market') || null;
    const minN   = parseInt(url.searchParams.get('min_resulted') || '20', 10);
    const rows = await loadResultedSamples(env, sport, market);
    const py = samplesToPY(rows);
    if (py.length < minN) {
      return new Response(JSON.stringify({
        ok: true, status: 'insufficient_data', n: py.length, required: minN,
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    // Também quebra por mercado
    const byMarket = {};
    for (const r of py) {
      const k = `${r.sport}:${r.market}`;
      (byMarket[k] ||= []).push(r);
    }
    const breakdown = Object.fromEntries(
      Object.entries(byMarket).map(([k, arr]) => [k, {
        n: arr.length, brier: brier(arr), log_loss: logLoss(arr), accuracy: accuracy(arr),
      }])
    );
    return new Response(JSON.stringify({
      ok: true,
      n: py.length,
      overall: { brier: brier(py), log_loss: logLoss(py), accuracy: accuracy(py) },
      breakdown,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  // ── Phase 2: calibration curve ──────────────────────────────────────────
  if (pathname === '/v1/admin/ml/quality/calibration' && method === 'GET') {
    if (!checkAdminAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    const sport  = url.searchParams.get('sport') || null;
    const market = url.searchParams.get('market') || null;
    const bins   = Math.min(parseInt(url.searchParams.get('bins') || '10', 10), 20);
    const rows = await loadResultedSamples(env, sport, market);
    const py = samplesToPY(rows);
    if (py.length < 10) {
      return new Response(JSON.stringify({ ok: true, status: 'insufficient_data', n: py.length }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    return new Response(JSON.stringify({
      ok: true, n: py.length, bins, curve: calibrationCurve(py, bins),
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  // ── Phase 3: fit Platt scaling & persist em KV ─────────────────────────
  if (pathname === '/v1/admin/ml/calibration/fit' && method === 'POST') {
    if (!checkAdminAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    let body; try { body = await request.json(); } catch { body = {}; }
    const sport  = body.sport  || null;
    const market = body.market || null;
    const rows = await loadResultedSamples(env, sport, market);
    const py = samplesToPY(rows);
    const res = fitPlatt(py);
    if (!res) {
      return new Response(JSON.stringify({
        ok: true, status: 'insufficient_data', n: py.length, required: 10,
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    const key = `cal:${sport || 'all'}:${market || 'all'}`;
    // Persiste se houver KV disponível (SB_CACHE ou CACHE)
    const kv = env.SB_CACHE || env.CACHE || null;
    const payload = { ...res, fitted_at: Date.now(), sport, market };
    if (kv) await kv.put(key, JSON.stringify(payload), { expirationTtl: 60 * 86400 }).catch(() => {});
    return new Response(JSON.stringify({ ok: true, key, params: payload }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  // ── Phase 3: apply calibration (read from KV or fit on-the-fly) ────────
  if (pathname === '/v1/admin/ml/calibration/apply' && method === 'GET') {
    if (!checkAdminAuth(request, env)) {
      return new Response(JSON.stringify(sbError('FORBIDDEN', 'Admin key required', 403)),
        { status: 403, headers: corsHeaders() });
    }
    const sport  = url.searchParams.get('sport') || null;
    const market = url.searchParams.get('market') || null;
    const p = parseFloat(url.searchParams.get('p') || '');
    if (!Number.isFinite(p) || p <= 0 || p >= 1) {
      return new Response(JSON.stringify(sbError('BAD_REQUEST', 'p must be in (0,1)', 400)),
        { status: 400, headers: corsHeaders() });
    }
    const key = `cal:${sport || 'all'}:${market || 'all'}`;
    const kv = env.SB_CACHE || env.CACHE || null;
    let params = null;
    if (kv) {
      try { params = JSON.parse((await kv.get(key)) || 'null'); } catch {}
    }
    if (!params) {
      return new Response(JSON.stringify({
        ok: true, status: 'no_calibration', p_raw: p, p_calibrated: p,
        hint: 'POST /v1/admin/ml/calibration/fit first',
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    const pCal = sigmoid(params.a * logit(p) + params.b);
    return new Response(JSON.stringify({
      ok: true, p_raw: p, p_calibrated: +pCal.toFixed(4), params,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  // ── Phase 5: selection filter server-side ──────────────────────────────
  // body: { picks: [{ confidence, odd, ev_pct, n_books, vig_pct, market, ... }], banca, kelly_fraction }
  if (pathname === '/v1/admin/ml/selection/filter' && method === 'POST') {
    // Público (não precisa admin — é pra UI/gateway usar)
    let body; try { body = await request.json(); } catch { body = {}; }
    const picks = Array.isArray(body.picks) ? body.picks : [];
    const banca = Number(body.banca || 1000);
    const kellyFrac = Number(body.kelly_fraction || 0.25);

    const MIN_EDGE_PCT = 3;      // modelo vs market no-vig
    const MAX_VIG_PCT  = 6;
    const MIN_BOOKS    = 3;
    const MIN_CONF     = 55;

    const accepted = [];
    const rejected = [];
    for (const pk of picks) {
      const conf = Number(pk.confidence ?? pk.conf ?? 0);
      const odd  = Number(pk.odd ?? 0);
      const ev   = Number(pk.ev_pct ?? pk.ev ?? 0);
      const vig  = Number(pk.vig_pct ?? 0);
      const nb   = Number(pk.n_books ?? 0);

      const reasons = [];
      if (conf < MIN_CONF)          reasons.push(`conf<${MIN_CONF}`);
      if (ev < MIN_EDGE_PCT)        reasons.push(`edge<${MIN_EDGE_PCT}%`);
      if (vig > MAX_VIG_PCT)        reasons.push(`vig>${MAX_VIG_PCT}%`);
      if (nb && nb < MIN_BOOKS)     reasons.push(`books<${MIN_BOOKS}`);
      if (!odd || odd < 1.3)        reasons.push('odd<1.30');

      if (reasons.length) {
        rejected.push({ ...pk, reject_reasons: reasons });
        continue;
      }

      // Kelly ajustado: aplica fator de confiança (0.7–1.0) sobre Kelly base
      const p = Math.max(0.02, Math.min(0.98, conf / 100));
      const b = odd - 1;
      const kellyFull = (p * b - (1 - p)) / b; // fração da banca
      const confAdj = 0.7 + 0.3 * ((conf - MIN_CONF) / (95 - MIN_CONF)); // 0.7 @ 55% → 1.0 @ 95%
      const kStake = Math.max(0, kellyFull * kellyFrac * Math.max(0.5, Math.min(1, confAdj)));
      accepted.push({
        ...pk,
        kelly_stake: +(banca * kStake).toFixed(2),
        kelly_pct: +(kStake * 100).toFixed(2),
        confidence_factor: +confAdj.toFixed(3),
      });
    }
    return new Response(JSON.stringify({
      ok: true, accepted, rejected,
      filters: { MIN_EDGE_PCT, MAX_VIG_PCT, MIN_BOOKS, MIN_CONF, kellyFrac },
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
  }

  return null;
}
