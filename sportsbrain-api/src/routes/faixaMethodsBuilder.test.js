// faixaMethodsBuilder.test.js — F2.60
// Cobertura mínima do spec §8.1 (docs/superpowers/specs/2026-05-27-faixa-methods-tier-design.md).
//
// Rodar: npm test (vitest configurado em vitest.config.js)

import assert from 'assert'
import {
  _normMatchKey,
  _filterHtChutesLegs,
  _groupByMatch,
  _buildHtChutesCard,
  _classifyTier,
  _pickTopCombos,
  _isSuperOddLeg,
  _buildDerivedDuplas,
  buildHtChutes,
  buildFaixaResultBtts,
  buildResultadoCombos,
  buildSuperOdd,
  buildFaixaMethods,
  HT_CHUTES_DUPLAS_CAP,
} from './faixaMethodsBuilder.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    failed++
  }
}

// ── Fixture helpers ────────────────────────────────────────────────────────

function mkLeg(overrides = {}) {
  return {
    match: 'São Paulo v Sport',
    home_team: 'São Paulo',
    away_team: 'Sport',
    stat: 'ht_shots_home',
    market: 'Chutes 1º Tempo Mandante',
    direction: 'over',
    selection: 'Mais de 3.5',
    line: 3.5,
    odd: 1.8,
    prob: 0.65,
    ev_pct: 17.0,
    league: 'Brasileirão Série A',
    kickoff_iso: '2026-05-30T22:00:00Z',
    ...overrides,
  }
}

// 4 stats por match (ht_shots_home/away + ht_corners_home/away)
function mkHtMatch4(matchName, baseOdd = 1.7) {
  return [
    mkLeg({ match: matchName, home_team: matchName.split(' v ')[0], away_team: matchName.split(' v ')[1],
            stat: 'ht_shots_home',   market: 'Chutes 1º Tempo Mandante',   odd: baseOdd, prob: 0.62 }),
    mkLeg({ match: matchName, home_team: matchName.split(' v ')[0], away_team: matchName.split(' v ')[1],
            stat: 'ht_shots_away',   market: 'Chutes 1º Tempo Visitante',  odd: baseOdd, prob: 0.66 }),
    mkLeg({ match: matchName, home_team: matchName.split(' v ')[0], away_team: matchName.split(' v ')[1],
            stat: 'ht_corners_home', market: 'Escanteios 1º Tempo Mandante', odd: baseOdd + 0.05, prob: 0.70 }),
    mkLeg({ match: matchName, home_team: matchName.split(' v ')[0], away_team: matchName.split(' v ')[1],
            stat: 'ht_corners_away', market: 'Escanteios 1º Tempo Visitante', odd: baseOdd + 0.05, prob: 0.68 }),
  ]
}

// ── _normMatchKey ───────────────────────────────────────────────────────────

console.log('\n_normMatchKey:')

test('normaliza accent + case (Bolívar vs Bolivar)', () => {
  assert.strictEqual(_normMatchKey('Bolívar v Cerro Porteño'), _normMatchKey('Bolivar v Cerro Porteno'))
})

test('strings vazias retornam vazio', () => {
  assert.strictEqual(_normMatchKey(''), '')
  assert.strictEqual(_normMatchKey(null), '')
})

// ── _filterHtChutesLegs ─────────────────────────────────────────────────────

console.log('\n_filterHtChutesLegs:')

test('aceita stat ht_shots_home', () => {
  const out = _filterHtChutesLegs([mkLeg({ stat: 'ht_shots_home', odd: 1.7 })])
  assert.strictEqual(out.length, 1)
})

test('aceita label canonical "Chutes 1º Tempo · Casa"', () => {
  const out = _filterHtChutesLegs([mkLeg({ stat: 'Chutes 1º Tempo · Casa', odd: 1.7 })])
  assert.strictEqual(out.length, 1)
})

test('rejeita stat fora de HT (1X2)', () => {
  const out = _filterHtChutesLegs([mkLeg({ stat: '1X2', market: 'Resultado' })])
  assert.strictEqual(out.length, 0)
})

test('rejeita odd fora do range (odd 1.10 < 1.25)', () => {
  const out = _filterHtChutesLegs([mkLeg({ odd: 1.10 })])
  assert.strictEqual(out.length, 0)
})

test('rejeita odd > 4.0', () => {
  const out = _filterHtChutesLegs([mkLeg({ odd: 4.5 })])
  assert.strictEqual(out.length, 0)
})

test('aceita odd 1.25 (limite inferior F2.55)', () => {
  const out = _filterHtChutesLegs([mkLeg({ odd: 1.25 })])
  assert.strictEqual(out.length, 1)
})

test('rejeita liga tênis explicit', () => {
  const out = _filterHtChutesLegs([mkLeg({ league: 'ATP 250 Roland Garros' })])
  assert.strictEqual(out.length, 0)
})

test('F2.66: rejeita tennis por nome de jogador (sem league)', () => {
  const out = _filterHtChutesLegs([mkLeg({ league: '', match: 'Casper Ruud v Tommy Paul' })])
  assert.strictEqual(out.length, 0)
})

test('F2.66: rejeita Djokovic vs ATP players', () => {
  const out = _filterHtChutesLegs([mkLeg({ league: 'Tipster Telegram', match: 'Joao Fonseca v Novak Djokovic' })])
  assert.strictEqual(out.length, 0)
})

test('F2.66: rejeita WTA names (Muchova, Teichmann)', () => {
  const out = _filterHtChutesLegs([mkLeg({ league: '', match: 'Jil Teichmann v Karolina Muchova' })])
  assert.strictEqual(out.length, 0)
})

test('aceita quando league vazio (bet365 direct)', () => {
  const out = _filterHtChutesLegs([mkLeg({ league: '' })])
  assert.strictEqual(out.length, 1)
})

test('F2.61: aceita "finalização" como sinônimo de "chute"', () => {
  const out = _filterHtChutesLegs([mkLeg({ stat: 'Finalizações 1º Tempo Mandante', market: 'Finalizações 1ºT Casa' })])
  assert.strictEqual(out.length, 1)
})

test('F2.61: aceita ht_finaliz_home como variante', () => {
  const out = _filterHtChutesLegs([mkLeg({ stat: 'ht_finaliz_home' })])
  assert.strictEqual(out.length, 1)
})

// ── _classifyTier ───────────────────────────────────────────────────────────

console.log('\n_classifyTier:')

test('odd 50 → cards', () => {
  assert.strictEqual(_classifyTier(50), 'cards')
})

test('odd 99 → cards (limite superior <100)', () => {
  assert.strictEqual(_classifyTier(99), 'cards')
})

test('odd 100 → conservador (limite inferior)', () => {
  assert.strictEqual(_classifyTier(100), 'conservador')
})

test('odd 5000 → conservador', () => {
  assert.strictEqual(_classifyTier(5000), 'conservador')
})

test('odd 9999 → conservador', () => {
  assert.strictEqual(_classifyTier(9999), 'conservador')
})

test('odd 10000 → agressivo', () => {
  assert.strictEqual(_classifyTier(10000), 'agressivo')
})

test('odd inválido → cards (fallback)', () => {
  assert.strictEqual(_classifyTier(-1), 'cards')
  assert.strictEqual(_classifyTier(NaN), 'cards')
})

// ── _groupByMatch ───────────────────────────────────────────────────────────

console.log('\n_groupByMatch:')

test('agrupa legs do mesmo match', () => {
  const legs = mkHtMatch4('Flamengo v Palmeiras')
  const grouped = _groupByMatch(legs)
  assert.strictEqual(grouped.size, 1)
  assert.strictEqual([...grouped.values()][0].length, 4)
})

test('matches diferentes em buckets separados', () => {
  const legs = [
    ...mkHtMatch4('A v B'),
    ...mkHtMatch4('C v D'),
  ]
  const grouped = _groupByMatch(legs)
  assert.strictEqual(grouped.size, 2)
})

// ── _buildHtChutesCard ──────────────────────────────────────────────────────

console.log('\n_buildHtChutesCard:')

test('Card com 4 legs do mesmo match', () => {
  const card = _buildHtChutesCard(mkHtMatch4('Palmeiras v Flamengo'))
  assert.ok(card, 'card não-nulo')
  assert.strictEqual(card.legs.length, 4)
  assert.strictEqual(card.match, 'Palmeiras v Flamengo')
})

test('combined_odd = product(legs.odd)', () => {
  const legs = mkHtMatch4('A v B', 1.5)  // 1.5 × 1.5 × 1.55 × 1.55 = 5.405
  const card = _buildHtChutesCard(legs)
  assert.ok(Math.abs(card.combined_odd - 5.40) < 0.05, `combined_odd ${card.combined_odd}`)
})

test('aceita Card com 3 legs (1 market faltando)', () => {
  const card = _buildHtChutesCard(mkHtMatch4('A v B').slice(0, 3))
  assert.ok(card)
  assert.strictEqual(card.legs.length, 3)
})

test('rejeita Card <3 legs', () => {
  assert.strictEqual(_buildHtChutesCard(mkHtMatch4('A v B').slice(0, 2)), null)
})

test('legs vazia → null', () => {
  assert.strictEqual(_buildHtChutesCard([]), null)
  assert.strictEqual(_buildHtChutesCard(null), null)
})

test('tier_class atribuído', () => {
  const card = _buildHtChutesCard(mkHtMatch4('A v B'))
  assert.ok(['cards', 'conservador', 'agressivo'].includes(card.tier_class))
})

// ── buildHtChutes (orchestrator) ────────────────────────────────────────────

console.log('\nbuildHtChutes:')

test('pool vazio → arrays vazios', () => {
  const r = buildHtChutes([])
  assert.deepStrictEqual(r.cards, [])
  assert.deepStrictEqual(r.duplas, [])
  assert.deepStrictEqual(r.quadras, [])
})

test('1 match qualificado → 1 card, 0 duplas', () => {
  const r = buildHtChutes(mkHtMatch4('A v B'))
  assert.strictEqual(r.cards.length, 1)
  assert.strictEqual(r.duplas.length, 0)  // precisa de 2+ cards
})

test('2 matches → 2 cards + 1 dupla', () => {
  const pool = [...mkHtMatch4('A v B'), ...mkHtMatch4('C v D')]
  const r = buildHtChutes(pool)
  assert.strictEqual(r.cards.length, 2)
  assert.strictEqual(r.duplas.length, 1)
})

test('4 matches → 4 cards + duplas + 1 quadra', () => {
  const pool = [
    ...mkHtMatch4('A v B'), ...mkHtMatch4('C v D'),
    ...mkHtMatch4('E v F'), ...mkHtMatch4('G v H'),
  ]
  const r = buildHtChutes(pool)
  assert.strictEqual(r.cards.length, 4)
  assert.ok(r.duplas.length >= 1)
  assert.strictEqual(r.quadras.length, 1)  // C(4,2)=6 mas cap 10, C(4,4)=1
})

test('match com 2 legs HT é descartado', () => {
  const pool = [
    ...mkHtMatch4('A v B').slice(0, 2),  // só 2 legs
    ...mkHtMatch4('C v D'),
  ]
  const r = buildHtChutes(pool)
  assert.strictEqual(r.cards.length, 1)  // só C v D entra
})

// ── _pickTopCombos cross-match ──────────────────────────────────────────────

console.log('\n_pickTopCombos:')

test('NUNCA combina 2 cards do mesmo match', () => {
  const cards = [
    { card_id: 'a', match: 'A v B', combined_odd: 5, combined_prob: 0.4, ev_pct: 100, legs: [] },
    { card_id: 'b', match: 'A v B', combined_odd: 5, combined_prob: 0.4, ev_pct: 100, legs: [] },
  ]
  const duplas = _pickTopCombos(cards, 2, 10)
  assert.strictEqual(duplas.length, 0)  // mesmo match → rejeitado
})

test('combina 2 cards de matches diferentes', () => {
  const cards = [
    { card_id: 'a', match: 'A v B', combined_odd: 5, combined_prob: 0.4, ev_pct: 100, legs: [] },
    { card_id: 'b', match: 'C v D', combined_odd: 5, combined_prob: 0.4, ev_pct: 100, legs: [] },
  ]
  const duplas = _pickTopCombos(cards, 2, 10)
  assert.strictEqual(duplas.length, 1)
})

test('cap em N duplas top-prob', () => {
  const cards = Array.from({ length: 10 }, (_, i) => ({
    card_id: `c${i}`, match: `Team${i} v Other${i}`, combined_odd: 5, combined_prob: 0.5 - i * 0.03,
    ev_pct: 100 - i * 10, legs: [],
  }))
  const duplas = _pickTopCombos(cards, 2, HT_CHUTES_DUPLAS_CAP)
  assert.ok(duplas.length <= HT_CHUTES_DUPLAS_CAP)
})

// ── buildFaixaResultBtts ────────────────────────────────────────────────────

console.log('\nbuildFaixaResultBtts:')

test('Card com 1 leg Resultado + 1 leg BTTS', () => {
  const pool = [
    mkLeg({ match: 'A v B', stat: '1X2', market: 'Resultado', direction: 'home', selection: 'A Vence', odd: 1.7, prob: 0.5 }),
    mkLeg({ match: 'A v B', stat: 'BTTS', market: 'Ambos Marcam', direction: 'yes', selection: 'Sim', odd: 2.0, prob: 0.5 }),
  ]
  const r = buildFaixaResultBtts(pool)
  assert.ok(r.cards.length >= 1)
  assert.strictEqual(r.cards[0].n_legs, 2)
})

test('skip match sem leg Resultado', () => {
  const pool = [
    mkLeg({ match: 'A v B', stat: 'BTTS', direction: 'yes', selection: 'Sim', odd: 2.0 }),
  ]
  const r = buildFaixaResultBtts(pool)
  assert.strictEqual(r.cards.length, 0)
})

test('skip seleção Empate no leg result', () => {
  const pool = [
    mkLeg({ match: 'A v B', stat: '1X2', market: 'Resultado', direction: 'draw', selection: 'Empate', odd: 3.5, prob: 0.3 }),
    mkLeg({ match: 'A v B', stat: 'BTTS', direction: 'yes', selection: 'Sim', odd: 2.0, prob: 0.5 }),
  ]
  const r = buildFaixaResultBtts(pool)
  assert.strictEqual(r.cards.length, 0)  // empate filtrado
})

// ── buildResultadoCombos (CONMEBOL/major football 1X2) ─────────────────────

console.log('\nbuildResultadoCombos:')

test('aceita 1X2 home não-empate em major football', () => {
  const pool = [
    mkLeg({ match: 'A v B', stat: '1X2', market: 'Resultado', direction: 'home', selection: 'A Vence', odd: 1.7, prob: 0.55,
            league: 'CONMEBOL Libertadores' }),
  ]
  const r = buildResultadoCombos(pool)
  assert.strictEqual(r.cards.length, 1)
})

test('skip Empate', () => {
  const pool = [
    mkLeg({ match: 'A v B', stat: '1X2', direction: 'draw', selection: 'Empate', odd: 3.5, prob: 0.25,
            league: 'Brasileirão Série A' }),
  ]
  const r = buildResultadoCombos(pool)
  assert.strictEqual(r.cards.length, 0)
})

test('skip liga fora da whitelist FUTEBOL_TOP', () => {
  const pool = [
    mkLeg({ match: 'A v B', stat: '1X2', direction: 'home', selection: 'A Vence', odd: 1.7, prob: 0.55,
            league: 'WTA Wimbledon' }),
  ]
  const r = buildResultadoCombos(pool)
  assert.strictEqual(r.cards.length, 0)
})

// ── _buildDerivedDuplas (F2.63 cobertura mãe) ─────────────────────────────

console.log('\n_buildDerivedDuplas (cobertura mãe):')

test('gera 6 sub-duplas de uma quadra (C(4,2))', () => {
  const quadra = [
    { card_id: 'a', match: 'A v B', combined_odd: 2, combined_prob: 0.5 },
    { card_id: 'b', match: 'C v D', combined_odd: 2, combined_prob: 0.5 },
    { card_id: 'c', match: 'E v F', combined_odd: 2, combined_prob: 0.5 },
    { card_id: 'd', match: 'G v H', combined_odd: 2, combined_prob: 0.5 },
  ]
  const duplas = _buildDerivedDuplas(quadra)
  assert.strictEqual(duplas.length, 6)
})

test('sub-duplas contêm card_ids', () => {
  const quadra = [
    { card_id: 'card1', match: 'A v B', combined_odd: 2, combined_prob: 0.5 },
    { card_id: 'card2', match: 'C v D', combined_odd: 3, combined_prob: 0.3 },
    { card_id: 'card3', match: 'E v F', combined_odd: 4, combined_prob: 0.2 },
    { card_id: 'card4', match: 'G v H', combined_odd: 5, combined_prob: 0.15 },
  ]
  const duplas = _buildDerivedDuplas(quadra)
  duplas.forEach(d => {
    assert.strictEqual(d.card_ids.length, 2)
    assert.ok(['card1','card2','card3','card4'].includes(d.card_ids[0]))
  })
})

test('combined_odd = produto das 2 cards', () => {
  const quadra = [
    { card_id: 'a', match: 'A v B', combined_odd: 2, combined_prob: 0.5 },
    { card_id: 'b', match: 'C v D', combined_odd: 3, combined_prob: 0.3 },
    { card_id: 'c', match: 'E v F', combined_odd: 4, combined_prob: 0.2 },
    { card_id: 'd', match: 'G v H', combined_odd: 5, combined_prob: 0.15 },
  ]
  const duplas = _buildDerivedDuplas(quadra)
  // Top dupla por prob = (a,b) prob 0.15, odd 2×3=6
  assert.ok(duplas.some(d => Math.abs(d.combined_odd - 6) < 0.01))
  assert.ok(duplas.some(d => Math.abs(d.combined_odd - 20) < 0.01))  // c×d
})

test('quadraCards != 4 → array vazio', () => {
  assert.deepStrictEqual(_buildDerivedDuplas([]), [])
  assert.deepStrictEqual(_buildDerivedDuplas([{ card_id: 'x' }]), [])
  assert.deepStrictEqual(_buildDerivedDuplas(null), [])
})

test('quadras retornadas têm derived_duplas (integração)', () => {
  const cards = Array.from({ length: 4 }, (_, i) => ({
    card_id: `c${i}`, match: `Team${i} v Other${i}`, combined_odd: 5, combined_prob: 0.4 - i * 0.05,
    ev_pct: 100 - i * 10, legs: [],
  }))
  const quadras = _pickTopCombos(cards, 4, 10)
  assert.ok(quadras.length >= 1)
  assert.ok(Array.isArray(quadras[0].derived_duplas))
  assert.strictEqual(quadras[0].derived_duplas.length, 6)
})

// ── buildSuperOdd (F2.62) ─────────────────────────────────────────────────

console.log('\nbuildSuperOdd:')

test('aceita pick com _is_boost=true', () => {
  assert.strictEqual(_isSuperOddLeg(mkLeg({ _is_boost: true })), true)
})

test('aceita pick com source="boosts"', () => {
  assert.strictEqual(_isSuperOddLeg(mkLeg({ source: 'boosts' })), true)
})

test('aceita pick com market "Aposta Aumentada"', () => {
  assert.strictEqual(_isSuperOddLeg(mkLeg({ market: 'Aposta Aumentada · Crie sua Aposta' })), true)
})

test('aceita pick com market "Super Odd"', () => {
  assert.strictEqual(_isSuperOddLeg(mkLeg({ market: 'Super Odd boost' })), true)
})

test('aceita selection "Odd Turbinada"', () => {
  assert.strictEqual(_isSuperOddLeg(mkLeg({ market: 'Resultado', selection: 'Odd Turbinada' })), true)
})

test('rejeita pick comum sem marker boost', () => {
  assert.strictEqual(_isSuperOddLeg(mkLeg({ market: 'Resultado Final', source: 'ours' })), false)
})

test('pool sem boostadas → cards vazio', () => {
  const r = buildSuperOdd([mkLeg(), mkLeg({ match: 'C v D' })])
  assert.strictEqual(r.cards.length, 0)
})

test('1 pick boostada → 1 card', () => {
  const r = buildSuperOdd([mkLeg({ market: 'Aposta Aumentada', odd: 2.5, prob: 0.6 })])
  assert.strictEqual(r.cards.length, 1)
  assert.strictEqual(r.cards[0].n_legs, 1)
  assert.strictEqual(r.cards[0].method, 'superodd')
})

test('dedup picks duplicadas mesmo match+market', () => {
  const pool = [
    mkLeg({ match: 'A v B', _is_boost: true, market: 'Boost X', odd: 2.0, prob: 0.5, ev_pct: 0 }),
    mkLeg({ match: 'A v B', _is_boost: true, market: 'Boost X', odd: 2.0, prob: 0.6, ev_pct: 20 }),
  ]
  const r = buildSuperOdd(pool)
  assert.strictEqual(r.cards.length, 1)
  assert.ok(r.cards[0].ev_pct >= 20, 'mantém a com melhor EV')
})

test('rejeita odd fora do range', () => {
  const r = buildSuperOdd([mkLeg({ _is_boost: true, odd: 1.2 })])
  assert.strictEqual(r.cards.length, 0)
})

// ── Integration: buildFaixaMethods ───────────────────────────────────────────

console.log('\nbuildFaixaMethods:')

test('estrutura completa com keys esperadas', () => {
  const r = buildFaixaMethods([], [])
  assert.ok('ht_chutes' in r)
  assert.ok('faixa_result_btts' in r)
  assert.ok('chutes' in r)
  assert.ok('libertadores' in r)
  assert.ok('resultado' in r)
  assert.ok('superodd' in r)
})

test('annotatedWithAll vazio → todas as estruturas vazias', () => {
  const r = buildFaixaMethods(null, null)
  assert.deepStrictEqual(r.ht_chutes.cards, [])
  assert.deepStrictEqual(r.faixa_result_btts.cards, [])
})

test('pool com 1 match → ht_chutes 1 card, faixa_result_btts 1 card (se houver legs)', () => {
  const pool = [
    ...mkHtMatch4('A v B'),
    mkLeg({ match: 'A v B', stat: '1X2', market: 'Resultado', direction: 'home', selection: 'A Vence', odd: 1.7, prob: 0.55 }),
    mkLeg({ match: 'A v B', stat: 'BTTS', direction: 'yes', selection: 'Sim', odd: 2.0, prob: 0.5 }),
  ]
  const r = buildFaixaMethods(pool, [])
  assert.strictEqual(r.ht_chutes.cards.length, 1)
  assert.ok(r.faixa_result_btts.cards.length >= 1)
})

// ── Edge cases ───────────────────────────────────────────────────────────────

console.log('\nEdge cases:')

test('leg sem odd → skip', () => {
  const out = _filterHtChutesLegs([mkLeg({ odd: null })])
  assert.strictEqual(out.length, 0)
})

test('leg sem match → skip', () => {
  const out = _filterHtChutesLegs([mkLeg({ match: null })])
  assert.strictEqual(out.length, 0)
})

test('leg sem prob → skip', () => {
  const out = _filterHtChutesLegs([mkLeg({ prob: null })])
  assert.strictEqual(out.length, 0)
})

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
