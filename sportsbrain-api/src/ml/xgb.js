// ══════════════════════════════════════════════════════════════════════════
// Pure-JS XGBoost (GBDT) inference.
// No training in Worker — model JSON uploaded via /v1/admin/ml/upload.
// Tree schema (per tree):
//   { nodes: [ { feat, thr, left, right, leaf } ... ] }  (array indexed nodes)
// OR compact array: [ feat|-1, thr|leaf_val, left, right ]
// We support the "nodes" form.
// ══════════════════════════════════════════════════════════════════════════

const TAG = '[ml:xgb]';
const JSON_HDR = { 'Content-Type': 'application/json' };

// Evaluate one tree against a numeric feature vector (array).
export function evaluateTree(tree, featuresArr) {
  const nodes = tree?.nodes;
  if (!nodes?.length) return 0;
  let i = 0, guard = 0;
  while (guard++ < 1000) {
    const n = nodes[i];
    if (!n) return 0;
    if (n.leaf !== undefined) return n.leaf;
    const v = featuresArr[n.feat];
    if (v == null || v === undefined || (typeof v === 'number' && !isFinite(v))) {
      // Missing: follow left by default
      i = n.left;
    } else if (v < n.thr) {
      i = n.left;
    } else {
      i = n.right;
    }
  }
  return 0;
}

// Binary classifier: sum scores → sigmoid
export function predictXGB(model, featuresArr) {
  const trees = model?.trees;
  if (!trees?.length) return null;
  let score = model?.base_score ?? 0;
  for (const t of trees) score += evaluateTree(t, featuresArr);
  return 1 / (1 + Math.exp(-score));
}

// Build feature vector from a plain object using model.feature_order
export function vectorize(model, featuresObj) {
  const order = model?.feature_order || [];
  return order.map(k => {
    const v = featuresObj?.[k];
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  });
}

// ── Model loader (cached) ──────────────────────────────────────────
const modelCache = new Map();
export async function loadModel(env, name) {
  if (!env.SB_DB || !name) return null;
  if (modelCache.has(name)) return modelCache.get(name);
  try {
    const row = await env.SB_DB.prepare(
      `SELECT name, trees_json, feature_order_json, base_score, trained_at
         FROM ml_models WHERE name = ?`
    ).bind(name).first();
    if (!row) { modelCache.set(name, null); return null; }
    const model = {
      name: row.name,
      trees: JSON.parse(row.trees_json || '[]'),
      feature_order: JSON.parse(row.feature_order_json || '[]'),
      base_score: row.base_score ?? 0,
      trained_at: row.trained_at,
    };
    modelCache.set(name, model);
    return model;
  } catch (e) {
    console.warn(`${TAG} loadModel: ${e.message}`);
    return null;
  }
}

// Public inference
export async function predict(env, modelName, featuresObj) {
  const model = await loadModel(env, modelName);
  if (!model || !model.trees?.length) return null;  // no-op until weights loaded
  const vec = vectorize(model, featuresObj);
  return predictXGB(model, vec);
}

// ── Admin upload: POST /v1/admin/ml/upload?name=nba_spread ───────────
// Body: { trees: [...], feature_order: [...], base_score?: 0 }
// Auth: X-Admin-Key header must equal env.SB_MASTER_KEY.
export async function handleXGBUpload(request, env) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const key  = request.headers.get('X-Admin-Key');
  if (!env.SB_MASTER_KEY || key !== env.SB_MASTER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'forbidden' }),
      { status: 403, headers: JSON_HDR });
  }
  if (!name) return new Response(JSON.stringify({ ok: false, error: 'name required' }),
    { status: 400, headers: JSON_HDR });
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'no_db' }),
    { status: 503, headers: JSON_HDR });
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad_json' }),
      { status: 400, headers: JSON_HDR });
  }
  if (!Array.isArray(body.trees) || !Array.isArray(body.feature_order)) {
    return new Response(JSON.stringify({ ok: false, error: 'trees and feature_order required' }),
      { status: 400, headers: JSON_HDR });
  }
  try {
    await env.SB_DB.prepare(`
      INSERT INTO ml_models (name, trees_json, feature_order_json, base_score, trained_at)
        VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        trees_json         = excluded.trees_json,
        feature_order_json = excluded.feature_order_json,
        base_score         = excluded.base_score,
        trained_at         = excluded.trained_at
    `).bind(
      name,
      JSON.stringify(body.trees),
      JSON.stringify(body.feature_order),
      body.base_score ?? 0,
      Date.now()
    ).run();
    modelCache.delete(name);
    return new Response(JSON.stringify({ ok: true, name, n_trees: body.trees.length }),
      { status: 200, headers: JSON_HDR });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }),
      { status: 500, headers: JSON_HDR });
  }
}
