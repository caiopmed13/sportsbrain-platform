// ══════════════════════════════════════════════════════════════════════════
// Isotonic calibration (PAV) — maps raw model prob → empirical win rate.
// Trains from picks_closed (result, ensemble_prob/model_prob).
// ══════════════════════════════════════════════════════════════════════════

const TAG = '[ml:calibration]';
const MIN_SAMPLES = 100;

// Pool-Adjacent-Violators isotonic regression.
// Input: array of {x, y, w} where x=predicted prob, y in {0,1}, w=weight.
// Output: sorted array of {x, y} representing the fitted monotonic mapping.
export function fitIsotonic(points) {
  if (!points?.length) return [];
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const blocks = sorted.map(p => ({ x: p.x, sumY: p.y * (p.w || 1), sumW: (p.w || 1) }));
  let i = 0;
  while (i < blocks.length - 1) {
    const avgI = blocks[i].sumY / blocks[i].sumW;
    const avgN = blocks[i + 1].sumY / blocks[i + 1].sumW;
    if (avgI <= avgN) { i++; continue; }
    // Pool
    blocks[i].sumY += blocks[i + 1].sumY;
    blocks[i].sumW += blocks[i + 1].sumW;
    blocks[i].x     = (blocks[i].x + blocks[i + 1].x) / 2;
    blocks.splice(i + 1, 1);
    if (i > 0) i--;
  }
  return blocks.map(b => ({ x: b.x, y: b.sumY / b.sumW }));
}

// Predict with the fitted curve (linear interpolation between knots).
export function applyIsotonic(curve, raw) {
  if (!curve?.length || raw == null) return raw;
  if (raw <= curve[0].x) return curve[0].y;
  if (raw >= curve[curve.length - 1].x) return curve[curve.length - 1].y;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].x >= raw) {
      const a = curve[i - 1], b = curve[i];
      const t = (raw - a.x) / Math.max(1e-9, b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return raw;
}

// Build + persist a curve for (sport, market)
export async function buildCalibrationCurve(env, { sport = null, market = null } = {}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };
  const args = [];
  let sql = `SELECT ensemble_prob AS p, model_prob AS pm, result
               FROM picks_closed
              WHERE result IN ('win', 'loss')
                AND (ensemble_prob IS NOT NULL OR model_prob IS NOT NULL)`;
  if (sport)  { sql += ' AND sport = ?';  args.push(sport); }
  if (market) { sql += ' AND market = ?'; args.push(market); }
  sql += ' LIMIT 20000';

  const { results } = await env.SB_DB.prepare(sql).bind(...args).all().catch(() => ({ results: [] }));
  const samples = (results || [])
    .map(r => ({ x: r.p ?? r.pm, y: r.result === 'win' ? 1 : 0, w: 1 }))
    .filter(r => r.x != null && r.x >= 0 && r.x <= 1);

  if (samples.length < MIN_SAMPLES) {
    console.log(`${TAG} not enough samples (${samples.length}) for sport=${sport} market=${market}`);
    return { ok: true, trained: false, n_samples: samples.length };
  }

  // Bucket into ~20 bins before PAV, to keep curve small
  const bins = 20;
  const bucketed = [];
  for (let i = 0; i < bins; i++) {
    const lo = i / bins, hi = (i + 1) / bins;
    const inBin = samples.filter(s => s.x >= lo && s.x < hi);
    if (!inBin.length) continue;
    const meanX = inBin.reduce((a, s) => a + s.x, 0) / inBin.length;
    const meanY = inBin.reduce((a, s) => a + s.y, 0) / inBin.length;
    bucketed.push({ x: meanX, y: meanY, w: inBin.length });
  }
  const curve = fitIsotonic(bucketed);

  try {
    await env.SB_DB.prepare(`
      INSERT INTO calibration_curves (sport, market, curve_json, trained_at, n_samples)
        VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(sport, market) DO UPDATE SET
        curve_json = excluded.curve_json,
        trained_at = excluded.trained_at,
        n_samples  = excluded.n_samples
    `).bind(sport || 'all', market || 'all', JSON.stringify(curve), Date.now(), samples.length).run();
  } catch (e) { console.warn(`${TAG} persist: ${e.message}`); }

  return { ok: true, trained: true, n_samples: samples.length, knots: curve.length };
}

// Cache: load curve from D1 and apply
const curveCache = new Map();
export async function loadCalibrationCurve(env, sport = 'all', market = 'all') {
  if (!env.SB_DB) return null;
  const key = `${sport}|${market}`;
  if (curveCache.has(key)) return curveCache.get(key);
  try {
    const row = await env.SB_DB.prepare(
      `SELECT curve_json, n_samples FROM calibration_curves WHERE sport = ? AND market = ?`
    ).bind(sport, market).first();
    if (!row || row.n_samples < MIN_SAMPLES) { curveCache.set(key, null); return null; }
    const curve = JSON.parse(row.curve_json || '[]');
    curveCache.set(key, curve);
    return curve;
  } catch { return null; }
}

export async function calibrate(env, sport, market, raw_prob) {
  const curve = await loadCalibrationCurve(env, sport, market)
             || await loadCalibrationCurve(env, sport || 'all', 'all')
             || await loadCalibrationCurve(env, 'all', 'all');
  if (!curve) return raw_prob;
  return applyIsotonic(curve, raw_prob);
}

// Rebuild curves for common splits
export async function buildAllCurves(env) {
  const splits = [
    { sport: null, market: null },
    { sport: 'soccer',     market: null },
    { sport: 'basketball', market: null },
    { sport: 'soccer',     market: 'h2h' },
    { sport: 'soccer',     market: 'totals' },
    { sport: 'basketball', market: 'spreads' },
    { sport: 'basketball', market: 'totals' },
  ];
  const out = [];
  for (const s of splits) out.push({ ...s, ...(await buildCalibrationCurve(env, s)) });
  return { ok: true, curves: out };
}
