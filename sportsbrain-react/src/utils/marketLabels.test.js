// marketLabels.test.js — P3.9 R6K-B
// Cobre o fix de label para 1X2/RESULT (de "Vencedor da Partida" → "Resultado Final").
// Razão: 1X2 inclui home/draw/away — chamar de "Vencedor" era semanticamente
// errado quando a seleção é Empate (21 ocorrências em payload pré-fix).

import { describe, it, expect } from 'vitest'
import { marketToPT, directionToPT, pickLabel } from './marketLabels.js'

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-B — marketToPT — 1X2/RESULT mapeia para "Resultado Final"', () => {
  it('1X2 → Resultado Final', () => {
    expect(marketToPT('1X2')).toBe('Resultado Final')
  })

  it('RESULT → Resultado Final', () => {
    expect(marketToPT('RESULT')).toBe('Resultado Final')
  })

  it('Match Result (Bet365 raw) → Resultado Final', () => {
    expect(marketToPT('Match Result')).toBe('Resultado Final')
  })

  it('Resultado Final (já em PT) → Resultado Final (idempotente)', () => {
    expect(marketToPT('Resultado Final')).toBe('Resultado Final')
  })

  it('Vencedor da Partida (label legacy) → Resultado Final (backward compat)', () => {
    // Cobre o caso onde rows persistidas em D1 ainda têm a label antiga.
    // O frontend formatter normaliza para o novo padrão.
    expect(marketToPT('Vencedor da Partida')).toBe('Resultado Final')
  })

  it('1X2_ADJ continua "Resultado Final (Ajustado)"', () => {
    expect(marketToPT('1X2_ADJ')).toBe('Resultado Final (Ajustado)')
  })

  it('NÃO usa mais "Vencedor da Partida"', () => {
    // Defensive: nenhum input deve produzir a label antiga
    const inputs = ['1X2', 'RESULT', 'Match Result', 'Resultado Final',
                    'Vencedor da Partida', '1X2_ADJ']
    for (const input of inputs) {
      expect(marketToPT(input)).not.toBe('Vencedor da Partida')
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-B — outros markets continuam corretos (sem regressão)', () => {
  it('BTTS → Ambos Marcam', () => {
    expect(marketToPT('BTTS')).toBe('Ambos Marcam')
  })

  it('Both Teams to Score → Ambos Marcam', () => {
    expect(marketToPT('Both Teams to Score')).toBe('Ambos Marcam')
  })

  it('TOTAL_GOALS → Total de Gols', () => {
    expect(marketToPT('TOTAL_GOALS')).toBe('Total de Gols')
  })

  it('DOUBLE_CHANCE → Chance Dupla', () => {
    expect(marketToPT('DOUBLE_CHANCE')).toBe('Chance Dupla')
  })

  it('CORRECT_SCORE → Resultado Correto (preserved)', () => {
    expect(marketToPT('CORRECT_SCORE')).toBe('Resultado Correto')
  })

  it('DRAW_NO_BET → Empate Anula Aposta', () => {
    expect(marketToPT('DRAW_NO_BET')).toBe('Empate Anula Aposta')
  })

  it('HT_FT → Intervalo / Final', () => {
    expect(marketToPT('HT_FT')).toBe('Intervalo / Final')
  })

  it('TOTAL_POINTS → Total de Pontos', () => {
    expect(marketToPT('TOTAL_POINTS')).toBe('Total de Pontos')
  })

  it('null/undefined → "Pick" (fallback)', () => {
    expect(marketToPT(null)).toBe('Pick')
    expect(marketToPT(undefined)).toBe('Pick')
  })

  it('mercado desconhecido retorna a própria string', () => {
    expect(marketToPT('SOME_UNKNOWN_MARKET')).toBe('SOME_UNKNOWN_MARKET')
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-B — pickLabel: composição final usuário-facing', () => {
  it('1X2 + draw produz "Resultado Final: Empate" (não "Vencedor da Partida: Empate")', () => {
    const pick = {
      market: '1X2',
      direction: 'draw',
      home_team: 'San Lorenzo',
      away_team: 'Deportivo Recoleta',
    }
    expect(pickLabel(pick)).toBe('Resultado Final: Empate')
  })

  it('1X2 + home produz "Resultado Final: San Lorenzo Vence"', () => {
    const pick = {
      market: '1X2',
      direction: 'home',
      home_team: 'San Lorenzo',
      away_team: 'Deportivo Recoleta',
    }
    expect(pickLabel(pick)).toBe('Resultado Final: San Lorenzo Vence')
  })

  it('1X2 + away produz "Resultado Final: Deportivo Recoleta Vence"', () => {
    const pick = {
      market: '1X2',
      direction: 'away',
      home_team: 'San Lorenzo',
      away_team: 'Deportivo Recoleta',
    }
    expect(pickLabel(pick)).toBe('Resultado Final: Deportivo Recoleta Vence')
  })

  it('label antiga "Vencedor da Partida" persistida em pick é normalizada', () => {
    const pick = {
      market: 'Vencedor da Partida',  // legacy persistido
      direction: 'draw',
      home_team: 'A',
      away_team: 'B',
    }
    expect(pickLabel(pick)).toBe('Resultado Final: Empate')
  })

  it('BTTS continua sem regressão', () => {
    const pick = { market: 'BTTS', direction: 'yes' }
    expect(pickLabel(pick)).toBe('Ambos Marcam: Sim')
  })

  it('TOTAL_GOALS Over preservado', () => {
    const pick = { market: 'TOTAL_GOALS', direction: 'over', line: 2.5 }
    expect(pickLabel(pick)).toBe('Total de Gols: Mais de 2.5')
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('R6K-B — directionToPT (preservado, sem mudança nesta fase)', () => {
  it('draw → Empate', () => {
    expect(directionToPT({ direction: 'draw' })).toBe('Empate')
  })

  it('x → Empate', () => {
    expect(directionToPT({ direction: 'x' })).toBe('Empate')
  })

  it('home com home_team renderiza nome do time', () => {
    expect(directionToPT({ direction: 'home', home_team: 'Flamengo' }))
      .toBe('Flamengo Vence')
  })

  it('home sem home_team → "Casa Vence"', () => {
    expect(directionToPT({ direction: 'home' })).toBe('Casa Vence')
  })

  it('away com away_team renderiza nome do time', () => {
    expect(directionToPT({ direction: 'away', away_team: 'Palmeiras' }))
      .toBe('Palmeiras Vence')
  })
})
