// ═══════════════════════════════════════════════════════════════════════════
// marketLabels.js — Tradução PT-BR de markets/directions Bet365
// USAR EM TODOS os lugares que mostram pick/leg pra usuário final
// (Premium.jsx, Combos.jsx, Banca365.jsx, Telegram.jsx, etc)
// ═══════════════════════════════════════════════════════════════════════════

export function marketToPT(m) {
  if (!m) return 'Pick'
  const s = String(m)
  if (/^CORNERS_OU$|^Total Corners FT$|Corners?\s+Mais|escanteio/i.test(s)) return 'Escanteios'
  if (/^Total Corners HT$/i.test(s)) return 'Escanteios 1º Tempo'
  if (/^TOTAL_GOALS$|^Total Goals$|^Total Gols/i.test(s)) return 'Total de Gols'
  if (/^GOALS_RANGE/i.test(s)) return 'Faixa de Gols'
  if (/^BTTS$|^Both Teams to Score$|Ambos\s+Marcam/i.test(s)) return 'Ambos Marcam'
  if (/^DOUBLE_CHANCE$|^Double Chance$|Chance\s+Dupla/i.test(s)) return 'Chance Dupla'
  // P3.9 R6K-B: 1X2 inclui home/draw/away. "Vencedor da Partida" era confuso
  // quando selection=Empate. "Resultado Final" é neutro. Regex captura tanto
  // o backend label novo "Resultado Final" quanto o legacy "Vencedor..." e
  // os Bet365 originais "Match Result", "1X2", "RESULT".
  if (/^1X2$|^RESULT$|^Match Result|Resultado\s+Final|Vencedor\s+da\s+Partida/i.test(s)) return 'Resultado Final'
  if (/^DRAW_NO_BET$|Draw No Bet|Empate Anula/i.test(s)) return 'Empate Anula Aposta'
  if (/^HANDICAP$/i.test(s)) return 'Handicap Asiático'
  if (/^PLAYER_SHOTS_ON_TARGET$/i.test(s)) return 'Chutes a Gol do Jogador'
  if (/^PLAYER_SHOTS$/i.test(s)) return 'Chutes do Jogador'
  if (/^PLAYER_FOULS$/i.test(s)) return 'Faltas do Jogador'
  if (/^PLAYER_TACKLES$/i.test(s)) return 'Desarmes do Jogador'
  if (/^PLAYER_CARDS$/i.test(s)) return 'Cartões do Jogador'
  if (/^PLAYER_HEADERS$/i.test(s)) return 'Cabeceios do Jogador'
  if (/^TOTAL_POINTS$|^Total Points$/i.test(s)) return 'Total de Pontos'
  if (/^CORRECT_SCORE/i.test(s)) return 'Resultado Correto'
  if (/^HT_FT|HTFT/i.test(s)) return 'Intervalo / Final'
  if (/^Total Cards$/i.test(s)) return 'Total de Cartões'
  if (/^Total Shots/i.test(s)) return 'Total de Chutes'
  // EXAUSTIVO — todos market types Bet365
  if (/^CORRECT_SCORE$|^Placar Exato$/i.test(s)) return 'Placar Exato'
  if (/^CORRECT_SCORE_HT$|Placar Exato.*1[ºo]/i.test(s)) return 'Placar Exato (1º Tempo)'
  if (/^HT_FT|^Intervalo.*Final/i.test(s)) return 'Intervalo / Final'
  if (/^GOALS_RANGE$|Faixa de Gols$/i.test(s)) return 'Faixa de Gols'
  if (/^TEAM_GOALS_RANGE/i.test(s)) return 'Faixa de Gols (por Time)'
  if (/^GOALS_RANGE_HT1/i.test(s)) return 'Faixa de Gols (1º Tempo)'
  if (/^GOALS_RANGE_HT2/i.test(s)) return 'Faixa de Gols (2º Tempo)'
  if (/^RESULT_GOALS_RANGE/i.test(s)) return 'Resultado + Faixa de Gols'
  if (/^DOUBLE_CHANCE_GOALS_RANGE/i.test(s)) return 'Chance Dupla + Faixa de Gols'
  if (/^PLAYER_SCORE_OR_ASSIST/i.test(s)) return 'Jogador Marca ou Assiste'
  if (/^PLAYER_SCORE$/i.test(s)) return 'Jogador Marca'
  if (/^PLAYER_CARDS/i.test(s)) return 'Jogador Cartão'
  if (/^PLAYER_SHOTS_OUTSIDE_BOX/i.test(s)) return 'Chutes Fora da Área'
  if (/^PLAYER_FOULS_DRAWN/i.test(s)) return 'Faltas Sofridas'
  if (/^BOTH_TEAMS_CARDED/i.test(s)) return 'Ambos Times Levam Cartão'
  if (/^DRAW_NO_BET|Empate Anula/i.test(s)) return 'Empate Anula Aposta'
  if (/^1X2_ADJ$/i.test(s)) return 'Resultado Final (Ajustado)'
  if (/^NBA_DOUBLE_RESULT/i.test(s)) return 'NBA · Resultado Duplo'
  if (/^NBA_GAME_LINES/i.test(s)) return 'NBA · Linhas do Jogo'
  if (/^NBA_HALF1/i.test(s)) return 'NBA · 1º Tempo'
  if (/^NBA_QUARTER/i.test(s)) return 'NBA · Quarto'
  if (/^NBA_TEAM_TOTALS/i.test(s)) return 'NBA · Total por Time'
  if (/^NBA_FIRST_BASKET/i.test(s)) return 'NBA · Primeira Cesta'
  if (/^NBA_WINNING_MARGIN/i.test(s)) return 'NBA · Margem de Vitória'
  return s
}

// Direction → texto humano específico ao contexto
// pick = { direction, line, home_team, away_team, market, player_name, team }
export function directionToPT(pick) {
  if (!pick) return ''
  const dir = (pick.direction || '').toLowerCase()
  const home = pick.home_team || ''
  const away = pick.away_team || ''
  const isBtts = /^BTTS$|Ambos Marcam/i.test(pick.market || '')
  const line = pick.line

  if (/^over/.test(dir) || dir === 'mais') return isBtts ? 'Sim' : (line != null ? `Mais de ${line}` : 'Mais')
  if (/^under/.test(dir) || dir === 'menos') return isBtts ? 'Não' : (line != null ? `Menos de ${line}` : 'Menos')
  if (dir === 'home' || dir === '1') return home ? `${home} Vence` : 'Casa Vence'
  if (dir === 'away' || dir === '2') return away ? `${away} Vence` : 'Fora Vence'
  if (dir === 'draw' || dir === 'x') return 'Empate'
  if (dir === '1x') return home ? `${home} ou Empate` : 'Casa ou Empate'
  if (dir === '12') return `${home || 'Casa'} ou ${away || 'Fora'}`
  if (dir === 'x2') return away ? `Empate ou ${away}` : 'Empate ou Fora'
  if (dir === 'yes' || dir === 'sim') return 'Sim'
  if (dir === 'no' || dir === 'não' || dir === 'nao') return 'Não'
  if (dir === 'win' || dir === 'vence' || dir === 'vencedor') return 'Vencedor'
  if (dir === 'dc') return 'Chance Dupla'
  if (dir === 'btts') return isBtts ? 'Sim' : 'Ambos Marcam'
  // Fallback
  if (line != null) return `Linha ${line}`
  return dir || ''
}

// Compõe label completa: "{market}: {selection}" — ex: "Escanteios: Mais de 9"
export function pickLabel(pick) {
  return `${marketToPT(pick.market)}: ${directionToPT(pick) || pick.selection || 'Pick'}`
}
