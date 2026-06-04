// scripts/test-mega-builders.js — P3.9 R6K-F2.8-LOCAL
// Teste local do cascadeMegaPlus com pool sintético derivado dos dumps reais
// de produção. Roda em Node puro (sem worker, sem CPU limit), permite ver
// quais combos o algoritmo PRODUZIRIA com cap 500k + hybrid sort + lottery.
//
// Uso: node scripts/test-mega-builders.js
// Saída: distribuição de combos, top 10, contagens por pool origin.
//
// NÃO PRECISA wrangler. NÃO TOCA D1. NÃO DEPLOY. Apenas algoritmo isolado.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Helpers (copy-paste mínimo da lógica em premiumPicks.js) ─────────────

// Gerador de combinações C(n, k) — espelha utility `combos` do premiumPicks
function* combos(arr, k) {
  const n = arr.length
  if (k < 0 || k > n) return
  if (k === 0) { yield []; return }
  const indices = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield indices.map(i => arr[i])
    let i = k - 1
    while (i >= 0 && indices[i] === n - k + i) i--
    if (i < 0) return
    indices[i]++
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1
  }
}

function _comboEvPct(legs) {
  const factor = (legs || []).reduce((acc, p) => {
    const e = (p.ev_pct || 0) / 100
    return e > 0 ? acc * (1 + e) : acc
  }, 1.0)
  return +((factor - 1) * 100).toFixed(2)
}

function _isDCFamily(p) {
  const s = (p.stat || p.market || '').toUpperCase()
  return /DOUBLE_CHANCE|DRAW_NO_BET|DNB/i.test(s)
}

// Virtual filter (copy from virtualGameFilter.js)
const VIRTUAL_PARENS_PATTERN = /\([A-Za-zÀ-ÿ][\w\s\-\.']+\)/g
const REAL_TEAM_PARENS_WHITELIST = /^\((II|III|IV|V|VI|B|C|D|W|F|M|U1[5-9]|U2[0-3]|Reserves?|Sub|CF|FC|SC|AC|BK|EC|RC|SE|GE|AA|AD|AE)\)$/i
function hasNonWhitelistedParens(s) {
  if (!s) return false
  const matches = String(s).match(VIRTUAL_PARENS_PATTERN)
  if (!matches) return false
  for (const paren of matches) {
    if (!REAL_TEAM_PARENS_WHITELIST.test(paren)) return true
  }
  return false
}
function _isVirtualOrCrossport(p) {
  if (!p || typeof p !== 'object') return false
  if (hasNonWhitelistedParens(p.home_team || '')) return true
  if (hasNonWhitelistedParens(p.away_team || '')) return true
  if (hasNonWhitelistedParens(p.match || '')) return true
  return false
}

// ─── Pool sintético: legs únicas de tier1+tier2+tier4 ─────────────────────

function readDump(name) {
  const fp = path.join(__dirname, `_dump_${name}.json`)
  if (!fs.existsSync(fp)) {
    console.error(`Missing dump: ${fp} — rode primeiro o curl que popula esses arquivos`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(fp, 'utf-8'))
}

function extractLegs(payload, section) {
  if (section === 'tier1') {
    return payload?.body?.tier1?.picks || payload?.tier1?.picks || []
  }
  const items = payload?.items || payload?.combos || payload?.[section]?.combos || []
  const legs = []
  for (const c of items) for (const l of (c.legs || [])) legs.push(l)
  return legs
}

const t1 = readDump('tier1')
const t2 = readDump('tier2')
const t4 = readDump('tier4')
const allLegs = [...extractLegs(t1, 'tier1'), ...extractLegs(t2, 'tier2'), ...extractLegs(t4, 'tier4')]

// Dedup por (match, market, selection)
const dedup = new Map()
for (const l of allLegs) {
  const k = `${l.match || ''}|${l.market || ''}|${l.selection || l.direction || ''}`
  if (!dedup.has(k)) dedup.set(k, l)
}
const unifiedLegs = Array.from(dedup.values())

console.log('═══════════════════════════════════════════════════════════')
console.log('R6K-F2.8-LOCAL — Teste cascadeMegaPlus em Node puro')
console.log('═══════════════════════════════════════════════════════════')
console.log()
console.log('Pool sintético (proxy do annotatedWithAll filtrado):')
console.log(`  Total legs distintas        : ${unifiedLegs.length}`)
console.log(`  Após filter virtual         : ${unifiedLegs.filter(l => !_isVirtualOrCrossport(l)).length}`)
console.log(`  Após filter virtual + DC    : ${unifiedLegs.filter(l => !_isVirtualOrCrossport(l) && !_isDCFamily(l)).length}`)
console.log(`  Com odd>=1.6 (filter F2.4) : ${unifiedLegs.filter(l => !_isVirtualOrCrossport(l) && !_isDCFamily(l) && (l.odd||0)>=1.6).length}`)
console.log(`  Com odd>=2.0 (filter F2.3) : ${unifiedLegs.filter(l => !_isVirtualOrCrossport(l) && !_isDCFamily(l) && (l.odd||0)>=2.0).length}`)
console.log()

// ─── REPLICAR cascadeMegaPlus com hybrid+lottery (F2.6 design) + cap 500k ──

const _plusByMatch = new Map()
for (const p of unifiedLegs) {
  if (!p || (p.odd || 0) < 1.6) continue
  if (_isDCFamily(p) || _isVirtualOrCrossport(p)) continue
  const _sm = (p.stat || p.market || '').toUpperCase()
  if (/DOUBLE_CHANCE|DRAW_NO_BET|DNB/i.test(_sm)) continue
  if (/JOGADOR.*MARCA|MARCA.*ASSIST|PLAYER.*SCORE/i.test(_sm)) continue
  const m = p.match
  if (!m) continue
  const prev = _plusByMatch.get(m)
  if (!prev || (p.prob || 0) > (prev.prob || 0)) _plusByMatch.set(m, p)
}
const _allCandidates = Array.from(_plusByMatch.values())
const _byProb = [..._allCandidates].sort((a, b) => (b.prob || 0) - (a.prob || 0))
const _byOdd = [..._allCandidates].sort((a, b) => (b.odd || 0) - (a.odd || 0))

console.log(`Pool por-match (após filters)  : ${_allCandidates.length} legs`)
console.log()

// Pool A: INTERLEAVE
const _seenInter = new Set()
const _poolInterleave = []
for (let i = 0; i < 30; i++) {
  if (i < _byOdd.length) {
    const p = _byOdd[i]
    if (p.match && !_seenInter.has(p.match)) { _seenInter.add(p.match); _poolInterleave.push(p) }
  }
  if (i < _byProb.length) {
    const p = _byProb[i]
    if (p.match && !_seenInter.has(p.match)) { _seenInter.add(p.match); _poolInterleave.push(p) }
  }
  if (_poolInterleave.length >= 30) break
}

// Pool B: LOTTERY (pure odd DESC)
const _poolLottery = _byOdd.slice(0, 30)

console.log(`Pool A (interleave)            : ${_poolInterleave.length} legs`)
console.log(`  Odd range (first 5)          : ${_poolInterleave.slice(0,5).map(p => p.odd).join(', ')}`)
console.log(`Pool B (lottery)               : ${_poolLottery.length} legs`)
console.log(`  Odd range (first 5)          : ${_poolLottery.slice(0,5).map(p => p.odd).join(', ')}`)
console.log()

// ─── Builder ─────────────────────────────────────────────────────────────

const out = []
function buildFromPool(pool, poolName) {
  if (pool.length < 8) return 0
  const t0 = Date.now()
  let _cnt = 0, produced = 0
  for (const k of [10, 11, 12, 13, 14, 15]) {
    if (pool.length < k) continue
    for (const c of combos(pool, k)) {
      if (_cnt >= 5000) break; _cnt++  // F2.9-B
      const cOdd = c.reduce((s, p) => s * p.odd, 1)
      const cProb = c.reduce((s, p) => s * p.prob, 1)
      if (cOdd < 500) continue
      out.push({
        legs: c, n_legs: k,
        combined_odd: +cOdd.toFixed(2),
        combined_prob: +(cProb * 100).toFixed(4),
        ev_pct: _comboEvPct(c),
        _pool_origin: poolName,
      })
      produced++
    }
  }
  const elapsed = Date.now() - t0
  console.log(`Pool ${poolName.padEnd(10)} → ${produced} combos válidos (${_cnt} iter, ${elapsed}ms)`)
  return produced
}

console.log('═══ Builder roda ═══')
buildFromPool(_poolInterleave, 'interleave')
buildFromPool(_poolLottery, 'lottery')

// Dedup por leg-set signature
const _seenCombos = new Set()
const deduped = []
for (const c of out) {
  const sig = c.legs.map(l => l.match || '').sort().join('|')
  if (!_seenCombos.has(sig)) { _seenCombos.add(sig); deduped.push(c) }
}
deduped.sort((a, b) => b.combined_prob - a.combined_prob)

console.log()
console.log(`═══ RESULTADO ═══`)
console.log(`Total combos antes dedup       : ${out.length}`)
console.log(`Total combos após dedup        : ${deduped.length}`)
console.log()

// Distribuição
const buckets = [[0,500],[500,1000],[1000,10000],[10000,100000],[100000,1e6],[1e6,1e9]]
console.log('Distribuição de combined_odd:')
for (const [lo, hi] of buckets) {
  const c = deduped.filter(x => lo <= x.combined_odd && x.combined_odd < hi)
  if (c.length) console.log(`  ${String(lo).padStart(9)} - ${String(hi).padStart(9)}: ${c.length}`)
}

// Top 10
console.log()
console.log('Top 10 por combined_odd:')
deduped.sort((a, b) => b.combined_odd - a.combined_odd)
for (const c of deduped.slice(0, 10)) {
  console.log(`  ${c._pool_origin.padEnd(10)} k=${String(c.n_legs).padStart(2)} odd=${String(c.combined_odd).padStart(12)}x  prob=${c.combined_prob.toFixed(4)}%  ev=${c.ev_pct.toFixed(1)}%`)
}

// Top 5 por method_tag (qual jogo) — sanity check
console.log()
console.log('Sample legs do top combo (matches):')
if (deduped.length) {
  for (const l of deduped[0].legs.slice(0, 8)) {
    console.log(`  - ${l.match} | ${l.market} ${l.selection || ''} @${l.odd}x prob=${(l.prob*100).toFixed(0)}%`)
  }
}

console.log()
console.log('═══════════════════════════════════════════════════════════')
console.log('FIM — sem deploy, sem push, sem D1 write, sem network external')
console.log('═══════════════════════════════════════════════════════════')
