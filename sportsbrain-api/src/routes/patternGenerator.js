// patternGenerator.js — agrega telegram_tips + pick_history W/L em tip_patterns
// Chamado por cron diário (GitHub Actions) via GET /internal/update-patterns
//
// Wilson LCB 90% CI sobre buckets (market × odd_band × league_tier × fav_strength).
// Padrões com LCB ≥ 55% e n_total ≥ 5 são considerados confiáveis para gerar picks próprios.
//
// FONTES:
//   telegram_tips   — tips de tipsters do Telegram (histórico)
//   pick_history    — picks premium gerados pelo AI (principal fonte de aprendizado)

import { corsHeaders } from './health.js'
import { isValidIngestSecret } from '../utils/ingestAuth.js'

async function ensurePatternsTable(db) {
  // D1 exec() requer SQL single-line (sem quebras de linha)
  await db.exec(`CREATE TABLE IF NOT EXISTS tip_patterns (id INTEGER PRIMARY KEY AUTOINCREMENT, market TEXT NOT NULL, odd_band TEXT NOT NULL, league_tier TEXT NOT NULL, fav_strength TEXT NOT NULL, n_total INTEGER DEFAULT 0, n_won INTEGER DEFAULT 0, win_rate REAL DEFAULT 0.0, wilson_lcb REAL DEFAULT 0.0, updated_at TEXT DEFAULT (datetime('now')), UNIQUE(market, odd_band, league_tier, fav_strength))`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tip_patterns_lcb ON tip_patterns(wilson_lcb DESC)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tip_patterns_market ON tip_patterns(market, odd_band)`)
}

function wilsonLCB(w, n, z = 1.645) {
  if (!n) return 0
  const p = w / n
  return Math.max(0, ((p + z*z/(2*n)) - z * Math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n))
}

export function oddBandOf(odd) {
  if (odd < 1.5) return '<1.5'
  if (odd < 2.0) return '1.5-2.0'
  if (odd < 3.0) return '2.0-3.0'
  if (odd < 5.0) return '3.0-5.0'
  if (odd < 10.0) return '5.0-10.0'
  return '10.0+'
}

// Inferência de liga por nome de canal ou match string. Sem API externa — heurísticas.
export function leagueTierOf(channelName, teams) {
  const cn = (channelName || '').toLowerCase()
  const tm = (teams || []).join(' ').toLowerCase()
  const combined = cn + ' ' + tm
  const top5 = /premier|laliga|bundesliga|serie.a|ligue.1|champions|arsenal|chelsea|liverpool|man.city|real.madrid|barcelona|psg|juventus|milan|inter|dortmund|bayern|atletico/i
  if (top5.test(combined)) return 'top5_eu'
  const sa = /brasileir[aã]o|libertadores|sudamericana|flamengo|palmeiras|atletico|gremio|internacional|corinthians|santos|boca|river|nacional|penarol|alianza/i
  if (sa.test(combined)) return 'south_america'
  return 'other'
}

export function favStrengthOf(odd) {
  if (odd < 1.5) return 'heavy'
  if (odd < 2.5) return 'moderate'
  return 'tossup'
}

// Normaliza pick_history.stat (PT ou EN) → categoria de mercado padronizada
// Usada para unificar pick_history com telegram_tips no aprendizado
export function marketFromStat(stat) {
  const s = (stat || '').toLowerCase()
  // Escanteios / Corners
  if (/corner|escantei|canto|canti/.test(s)) return 'CORNERS_OU'
  // BTTS / Ambos Marcam
  if (/btts|ambos.*marc|both.*score/.test(s)) return 'BTTS'
  // Dupla Hipótese / Double Chance
  if (/double.chance|dupla.hip|dupla.chance/.test(s)) return 'DOUBLE_CHANCE'
  // Resultado / 1X2
  if (/\b1x2\b|match.winner|result|resultado/.test(s)) return '1X2'
  // Total gols
  if (/total.gol|total.goal|gols.no.jogo/.test(s)) return 'TOTAL_GOALS'
  // Cartões
  if (/cart|card/.test(s)) return 'CARDS'
  // Chutes / Finalizações
  if (/shot|chute|finaliz/.test(s)) return 'SHOTS'
  // Faltas / Fouls
  if (/foul|falta/.test(s)) return 'FOULS'
  // Handicap
  if (/handicap/.test(s)) return 'HANDICAP'
  // Player stats
  if (/player|jogador|marca.assist|desarme/.test(s)) return 'PLAYER_PROP'
  return (stat || 'OTHER').toUpperCase().replace(/\s+/g, '_').slice(0, 30)
}

export async function handleUpdatePatterns(request, env) {
  // Auth — contrato único de ingest (Fase 1). Antes aceitava
  // ?secret=, X-Admin-Key, X-Master-Key e SB_MASTER_KEY;
  // agora SÓ X-Ingest-Secret === SB_INGEST_SECRET.
  if (!isValidIngestSecret(request, env)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  if (!env.SB_DB) {
    return new Response(JSON.stringify({ error: 'no db' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }

  try {
    await ensurePatternsTable(env.SB_DB)

    // ── Fonte 1: telegram_tips ────────────────────────────────────────────
    const { results: tipsterRows } = await env.SB_DB.prepare(
      `SELECT market, odd, result, channel_name, teams FROM telegram_tips
       WHERE result IN ('W', 'L') AND odd > 0 AND market IS NOT NULL`
    ).all().catch(() => ({ results: [] }))

    // ── Fonte 2: pick_history (premium AI picks) ─────────────────────────
    const { results: pickRows } = await env.SB_DB.prepare(
      `SELECT stat, real_odd, result, league, home_team, away_team FROM pick_history
       WHERE result IN ('W', 'L') AND real_odd > 0 AND stat IS NOT NULL`
    ).all().catch(() => ({ results: [] }))

    const totalResolved = (tipsterRows?.length || 0) + (pickRows?.length || 0)

    if (totalResolved === 0) {
      return new Response(JSON.stringify({ ok: true, updated: 0, message: 'no resolved tips or picks' }), {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
      })
    }

    const buckets = new Map()

    // Agrega telegram_tips
    for (const t of (tipsterRows || [])) {
      let teams = []
      try { teams = t.teams ? JSON.parse(t.teams) : [] } catch {}
      const key = [
        (t.market || 'unknown').toUpperCase(),
        oddBandOf(t.odd),
        leagueTierOf(t.channel_name, teams),
        favStrengthOf(t.odd),
      ].join('||')
      if (!buckets.has(key)) buckets.set(key, { n: 0, w: 0 })
      const b = buckets.get(key)
      b.n++
      if (t.result === 'W') b.w++
    }

    // Agrega pick_history (premium AI — fonte primária de aprendizado)
    for (const p of (pickRows || [])) {
      const odd = parseFloat(p.real_odd) || 0
      if (odd <= 1 || odd > 500) continue
      const market = marketFromStat(p.stat)
      const teams = [p.home_team, p.away_team].filter(Boolean)
      const key = [
        market,
        oddBandOf(odd),
        leagueTierOf(p.league, teams),
        favStrengthOf(odd),
      ].join('||')
      if (!buckets.has(key)) buckets.set(key, { n: 0, w: 0 })
      const b = buckets.get(key)
      b.n++
      if (p.result === 'W') b.w++
    }

    const MIN_SAMPLES = 5
    let updated = 0
    const top10 = []

    for (const [key, { n, w }] of buckets.entries()) {
      if (n < MIN_SAMPLES) continue
      const [market, odd_band, league_tier, fav_strength] = key.split('||')
      const win_rate = w / n
      const lcb = wilsonLCB(w, n)

      await env.SB_DB.prepare(`
        INSERT INTO tip_patterns (market, odd_band, league_tier, fav_strength, n_total, n_won, win_rate, wilson_lcb, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(market, odd_band, league_tier, fav_strength) DO UPDATE SET
          n_total = excluded.n_total,
          n_won = excluded.n_won,
          win_rate = excluded.win_rate,
          wilson_lcb = excluded.wilson_lcb,
          updated_at = excluded.updated_at
      `).bind(market, odd_band, league_tier, fav_strength, n, w, win_rate, lcb).run()

      updated++
      top10.push({ market, odd_band, league_tier, fav_strength, n, win_rate: +(win_rate*100).toFixed(1), lcb: +(lcb*100).toFixed(1) })
    }

    return new Response(JSON.stringify({
      ok: true,
      total_resolved: totalResolved,
      tipster_tips: tipsterRows?.length || 0,
      premium_picks: pickRows?.length || 0,
      buckets_processed: buckets.size,
      patterns_updated: updated,
      top10_by_lcb: top10.sort((a,b) => b.lcb - a.lcb).slice(0, 10),
    }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[patterns] erro:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    })
  }
}
