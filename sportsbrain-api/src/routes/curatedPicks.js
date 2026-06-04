// ═══════════════════════════════════════════════════════════════════════════
// curatedPicks.js — TIPS PREMIUM VENDÁVEIS
// ═══════════════════════════════════════════════════════════════════════════
// Estratégia: usa BUCKETS sustentáveis (Wilson LCB > 70%) como primary source.
// Em vez de gerar com modelo (corner-bias), pesca tips REAIS de tipsters
// com track record provado em (channel × market × odd_band).
//
// Exemplo: FAIXA VIP × DOUBLE_CHANCE × 10.0+ tem n=58, LCB=83.3%, EV +969%.
// → Buscamos tips RECENTES UNRESOLVED desse bucket → essas são as picks
// que seriam vendáveis com confiança.
//
// Output:
//   - 5-10 tips/dia (não mais)
//   - Variedade: max 2 do mesmo market family
//   - Selection ESPECÍFICA (PT-BR humano, não "dc"/"btts")
//   - Sustentabilidade marcada (LCB %, EV %, WR raw)
// ═══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js'

// Wilson LCB (one-sided 95%)
function wilsonLCB(wins, n, z = 1.645) {
  if (n === 0) return 0
  const p = wins / n
  const denom = 1 + z * z / n
  const center = p + z * z / (2 * n)
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return Math.max(0, (center - margin) / denom)
}

const oddBand = (odd) => {
  if (odd < 1.5) return '<1.5'
  if (odd < 2) return '1.5-2.0'
  if (odd < 3) return '2.0-3.0'
  if (odd < 5) return '3.0-5.0'
  if (odd < 10) return '5.0-10.0'
  return '10.0+'
}

const marketFamily = (m) => {
  const s = (m || '').toLowerCase()
  if (/corner|escantei/.test(s)) return 'CORNERS'
  if (/btts|both/.test(s)) return 'BTTS'
  if (/double|chance|^dc/.test(s)) return 'DC'
  if (/1x2|result|win|moneyline/.test(s)) return 'WINNER'
  if (/total.*goal|^total_goal|^gol/.test(s)) return 'GOALS'
  if (/shot|chute/.test(s)) return 'SHOTS'
  if (/handicap/.test(s)) return 'HANDICAP'
  return 'OTHER'
}

// Extrai DC específico (1X/12/X2) do raw_text procurando padrões PT-BR
function extractDCFromText(rawText, t1, t2) {
  if (!rawText) return null
  const text = String(rawText).toLowerCase()
  const homeFirst5 = (t1 || '').toLowerCase().slice(0, 5)
  const awayFirst5 = (t2 || '').toLowerCase().slice(0, 5)
  // Padrões: "Casa ou Empate", "Empate ou Fora", "Casa ou Fora"
  // OU explícito "1X", "12", "X2" no texto
  if (/\b(1x|casa\s+(ou|\/)\s+empate|home\s+(or|\/)\s+draw)\b/i.test(text)) return '1X'
  if (/\b(x2|empate\s+(ou|\/)\s+(fora|visitante)|draw\s+(or|\/)\s+away)\b/i.test(text)) return 'X2'
  if (/\b(12|casa\s+(ou|\/)\s+(fora|visitante)|home\s+(or|\/)\s+away|sem\s+empate)\b/i.test(text)) return '12'
  // Heurística: "{home} ou Empate" / "Empate ou {away}"
  if (homeFirst5 && new RegExp(`${homeFirst5}\\w*\\s+(ou|\/)\\s+empate`, 'i').test(text)) return '1X'
  if (awayFirst5 && new RegExp(`empate\\s+(ou|\/)\\s+${awayFirst5}`, 'i').test(text)) return 'X2'
  return null
}

// Selection PT-BR — agora ESPECÍFICA pra DC (extrai 1X/12/X2 do raw_text)
function directionToPT(market_tag, line, market, t1, t2, raw_text) {
  const dir = (market_tag || '').toLowerCase()
  const isBtts = /BTTS|ambos\s*marcam/i.test(market || '')
  if (/^over/.test(dir) || dir === 'mais') return isBtts ? 'Sim' : (line != null ? `Mais de ${line}` : 'Mais')
  if (/^under/.test(dir) || dir === 'menos') return isBtts ? 'Não' : (line != null ? `Menos de ${line}` : 'Menos')
  if (dir === 'home' || dir === '1') return `${t1 || 'Casa'} Vence`
  if (dir === 'away' || dir === '2') return `${t2 || 'Fora'} Vence`
  if (dir === 'draw' || dir === 'x') return 'Empate'
  if (dir === '1x') return `${t1 || 'Casa'} ou Empate`
  if (dir === '12') return `${t1 || 'Casa'} ou ${t2 || 'Fora'}`
  if (dir === 'x2') return `Empate ou ${t2 || 'Fora'}`
  if (dir === 'yes' || dir === 'sim') return 'Sim'
  if (dir === 'no' || dir === 'não') return 'Não'
  if (dir === 'win') return 'Vencedor'
  if (dir === 'dc') {
    // EXTRAI DC ESPECÍFICO do texto bruto da tip
    const specific = extractDCFromText(raw_text, t1, t2)
    if (specific === '1X') return `${t1 || 'Casa'} ou Empate (1X)`
    if (specific === '12') return `Sem Empate (12)`  // home ou away = sem empate
    if (specific === 'X2') return `Empate ou ${t2 || 'Fora'} (X2)`
    return 'Chance Dupla'
  }
  if (dir === 'btts') return 'Ambos Marcam'
  if (line != null) return `Linha ${line}`
  return market || 'Pick'
}

function marketToPT(m) {
  if (!m) return 'Pick'
  const s = String(m)
  if (/^CORNERS_OU$|escantei/i.test(s)) return 'Escanteios'
  if (/^TOTAL_GOALS$/i.test(s)) return 'Total de Gols'
  if (/^BTTS$/i.test(s)) return 'Ambos Marcam'
  if (/^DOUBLE_CHANCE$/i.test(s)) return 'Chance Dupla'
  // P3.9 R6K-B: ver premiumPicks.js — "Resultado Final" em vez de
  // "Vencedor da Partida" porque 1X2 inclui Empate.
  if (/^1X2$|^RESULT$/i.test(s)) return 'Resultado Final'
  if (/^HANDICAP$/i.test(s)) return 'Handicap'
  if (/^PLAYER_SHOTS$/i.test(s)) return 'Chutes do Jogador'
  if (/^PLAYER_SHOTS_ON_TARGET$/i.test(s)) return 'Chutes a Gol'
  if (/^PLAYER_FOULS$/i.test(s)) return 'Faltas do Jogador'
  if (/^PLAYER_TACKLES$/i.test(s)) return 'Desarmes'
  return s
}

// Limpa garbage de market words após nome
function cleanTeam(s) {
  if (!s) return ''
  let out = String(s).trim()
  // CRÍTICO: remove qualquer "v X" onde X começa com palavra de mercado
  // (ex: "CJ McCollum v Menos de", "CJ McCollum v Mais de Pontos")
  out = out.replace(/\s+v\s+(menos|mais|over|under|sim|n[aã]o|mapa|round|jogo|partida).*$/i, '')
  // Remove sufixos market diretos
  out = out.replace(/\s+(menos|mais|over|under)\s+de\s.*$/i, '')
  out = out.replace(/\s+\d+(\.\d+)?\s+(pontos|gols?|chutes|cartões|escanteios|finalizações|kills|tackles|faltas|desarmes|cartoes).*$/i, '')
  out = out.replace(/\s*[-–]\s*(mapa|jogo|round|partida).*$/i, '')
  out = out.replace(/\s+(odds?\s+turbinad|aumentad|libertadores\s+odds).*$/i, '')
  // Remove " v" trailing solto OU "Menos de" trailing solto
  out = out.replace(/\s+(v|menos|mais|over|under|de)\s*$/i, '')
  out = out.replace(/[.,;:\-–\s]+$/g, '')
  // Limita 4 palavras pra preservar nomes compostos ("CJ McCollum")
  return out.split(/\s+/).slice(0, 4).join(' ').trim()
}

function recoverTeams(teams, rawText) {
  let t1 = cleanTeam(teams[0] || '')
  let t2 = cleanTeam(teams[1] || '')
  if (t1 && t2) return [t1, t2]
  if (!rawText) return [t1 || '?', t2 || '?']
  const m = String(rawText).match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.\-' ]+?)\s+(?:x|vs|v|×|-)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.\-' ]+)/i)
  if (m) {
    if (!t1) t1 = cleanTeam(m[1])
    if (!t2) t2 = cleanTeam(m[2])
  }
  return [t1 || '?', t2 || '?']
}

const BOGUS_REGEX = /^(LINHA|JOGADOR|TIME|EQUIPE|TEMPO|INTEGRAL|RESULTADO|MAPA|JOGO|FALLEN|SUPER|AUMENTAD|TURBINAD|PARTIDA|ROUND|FASE|LIBERTADORES|CHAMPIONS|COPA|CRIAR)\b/i

export async function handleCuratedPicks(request, env) {
  if (!env?.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    })
  }
  try {
    const url = new URL(request.url)
    const minLCB = parseFloat(url.searchParams.get('min_lcb') || '0.65')  // 65% minimum LCB
    const minBucketN = parseInt(url.searchParams.get('min_n') || '15', 10)
    const hoursWindow = parseInt(url.searchParams.get('hours') || '12', 10)
    const maxPicks = parseInt(url.searchParams.get('max') || '10', 10)

    // ─── PASSO 1: Computar buckets sustentáveis ───────────────────────────
    const { results: resolved } = await env.SB_DB.prepare(
      `SELECT channel_id, market, odd, result FROM telegram_tips
       WHERE result IN ('W','L') AND odd > 0`
    ).all()

    const buckets = {}
    for (const t of resolved || []) {
      const band = oddBand(t.odd)
      const key = `${t.channel_id}|${t.market || 'unknown'}|${band}`
      if (!buckets[key]) buckets[key] = { wins: 0, losses: 0, n: 0, oddSum: 0 }
      const b = buckets[key]
      b.n++
      b.oddSum += t.odd
      if (t.result === 'W') b.wins++
      else b.losses++
    }
    // Marca buckets sustentáveis (LCB > minLCB, n >= minBucketN)
    const sustainable = new Set()
    const bucketStats = {}
    for (const [k, b] of Object.entries(buckets)) {
      if (b.n < minBucketN) continue
      const lcb = wilsonLCB(b.wins, b.n)
      const avgOdd = b.oddSum / b.n
      if (lcb >= minLCB) {
        sustainable.add(k)
        bucketStats[k] = {
          lcb: +(lcb * 100).toFixed(1),
          rawWR: +(b.wins / b.n * 100).toFixed(1),
          n: b.n,
          avgOdd: +avgOdd.toFixed(2),
          evLCB: +((lcb * avgOdd - 1) * 100).toFixed(1),
        }
      }
    }

    if (sustainable.size === 0) {
      return new Response(JSON.stringify({
        ok: true, total_buckets: Object.keys(buckets).length,
        sustainable_buckets: 0, picks: [],
        message: `Nenhum bucket com LCB >= ${(minLCB*100).toFixed(0)}% e n >= ${minBucketN}. Aguardando mais resolutions.`,
      }, null, 2), { status: 200, headers: corsHeaders({ 'Content-Type': 'application/json' }) })
    }

    // ─── PASSO 2: Pesca tips RECENTES (unresolved) que casam com buckets sustentáveis
    const cutoff = Date.now() - hoursWindow * 3600_000
    const { results: recent } = await env.SB_DB.prepare(
      `SELECT channel_id, channel_name, message_id, market, market_tag, line, odd, teams, raw_text, posted_at
       FROM telegram_tips
       WHERE posted_at >= ? AND result IS NULL AND odd > 0 AND market IS NOT NULL
       ORDER BY posted_at DESC LIMIT 500`
    ).bind(cutoff).all()

    // ─── ANTI-STALE: carrega matches reais de hoje pra filtrar tipsters
    let realTeams = new Set()
    try {
      const cacheRow = await env.SB_DB.prepare(
        `SELECT payload FROM picks_cache_today WHERE sport = 'football'`
      ).first()
      if (cacheRow?.payload) {
        const data = JSON.parse(cacheRow.payload)
        for (const p of (data.top_props || [])) {
          if (p.home_team) realTeams.add(p.home_team.toLowerCase().slice(0, 6))
          if (p.away_team) realTeams.add(p.away_team.toLowerCase().slice(0, 6))
        }
      }
      // Também basquete
      const cacheBkRow = await env.SB_DB.prepare(
        `SELECT payload FROM picks_cache_today WHERE sport = 'basketball'`
      ).first()
      if (cacheBkRow?.payload) {
        const data = JSON.parse(cacheBkRow.payload)
        for (const p of (data.top_props || [])) {
          if (p.home_team) realTeams.add(p.home_team.toLowerCase().slice(0, 6))
          if (p.away_team) realTeams.add(p.away_team.toLowerCase().slice(0, 6))
        }
      }
    } catch {}

    const picks = []
    for (const r of (recent || [])) {
      const band = oddBand(r.odd)
      const bucketKey = `${r.channel_id}|${r.market}|${band}`
      if (!sustainable.has(bucketKey)) continue  // bucket sem track record provado

      const teamsRaw = r.teams ? JSON.parse(r.teams) : []
      const [t1, t2] = recoverTeams(teamsRaw, r.raw_text)
      if (t1 === '?' || t2 === '?') continue
      // Bogus filter
      if (BOGUS_REGEX.test(t1.split(/\s|-/)[0]) || BOGUS_REGEX.test(t2.split(/\s|-/)[0])) continue
      // FILTER FINAL: descarta picks onde t2 começa com palavra de mercado (parser bug player props)
      if (/^(menos|mais|over|under|sim|n[aã]o|chance|dupla|ambos|empate|vencedor|sem|com)\b/i.test(t2)) continue
      if (/^(menos|mais|over|under|sim|n[aã]o|chance|dupla|ambos|empate|vencedor|sem|com)\b/i.test(t1)) continue
      // ANTI-STALE: ambos times precisam existir nos jogos reais do dia
      if (realTeams.size > 0) {
        const h6 = t1.toLowerCase().slice(0, 6)
        const a6 = t2.toLowerCase().slice(0, 6)
        if (!realTeams.has(h6) || !realTeams.has(a6)) continue
      }

      const stats = bucketStats[bucketKey]
      // SANITY CHECK: detecta tip que é combo (FAIXA divide odds altas em duplas)
      // Ex: "Mais de 3 escanteios @11" — escanteios over 3 odd 11 não existe single
      // Critério: market O/U single odd > 4 OU 1X2 single odd > 6 = quase certo combo
      const isLikelyCombo = (() => {
        const fam = marketFamily(r.market)
        if ((fam === 'CORNERS' || fam === 'GOALS') && r.odd > 4) return true
        if (fam === 'WINNER' && r.odd > 6) return true
        if (fam === 'BTTS' && r.odd > 3) return true
        return false
      })()
      const sel = directionToPT(r.market_tag, r.line, r.market, t1, t2, r.raw_text)
      picks.push({
        channel_name: r.channel_name,
        match: `${t1} v ${t2}`,
        home_team: t1,
        away_team: t2,
        market_raw: r.market,
        market: marketToPT(r.market),
        market_family: marketFamily(r.market),
        selection: sel,
        likely_combo: isLikelyCombo,
        combo_warning: isLikelyCombo ? '⚠️ Provavelmente combo — odd alta sugere múltipla' : null,
        line: r.line,
        odd: r.odd,
        // Sustentabilidade BAYESIAN (não chute)
        prob_estimate: stats.lcb / 100,  // usa LCB como conservative prob
        wilson_lcb_pct: stats.lcb,
        raw_wr_pct: stats.rawWR,
        bucket_n: stats.n,
        bucket_avg_odd: stats.avgOdd,
        ev_lcb_pct: stats.evLCB,
        // EV recalculado pra ESSA pick específica usando LCB como prob
        ev_pick_pct: +((stats.lcb / 100 * r.odd - 1) * 100).toFixed(1),
        recommended_stake_pct: 1.0,  // 1% banca padrão pra picks LCB-verified
        posted_at: r.posted_at,
        age_min: Math.round((Date.now() - r.posted_at) / 60000),
      })
    }

    // ─── PASSO 3: Diversifica + dedup
    // Sort: maior EV LCB primeiro
    picks.sort((a, b) => b.ev_pick_pct - a.ev_pick_pct)
    // Dedup por (match, market_family) + max 2 por family + max 2 por canal
    const seenMatchFamily = new Set()
    const familyCount = {}
    const channelCount = {}
    const final = []
    for (const p of picks) {
      const k = `${p.match}|${p.market_family}`
      if (seenMatchFamily.has(k)) continue
      if ((familyCount[p.market_family] || 0) >= 3) continue  // max 3 por family
      if ((channelCount[p.channel_name] || 0) >= 3) continue
      seenMatchFamily.add(k)
      familyCount[p.market_family] = (familyCount[p.market_family] || 0) + 1
      channelCount[p.channel_name] = (channelCount[p.channel_name] || 0) + 1
      final.push(p)
      if (final.length >= maxPicks) break
    }

    return new Response(JSON.stringify({
      ok: true,
      method: 'bayesian_wilson_lcb',
      params: { min_lcb: minLCB, min_bucket_n: minBucketN, hours_window: hoursWindow },
      total_buckets: Object.keys(buckets).length,
      sustainable_buckets: sustainable.size,
      candidate_recent_tips: (recent || []).length,
      picks_returned: final.length,
      market_distribution: familyCount,
      channels_used: channelCount,
      picks: final,
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=180' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
