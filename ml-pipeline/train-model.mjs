// ═══════════════════════════════════════════════════════════════════════════
// train-model.mjs — Treina modelo de calibração via gradient boosting LOCAL
// ═══════════════════════════════════════════════════════════════════════════
// Pipeline (puro Node, sem Python):
//   1. Lê pick_history (W/L) via /v1/picks/history
//   2. Engineera features: edge, conf, market_family, hour, league_tier, line, odd
//   3. Treina LightGBM-like via XGBoost-js (gradient boosted trees)
//   4. Avalia em hold-out (last 20%)
//   5. Exporta modelo (JSON tree dump) + metadata
//   6. POST modelo pro /v1/ml/upload-model do Worker (que armazena em D1)
//
// Worker carrega o modelo no boot e aplica em cada pick gerado.
// ═══════════════════════════════════════════════════════════════════════════

import { fetch } from 'undici'
import fs from 'fs'

const API_BASE = process.env.API_BASE || 'https://sportsbrain-api.sportsbrain-api.workers.dev'
const SECRET = process.env.SB_INGEST_SECRET || ''

// ─── Feature engineering ──────────────────────────────────────────────────
function marketFamily(stat) {
  const s = (stat || '').toLowerCase()
  if (/goals|gol|over|under|mais de|menos de/i.test(s)) return 0  // goals
  if (/corner|escanteio/i.test(s)) return 1
  if (/card|cart/i.test(s)) return 2
  if (/btts|ambos.*marca/i.test(s)) return 3
  if (/casa|home|fora|away|empate|draw|win|1x2/i.test(s)) return 4
  if (/double.*chance|chance.*dupla/i.test(s)) return 5
  if (/htft|intervalo/i.test(s)) return 6
  if (/pontos|points|reb|ast/i.test(s)) return 7  // nba_player
  return 8  // other
}

function leagueTier(league) {
  const l = (league || '').toLowerCase()
  // Tier 1: top European
  if (/premier league|la liga|serie a|bundesliga|ligue 1|champions/.test(l)) return 1
  // Tier 2: secondary European + South America top
  if (/serie b|championship|libertadores|sudamericana|brasileirão|brasileirao|nba/.test(l)) return 2
  // Tier 3: rest
  return 3
}

function extractFeatures(pick) {
  const stat = pick.stat || ''
  const family = marketFamily(stat)
  const conf = (pick.conf || 50) / 100
  const odd = parseFloat(pick.real_odd || 2.0) || 2.0
  const ev = parseFloat(pick.ev_real || 0) || 0
  const tier = leagueTier(pick.league)
  // Extrai linha numérica do stat se houver
  const lineMatch = stat.match(/(\d+\.?\d*)/g)
  const line = lineMatch ? parseFloat(lineMatch[lineMatch.length-1]) : 0
  // Hora do pick (date)
  const hour = pick.pick_date ? new Date(pick.pick_date).getUTCHours() : 12
  return {
    conf,
    odd,
    ev,
    family,
    tier,
    line,
    hour,
    sport: pick.sport === 'basketball' ? 1 : 0,
  }
}

// ─── Decision Stump (1-level tree) ────────────────────────────────────────
// Implementação simples de gradient boosting com stumps.
// Cada stump = (feature, threshold, left_value, right_value).
function trainStump(samples, residuals) {
  // samples: array of feature vectors (objects). residuals: array of {y, weight}
  const features = ['conf', 'odd', 'ev', 'family', 'tier', 'line', 'hour', 'sport']
  let bestGain = -Infinity
  let bestSplit = null
  for (const feat of features) {
    const values = samples.map(s => s[feat])
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    if (sorted.length < 2) continue
    // Tenta cada threshold
    for (let i = 0; i < sorted.length - 1; i++) {
      const thr = (sorted[i] + sorted[i+1]) / 2
      let leftSum = 0, leftCount = 0, rightSum = 0, rightCount = 0
      for (let j = 0; j < samples.length; j++) {
        if (samples[j][feat] <= thr) {
          leftSum += residuals[j]; leftCount++
        } else {
          rightSum += residuals[j]; rightCount++
        }
      }
      if (leftCount === 0 || rightCount === 0) continue
      const leftAvg = leftSum / leftCount
      const rightAvg = rightSum / rightCount
      // Gain: variance reduction
      const totalAvg = (leftSum + rightSum) / (leftCount + rightCount)
      const gain = leftCount * (leftAvg - totalAvg) ** 2 + rightCount * (rightAvg - totalAvg) ** 2
      if (gain > bestGain) {
        bestGain = gain
        bestSplit = { feature: feat, threshold: thr, left_value: leftAvg, right_value: rightAvg }
      }
    }
  }
  return bestSplit
}

function applyStump(stump, sample) {
  return sample[stump.feature] <= stump.threshold ? stump.left_value : stump.right_value
}

// Sigmoid pra mapear log-odds → prob
function sigmoid(x) { return 1 / (1 + Math.exp(-x)) }
function logit(p) { return Math.log(p / Math.max(1e-9, 1 - p)) }

// ─── Gradient Boosting com log-loss ───────────────────────────────────────
function trainBooster(samples, labels, numTrees = 50, learningRate = 0.1) {
  const n = samples.length
  // Inicialização: log-odds da prevalência geral
  const meanY = labels.reduce((a,b) => a+b, 0) / n
  const init_pred = logit(Math.max(0.01, Math.min(0.99, meanY)))
  const trees = []
  let pred = new Array(n).fill(init_pred)

  for (let t = 0; t < numTrees; t++) {
    // Calcula residuals (gradient da log-loss)
    const residuals = pred.map((p, i) => {
      const prob = sigmoid(p)
      return labels[i] - prob
    })
    const stump = trainStump(samples, residuals)
    if (!stump) break
    trees.push(stump)
    // Atualiza pred
    for (let i = 0; i < n; i++) {
      pred[i] += learningRate * applyStump(stump, samples[i])
    }
  }

  return { init_pred, trees, learningRate }
}

function predictBooster(booster, sample) {
  let pred = booster.init_pred
  for (const tree of booster.trees) {
    pred += booster.learningRate * applyStump(tree, sample)
  }
  return sigmoid(pred)
}

// ─── Métricas ─────────────────────────────────────────────────────────────
function logLoss(labels, predictions) {
  let loss = 0
  for (let i = 0; i < labels.length; i++) {
    const p = Math.max(1e-9, Math.min(1-1e-9, predictions[i]))
    loss -= labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p)
  }
  return loss / labels.length
}

function accuracy(labels, predictions, threshold = 0.5) {
  let correct = 0
  for (let i = 0; i < labels.length; i++) {
    if ((predictions[i] >= threshold) === (labels[i] === 1)) correct++
  }
  return correct / labels.length
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[ml-train] fetching pick_history (resolved only, limit 5000)...`)
  const r = await fetch(`${API_BASE}/v1/picks/history?resolved=1&limit=5000`)
  const j = await r.json()
  const all = j.picks || []
  console.log(`[ml-train] ${all.length} resolved W/L picks`)

  // Fetch Telegram tipsters features pra enriquecer training
  let tipsterFeatures = {}
  try {
    const tr = await fetch(`${API_BASE}/v1/telegram/ml-features`)
    const tj = await tr.json()
    for (const f of (tj.features || [])) {
      const k = `${f.channel_id}|${f.market}`
      if (!tipsterFeatures[k]) tipsterFeatures[k] = { wins: 0, total: 0 }
      tipsterFeatures[k].wins += f.wins
      tipsterFeatures[k].total += f.total
    }
    console.log(`[ml-train] Telegram features: ${Object.keys(tipsterFeatures).length} tipster×market buckets`)
  } catch {}

  if (all.length < 50) {
    console.log(`[ml-train] sample muito pequeno (<50). Abortando treino.`)
    process.exit(0)
  }

  // Extract features + labels
  const data = all.map(p => ({
    features: extractFeatures(p),
    label: p.result === 'W' ? 1 : 0,
  }))

  // Shuffle (Fisher-Yates)
  for (let i = data.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[data[i], data[j]] = [data[j], data[i]]
  }

  // Split 80/20
  const trainCut = Math.floor(data.length * 0.8)
  const train = data.slice(0, trainCut)
  const test = data.slice(trainCut)
  console.log(`[ml-train] train=${train.length} test=${test.length}`)

  // Train
  const trainX = train.map(d => d.features)
  const trainY = train.map(d => d.label)
  const booster = trainBooster(trainX, trainY, 50, 0.1)
  console.log(`[ml-train] trained ${booster.trees.length} trees`)

  // Eval on test
  const testX = test.map(d => d.features)
  const testY = test.map(d => d.label)
  const testPred = testX.map(x => predictBooster(booster, x))
  const ll = logLoss(testY, testPred)
  const acc = accuracy(testY, testPred)
  console.log(`[ml-train] test logloss=${ll.toFixed(4)} accuracy=${(acc*100).toFixed(1)}%`)

  // Compara com baseline (always predict average)
  const baselineProb = trainY.reduce((a,b)=>a+b,0) / trainY.length
  const baselineLL = logLoss(testY, testY.map(() => baselineProb))
  console.log(`[ml-train] baseline logloss=${baselineLL.toFixed(4)} (improvement: ${((baselineLL-ll)/baselineLL*100).toFixed(1)}%)`)

  // Salva modelo local + sobe pro Worker
  const model = {
    version: Date.now(),
    trained_at: new Date().toISOString(),
    sample_size: all.length,
    train_size: train.length,
    test_size: test.length,
    metrics: {
      test_logloss: +ll.toFixed(4),
      test_accuracy: +(acc*100).toFixed(1),
      baseline_logloss: +baselineLL.toFixed(4),
      improvement_pct: +(((baselineLL-ll)/baselineLL)*100).toFixed(1),
    },
    booster,
  }
  const outPath = './model.json'
  fs.writeFileSync(outPath, JSON.stringify(model, null, 2))
  console.log(`[ml-train] modelo salvo em ${outPath}`)

  // POST pro Worker
  try {
    const upRes = await fetch(`${API_BASE}/v1/ml/upload-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': SECRET },
      body: JSON.stringify(model),
    })
    console.log(`[ml-train] upload Worker:`, upRes.status, await upRes.text())
  } catch (e) {
    console.error(`[ml-train] upload erro:`, e.message)
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
