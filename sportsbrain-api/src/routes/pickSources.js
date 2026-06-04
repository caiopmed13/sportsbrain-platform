// pickSources.js — DB query functions extracted from premiumPicks.js
import { recoverTeams, pairAppearsAdjacent } from './pickUtils.js'

// F2.18 cutoff relaxation: 36h → 72h
// FAIXA posta tips com antecedência (dom/seg para meio de semana).
// Cap antigo de 36h descartava boa parte do material observado nos screenshots.
const TIPSTER_MAX_LOOKBACK_HOURS = 72

export async function getCachedPicks(env, sport) {
  if (!env.SB_DB) return { picks: [], generated_at: null }
  try {
    const row = await env.SB_DB.prepare(
      `SELECT payload, generated_at FROM picks_cache_today WHERE sport = ?`
    ).bind(sport).first()
    if (!row?.payload) return { picks: [], generated_at: null }
    const data = JSON.parse(row.payload)
    return { picks: data.top_props || [], generated_at: row.generated_at }
  } catch { return { picks: [], generated_at: null } }
}

export async function getRecentTipsterTips(env, hours = 24) {
  if (!env.SB_DB) return []
  try {
    const cutoff = Date.now() - hours * 3600_000
    const { results } = await env.SB_DB.prepare(
      `SELECT * FROM telegram_tips
       WHERE posted_at >= ? AND market IS NOT NULL AND odd >= 1.3 AND odd <= 50
       ORDER BY posted_at DESC LIMIT 100`
    ).bind(cutoff).all()
    return (results || []).map(r => ({
      ...r,
      teams: r.teams ? JSON.parse(r.teams) : [],
    }))
  } catch { return [] }
}

// ── Wilson LCB (95% CI) ───────────────────────────────────────────────────
function wilsonLCB(wins, n, z = 1.645) {
  if (!n) return null
  const p = wins / n
  return Math.max(0, ((p + z*z/(2*n)) - z * Math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n))
}

// Cache de WR real por canal — carregado 1x por request (evita N queries)
// key: channel_id, value: { lcb, wins, n }
async function loadChannelWinRates(env) {
  const map = {}
  try {
    const cutoff = Date.now() - 90 * 86_400_000  // 90 dias
    const { results } = await env.SB_DB.prepare(`
      SELECT channel_id,
        SUM(CASE WHEN result='W' THEN 1 ELSE 0 END) AS wins,
        COUNT(*) AS n
      FROM telegram_tips
      WHERE result IN ('W','L') AND posted_at >= ?
      GROUP BY channel_id
      HAVING n >= 8
    `).bind(cutoff).all().catch(() => ({ results: [] }))
    for (const r of results || []) {
      const lcb = wilsonLCB(r.wins, r.n)
      if (lcb !== null) map[r.channel_id] = { lcb, wins: r.wins, n: r.n }
    }
  } catch {}
  return map
}

// Tips dos tipsters convertidas em picks pra usar em TODOS os tiers
// minOdd/maxOdd configurável: tier1 quer odd baixa (1.3-3), tier3 quer alta (4-50)
export async function getTipsterPicksForCombos(env, { hours = 24, minOdd = 1.3, maxOdd = 50, limit = 300 } = {}) {
  if (!env.SB_DB) return []
  try {
    // F2.18: Tipster tips são úteis por até 72h (FAIXA posta dom/seg para jogos meio de semana).
    // Cap antigo 36h descartava ~grande parte do volume observado.
    // Filter result IS NULL continua descartando tips já voidadas, então nada de zumbi.
    const cutoff = Date.now() - Math.min(hours, TIPSTER_MAX_LOOKBACK_HOURS) * 3600_000

    // Carrega WR real por canal (substitui priors inventados)
    const channelWR = await loadChannelWinRates(env)

    const { results } = await env.SB_DB.prepare(
      `SELECT channel_id, channel_name, message_id, market, market_tag, line, odd, teams, raw_text, posted_at, result
       FROM telegram_tips
       WHERE posted_at >= ? AND odd >= ? AND odd <= ? AND market IS NOT NULL
         AND result IS NULL
       ORDER BY posted_at DESC, odd DESC LIMIT ?`
    ).bind(cutoff, minOdd, maxOdd, limit).all()
    return (results || []).map(r => {
      const teamsRaw = r.teams ? JSON.parse(r.teams) : []
      const [t1, t2] = recoverTeams(teamsRaw, r.raw_text)
      // Se ainda assim ambos vazios após recovery, descarta
      if (t1 === '?' && t2 === '?') return null
      // Descarta placeholders genéricos (template words em UPPER)
      const bogusWords = /^(LINHA|JOGADOR|TIME|EQUIPE|MATCH|PONTOS|REBOTES|ASSISTENCIAS|ASI|DIFEREN|MEDIA|TOTAL|MAIS|MENOS|OVER|UNDER|HANDICAP|TEMPO|INTEGRAL|RESULTADO|AMBOS|ESCANTEIOS|CARTOES|CARTÕES|GOLS?|CHUTES|FINAIS|EMPATE|VITORIA|VITÓRIA|VENCE|VENCEDOR|MAPA|JOGO|PARTIDA|ROUND|FASE|LIBERTADORES|CHAMPIONS|COPA|BRASILEIRAO|BRASILEIRÃO|EUROPA|MUNDIAL|FALLEN|SUPERAUMENTADA|SUPER|AUMENTAD[AO]S?|TURBINAD[AO]S?)\b/i
      const ok = (s) => s && s !== '?' && !bogusWords.test(s.split(/\s|-/)[0]) && s.length >= 2
      // HT_ markets: FAIXA posta tips de time único ("Grêmio · Mais 5.5 Chutes 1T")
      const isHtSingle = /^HT_/i.test(r.market || '') && !ok(t2)
      if (isHtSingle ? (!ok(t1) && !ok(t2)) : (!ok(t1) || !ok(t2))) return null
      // F2.50: descarta pares fake de posts multi-jogo (raw_text com vários times mas
      // sem padrão "{t1} vs {t2}"). Ex: MSC TIPS - Especiais → "Palmeiras v Cruzeiro"
      // quando na verdade são 2 jogos separados (Palmeiras vs X + Cruzeiro vs Y).
      // HT single (1 time) é exceção.
      if (!isHtSingle && ok(t1) && ok(t2) && r.raw_text) {
        if (!pairAppearsAdjacent(t1, t2, r.raw_text)) return null
      }

      const channelLow = (r.channel_name || '').toLowerCase()
      const isFaixa = channelLow.includes('faixa')
      const isFocal = /aposta\s*e\s*palpite|aposta.*palpite|palpite.*aposta/i.test(r.channel_name || '')

      // ── PROB REAL: Wilson LCB do canal ou fallback conservador ───────────
      // ANTES: priors inventados 0.78/0.74/0.65
      // AGORA: WR verificado dos últimos 90 dias com intervalo de confiança
      const chWR = channelWR[r.channel_id]
      let probEstimate
      if (chWR && chWR.lcb > 0.50) {
        // Canal tem track record verificado com LCB > 50% → usa LCB real
        probEstimate = chWR.lcb
      } else if (chWR && chWR.n >= 8) {
        // Canal tem dados mas LCB baixo → prior conservador baseado em wins/n reais
        probEstimate = Math.max(0.45, chWR.wins / chWR.n * 0.85)
      } else {
        // Sem dados suficientes → prior neutro conservador (50%, não 65-78% inventado)
        // Picks sem calibração vão para pool mas com probabilidade conservadora
        probEstimate = 0.50
      }
      // Ajusta prob por odd (Bayesian: odds altas = prob menor, independente de canal)
      if (r.odd >= 10) probEstimate *= 0.60
      else if (r.odd >= 5) probEstimate *= 0.75
      else if (r.odd >= 3) probEstimate *= 0.88
      // EXTRACT DC ESPECIFICO (1X/12/X2) do raw_text — corrige "Chance Dupla: Chance Dupla"
      let dcSpecific = null
      if (r.market === 'DOUBLE_CHANCE' && r.raw_text) {
        const txt = String(r.raw_text).toLowerCase()
        if (/\b1x|casa\s+(ou|\/)\s+empate|home\s+(or|\/)\s+draw/i.test(txt)) dcSpecific = '1X'
        else if (/\bx2|empate\s+(ou|\/)\s+(fora|visitante)/i.test(txt)) dcSpecific = 'X2'
        else if (/\b12|sem\s+empate|casa\s+(ou|\/)\s+fora/i.test(txt)) dcSpecific = '12'
      }
      // Selection PT-BR específica (não mais "over_corners 3" ou "dc" cru)
      const mt = (r.market_tag || '').toLowerCase()
      const isBtts = /BTTS|ambos\s*marcam/i.test(r.market || '')
      let sel
      if (/^over/.test(mt)) sel = isBtts ? 'Sim' : `Mais de ${r.line ?? ''}`.trim()
      else if (/^under/.test(mt)) sel = isBtts ? 'Não' : `Menos de ${r.line ?? ''}`.trim()
      else if (mt === 'dc' || mt === 'double_chance') sel = (typeof dcSpecific !== 'undefined' && dcSpecific === '1X') ? `${t1} ou Empate` : (typeof dcSpecific !== 'undefined' && dcSpecific === '12') ? `Sem Empate (${t1} ou ${t2})` : (typeof dcSpecific !== 'undefined' && dcSpecific === 'X2') ? `Empate ou ${t2}` : 'Chance Dupla'
      else if (mt === '1x') sel = `${t1} ou Empate`
      else if (mt === '12') sel = `${t1} ou ${t2}`
      else if (mt === 'x2') sel = `Empate ou ${t2}`
      else if (mt === 'home' || mt === '1' || mt === 'win') sel = `${t1} Vence`
      else if (mt === 'away' || mt === '2') sel = `${t2} Vence`
      else if (mt === 'draw' || mt === 'x') sel = 'Empate'
      else if (mt === 'btts' || mt === 'yes' || mt === 'sim') sel = 'Ambos Marcam: Sim'
      else if (mt === 'no' || mt === 'não') sel = 'Ambos Marcam: Não'
      else sel = (r.line ? `Linha ${r.line}` : (r.market || 'Tip'))
      const teamA = ok(t1) ? t1 : t2
      const teamB = ok(t2) ? t2 : null
      return {
        match: teamB ? `${teamA} v ${teamB}` : teamA,
        match_id: `tipster_${r.message_id}`,
        home_team: teamA, away_team: teamB,
        league: r.channel_name?.includes('FAIXA') ? 'Tipster (FAIXA)' : 'Tipster Telegram',
        kickoff: null,  // tipster tips: data do jogo desconhecida — assume hoje
        market: r.market, stat: r.market_tag,
        line: r.line, direction: r.market_tag, team: isHtSingle ? teamA : null, player_name: null,
        selection: sel,
        book_odds: r.odd, odd: r.odd,
        prob: probEstimate, conf: probEstimate * 100, confidence: probEstimate * 100,
        ev_pct: +((probEstimate * r.odd - 1) * 100).toFixed(2),
        consensus_count: 1, consensus_channels: 1,
        score: 0, recommended_stake_pct: 1,
        bet365: false, odd_source: 'tipster', source: 'tipster',
        posted_at: r.posted_at,
        // ── METADATA pra UI exibir badge + análise ────────
        channel_name: r.channel_name,
        is_focal: isFocal,
        is_faixa: isFaixa,
        analysis: r.raw_text ? String(r.raw_text).slice(0, 1500) : null,
        // Evidência real do canal (não inventada)
        channel_wr_lcb: chWR ? +(chWR.lcb * 100).toFixed(1) : null,
        channel_wr_n:   chWR ? chWR.n : 0,
        _has_real_wr:   !!(chWR && chWR.n >= 8),  // flag: prob veio de dados reais
      }
    }).filter(Boolean)
  } catch { return [] }
}
