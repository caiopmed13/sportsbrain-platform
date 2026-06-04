// premiumLabels.js — helpers de label/seleção extraídos de Premium.jsx (F2.92)
// marketToPT, statLabelWithTeam, selectionTxt — labels PT-BR para markets/stats.

export function marketToPT(m) {
  if (!m) return 'Pick'
  const s = m.toString()
  // HT markets — specific patterns BEFORE generic catch-alls (order matters)
  if (/escanteio.*(1[oº°]?\s*t|1st\s*half).*(mandant|casa)/i.test(s) || /^HT_CORNERS_HOME$/i.test(s)) return 'Escanteios 1ºT · Casa'
  if (/escanteio.*(1[oº°]?\s*t|1st\s*half).*(visitant|fora)/i.test(s) || /^HT_CORNERS_AWAY$/i.test(s)) return 'Escanteios 1ºT · Fora'
  if (/escanteio.*(1[oº°]?\s*t|1st\s*half)|^HT_CORNERS|^Total Corners HT$/i.test(s)) return 'Escanteios 1ºT'
  if (/chute.*(1[oº°]?\s*t|1st\s*half).*(mandant|casa)/i.test(s) || /^HT_SHOTS_HOME$/i.test(s)) return 'Chutes 1ºT · Casa'
  if (/chute.*(1[oº°]?\s*t|1st\s*half).*(visitant|fora)/i.test(s) || /^HT_SHOTS_AWAY$/i.test(s)) return 'Chutes 1ºT · Fora'
  if (/chute.*(1[oº°]?\s*t|1st\s*half)|^HT_SHOTS|^HT_TOTAL_SHOTS/i.test(s)) return 'Chutes 1ºT'
  if (/cart[aã]o.*(1[oº°]?\s*t|1st\s*half)|^HT_CARDS/i.test(s)) return 'Cartões 1ºT'
  // Generic fallbacks (must come after HT-specific checks)
  if (/^CORNERS_OU$|^Total Corners FT$|Corners?\s+Mais|^escanteio/i.test(s)) return 'Escanteios'
  if (/^TOTAL_GOALS$|^Total Goals$|^Total Gols/i.test(s)) return 'Total Gols'
  if (/^GOALS_RANGE/i.test(s)) return 'Faixa de Gols'
  if (/^BTTS$|^Both Teams to Score$|^Ambos Marcam/i.test(s)) return 'Ambos Marcam'
  if (/^DOUBLE_CHANCE$|^Double Chance$|^Chance Dupla/i.test(s)) return 'Chance Dupla'
  if (/^1X2$|^RESULT$|^Match Result|^Resultado Final/i.test(s)) return 'Resultado'
  if (/^DRAW_NO_BET$|Draw No Bet|Empate Anula/i.test(s)) return 'Empate Anula'
  if (/^HANDICAP$/i.test(s)) return 'Handicap'
  if (/^PLAYER_SHOTS$/i.test(s)) return 'Chutes Jogador'
  if (/^PLAYER_SHOTS_ON_TARGET$/i.test(s)) return 'Chutes a Gol'
  if (/^PLAYER_FOULS$/i.test(s)) return 'Faltas Jogador'
  if (/^PLAYER_TACKLES$/i.test(s)) return 'Desarmes'
  if (/^PLAYER_CARDS$/i.test(s)) return 'Cartões Jogador'
  if (/^TOTAL_POINTS$/i.test(s)) return 'Total Pontos'
  if (/^CORRECT_SCORE/i.test(s)) return 'Resultado Correto'
  if (/^HT_FT|HTFT/i.test(s)) return 'Intervalo / Final'
  return s
}

// F2.68: stat label com nome real do time (em vez de "Casa"/"Fora")
// Detecta sufixos _home/_away em stats normalizados (ht_corners_home etc).
// Recebe leg + match string ("Home v Away") e extrai team names.
export function statLabelWithTeam(leg, matchStr) {
  if (!leg) return 'Pick'
  const s = String(leg.stat || leg.market || '').trim()
  // Split match: "Home v Away", "Home vs Away", "Home x Away"
  let home = leg.home_team || ''
  let away = leg.away_team || ''
  if ((!home || !away) && matchStr) {
    const m = String(matchStr).split(/\s+(?:v|vs|x)\s+/i)
    if (m.length === 2) { home = home || m[0].trim(); away = away || m[1].trim() }
  }
  const isHome = /_home$|·\s*Casa$|\bcasa\b/i.test(s) || /mandant/i.test(s)
  const isAway = /_away$|·\s*Fora$|\bfora\b/i.test(s) || /visitant/i.test(s)
  // ht_corners → Escanteios 1ºT
  if (/ht_corners|escanteio.*1[ºo]\s*t/i.test(s)) {
    if (isHome && home) return `Escanteios 1ºT · ${home}`
    if (isAway && away) return `Escanteios 1ºT · ${away}`
    return 'Escanteios 1ºT'
  }
  // ht_shots / ht_finaliz → Chutes 1ºT
  if (/ht_(shots|finaliz)|chutes?\s*1[ºo]\s*t|finaliza[çc][õo]es\s*1[ºo]\s*t/i.test(s)) {
    if (isHome && home) return `Chutes 1ºT · ${home}`
    if (isAway && away) return `Chutes 1ºT · ${away}`
    return 'Chutes 1ºT'
  }
  // ht_cards
  if (/ht_cards|cart[aã]o.*1[ºo]\s*t/i.test(s)) {
    if (isHome && home) return `Cartões 1ºT · ${home}`
    if (isAway && away) return `Cartões 1ºT · ${away}`
    return 'Cartões 1ºT'
  }
  // fallback to marketToPT
  return marketToPT(s)
}

// selectionTxt — converte direction + line em texto PT-BR amigável
// Lida com: over/under, home/away/draw, 1x/12/x2, dc, btts, yes/no, etc.
export function selectionTxt(pick) {
  const dirNorm = (pick.direction || '').toLowerCase()
  const home = pick.home_team || ''
  const away = pick.away_team || ''
  const isBtts = /^BTTS$|Ambos Marcam/i.test(pick.market || '')
  let dirTxt = ''
  if (dirNorm === 'over' || dirNorm === 'mais') dirTxt = isBtts ? 'Sim' : `Mais de ${pick.line ?? ''}`
  else if (dirNorm === 'under' || dirNorm === 'menos') dirTxt = isBtts ? 'Não' : `Menos de ${pick.line ?? ''}`
  else if (dirNorm === 'home' || dirNorm === '1') dirTxt = home ? `${home} Vence` : 'Casa Vence'
  else if (dirNorm === 'away' || dirNorm === '2') dirTxt = away ? `${away} Vence` : 'Fora Vence'
  else if (dirNorm === 'draw' || dirNorm === 'x') dirTxt = 'Empate'
  else if (dirNorm === '1x') dirTxt = home ? `${home} ou Empate` : 'Casa ou Empate'
  else if (dirNorm === '12') dirTxt = `${home || 'Casa'} ou ${away || 'Fora'}`
  else if (dirNorm === 'x2') dirTxt = away ? `Empate ou ${away}` : 'Empate ou Fora'
  else if (dirNorm === 'yes' || dirNorm === 'sim') dirTxt = 'Sim'
  else if (dirNorm === 'no' || dirNorm === 'não') dirTxt = 'Não'
  else if (dirNorm === 'win' || dirNorm === 'vence') dirTxt = 'Vencedor'
  else if (dirNorm === 'dc') dirTxt = 'Chance Dupla'
  else if (dirNorm === 'btts') dirTxt = 'Ambos Marcam'
  const _isTechSel = /^(over_|under_|dc|btts|win|over$|under$|yes$|no$|home$|away$|draw$|1x$|12$|x2$)/i.test(pick.selection || '')
  // Verbose HT corner selections ("Mais de X Escanteios 1ºT para Team" OR "Mais 1.5"/"Menos 2.5")
  // Treat as technical so selectionTxt() builds clean "[team] Mais de X" from direction+line
  const _isHtCornerVerbose = /escanteio.*1[oº°]?\s*t/i.test(pick.selection || '')
  // Short Bet365-format selections like "Mais 1.5", "Menos 2.5" — use direction+line for consistency
  const _isBetShortSel = /^(mais|menos)\s+[\d.]+$/i.test((pick.selection || '').trim())
  return ((!_isTechSel && !_isHtCornerVerbose && !_isBetShortSel) && pick.selection)
    ? pick.selection
    : ([pick.player_name || pick.team, dirTxt].filter(Boolean).join(' ').trim() || dirTxt || 'Pick')
}
