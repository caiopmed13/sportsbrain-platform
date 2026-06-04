// pickUtils.js — pure helpers, no DB/env dependencies

// Limpa nome de time: remove números soltos, sufixos garbage, palavras tipo "Hoje/Live"
export function cleanTeamName(s) {
  if (!s) return ''
  let out = String(s).trim()
  // Remove prefix "Tempo " (1º Tempo, 2º Tempo capturado errado pelo parser)
  out = out.replace(/^(1[ºo°]?\s*)?(2[ºo°]?\s*)?Tempo\s+(Integral|Pleno|Total|HT|FT)?\s*[-–]?\s*/i, '')
  out = out.replace(/^Tempo\s+/i, '')  // "Tempo Foo" → "Foo"
  // Remove trailing single uppercase letter ("Inter v SC Freiburg X")
  out = out.replace(/\s+[A-Z]$/, '')
  // Remove trailing dash sozinho ("Tempo v Rayo Vallecano -")
  out = out.replace(/\s*[-–]\s*$/, '')
  // Remove prefix de números soltos
  out = out.replace(/^(\d+\s+[A-Z]{1,3}\s+)+/, '')
  // Remove sufixos típicos
  out = out.replace(/\s+(hoje|live|amanha|amanhã|today|now|live)$/i, '')
  out = out.replace(/\s+(odds?\s+turbinad[ao]s?|aumentad[ao]s?|libertadores\s+odds.*|mapa\s*\d+.*|jogo\s*\d+.*|partida\s*\d+.*|round\s*\d+.*)$/i, '')
  out = out.replace(/\s*[-–]\s*mapa.*$/i, '')
  out = out.replace(/\s*[-–]\s*\d+\s*kills?.*$/i, '')
  // Remove garbage como "PAT PAG. ANTECIPADO CRIAR APOSTA"
  // INCLUI palavras de mercado/tempo PT-BR que parser confunde com nome de time:
  if (/^(pat|pag|antecipado|criar|aposta|simples|combo|odd|stake|cash|live|tempo|integral|resultado|ambos|marcam|escanteios|cart[oõ]es|gols?|chutes|finaliz|over|under|mais|menos|primeiro|segundo|1[ºo°]|2[ºo°]|ft|ht|sg|halftime|fulltime|match|win|empate|draw|das|do|dos|da|de|aumentadas|turbinadas|libertadores|champions|copa|finais|semis|quartas|oitavas|grupo|fase)\b/i.test(out)) {
    // tenta achar o nome real depois (ex: "das aumentadas Bodo/Glimt" → "Bodo/Glimt")
    const m = out.match(/\b([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý0-9][a-zà-ÿ0-9]+)?(?:\/[A-ZÀ-Ý][a-zà-ÿ]+)?)/);
    if (m) out = m[1]
    else return ''
  }
  // Remove "Odd Turbinada" anywhere
  out = out.replace(/\b(odds?\s+turbinad[ao]s?|aumentad[ao]s?)\b/gi, '').trim()
  // Remove "É N" / "é N" suffix (e.g. "Stuttgart É 5" → "Stuttgart"; Portuguese verb + number artifact)
  out = out.replace(/\s+[ÉéèÈ]\s+\d.*$/i, '').trim()
  // Remove trailing orphan numbers (e.g. "Stuttgart 5" → "Stuttgart")
  out = out.replace(/\s+\d+(\.\d+)?$/, '').trim()
  // Strip embedded "X word" separator artifact: "Mainz X Jose" → "Mainz", "Paris X Brest Y" → "Paris"
  out = out.replace(/\s+[Xx]\s+\S.*$/, '').trim()
  // Limita a 3 palavras pra evitar capturar muito texto
  const parts = out.split(/\s+/).filter(p => p.length > 0).slice(0, 3)
  out = parts.join(' ').trim()
  // Mínimo: 2 chars
  if (out.length < 2) return ''
  // Rejeita resultado que ainda é palavra de mercado (ex: cleanTeamName('Mais de 5') → 'Mais' → rejeita)
  if (/^(mais|menos|over|under|btts|sim|não|nao|win|draw|empate|vence|vencedor|gol|escanteio|corner|total|ambos|marcam|chance|handicap|placar|resultado|linha|jogador|pontos|rebote|assist|tempo|integral|primeiro|segundo|metade|turno|parcial|intervalo|final|media|diferença|spread|chutes?|cantos?|shots?|cards?|cartão|cartoes?|falta|foul|tiros?)\b/i.test(out)) return ''
  return out
}

// Tenta recuperar times do raw_text quando parser só extraiu 1 (ou 0)
const _isMktWord = (s) => /^(mais|menos|over|under|btts|sim|não|nao|win|draw|empate|vence|vencedor|gol|escanteio|corner|total|ambos|marcam|chance|handicap|placar|resultado|linha|jogador|pontos|rebote|assist|tempo|integral|primeiro|segundo|metade|turno|parcial|intervalo|final|media|diferença|spread)\b/i.test(s || '')

// F2.50: valida que t1 e t2 aparecem próximos no raw_text conectados por um separador.
// Posts multi-jogo (ex: "Palmeiras 19:00\n...\nCruzeiro 21:30 vs Barcelona SC") têm os
// 2 nomes mas em jogos distintos → parser upstream conflou as 2 partidas num "fixture" fake.
// Retorna true se há "{t1} ... (x|vs|v|×|-|–) ... {t2}" (ou inverso) dentro de ~60 chars.
export function pairAppearsAdjacent(t1, t2, rawText) {
  if (!t1 || !t2 || !rawText) return true  // sem dados pra validar → trust
  const text = String(rawText).replace(/\s+/g, ' ')
  // normalize p/ comparação case+accent insensitive
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const lowText = norm(text)
  const a = norm(t1), b = norm(t2)
  // Caso A: t1 ... sep ... t2  (proximidade ≤ 60 chars)
  // Caso B: t2 ... sep ... t1
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sep = '\\s+(?:x|vs|v|×|-|–|×)\\s+'
  const rxA = new RegExp(`${esc(a)}[^a-z0-9]{0,40}${sep}[^a-z0-9]{0,40}${esc(b)}`, 'i')
  const rxB = new RegExp(`${esc(b)}[^a-z0-9]{0,40}${sep}[^a-z0-9]{0,40}${esc(a)}`, 'i')
  if (rxA.test(lowText) || rxB.test(lowText)) return true
  // Fallback: t1 e t2 ocorrem dentro de 80 chars um do outro (separador implícito)
  const i1 = lowText.indexOf(a)
  const i2 = lowText.indexOf(b)
  if (i1 >= 0 && i2 >= 0 && Math.abs(i1 - i2) <= 80) return true
  return false
}

// R6K-F2.14-C: comparador accent/casing-insensitive p/ detectar "mesmo time"
// extraído duas vezes pelo parser (ex: "São paulo" + "Sao paulo").
const _normTeamForCompare = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

export function recoverTeams(teams, rawText) {
  let t1 = cleanTeamName(teams[0] || '')
  let t2 = cleanTeamName(teams[1] || '')
  // R6K-F2.14-C: se t1 e t2 normalizam para o mesmo nome, descarta t2.
  // Caso real (tipster Telegram): teams=["São Paulo", "Sao Paulo"] → cleanTeamName
  // mantém os 2 → return [t1, t2] retornaria pick com home==away (mesmo time).
  // Aí o pick falsamente passa pelo filter de "1 time joga hoje" (PLAYER_SHOTS isPlayerSpecific)
  // gerando legs "São paulo v Sao paulo" em Megas.
  if (t1 && t2 && _normTeamForCompare(t1) === _normTeamForCompare(t2)) {
    t2 = ''  // força fallback ao regex search abaixo OU retornará [t1, '?']
  }
  // Não devolve early se t2 é palavra de mercado (ex: 'Mais', 'Over', 'Gol')
  if (t1 && t2 && !_isMktWord(t2) && !_isMktWord(t1)) return [t1, t2]
  if (_isMktWord(t2)) t2 = ''
  if (!rawText) return [t1 || '?', t2 || '?']
  const text = String(rawText).replace(/\s+/g, ' ').trim()
  // Match curto: 1-3 palavras de cada lado, começando com letra
  const sepRegex = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'&/_-]*(?:\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,2})\s+(?:x|vs|v|×|-|–)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'&/_-]*(?:\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,2})/i
  const m = text.match(sepRegex)
  if (m) {
    const a = cleanTeamName(m[1]); const b = cleanTeamName(m[2])
    if (!t1) t1 = a
    if (!t2) t2 = (a.toLowerCase() === t1.toLowerCase()) ? b : (b.toLowerCase() === t1.toLowerCase() ? a : b)
  }
  if (t1 && !t2) {
    const esc = t1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m2 = text.match(new RegExp(`${esc}\\s+(?:x|vs|v|×|-|–)\\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'&/_-]*(?:\\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,2})`, 'i'))
    if (m2) t2 = cleanTeamName(m2[1])
    else {
      const m3 = text.match(new RegExp(`([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'&/_-]*(?:\\s+[A-Za-zÀ-ÿ0-9.'&/_-]+){0,2})\\s+(?:x|vs|v|×|-|–)\\s+${esc}`, 'i'))
      if (m3) t2 = cleanTeamName(m3[1])
    }
  }
  return [t1 || '?', t2 || '?']
}

export function kellyStake(prob, odd, fraction = 0.25) {
  // Guards: previne NaN/Infinity em edge cases
  if (!Number.isFinite(prob) || !Number.isFinite(odd)) return 0
  if (prob <= 0 || prob >= 1) return 0
  if (odd <= 1) return 0  // sem edge possível
  const b = odd - 1
  const q = 1 - prob
  const k = (b * prob - q) / b
  return Math.max(0, Math.min(1, k * fraction))  // cap 100% banca
}

// ── TIER_CONFIG: parametros centralizados (era magic numbers espalhados) ──
export const TIER_CONFIG = {
  tier1: { maxPerMarket: 25, maxResults: 92, minOdd: 1.3, maxOdd: 5, minProb: 0.45 },
  tier2: { maxPerMarket: 2, maxResults: 100, minOdd: 2.0, maxOdd: 9, minProb: 0.30, comboOddRange: [9, 30], maxLegReuse: 3 },
  tier3: { maxResults: 100, minOdd: 1.5, maxOdd: 25, minProb: 0.30, poolSize: 40, comboOddRange: [25, 999], maxLegReuse: 4 },
  tier4: { maxResults: 100, minOdd: 2, maxOdd: 35, minProb: 0.35, poolSize: 40, comboOddRange: [1000, 100000], maxLegReuse: 5 },
}

// Helper: dedup picks por (match + market_signature) limitando a N por market
export function diversifyPool(picks, maxPerMarket = 3) {
  const counts = {}
  const out = []
  for (const p of picks) {
    const sig = `${(p.market || '').toLowerCase()}|${p.line ?? ''}|${p.direction ?? ''}`
    counts[sig] = (counts[sig] || 0) + 1
    if (counts[sig] <= maxPerMarket) out.push(p)
  }
  return out
}

// Family-based diversifier: agrupa markets por categoria pra forçar variedade
// (ex: corner FT + corner HT + over_corners = mesma family CORNERS)
export function marketFamilyOf(m) {
  const s = (m || '').toLowerCase()
  // HT-specific (FAIXA pattern) ANTES de generic — pra diversificar HT vs FT
  if (/ht_corners|escanteios.*1.*tempo|1.*tempo.*escantei/.test(s)) return 'HT_CORNERS'
  if (/ht_shots|ht_total_shots|chutes.*1.*tempo|1.*tempo.*chutes/.test(s)) return 'HT_SHOTS'
  if (/ht_cards|cart.*1.*tempo/.test(s)) return 'HT_CARDS'
  if (/correct_score|placar exato/.test(s)) return 'CORRECT_SCORE'
  if (/corner|escantei/.test(s)) return 'CORNERS'
  if (/btts|both|ambos/.test(s)) return 'BTTS'
  if (/double|chance|^dc$/.test(s)) return 'DC'
  if (/1x2|result|win|moneyline|vencedor|match|draw_no_bet/.test(s)) return 'WINNER'
  if (/total.*goal|^total_goal|^gol|goals_range/.test(s)) return 'GOALS'
  if (/shot|chute/.test(s)) return 'SHOTS'
  if (/handicap/.test(s)) return 'HANDICAP'
  if (/card|cart/.test(s)) return 'CARDS'
  if (/point|cesta/.test(s)) return 'POINTS'
  if (/rebound/.test(s)) return 'REBOUNDS'
  if (/assist/.test(s)) return 'ASSISTS'
  return 'OTHER'
}

export function diversifyByFamily(picks, maxPerFamily = 6) {
  const counts = {}
  const out = []
  for (const p of picks) {
    const fam = marketFamilyOf(p.market)
    counts[fam] = (counts[fam] || 0) + 1
    if (counts[fam] <= maxPerFamily) out.push(p)
  }
  return out
}

// Helper: filtra combos finais limitando reuso de cada leg (diversidade)
export function diversifyCombos(combosArr, maxLegReuse = 3, maxPairOverlap = 2) {
  // maxLegReuse: cada perna individual aparece no máximo N combos
  // maxPairOverlap: 2 combos quaisquer NÃO podem compartilhar mais de N pernas
  const legUse = {}
  const out = []
  const outLegSets = []  // Set<legKey>[] paralelo a out
  for (const c of combosArr) {
    const legKeys = c.legs.map(l => `${l.match}|${l.market}|${l.line ?? ''}|${l.direction ?? ''}`)
    const overused = legKeys.some(k => (legUse[k] || 0) >= maxLegReuse)
    if (overused) continue
    const thisSet = new Set(legKeys)
    // Rejeita combo que compartilha >maxPairOverlap pernas com algum combo já aceito
    let tooSimilar = false
    for (const prev of outLegSets) {
      let shared = 0
      for (const k of thisSet) if (prev.has(k)) { shared++; if (shared > maxPairOverlap) break }
      if (shared > maxPairOverlap) { tooSimilar = true; break }
    }
    if (tooSimilar) continue
    for (const k of legKeys) legUse[k] = (legUse[k] || 0) + 1
    out.push(c)
    outLegSets.push(thisSet)
  }
  return out
}

// Calcula consensus: quantos tipsters tem tip semelhante
export function calcConsensus(pick, tipsterTips) {
  const home = (pick.home_team || '').toLowerCase()
  const away = (pick.away_team || '').toLowerCase()
  const market = (pick.stat || pick.market || '').toLowerCase()
  let count = 0
  const channels = new Set()
  for (const t of tipsterTips) {
    const teamMatch = t.teams.some(team => {
      const tl = team.toLowerCase()
      return home.includes(tl.slice(0, 5)) || away.includes(tl.slice(0, 5))
    })
    const marketMatch = (t.market || '').toLowerCase().includes(market.slice(0, 5)) ||
                        market.includes((t.market || '').toLowerCase().slice(0, 5))
    if (teamMatch && marketMatch) {
      count++
      channels.add(t.channel_id)
    }
  }
  return { count, unique_channels: channels.size }
}

export function* combos(arr, k) {
  if (k === 0) { yield []; return }
  if (arr.length < k) return
  for (let i = 0; i <= arr.length - k; i++) {
    for (const tail of combos(arr.slice(i+1), k-1)) yield [arr[i], ...tail]
  }
}

// Canonical team name map — abreviações conhecidas → nome oficial curto
const _CANONICAL = {
  'psg': 'Paris SG',
  'paris sg': 'Paris SG',
  'paris saint-germain': 'Paris SG',
  'man city': 'Man. City',
  'manchester city': 'Man. City',
  'man utd': 'Man. United',
  'man united': 'Man. United',
  'manchester united': 'Man. United',
  'man u': 'Man. United',
  'manu': 'Man. United',
  'inter milan': 'Inter',
  'inter de milão': 'Inter',
  'inter de milano': 'Inter',
  'fc barcelona': 'Barcelona',
  'barca': 'Barcelona',
  'atletico madrid': 'Atlético',
  'atletico de madrid': 'Atlético',
  'atl. madrid': 'Atlético',
  'real madrid': 'Real Madrid',
  'bayer leverkusen': 'Leverkusen',
  'b. leverkusen': 'Leverkusen',
  'borussia dortmund': 'Dortmund',
  'bvb': 'Dortmund',
  'rb leipzig': 'Leipzig',
  'ac milan': 'Milan',
  'juventus fc': 'Juventus',
  'as roma': 'Roma',
  'ss lazio': 'Lazio',
  'as monaco': 'Monaco',
  'olympique lyon': 'Lyon',
  'ol': 'Lyon',
  'olympique marseille': 'Marseille',
  'om': 'Marseille',
  'benfica': 'Benfica',
  'sl benfica': 'Benfica',
  'sporting cp': 'Sporting',
  'sporting clube': 'Sporting',
  'porto': 'Porto',
  'fc porto': 'Porto',
  'ajax': 'Ajax',
  'ajax amsterdam': 'Ajax',
  'celtic fc': 'Celtic',
  'rangers fc': 'Rangers',
  'arsenal fc': 'Arsenal',
  'chelsea fc': 'Chelsea',
  'liverpool fc': 'Liverpool',
  'tottenham hotspur': 'Tottenham',
  'spurs': 'Tottenham',
  'west ham united': 'West Ham',
  'newcastle united': 'Newcastle',
  'aston villa fc': 'Aston Villa',
  'flamengo': 'Flamengo',
  'cr flamengo': 'Flamengo',
  'palmeiras': 'Palmeiras',
  'se palmeiras': 'Palmeiras',
  'fluminense': 'Fluminense',
  'botafogo': 'Botafogo',
  'corinthians': 'Corinthians',
  'sc corinthians': 'Corinthians',
  'santos fc': 'Santos',
  'gremio': 'Grêmio',
  'grêmio': 'Grêmio',
  // R6K-F2.14-B: alias para São Paulo (resolve casing/accent variants)
  'são paulo': 'São Paulo',
  'sao paulo': 'São Paulo',
  'são paulo fc': 'São Paulo',
  'sao paulo fc': 'São Paulo',
  'spfc': 'São Paulo',
  'internacional': 'Inter RS',
  'sport club internacional': 'Inter RS',
}

export function normalizeTeamName(s) {
  const cleaned = cleanTeamName(s)
  if (!cleaned) return ''
  const key = cleaned.toLowerCase()
  const canonical = _CANONICAL[key]
  if (canonical) return canonical
  // Title-case first letter for names not in canonical map ("sport" → "Sport")
  return /^[a-záàâãéèêíìîóòôõúùûç]/u.test(cleaned)
    ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    : cleaned
}
