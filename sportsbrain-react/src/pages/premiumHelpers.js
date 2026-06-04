// premiumHelpers.js — pure JS helpers for Premium tier logic (no React)
// Extracted from Premium.jsx so they can be unit-tested with vitest.

/**
 * Groups VIP items by method_group_id.
 * Returns Map<groupId, { singles, doubles, triples, fullMega }>
 * - skips items with no method_group_id
 * - skips items with hidden_reason set
 * - decomposition_level 'full_mega' → fullMega
 * - 'single_game' → singles
 * - 'double' → doubles
 * - 'triple' or 'quadra' → triples
 */
export function groupVipItems(items) {
  if (!items) return new Map()
  const groups = new Map()
  for (const item of items) {
    if (!item.method_group_id) continue
    if (item.hidden_reason) continue  // skip sanity-gated items
    const gid = item.method_group_id
    if (!groups.has(gid)) groups.set(gid, { singles: [], doubles: [], triples: [], fullMega: null })
    const g = groups.get(gid)
    if (item.decomposition_level === 'full_mega') g.fullMega = item
    else if (item.decomposition_level === 'single_game') g.singles.push(item)
    else if (item.decomposition_level === 'double') g.doubles.push(item)
    else if (item.decomposition_level === 'triple' || item.decomposition_level === 'quadra') g.triples.push(item)
  }
  return groups
}

/**
 * Returns Map<groupId, group> containing ONLY groups that have a fullMega item.
 * Used to render VipGroupCard only for proper mega groups, not jackpot/loose combos.
 */
export function filterMegaGroups(items) {
  const groups = groupVipItems(items)
  const result = new Map()
  for (const [gid, group] of groups) {
    if (group.fullMega) result.set(gid, group)
  }
  return result
}

/**
 * Returns number of method_group_id groups that contain a full_mega item.
 * This is used for the "Mega" tab badge counter.
 */
export function countMegaGroups(combos) {
  return filterMegaGroups(combos).size
}

/**
 * Returns true when: fullMega exists AND ev_pct is a number >= 0
 * Also returns false when ev_reliable === false (explicitly unreliable → no post).
 * Note: ev_reliable: undefined (absent) does NOT block posting.
 */
export function megaCanPost(fullMega) {
  if (!fullMega) return false
  if (fullMega.ev_reliable === false) return false   // explicitly unreliable → no post
  if (typeof fullMega.ev_pct !== 'number') return false
  return fullMega.ev_pct >= 0
}

/**
 * Returns items that have NO method_group_id (they lack VIP group membership).
 * These are raw combos routed to tier4 only by combined_odd >= 500 threshold.
 */
export function getMegaOrphans(items) {
  if (!items) return []
  return items.filter(item => !item.method_group_id)
}

/**
 * Returns true when fullMega qualifies as a "main" mega (shown in Mega tab):
 * game_block_count >= 4, or mega_size_tier in [standard, large, ultra].
 * Megas with < 4 blocks are Jackpot VIP (shown in Jackpot tab).
 * There is no upper limit — 20, 30, 50+ block megas are all main megas.
 */
export function isMainMega(fullMega) {
  if (!fullMega) return false
  if (fullMega.is_displayable === false) return false
  if (fullMega.hidden_reason) return false
  if ((fullMega.game_block_count || 0) >= 4) return true
  const MAIN_TIERS = ['standard', 'large', 'ultra']
  if (MAIN_TIERS.includes(fullMega.mega_size_tier)) return true
  return false
}

/**
 * F2.38.1: Computa fingerprint deterministico de uma fullMega para dedup.
 * Estratégia: odd arredondada + EV arredondado + n_legs + first 3 legs as-is
 * (não sorted, evita o problema de ordenação alfabética com matches randomic
 * adicionados pelo cascade_plus_strategy).
 * cascade_plus_0..9 com mesma odd 691x + mesmo EV +226.1% + 10 legs + mesmas
 * 3 primeiras pernas → mesmo fingerprint → dedup correto.
 */
function _megaFingerprint(fullMega) {
  if (!fullMega) return ''
  // F2.38.2: dedup agressivo — odd round + ev round + n_legs + method_tag.
  // F2.91: + risk_profile (conservative/aggressive) — antes Megas com mesma
  // odd/EV/legs mas perfis diferentes eram deduplicadas por engano.
  const odd = Math.round(+fullMega.combined_odd || 0)
  const ev = Math.round((+fullMega.ev_pct || 0) * 10) / 10
  const nLegs = +fullMega.n_legs || 0
  const tag = (fullMega.method_tag || fullMega.method_family || '').toString().toLowerCase()
  const risk = (fullMega.risk_profile || getEffectiveRiskProfile(fullMega) || '').toString().toLowerCase()
  return `${tag}|${odd}|${ev}|${nLegs}|${risk}`
}

/**
 * F2.38.3: Dedup genérico para arrays de combos (tier2/tier3/tier4 raw).
 * Mesmo fingerprint do mega — colapsa combos UX-equivalentes.
 * F2.39: Também filtra EV trash (< -25%) — combos catastroficamente negativos
 * são lixo gerado, não vale a pena mostrar.
 */
export function dedupCombos(combos) {
  if (!Array.isArray(combos)) return []
  const seen = new Set()
  const out = []
  for (const c of combos) {
    // F2.39: filter EV trash (< -25%) — combos catastroficamente ruins
    const ev = +c.ev_pct
    if (Number.isFinite(ev) && ev < -25) continue
    const fp = _megaFingerprint(c)
    if (!fp) { out.push(c); continue }
    if (seen.has(fp)) continue
    seen.add(fp)
    out.push(c)
  }
  return out
}

/**
 * Returns Map<groupId, group> containing only groups where isMainMega(group.fullMega) is true.
 * F2.38: Dedupa por fingerprint.
 * F2.39: Filtra EV trash (< -25%).
 */
export function filterMainMegaGroups(items) {
  const groups = filterMegaGroups(items)
  const result = new Map()
  const seenFp = new Set()
  for (const [gid, group] of groups) {
    if (!isMainMega(group.fullMega)) continue
    // F2.39: filter EV trash
    const ev = +group.fullMega?.ev_pct
    if (Number.isFinite(ev) && ev < -25) continue
    const fp = _megaFingerprint(group.fullMega)
    if (fp && seenFp.has(fp)) continue
    seenFp.add(fp)
    result.set(gid, group)
  }
  return result
}

/**
 * Returns Map<groupId, group> containing groups that have a fullMega but isMainMega is false.
 * These are small megas that should display in a "Jackpot VIP" subsection.
 */
export function filterSmallMegaGroups(items) {
  const groups = filterMegaGroups(items)
  const result = new Map()
  const seenFp = new Set()
  for (const [gid, group] of groups) {
    if (isMainMega(group.fullMega)) continue
    const fp = _megaFingerprint(group.fullMega)
    if (fp && seenFp.has(fp)) continue
    seenFp.add(fp)
    result.set(gid, group)
  }
  return result
}

/**
 * Returns a human-readable title for a VIP group.
 * Maps technical method identifiers to display labels.
 */
export function formatVipGroupTitle(group) {
  const item = group.fullMega
    || (group.singles && group.singles[0])
    || (group.doubles && group.doubles[0])
    || (group.triples && group.triples[0])  // also check triples/quadras
  if (!item) return 'VIP'
  // check all three fields in priority order
  const candidates = [item.method_family, item.method_tag, item.source]
  for (const val of candidates) {
    if (!val) continue
    const v = String(val).toLowerCase()
    if (v.includes('draw_btts')) return 'DRAW + BTTS'
    if (v.includes('result_btts') || v.includes('faixa')) return 'FAIXA'
    // use ht_ (with underscore) to avoid matching unrelated values starting with 'ht'
    if (v.includes('ht_shots') || v.includes('ht_corners') || v.includes('ht_')) return 'HT METHOD'
    if (v.includes('player_shots') || v.includes('shots') || v.includes('chutes')) return 'CHUTES'
    if (v.includes('cards_2t') || v.includes('bingo')) return 'BINGO DOS CLÁSSICOS'
  }
  // fallback: clean up method_tag
  const tag = item.method_tag || item.source || ''
  if (tag) return String(tag).replace(/^vip_/i, '').replace(/_/g, ' ').toUpperCase()
  return 'VIP'
}

/**
 * Returns effective risk profile for display.
 * draw_btts methods are always aggressive, regardless of stored risk_profile.
 */
export function getEffectiveRiskProfile(item) {
  const family = item.method_family || item.source || ''
  if (String(family).toLowerCase().includes('draw_btts')) return 'aggressive'
  return item.risk_profile || 'conservative'
}

// FAIXA-Methods tier (spec sec 2 decision 4):
//   cards       < 100x
//   conservador 100x - 9999x
//   agressivo   >= 10000x
export function filterByOddRange(items, range) {
  const arr = Array.isArray(items) ? items : [];
  if (range === 'cards')       return arr.filter(i => +i.combined_odd < 100);
  if (range === 'conservador') return arr.filter(i => +i.combined_odd >= 100 && +i.combined_odd < 10000);
  if (range === 'agressivo')   return arr.filter(i => +i.combined_odd >= 10000);
  return arr;
}
