// telegramTemplates.test.js — F2.64
import assert from 'assert'
import {
  generateHtChutesText,
  generateFaixaResultBttsText,
  generateChutesText,
  generateFutebolTopText,
  generateSuperOddText,
  generateDuplaText,
  generateQuadraText,
  generateTelegramText,
  withTelegramTemplates,
} from './telegramTemplates.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++ }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++ }
}

function mkCard(method, overrides = {}) {
  return {
    card_id: 'test-1',
    method,
    match: 'Cruzeiro v Barcelona SC',
    kickoff_iso: '2026-05-30T22:00:00Z',
    legs: [
      { match: 'Cruzeiro v Barcelona SC', stat: 'ht_shots_home', selection: 'Mais 3.5 chutes 1ºT', odd: 1.7, prob: 0.65 },
    ],
    combined_odd: 1.7,
    combined_prob: 0.65,
    ev_pct: 10.5,
    ...overrides,
  }
}

console.log('\ngenerateHtChutesText:')
test('inclui emoji HT-CHUTES + match + odd combinada', () => {
  const card = mkCard('ht_chutes', {
    legs: [
      { match: 'Cruzeiro v Barcelona SC', stat: 'ht_shots_home', selection: 'Casa 3.5 chutes 1ºT', odd: 1.5, prob: 0.7 },
      { match: 'Cruzeiro v Barcelona SC', stat: 'ht_shots_away', selection: 'Fora 3.5 chutes 1ºT', odd: 1.5, prob: 0.7 },
      { match: 'Cruzeiro v Barcelona SC', stat: 'ht_corners_home', selection: 'Casa 2.5 esc 1ºT', odd: 1.4, prob: 0.75 },
      { match: 'Cruzeiro v Barcelona SC', stat: 'ht_corners_away', selection: 'Fora 2.5 esc 1ºT', odd: 1.4, prob: 0.75 },
    ],
    combined_odd: 4.41, combined_prob: 0.276, ev_pct: 21.7,
  })
  const t = generateHtChutesText(card)
  assert.ok(t.includes('HT-CHUTES'))
  assert.ok(t.includes('Cruzeiro v Barcelona SC'))
  assert.ok(t.includes('4 legs'))
  assert.ok(t.includes('4.41'))
  assert.ok(t.includes('28%'))
})

test('card null → string vazia', () => {
  assert.strictEqual(generateHtChutesText(null), '')
})

console.log('\ngenerateFaixaResultBttsText:')
test('inclui resultado + BTTS legs', () => {
  const card = mkCard('faixa_result_btts', {
    legs: [
      { match: 'A v B', stat: '1X2', direction: 'home', selection: 'A Vence', odd: 1.7, prob: 0.55 },
      { match: 'A v B', stat: 'BTTS', direction: 'yes', selection: 'Sim', odd: 2.0, prob: 0.5 },
    ],
    combined_odd: 3.4, combined_prob: 0.275, ev_pct: -6.5,
  })
  const t = generateFaixaResultBttsText(card)
  assert.ok(t.includes('FAIXA RESULT+BTTS'))
  assert.ok(t.includes('Resultado'))
  assert.ok(t.includes('Ambos Marcam'))
})

console.log('\ngenerateChutesText:')
test('inclui nome do player + média', () => {
  const card = mkCard('chutes', {
    player_name: 'Andrés Gómez',
    legs: [
      { team: 'Vasco', match: 'Vasco v Santos', selection: 'Mais de 1.5 chutes', odd: 1.7, prob: 0.62,
        analysis: 'Média 2.5 chutes/jogo (n=16)' },
    ],
  })
  const t = generateChutesText(card)
  assert.ok(t.includes('Andrés Gómez'))
  assert.ok(t.includes('Vasco'))
  assert.ok(t.includes('Mais de 1.5 chutes'))
})

console.log('\ngenerateFutebolTopText:')
test('label customizável', () => {
  const card = mkCard('libertadores', {
    legs: [
      { stat: '1X2', selection: 'A Vence', odd: 1.7, prob: 0.55 },
      { stat: 'BTTS', selection: 'Sim', odd: 2.0, prob: 0.5 },
    ],
    combined_odd: 3.4, combined_prob: 0.275, ev_pct: -6.5,
  })
  const t = generateFutebolTopText(card, 'FUTEBOL TOP')
  assert.ok(t.includes('FUTEBOL TOP'))
})

console.log('\ngenerateSuperOddText:')
test('inclui hint de stake max', () => {
  const card = mkCard('superodd', {
    legs: [{ market: 'Aposta Aumentada', selection: 'Combo X', odd: 2.5, prob: 0.45 }],
  })
  const t = generateSuperOddText(card)
  assert.ok(t.includes('SUPER ODD'))
  assert.ok(t.includes('2.50'))
  assert.ok(t.includes('Stake'))
})

console.log('\ngenerateDuplaText:')
test('2 matches diferentes', () => {
  const dupla = {
    cards: [
      { match: 'A v B', combined_odd: 2.0, combined_prob: 0.5 },
      { match: 'C v D', combined_odd: 1.5, combined_prob: 0.7 },
    ],
    combined_odd: 3.0, combined_prob: 0.35, ev_pct: 5,
  }
  const t = generateDuplaText(dupla, 'DUPLA TESTE')
  assert.ok(t.includes('DUPLA TESTE'))
  assert.ok(t.includes('A v B'))
  assert.ok(t.includes('C v D'))
})

console.log('\ngenerateQuadraText:')
test('4 matches + cobertura mãe hint', () => {
  const quadra = {
    cards: [
      { match: 'A v B', combined_odd: 2, combined_prob: 0.5 },
      { match: 'C v D', combined_odd: 2, combined_prob: 0.5 },
      { match: 'E v F', combined_odd: 2, combined_prob: 0.5 },
      { match: 'G v H', combined_odd: 2, combined_prob: 0.5 },
    ],
    combined_odd: 16, combined_prob: 0.0625, ev_pct: 0,
    derived_duplas: Array(6).fill({ card_ids: ['x','y'] }),
  }
  const t = generateQuadraText(quadra)
  assert.ok(t.includes('QUADRA'))
  assert.ok(t.includes('Cobertura mãe'))
  assert.ok(t.includes('6'))
})

console.log('\ngenerateTelegramText (dispatcher):')
test('dispatch por method para HT-CHUTES', () => {
  const card = mkCard('ht_chutes', { legs: Array(4).fill({ selection: 'X', odd: 1.5, prob: 0.7 }) })
  const t = generateTelegramText(card)
  assert.ok(t.includes('HT-CHUTES'))
})

test('dispatch dupla por cards.length === 2', () => {
  const dupla = {
    cards: [
      { match: 'A v B', combined_odd: 2, combined_prob: 0.5 },
      { match: 'C v D', combined_odd: 2, combined_prob: 0.5 },
    ],
    combined_odd: 4, combined_prob: 0.25, ev_pct: 0,
  }
  const t = generateTelegramText(dupla)
  assert.ok(t.includes('DUPLA'))
})

console.log('\nwithTelegramTemplates:')
test('enriquece todos os cards com telegram_text', () => {
  const fm = {
    ht_chutes: { cards: [mkCard('ht_chutes')], duplas: [], quadras: [] },
    chutes:    { cards: [mkCard('chutes')], duplas: [], triplas: [], quadras: [] },
  }
  const out = withTelegramTemplates(fm)
  assert.ok(out.ht_chutes.cards[0].telegram_text)
  assert.ok(out.chutes.cards[0].telegram_text)
  assert.ok(out.ht_chutes.cards[0].telegram_text.includes('HT-CHUTES'))
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
