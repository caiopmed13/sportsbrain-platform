// ═══════════════════════════════════════════════════════════════════════════
// NBA enrichment: injeta dados reais (ESPN gamelog + injuries) em combos/props
// ═══════════════════════════════════════════════════════════════════════════
// fetchPlayerStatsBatch(players)     → Map<player, { l5, l10, home, away, daysSinceLast, games[] }>
// computeHitRate(games, stat, line)  → { hit, total, pct }
// projectAdjustedAvg(stats, ctx)     → avg ajustado por home/away + REST + minutos
// enrichCombosWithHitRate(...)       → combos com hitL10, correlação por archetype
// enrichPropsWithHitRate(...)        → props singles com L10 real + REST + split
// buildInjurySet(payload)            → Set<playerName> dinâmico da ESPN
// getArchetypeCorr(posA, posB, key)  → correlação ajustada por perfil
// ═══════════════════════════════════════════════════════════════════════════
import { fetchNBAPlayerStats, fetchNBAInjuries } from './espn'

// Re-export injuries pra BkProps importar daqui só
export { fetchNBAInjuries }

// Cache sessionStorage pra não bater ESPN a cada render
const BATCH_KEY = 'sb_nba_batch_v3'   // v3: inclui l5.min/l10.min + home/away split
const BATCH_TTL = 30 * 60 * 1000

export async function fetchPlayerStatsBatch(players) {
  const map = new Map()
  // Cache
  try {
    const raw = sessionStorage.getItem(BATCH_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      if (c?.ts && Date.now() - c.ts < BATCH_TTL) {
        Object.entries(c.data || {}).forEach(([k, v]) => map.set(k, v))
      }
    }
  } catch {}

  const missing = players.filter(p => !map.has(p))
  if (!missing.length) return map

  // Paraleliza com limite de 8 (evita floodar ESPN)
  const CHUNK = 8
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK)
    await Promise.allSettled(slice.map(async p => {
      try {
        const r = await fetchNBAPlayerStats(p)
        if (r?.stats) map.set(p, r.stats)
      } catch {}
    }))
  }

  // Persiste
  try {
    const data = {}
    map.forEach((v, k) => { data[k] = v })
    sessionStorage.setItem(BATCH_KEY, JSON.stringify({ data, ts: Date.now() }))
  } catch {}

  return map
}

// Hit rate: quantos dos últimos N jogos o jogador superou a linha
export function computeHitRate(games, statKey, line) {
  if (!games?.length || line == null) return null
  const parsed = parseFloat(String(line).replace(/[OU]/i, ''))
  if (!isFinite(parsed)) return null
  let hit = 0
  games.forEach(g => { if (g[statKey] > parsed) hit++ })
  const total = games.length
  return { hit, total, pct: Math.round((hit / total) * 100) }
}

// ─── Injury set dinâmico ─────────────────────────────────────────────────
// payload = { out: [names], doubtful: [], questionable: [] }
// Consideramos OUT + DOUBTFUL como "não gerar props" (questionable fica)
export function buildInjurySet(payload) {
  const set = new Set()
  if (!payload) return set
  ;(payload.out || []).forEach(n => set.add(n))
  ;(payload.doubtful || []).forEach(n => set.add(n))
  return set
}

// ─── Correlação por archetype ────────────────────────────────────────────
// Base empírica + ajuste por perfil dos jogadores nas legs (same-player SGP)
// Guards de primeiro plano (PG) têm maior Pts×Ast que wings/bigs
// Bigs dominantes têm maior Pts×Reb
// Ast×Reb é baixa em todos os perfis
const ARCHETYPE_CORR = {
  // chave: statPair|pos  → ajuste ao ρ base
  'pts+ast|guard': 0.30, 'pts+ast|wing': 0.18, 'pts+ast|big': 0.12,
  'pts+reb|guard': 0.08, 'pts+reb|wing': 0.15, 'pts+reb|big': 0.25,
  'ast+reb|guard': 0.05, 'ast+reb|wing': 0.02, 'ast+reb|big': 0.04,
}
export function getArchetypeCorr(statKey, pos) {
  // statKey esperado formato 'pts+ast' (ordenado)
  const parts = statKey.split('+').sort()
  const norm = parts.join('+')
  const k = `${norm}|${pos || 'wing'}`
  if (ARCHETYPE_CORR[k] != null) return ARCHETYPE_CORR[k]
  // Fallback: média do stat pair
  const allPos = ['guard', 'wing', 'big']
  const vals = allPos.map(p => ARCHETYPE_CORR[`${norm}|${p}`]).filter(v => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.1
}

// ─── Projeção ajustada por contexto real ─────────────────────────────────
// stats = { l5, l10, home, away, daysSinceLast, games }
// ctx   = { isHome, statBase }
// Prioridade: home/away split (se sample ≥4) > L10 > L5
// Aplica REST bonus: +4% se daysSinceLast ≥ 3 (descanso extra)
// Penalidade B2B: -8% se daysSinceLast === 1 (mas B2B já é aplicado antes; só damos bonus)
export function projectAdjustedAvg(stats, ctx = {}) {
  if (!stats) return null
  const { isHome, statBase } = ctx
  if (!statBase) return null

  // 1) Home/away split se amostra suficiente
  const split = isHome ? stats.home : stats.away
  let base = null
  let source = 'none'
  if (split && split.sample >= 4 && split[statBase] != null) {
    base = split[statBase]; source = isHome ? 'home-split' : 'away-split'
  } else if (stats.l10?.[statBase] != null) {
    base = stats.l10[statBase]; source = 'L10'
  } else if (stats.l5?.[statBase] != null) {
    base = stats.l5[statBase]; source = 'L5'
  }
  if (base == null) return null

  // 2) REST bonus — descanso ≥3 dias = +4% (estudos mostram +3-5% em pts)
  let restMult = 1
  if (stats.daysSinceLast != null) {
    if (stats.daysSinceLast >= 3) restMult = 1.04
    else if (stats.daysSinceLast === 1) restMult = 0.94   // B2B extra (cumulativo com penalty externa já aplicada)
  }

  // 3) Tendência de minutos: se L5 minutos > L10 minutos → jogando mais (boost linear)
  let minMult = 1
  if (stats.l5?.min && stats.l10?.min && stats.l10.min > 0) {
    const ratio = stats.l5.min / stats.l10.min
    if (ratio > 1.05) minMult = Math.min(1.08, ratio)     // teto +8%
    else if (ratio < 0.92) minMult = Math.max(0.90, ratio) // piso -10%
  }

  const adjusted = base * restMult * minMult
  return {
    adjusted: +adjusted.toFixed(1),
    base: +base.toFixed(1),
    source,
    restMult: +restMult.toFixed(3),
    minMult: +minMult.toFixed(3),
    daysSinceLast: stats.daysSinceLast,
  }
}

// Ajusta confiança do combo usando hit rate real:
// conf_final = 0.7 × conf_modelo + 0.3 × (hitRate médio das pernas)
// Se hitRate médio < 40% → flag "⚠ frio"; se ≥ 70% → "🔥 quente"
export function enrichCombosWithHitRate(combos, statsMap, positionsMap = {}) {
  return combos.map(c => {
    const stats = statsMap.get(c.player)
    if (!stats?.games?.length) return { ...c, hitRateAvailable: false }

    // Contexto de projeção: home/away inferido via c.team === c.home (se disponível)
    const isHome = c.team && c.home && c.team === c.home

    const legsEnriched = c.legs.map(leg => {
      const hit = computeHitRate(stats.games, leg.statBase, leg.line)

      // NOVO: projeção ajustada por leg (split home/away + REST + tendência minutos)
      const proj = projectAdjustedAvg(stats, { isHome, statBase: leg.statBase })
      let adjHitPct = hit?.pct ?? null
      let marginPct = null
      if (proj?.adjusted) {
        const lineNum = parseFloat(String(leg.line).replace(/[OU]/i, ''))
        if (isFinite(lineNum) && lineNum > 0) {
          marginPct = +(((proj.adjusted - lineNum) / lineNum) * 100).toFixed(1)
          // Boost/penalty no hit rate da leg conforme margem projetada:
          //   >15%  → hit×1.08   >5%  → hit×1.04
          //   <-10% → hit×0.90   <-5% → hit×0.95
          if (adjHitPct != null) {
            if      (marginPct >  15) adjHitPct = Math.round(adjHitPct * 1.08)
            else if (marginPct >   5) adjHitPct = Math.round(adjHitPct * 1.04)
            else if (marginPct < -10) adjHitPct = Math.round(adjHitPct * 0.90)
            else if (marginPct <  -5) adjHitPct = Math.round(adjHitPct * 0.95)
            adjHitPct = Math.max(5, Math.min(95, adjHitPct))
          }
        }
      }

      return {
        ...leg,
        hitL10: hit,
        l10avg: stats.l10?.[leg.statBase] ?? null,
        projAdjusted: proj?.adjusted ?? null,   // média projetada (minuto-ajustada)
        projSource: proj?.source ?? null,
        minMult: proj?.minMult ?? null,         // ratio L5/L10 minutos (1 = neutro)
        restMult: proj?.restMult ?? null,
        marginPct,                               // % acima/abaixo da linha
        adjHitPct,                               // hit rate após ajuste de contexto
      }
    })

    // Usa adjHitPct (com context) quando disponível, senão hitL10.pct cru
    const pcts = legsEnriched
      .map(l => l.adjHitPct ?? l.hitL10?.pct)
      .filter(p => p != null)
    if (!pcts.length) return { ...c, legs: legsEnriched, hitRateAvailable: false }

    // Hit rate combinado "empírico": produto das pernas ajustado por correlação archetype
    const pos = positionsMap[c.player] || 'wing'
    let corrAdjusted = 1
    if (legsEnriched.length === 2) {
      const key = `${legsEnriched[0].statBase}+${legsEnriched[1].statBase}`
      const rho = getArchetypeCorr(key, pos)
      corrAdjusted = 1 + rho * 0.6   // f=0.6 conservador
    }
    const productPct = Math.round(pcts.reduce((a, b) => a * (b / 100), 1) * corrAdjusted * 100)

    // Peso extra pro produto se projeção estiver forte de um lado
    // (quando ambas legs têm margem > +10% ou < -10%, aumenta peso do empírico)
    const strongSignal = legsEnriched.every(l => l.marginPct != null && Math.abs(l.marginPct) >= 10)
    const empiricalWeight = strongSignal ? 0.40 : 0.30
    const confBlended = Math.round((1 - empiricalWeight) * c.conf + empiricalWeight * productPct)

    const avgLegHit = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    const vibe = avgLegHit >= 70 ? 'hot' : avgLegHit < 40 ? 'cold' : 'neutral'

    // Flag visual de contexto de minutos
    const minFlags = legsEnriched.map(l => l.minMult).filter(v => v != null)
    const avgMinMult = minFlags.length ? minFlags.reduce((a, b) => a + b, 0) / minFlags.length : 1
    const minuteTrend =
      avgMinMult > 1.03 ? 'up' : avgMinMult < 0.96 ? 'down' : 'flat'

    return {
      ...c,
      legs: legsEnriched,
      hitRateAvailable: true,
      hitL10Product: productPct,
      hitL10AvgLeg: avgLegHit,
      confOriginal: c.conf,
      conf: Math.max(5, Math.min(92, confBlended)),
      vibe,
      minuteTrend,                              // 'up' | 'flat' | 'down'
      avgMinMult: +avgMinMult.toFixed(3),
      archetypeCorr: legsEnriched.length === 2
        ? Math.round(getArchetypeCorr(`${legsEnriched[0].statBase}+${legsEnriched[1].statBase}`, pos) * 100)
        : c.corr,
    }
  })
}

// Aplica hit rate, home/away split, REST e projeção em props singles
// Se a prop tem isHome no pickContext, usa split real
export function enrichPropsWithHitRate(props, statsMap) {
  return props.map(p => {
    const stats = statsMap.get(p.player)
    if (!stats?.games?.length) return p
    const hit = computeHitRate(stats.games, p.statBase, p.line)

    // Projeção ajustada (home/away split + REST + minutos)
    const isHome = p.team && p.home && p.team === p.home
    const proj = projectAdjustedAvg(stats, { isHome, statBase: p.statBase })

    let confBlended = p.conf
    if (hit) {
      confBlended = Math.round(0.7 * p.conf + 0.3 * hit.pct)
    }

    // Se projeção disponível, recalcula confidence vs a linha com dados reais
    // ganho adicional se avg ajustado supera a linha em ≥ 20%
    if (proj?.adjusted) {
      const lineNum = parseFloat(String(p.line).replace(/[OU]/i, ''))
      if (isFinite(lineNum) && lineNum > 0) {
        const margin = (proj.adjusted - lineNum) / lineNum
        if (margin > 0.15)      confBlended = Math.round(confBlended * 1.08)
        else if (margin < -0.10) confBlended = Math.round(confBlended * 0.90)
      }
    }

    // REST bonus explícito (pode acumular com projeção)
    let restTag = null
    if (stats.daysSinceLast != null) {
      if (stats.daysSinceLast >= 3) restTag = `💤 +${stats.daysSinceLast}d rest`
      else if (stats.daysSinceLast === 1) restTag = '⚠ B2B (1d)'
    }

    return {
      ...p,
      hitL10: hit,
      l10avg: stats.l10?.[p.statBase] ?? null,
      splitAvg: proj ? { source: proj.source, value: proj.adjusted, base: proj.base } : null,
      restTag,
      daysSinceLast: stats.daysSinceLast,
      confOriginal: p.conf,
      conf: Math.max(5, Math.min(92, confBlended)),
    }
  })
}
