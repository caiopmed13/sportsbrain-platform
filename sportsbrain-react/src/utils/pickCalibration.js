// ═══════════════════════════════════════════════════════════════════════════
// Fase 3 — Calibração Mensal do Histórico
// ═══════════════════════════════════════════════════════════════════════════
// Usa o histórico sincronizado (pickHistory.jsx) para computar SHIFTS por:
//   - Liga       (ex: Brasileirão overconfidence +8pp em Casa Win)
//   - Mercado    (ex: Empate underperformance -5pp em média)
//   - Bracket    (ex: 80-89% conf tá batendo só 70% → Platt correction)
//
// Janela rolling: 30 dias (mensal, como pedido)
// Shifts só são aplicados quando sampleSize >= MIN_SAMPLE para evitar overfit
//
// API:
//   buildCalibrationMap(history, windowDays=30) → { byLeague, byMarket, byBracket, sampleSize }
//   applyCalibration(pick, calibMap) → pick ajustado
//   loadCachedCalibration() → mapa do localStorage (atualizado pelo sync)
// ═══════════════════════════════════════════════════════════════════════════

const CALIB_CACHE_KEY = 'sb_calibration_v1'
const MIN_SAMPLE = 10
const MIN_BRACKET_SAMPLE = 15

const HISTORY_KEYS = [
  'sb_ftprops_history',
  'sb_bkprops_history',
  'sb_garantido_history',
]

// ── Normaliza nome de liga para chave ────────────────────────────────────
function normLg(lg) {
  return (lg || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/ç/g,'c')
    .replace(/[^a-z0-9]/g,'').slice(0, 30) || 'unknown'
}

// ── Agrupa picks resolvidas (W/L) por chave e computa shift ───────────────
function computeShifts(resolved, keyFn) {
  const buckets = new Map()
  resolved.forEach(p => {
    const k = keyFn(p)
    if (!k) return
    if (!buckets.has(k)) buckets.set(k, { wins: 0, total: 0, confSum: 0 })
    const b = buckets.get(k)
    b.total++
    b.confSum += p.conf || 0
    if (p.result === 'W') b.wins++
  })

  const result = {}
  buckets.forEach((b, k) => {
    if (b.total < MIN_SAMPLE) return
    const predicted = b.confSum / b.total / 100   // conf média ÷ 100
    const actual    = b.wins   / b.total
    result[k] = {
      predicted: +(predicted * 100).toFixed(1),
      actual:    +(actual    * 100).toFixed(1),
      shift:     +((actual - predicted) * 100).toFixed(1),  // pp: + = melhor que esperado
      sample:    b.total,
    }
  })
  return result
}

// ── Platt scaling simplificado por bracket ────────────────────────────────
function computeBracketShifts(resolved) {
  const brackets = [
    { label: '85+',   min: 85, max: 100 },
    { label: '80-84', min: 80, max: 84  },
    { label: '75-79', min: 75, max: 79  },
    { label: '70-74', min: 70, max: 74  },
    { label: '60-69', min: 60, max: 69  },
    { label: '<60',   min: 0,  max: 59  },
  ]
  const result = {}
  brackets.forEach(b => {
    const picks = resolved.filter(p => (p.conf || 0) >= b.min && (p.conf || 0) <= b.max)
    if (picks.length < MIN_BRACKET_SAMPLE) return
    const wins = picks.filter(p => p.result === 'W').length
    const avgConf = picks.reduce((a, p) => a + (p.conf || 0), 0) / picks.length
    const actualWR = (wins / picks.length) * 100
    result[b.label] = {
      range:     [b.min, b.max],
      avgConf:   +avgConf.toFixed(1),
      actualWR:  +actualWR.toFixed(1),
      shift:     +(actualWR - avgConf).toFixed(1),
      sample:    picks.length,
    }
  })
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
export function buildCalibrationMap(history, windowDays = 30) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const resolved = (history || []).filter(h =>
    (h.result === 'W' || h.result === 'L') &&
    (h.savedAt ? h.savedAt >= cutoff : true)
  )

  return {
    byLeague:   computeShifts(resolved, p => normLg(p.league)),
    byMarket:   computeShifts(resolved, p => (p.stat || '').slice(0, 30)),
    byBracket:  computeBracketShifts(resolved),
    byLeagueMarket: computeShifts(resolved, p => `${normLg(p.league)}|${(p.stat || '').slice(0, 20)}`),
    sampleSize: resolved.length,
    builtAt:    Date.now(),
    windowDays,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Aplica shift em uma pick antes de emitir
// Shifts clamped em ±8pp para evitar correções drásticas de ruído
// Retorna { conf, shift, shiftSource } com metadados de auditoria
// ═══════════════════════════════════════════════════════════════════════════
export function applyCalibration(pick, calibMap) {
  if (!pick || !calibMap) return { conf: pick?.conf || 0, shift: 0, shiftSource: null }
  const lgKey     = normLg(pick.league)
  const mktKey    = (pick.stat || '').slice(0, 30)
  const lmKey     = `${lgKey}|${(pick.stat || '').slice(0, 20)}`
  const baseConf  = pick.conf || 0

  // Prioridade: leagueMarket > league > market > bracket
  let shift = 0, source = null
  if (calibMap.byLeagueMarket?.[lmKey]) {
    shift = calibMap.byLeagueMarket[lmKey].shift
    source = `liga+mercado (${calibMap.byLeagueMarket[lmKey].sample} amostras)`
  } else if (calibMap.byLeague?.[lgKey] && calibMap.byMarket?.[mktKey]) {
    // Média ponderada pelos dois
    const lg = calibMap.byLeague[lgKey]
    const mk = calibMap.byMarket[mktKey]
    const totalSample = lg.sample + mk.sample
    shift = (lg.shift * lg.sample + mk.shift * mk.sample) / totalSample
    source = `liga+mercado (combinado, ${totalSample} amostras)`
  } else if (calibMap.byLeague?.[lgKey]) {
    shift = calibMap.byLeague[lgKey].shift
    source = `liga (${calibMap.byLeague[lgKey].sample})`
  } else if (calibMap.byMarket?.[mktKey]) {
    shift = calibMap.byMarket[mktKey].shift
    source = `mercado (${calibMap.byMarket[mktKey].sample})`
  }

  // Bracket shift adiciona ajuste fino se existir
  const bracketLabel =
    baseConf >= 85 ? '85+' :
    baseConf >= 80 ? '80-84' :
    baseConf >= 75 ? '75-79' :
    baseConf >= 70 ? '70-74' :
    baseConf >= 60 ? '60-69' : '<60'
  const bracketShift = calibMap.byBracket?.[bracketLabel]?.shift || 0

  // Combina shifts (peso 0.7 para liga/mercado, 0.3 para bracket)
  const finalShift = Math.max(-8, Math.min(8, shift * 0.7 + bracketShift * 0.3))
  const finalConf  = Math.max(5, Math.min(92, Math.round(baseConf + finalShift)))

  return {
    conf: finalConf,
    shift: +finalShift.toFixed(1),
    shiftSource: source,
    originalConf: baseConf,
    bracketShift: +bracketShift.toFixed(1),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cache local (rebuildada sempre que histórico atualiza)
// ═══════════════════════════════════════════════════════════════════════════
export function saveCalibrationCache(map) {
  try { localStorage.setItem(CALIB_CACHE_KEY, JSON.stringify(map)) } catch {}
}

export function loadCalibrationCache() {
  try {
    const raw = localStorage.getItem(CALIB_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// Junta histórico de todos os esportes (football + basketball + garantido)
// + auto-diary de Top Picks (Fase 2: alimenta Platt scaling com picks recentes)
export function loadAllHistory() {
  const all = []
  HISTORY_KEYS.forEach(k => {
    try {
      const arr = JSON.parse(localStorage.getItem(k) || '[]')
      all.push(...arr)
    } catch {}
  })
  // Auto-diary do clvTracker.js (Top Picks Premium auto-logados)
  try {
    const diary = JSON.parse(localStorage.getItem('sb_clv_diary_v1') || '[]')
    for (const p of diary) {
      if (!p.result || p.result === 'P') continue
      // Adapta schema para compatibilidade com computeShifts
      all.push({
        league:  p.league,
        stat:    `${p.market}:${p.side}`,        // ex: "1X2:H", "BTTS:YES"
        conf:    p.conf,
        result:  p.result,
        savedAt: p.closed_at || p.ts_open,
      })
    }
  } catch {}
  return all
}

// Rebuild automático: se cache > 7 dias, refresh.
// Chamar no boot da página (lazy) — barato, lê localStorage.
export function autoRebuildIfStale(windowDays = 30, maxAgeDays = 7) {
  const cached = loadCalibrationCache()
  const ageMs = cached?.builtAt ? Date.now() - cached.builtAt : Infinity
  if (ageMs > maxAgeDays * 86400_000) {
    return rebuildCalibrationCache(windowDays)
  }
  return cached
}

// Helper: rebuildada o cache a partir do histórico atual
export function rebuildCalibrationCache(windowDays = 30) {
  const all = loadAllHistory()
  const map = buildCalibrationMap(all, windowDays)
  saveCalibrationCache(map)
  return map
}

// ═══════════════════════════════════════════════════════════════════════════
// Fase 5 — Fetch calibração do servidor (agregado cross-user)
// Server tem MUITO mais amostras que o localStorage → usa como base
// Local merge sobrepõe apenas em chaves com amostra local significativa
// ═══════════════════════════════════════════════════════════════════════════
const SERVER_CALIB_KEY = 'sb_calib_server_v1'
const SERVER_CALIB_TTL = 15 * 60 * 1000   // 15min (match Cache-Control)

export async function fetchServerCalibration(sport = 'football', windowDays = 30) {
  // Tenta cache primeiro
  try {
    const raw = sessionStorage.getItem(SERVER_CALIB_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      if (c?.ts && Date.now() - c.ts < SERVER_CALIB_TTL && c.sport === sport) {
        return c.map
      }
    }
  } catch {}

  try {
    const url = `https://sportsbrain-api.sportsbrain-api.workers.dev/v1/calibration?sport=${sport}&window=${windowDays}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data = await res.json()
    const map = data.calibration || null
    if (map) {
      try { sessionStorage.setItem(SERVER_CALIB_KEY, JSON.stringify({ map, sport, ts: Date.now() })) } catch {}
    }
    return map
  } catch { return null }
}

// Merge: server como base + local sobrepõe em chaves onde local tem ≥15 amostras
// (local reflete as picks DESTE usuário, pode diferir se ele tem viés específico)
export function mergeCalibrationMaps(serverMap, localMap) {
  if (!serverMap && !localMap) return null
  if (!serverMap) return localMap
  if (!localMap)  return serverMap

  const mergeSection = (key) => {
    const out = { ...(serverMap[key] || {}) }
    const local = localMap[key] || {}
    for (const k of Object.keys(local)) {
      if (local[k].sample >= 15) out[k] = local[k]   // local wins quando tem amostra
    }
    return out
  }

  return {
    byLeague:        mergeSection('byLeague'),
    byMarket:        mergeSection('byMarket'),
    byLeagueMarket:  mergeSection('byLeagueMarket'),
    byBracket:       mergeSection('byBracket'),
    sampleSize:      (serverMap.sampleSize || 0) + (localMap.sampleSize || 0),
    windowDays:      localMap.windowDays || serverMap.windowDays || 30,
    builtAt:         Date.now(),
    source:          'merged',
  }
}
