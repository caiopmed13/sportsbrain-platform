import { describe, test, expect } from 'vitest'
import { groupVipItems, filterMegaGroups, countMegaGroups, megaCanPost, getMegaOrphans,
         isMainMega, filterMainMegaGroups, filterSmallMegaGroups, formatVipGroupTitle,
         getEffectiveRiskProfile } from './premiumHelpers.js'

// ── Test A ────────────────────────────────────────────────────────────────────
// 1 fullMega + 6 singles + 3 doubles + 2 triples sharing same method_group_id
describe('Test A — full VIP group structure', () => {
  const gid = 'grp-1'
  const fullMega = { method_group_id: gid, decomposition_level: 'full_mega' }
  const singles = Array.from({ length: 6 }, (_, i) => ({
    method_group_id: gid,
    decomposition_level: 'single_game',
    match: `M${i}`,
  }))
  const doubles = Array.from({ length: 3 }, (_, i) => ({
    method_group_id: gid,
    decomposition_level: 'double',
    match: `D${i}`,
  }))
  const triples = Array.from({ length: 2 }, (_, i) => ({
    method_group_id: gid,
    decomposition_level: 'triple',
    match: `T${i}`,
  }))
  // quadra should land in triples bucket (same as triple)
  const quadraItem = { method_group_id: gid, decomposition_level: 'quadra', match: 'Q0' }
  const all = [fullMega, ...singles, ...doubles, ...triples, quadraItem]

  test('filterMegaGroups returns 1 group (not 12)', () => {
    expect(filterMegaGroups(all).size).toBe(1)
  })

  test('countMegaGroups returns 1', () => {
    expect(countMegaGroups(all)).toBe(1)
  })

  test('group contains the correct fullMega item', () => {
    expect(filterMegaGroups(all).get(gid).fullMega).toBe(fullMega)
  })

  test('group contains all 6 singles', () => {
    expect(filterMegaGroups(all).get(gid).singles.length).toBe(6)
  })

  test('quadra item lands in triples bucket', () => {
    expect(filterMegaGroups(all).get(gid).triples.length).toBe(3)
  })
})

// ── Test B ────────────────────────────────────────────────────────────────────
// combo with combined_odd: 600 and decomposition_level: 'triple' — not a mega group
describe('Test B — jackpot combo with no full_mega is excluded', () => {
  const jackpotCombo = { method_group_id: 'grp-2', decomposition_level: 'triple', combined_odd: 600 }

  test('filterMegaGroups size is 0', () => {
    expect(filterMegaGroups([jackpotCombo]).size).toBe(0)
  })

  test('countMegaGroups returns 0', () => {
    expect(countMegaGroups([jackpotCombo])).toBe(0)
  })
})

// ── Test C ────────────────────────────────────────────────────────────────────
// fullMega with game_block_count: 18 appears in mega groups
describe('Test C — ultra mega appears in filterMegaGroups', () => {
  const ultraMega = {
    method_group_id: 'grp-3',
    decomposition_level: 'full_mega',
    game_block_count: 18,
    display_odd: '1.000.000x+',
    mega_size_tier: 'ultra',
  }

  test('filterMegaGroups size is 1', () => {
    expect(filterMegaGroups([ultraMega]).size).toBe(1)
  })

  test('game_block_count is preserved', () => {
    expect(filterMegaGroups([ultraMega]).get('grp-3').fullMega.game_block_count).toBe(18)
  })

  test('display_odd is preserved', () => {
    expect(filterMegaGroups([ultraMega]).get('grp-3').fullMega.display_odd).toBe('1.000.000x+')
  })
})

// ── Test D ────────────────────────────────────────────────────────────────────
// fullMega with ev_reliable: false and ev_pct: -99.99 → megaCanPost false
describe('Test D — ev_pct < 0 blocks posting even when ev_reliable is false', () => {
  const unreliableMega = {
    decomposition_level: 'full_mega',
    ev_reliable: false,
    ev_pct: -99.99,
  }

  test('megaCanPost returns false', () => {
    expect(megaCanPost(unreliableMega)).toBe(false)
  })
})

// ── Test E ────────────────────────────────────────────────────────────────────
// ev_pct edge cases and getMegaOrphans + hidden_reason
describe('Test E — megaCanPost ev_pct edge cases', () => {
  test('ev_pct: -5 → false', () => {
    expect(megaCanPost({ ev_pct: -5 })).toBe(false)
  })

  test('ev_pct: 0 → true', () => {
    expect(megaCanPost({ ev_pct: 0 })).toBe(true)
  })

  test('ev_pct: 12 → true', () => {
    expect(megaCanPost({ ev_pct: 12 })).toBe(true)
  })

  test('null fullMega → false', () => {
    expect(megaCanPost(null)).toBe(false)
  })

  test('ev_pct: null → false', () => {
    expect(megaCanPost({ ev_pct: null })).toBe(false)
  })
})

describe('Test E — getMegaOrphans', () => {
  const orphan = { combined_odd: 800, decomposition_level: 'triple' } // no method_group_id
  const grouped = { method_group_id: 'g1', decomposition_level: 'double' }

  test('returns only items with no method_group_id', () => {
    expect(getMegaOrphans([orphan, grouped]).length).toBe(1)
  })

  test('the orphan item is the correct object', () => {
    expect(getMegaOrphans([orphan, grouped])[0]).toBe(orphan)
  })
})

describe('Test E — hidden_reason skipped by groupVipItems', () => {
  const hidden = {
    method_group_id: 'g1',
    decomposition_level: 'full_mega',
    hidden_reason: 'mega_exceeds_sanity_limits',
  }

  test('groupVipItems returns empty map when only item has hidden_reason', () => {
    expect(groupVipItems([hidden]).size).toBe(0)
  })
})

// ── New Test A (polish) ────────────────────────────────────────────────────────
describe('Test A (polish) — isMainMega block count threshold (threshold = 4)', () => {
  test('fullMega with 2 blocks → not main mega (Jackpot VIP)', () => {
    expect(isMainMega({ game_block_count: 2 })).toBe(false)
  })
  test('fullMega with 3 blocks → not main mega (Jackpot VIP)', () => {
    expect(isMainMega({ game_block_count: 3 })).toBe(false)
  })
  test('fullMega with 4 blocks → IS main mega', () => {
    expect(isMainMega({ game_block_count: 4 })).toBe(true)
  })
  test('fullMega with 5 blocks → is main mega', () => {
    expect(isMainMega({ game_block_count: 5 })).toBe(true)
  })
  test('fullMega with 6 blocks → is main mega', () => {
    expect(isMainMega({ game_block_count: 6 })).toBe(true)
  })
  test('fullMega with 20 blocks → is main mega (no upper limit)', () => {
    expect(isMainMega({ game_block_count: 20 })).toBe(true)
  })
  test('fullMega with 27 blocks → is main mega (ultra, not hidden)', () => {
    expect(isMainMega({ game_block_count: 27 })).toBe(true)
  })
  test('fullMega with mega_size_tier standard (no block count) → is main mega', () => {
    expect(isMainMega({ mega_size_tier: 'standard' })).toBe(true)
  })
  test('fullMega with mega_size_tier ultra → is main mega', () => {
    expect(isMainMega({ mega_size_tier: 'ultra' })).toBe(true)
  })
  test('fullMega with is_displayable:false → not main mega', () => {
    expect(isMainMega({ game_block_count: 8, is_displayable: false })).toBe(false)
  })
  test('fullMega with hidden_reason → not main mega', () => {
    expect(isMainMega({ game_block_count: 8, hidden_reason: 'mega_exceeds_sanity_limits' })).toBe(false)
  })
  test('null fullMega → not main mega', () => {
    expect(isMainMega(null)).toBe(false)
  })
})

// ── New Test B (polish) ────────────────────────────────────────────────────────
describe('Test B (polish) — filterMainMegaGroups threshold = 4 blocks', () => {
  const jackpotVip = { method_group_id: 'g-jackpot', decomposition_level: 'full_mega', game_block_count: 3 }
  const borderMega = { method_group_id: 'g-border',  decomposition_level: 'full_mega', game_block_count: 4 }
  const mainMega   = { method_group_id: 'g-main',    decomposition_level: 'full_mega', game_block_count: 6 }
  const ultraMega  = { method_group_id: 'g-ultra',   decomposition_level: 'full_mega', game_block_count: 27 }

  test('3-block fullMega NOT in filterMainMegaGroups', () => {
    expect(filterMainMegaGroups([jackpotVip]).has('g-jackpot')).toBe(false)
  })
  test('4-block fullMega IS in filterMainMegaGroups (border case)', () => {
    expect(filterMainMegaGroups([borderMega]).has('g-border')).toBe(true)
  })
  test('6-block fullMega IS in filterMainMegaGroups', () => {
    expect(filterMainMegaGroups([mainMega]).has('g-main')).toBe(true)
  })
  test('27-block fullMega IS in filterMainMegaGroups (no upper limit)', () => {
    expect(filterMainMegaGroups([ultraMega]).has('g-ultra')).toBe(true)
  })
  test('3-block fullMega IS in filterSmallMegaGroups', () => {
    expect(filterSmallMegaGroups([jackpotVip]).has('g-jackpot')).toBe(true)
  })
  test('4-block fullMega NOT in filterSmallMegaGroups', () => {
    expect(filterSmallMegaGroups([borderMega]).has('g-border')).toBe(false)
  })
  test('27-block fullMega NOT in filterSmallMegaGroups', () => {
    expect(filterSmallMegaGroups([ultraMega]).has('g-ultra')).toBe(false)
  })
})

// ── New Test C (polish) ────────────────────────────────────────────────────────
describe('Test C (polish) — getEffectiveRiskProfile draw_btts override', () => {
  test('draw_btts_jackpot + conservative stored → returns aggressive', () => {
    expect(getEffectiveRiskProfile({ method_family: 'draw_btts_jackpot', risk_profile: 'conservative' })).toBe('aggressive')
  })
  test('draw_btts_jackpot + aggressive stored → still aggressive', () => {
    expect(getEffectiveRiskProfile({ method_family: 'draw_btts_jackpot', risk_profile: 'aggressive' })).toBe('aggressive')
  })
  test('other method + conservative → conservative', () => {
    expect(getEffectiveRiskProfile({ method_family: 'result_btts', risk_profile: 'conservative' })).toBe('conservative')
  })
  test('no method_family + aggressive risk → aggressive', () => {
    expect(getEffectiveRiskProfile({ risk_profile: 'aggressive' })).toBe('aggressive')
  })
})

// ── New Test D (polish) ────────────────────────────────────────────────────────
describe('Test D (polish) — orphan never in main mega groups', () => {
  const orphan = { combined_odd: 1500, decomposition_level: 'full_mega' } // no method_group_id

  test('orphan (no method_group_id) not in filterMainMegaGroups', () => {
    // groupVipItems skips items with no method_group_id, so no group exists
    expect(filterMainMegaGroups([orphan]).size).toBe(0)
  })
  test('orphan returned by getMegaOrphans', () => {
    expect(getMegaOrphans([orphan]).length).toBe(1)
  })
})

// ── New Test E (polish) ────────────────────────────────────────────────────────
describe('Test E (polish) — orphan with high odd does not count in main mega', () => {
  const orphan = { combined_odd: 2000, decomposition_level: 'triple' } // no method_group_id
  const mainMega = { method_group_id: 'g1', decomposition_level: 'full_mega', game_block_count: 8 }

  test('orphan is in getMegaOrphans', () => {
    expect(getMegaOrphans([orphan, mainMega])[0]).toBe(orphan)
  })
  test('filterMainMegaGroups only counts the main mega group (not orphan)', () => {
    expect(filterMainMegaGroups([orphan, mainMega]).size).toBe(1)
  })
})

// ── megaCanPost — ev_reliable=false blocks posting ────────────────────────────
describe('megaCanPost — ev_reliable=false blocks posting', () => {
  test('ev_reliable: false + ev_pct: 10 → cannot post', () => {
    expect(megaCanPost({ ev_reliable: false, ev_pct: 10 })).toBe(false)
  })
  test('ev_reliable: true + ev_pct: 5 → can post', () => {
    expect(megaCanPost({ ev_reliable: true, ev_pct: 5 })).toBe(true)
  })
  test('ev_reliable: undefined (absent) + ev_pct: 5 → can post', () => {
    expect(megaCanPost({ ev_pct: 5 })).toBe(true)
  })
})

// ── formatVipGroupTitle ───────────────────────────────────────────────────────
describe('formatVipGroupTitle — label mapping', () => {
  const makeGroup = (method_family, method_tag, source) => ({
    fullMega: { method_family, method_tag, source },
    singles: [], doubles: [], triples: [],
  })

  test('draw_btts_jackpot → DRAW + BTTS', () => {
    expect(formatVipGroupTitle(makeGroup('draw_btts_jackpot'))).toBe('DRAW + BTTS')
  })
  test('result_btts → FAIXA', () => {
    expect(formatVipGroupTitle(makeGroup('result_btts'))).toBe('FAIXA')
  })
  test('method_tag FAIXA → FAIXA', () => {
    expect(formatVipGroupTitle(makeGroup(null, 'vip_faixa_btts'))).toBe('FAIXA')
  })
  test('ht_shots_corners → HT METHOD', () => {
    expect(formatVipGroupTitle(makeGroup('ht_shots_corners'))).toBe('HT METHOD')
  })
  test('player_shots → CHUTES', () => {
    expect(formatVipGroupTitle(makeGroup('player_shots'))).toBe('CHUTES')
  })
  test('cards_2t → BINGO DOS CLÁSSICOS', () => {
    expect(formatVipGroupTitle(makeGroup('cards_2t'))).toBe('BINGO DOS CLÁSSICOS')
  })
  test('source BINGO → BINGO DOS CLÁSSICOS', () => {
    expect(formatVipGroupTitle(makeGroup(null, null, 'bingo_classicos'))).toBe('BINGO DOS CLÁSSICOS')
  })
  test('fallback: strips vip_ prefix from method_tag', () => {
    expect(formatVipGroupTitle(makeGroup(null, 'vip_custom_method'))).toBe('CUSTOM METHOD')
  })
  test('no item found → VIP', () => {
    expect(formatVipGroupTitle({ fullMega: null, singles: [], doubles: [], triples: [] })).toBe('VIP')
  })
  test('triples-only group uses triple item for title', () => {
    const group = { fullMega: null, singles: [], doubles: [], triples: [{ method_family: 'draw_btts_jackpot' }] }
    expect(formatVipGroupTitle(group)).toBe('DRAW + BTTS')
  })
})

// ── Spec Tests (mega limit removal) ──────────────────────────────────────────

describe('Spec Test A — 3-block fullMega → Jackpot VIP, not Mega', () => {
  const jackpotVipItem = { method_group_id: 'g-jvip', decomposition_level: 'full_mega', game_block_count: 3 }

  test('isMainMega returns false', () => {
    expect(isMainMega(jackpotVipItem)).toBe(false)
  })
  test('appears in filterSmallMegaGroups', () => {
    expect(filterSmallMegaGroups([jackpotVipItem]).has('g-jvip')).toBe(true)
  })
  test('does NOT appear in filterMainMegaGroups', () => {
    expect(filterMainMegaGroups([jackpotVipItem]).has('g-jvip')).toBe(false)
  })
})

describe('Spec Test B — 4-block fullMega → main Mega', () => {
  const mainItem = { method_group_id: 'g-4b', decomposition_level: 'full_mega', game_block_count: 4 }

  test('isMainMega returns true', () => {
    expect(isMainMega(mainItem)).toBe(true)
  })
  test('appears in filterMainMegaGroups', () => {
    expect(filterMainMegaGroups([mainItem]).has('g-4b')).toBe(true)
  })
  test('does NOT appear in filterSmallMegaGroups', () => {
    expect(filterSmallMegaGroups([mainItem]).has('g-4b')).toBe(false)
  })
})

describe('Spec Test C — 20-block fullMega → main Mega (no upper limit)', () => {
  const item = { method_group_id: 'g-20b', decomposition_level: 'full_mega', game_block_count: 20 }

  test('isMainMega returns true', () => {
    expect(isMainMega(item)).toBe(true)
  })
  test('appears in filterMainMegaGroups', () => {
    expect(filterMainMegaGroups([item]).has('g-20b')).toBe(true)
  })
})

describe('Spec Test D — 27-block fullMega → main Mega (ultra tier)', () => {
  const item = { method_group_id: 'g-27b', decomposition_level: 'full_mega', game_block_count: 27 }

  test('isMainMega returns true', () => {
    expect(isMainMega(item)).toBe(true)
  })
  test('appears in filterMainMegaGroups', () => {
    expect(filterMainMegaGroups([item]).has('g-27b')).toBe(true)
  })
  test('does NOT appear in filterSmallMegaGroups', () => {
    expect(filterSmallMegaGroups([item]).has('g-27b')).toBe(false)
  })
})

describe('Spec Test E — conservative + aggressive each with 4 blocks → 2 main megas', () => {
  const cons = { method_group_id: 'g-cons', decomposition_level: 'full_mega', game_block_count: 4, risk_profile: 'conservative' }
  const aggr = { method_group_id: 'g-aggr', decomposition_level: 'full_mega', game_block_count: 4, risk_profile: 'aggressive' }

  test('filterMainMegaGroups returns 2 groups', () => {
    expect(filterMainMegaGroups([cons, aggr]).size).toBe(2)
  })
  test('conservative group is present', () => {
    expect(filterMainMegaGroups([cons, aggr]).has('g-cons')).toBe(true)
  })
  test('aggressive group is present', () => {
    expect(filterMainMegaGroups([cons, aggr]).has('g-aggr')).toBe(true)
  })
})

describe('Spec Test F — conservative 10 blocks + aggressive 6 blocks', () => {
  const cons = { method_group_id: 'g-cons10', decomposition_level: 'full_mega', game_block_count: 10, risk_profile: 'conservative' }
  const aggr = { method_group_id: 'g-aggr6',  decomposition_level: 'full_mega', game_block_count: 6,  risk_profile: 'aggressive' }

  test('both qualify as main mega', () => {
    const groups = filterMainMegaGroups([cons, aggr])
    expect(groups.size).toBe(2)
  })
  test('conservative has 10 blocks', () => {
    const groups = filterMainMegaGroups([cons, aggr])
    expect(groups.get('g-cons10').fullMega.game_block_count).toBe(10)
  })
  test('aggressive has 6 blocks', () => {
    const groups = filterMainMegaGroups([cons, aggr])
    expect(groups.get('g-aggr6').fullMega.game_block_count).toBe(6)
  })
})

describe('Spec Test H — fullMega with is_displayable:false or hidden_reason → never main mega', () => {
  test('is_displayable false → not main mega', () => {
    expect(isMainMega({ game_block_count: 8, is_displayable: false })).toBe(false)
  })
  test('hidden_reason set → not main mega', () => {
    expect(isMainMega({ game_block_count: 8, hidden_reason: 'mega_exceeds_sanity_limits' })).toBe(false)
  })
  test('no hidden flags + 4 blocks → main mega', () => {
    expect(isMainMega({ game_block_count: 4, is_displayable: true })).toBe(true)
  })
})

import { filterByOddRange } from './premiumHelpers.js';

describe('filterByOddRange', () => {
  const items = [
    { combined_odd: 50 },     // cards
    { combined_odd: 500 },    // conservador
    { combined_odd: 5000 },   // conservador
    { combined_odd: 15000 },  // agressivo
  ];

  it('returns cards bucket (<100)', () => {
    expect(filterByOddRange(items, 'cards')).toHaveLength(1);
    expect(filterByOddRange(items, 'cards')[0].combined_odd).toBe(50);
  });

  it('returns conservador bucket (100-9999)', () => {
    const out = filterByOddRange(items, 'conservador');
    expect(out).toHaveLength(2);
    expect(out.map(i => i.combined_odd).sort((a, b) => a - b)).toEqual([500, 5000]);
  });

  it('returns agressivo bucket (>=10000)', () => {
    const out = filterByOddRange(items, 'agressivo');
    expect(out).toHaveLength(1);
    expect(out[0].combined_odd).toBe(15000);
  });

  it('returns all when range is unknown', () => {
    expect(filterByOddRange(items, 'whatever')).toHaveLength(4);
  });

  it('handles empty array', () => {
    expect(filterByOddRange([], 'cards')).toEqual([]);
  });
});
