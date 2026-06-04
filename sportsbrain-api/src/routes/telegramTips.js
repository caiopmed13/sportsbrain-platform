// ═══════════════════════════════════════════════════════════════════════════
// telegramTips.js — Ingest e leaderboard de tipsters Telegram
// ═══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js'

async function ensureTable(db) {
  // ALTER TABLE pra adicionar colunas se não existirem (idempotente)
  await db.exec(
    `CREATE TABLE IF NOT EXISTS telegram_tips (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL, message_id TEXT NOT NULL, posted_at INTEGER NOT NULL, raw_text TEXT, sport TEXT, market TEXT, market_tag TEXT, line REAL, odd REAL, stake REAL, stake_type TEXT, teams TEXT, confidence_score REAL, result TEXT, settled_at INTEGER, matched_pick_id TEXT, created_at INTEGER NOT NULL)`
  )
  // Adiciona colunas novas (ignora erro se já existem)
  await db.exec(`ALTER TABLE telegram_tips ADD COLUMN ocr_extracted INTEGER DEFAULT 0`).catch(() => {})
  await db.exec(`ALTER TABLE telegram_tips ADD COLUMN has_media INTEGER DEFAULT 0`).catch(() => {})
  await db.exec(`ALTER TABLE telegram_tips ADD COLUMN combo_group_id TEXT`).catch(() => {})
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_channel ON telegram_tips(channel_id, posted_at DESC)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_market ON telegram_tips(market, posted_at DESC)`)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_tg_combo ON telegram_tips(combo_group_id)`).catch(() => {})
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_unique ON telegram_tips(channel_id, message_id)`)
}

// POST /internal/ingest-telegram-tips
export async function handleIngestTelegramTips(request, env) {
  const secret = request.headers.get('X-Ingest-Secret')
  if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
  }
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const body = await request.json()
    const tips = body.tips || []
    if (!tips.length) return new Response(JSON.stringify({ ok: true, saved: 0 }), { status: 200, headers: corsHeaders() })

    let saved = 0, dupes = 0
    for (const t of tips) {
      const p = t.parsed || {}
      try {
        await env.SB_DB.prepare(
          `INSERT INTO telegram_tips (channel_id, channel_name, message_id, posted_at, raw_text, sport, market, market_tag, line, odd, stake, stake_type, teams, confidence_score, ocr_extracted, has_media, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          t.channel_id, t.channel_name, t.message_id, t.posted_at, t.raw_text,
          p.sport || 'unknown', p.market || null, p.market_tag || null, p.line || null, p.odd || null, p.stake || null, p.stake_type || null,
          JSON.stringify(p.teams || []), p.confidence_score || 0,
          t.ocr_extracted ? 1 : 0, t.has_media ? 1 : 0, Date.now()
        ).run()
        saved++
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) dupes++
      }
    }
    // Prune tips >2 anos (era 90 dias — bloqueava bootstrap histórico)
    await env.SB_DB.prepare(`DELETE FROM telegram_tips WHERE posted_at < ?`).bind(Date.now() - 730*86400_000).run().catch(()=>{})
    return new Response(JSON.stringify({ ok: true, saved, dupes }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/tipsters — leaderboard
export async function handleTipstersLeaderboard(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 90)
    const cutoff = Date.now() - days * 86400_000

    // Stats por canal
    const { results } = await env.SB_DB.prepare(`
      SELECT
        channel_id, channel_name,
        COUNT(*) AS total_tips,
        SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) AS pending,
        AVG(odd) AS avg_odd,
        AVG(confidence_score) AS avg_confidence
      FROM telegram_tips
      WHERE posted_at >= ?
      GROUP BY channel_id
      ORDER BY total_tips DESC
      LIMIT 100
    `).bind(cutoff).all()

    const tipsters = (results || []).map(r => {
      const resolved = r.wins + r.losses
      const wr = resolved > 0 ? +((r.wins / resolved) * 100).toFixed(1) : null
      // ROI estimate: assume avg odd e flat stake 1u
      const roi = resolved > 0 ? +(((r.wins * (r.avg_odd - 1)) - r.losses) / resolved * 100).toFixed(1) : null
      return {
        channel_id: r.channel_id,
        channel_name: r.channel_name,
        total_tips: r.total_tips,
        wins: r.wins, losses: r.losses, pending: r.pending,
        win_rate: wr, roi_pct: roi,
        avg_odd: +r.avg_odd?.toFixed(2),
        avg_confidence: +r.avg_confidence?.toFixed(2),
      }
    })

    return new Response(JSON.stringify({
      ok: true,
      cutoff_days: days,
      tipsters_count: tipsters.length,
      tipsters,
    }), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'public, max-age=300' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/tips-feed?hours=24&channel=xxx
export async function handleTipsFeed(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const hours = Math.min(parseInt(url.searchParams.get('hours') || '24', 10), 17520)  // até 2 anos
    const channel = url.searchParams.get('channel')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 10000)
    const onlyPending = url.searchParams.get('only_pending') === '1'
    const cutoff = Date.now() - hours * 3600_000
    let sql = `SELECT * FROM telegram_tips WHERE posted_at >= ?`
    const binds = [cutoff]
    if (channel) { sql += ` AND channel_id = ?`; binds.push(channel) }
    if (onlyPending) sql += ` AND result IS NULL`
    sql += ` ORDER BY posted_at DESC LIMIT ${limit}`
    const { results } = await env.SB_DB.prepare(sql).bind(...binds).all()
    const tips = (results || []).map(r => ({
      ...r,
      teams: r.teams ? JSON.parse(r.teams) : [],
    }))
    return new Response(JSON.stringify({ ok: true, count: tips.length, tips }), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'public, max-age=120' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/follow-tipster?channel=X&min_odd=5&hours=24
// Retorna tips RECENTES dos canais escolhidos com filtro de odd alta.
// Frontend usa pra mostrar "Picks Recomendados de Tipsters" — copia direto.
export async function handleFollowTipster(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const channel = url.searchParams.get('channel')   // partial name match
    const minOdd = parseFloat(url.searchParams.get('min_odd') || '0')
    const maxOdd = parseFloat(url.searchParams.get('max_odd') || '999')
    const hours = Math.min(parseInt(url.searchParams.get('hours') || '24', 10), 168)
    const cutoff = Date.now() - hours * 3600_000

    let sql = `SELECT * FROM telegram_tips WHERE posted_at >= ? AND odd >= ? AND odd <= ? AND market IS NOT NULL`
    const binds = [cutoff, minOdd, maxOdd]
    if (channel) {
      sql += ` AND channel_name LIKE ?`
      binds.push(`%${channel}%`)
    }
    sql += ` ORDER BY posted_at DESC LIMIT 200`

    const { results } = await env.SB_DB.prepare(sql).bind(...binds).all()
    const tips = (results || []).map(r => ({
      ...r,
      teams: r.teams ? JSON.parse(r.teams) : [],
    }))

    // Group by tipster com summary
    const byChannel = {}
    for (const t of tips) {
      const k = t.channel_name
      if (!byChannel[k]) byChannel[k] = []
      byChannel[k].push(t)
    }

    return new Response(JSON.stringify({
      ok: true,
      filters: { channel, min_odd: minOdd, max_odd: maxOdd, hours },
      total_tips: tips.length,
      channels: Object.keys(byChannel).length,
      tips,
      by_channel: Object.entries(byChannel).map(([name, arr]) => ({
        channel: name,
        count: arr.length,
        avg_odd: +(arr.reduce((s, t) => s + (t.odd || 0), 0) / arr.length).toFixed(2),
      })),
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'public, max-age=120' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/combos-grouped?channel=X&hours=720
// Retorna tips agrupadas por combo_group_id (FAIXA VIP-style — tips com mesma odd
// em janela curta são partes de mesmo combo dividido em fotos).
export async function handleCombosGrouped(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const channelId = url.searchParams.get('channel') || ''
    const hours = Math.min(parseInt(url.searchParams.get('hours') || '720', 10), 17520)
    const cutoff = Date.now() - hours * 3600_000

    let sql = `SELECT * FROM telegram_tips WHERE posted_at >= ? AND combo_group_id IS NOT NULL`
    const binds = [cutoff]
    if (channelId) { sql += ` AND channel_id = ?`; binds.push(channelId) }
    sql += ` ORDER BY combo_group_id, posted_at`
    const { results } = await env.SB_DB.prepare(sql).bind(...binds).all()
    const tips = results || []

    // Agrupa por combo_group_id
    const grouped = {}
    for (const t of tips) {
      const k = t.combo_group_id
      if (!grouped[k]) grouped[k] = []
      grouped[k].push({ ...t, teams: t.teams ? JSON.parse(t.teams) : [] })
    }

    // Formata combos
    const combos = Object.entries(grouped).map(([groupId, parts]) => {
      const w = parts.filter(p => p.result === 'W').length
      const l = parts.filter(p => p.result === 'L').length
      // Combined result: W se TODOS partes são W, L se ALGUM é L, else pending
      const result = parts.every(p => p.result === 'W') ? 'W'
                   : parts.some(p => p.result === 'L') ? 'L'
                   : null
      // Combined odd = PRODUTO das odds individuais (cada foto = 1 leg)
      const combinedOdd = parts.reduce((acc, p) => acc * (p.odd || 1), 1)
      // Possíveis duplas: C(n,2) combinações de pares
      const possibleDuplas = parts.length >= 2
        ? parts.flatMap((a, i) => parts.slice(i+1).map(b => +(a.odd * b.odd).toFixed(2)))
        : []
      return {
        combo_group_id: groupId,
        channel_name: parts[0].channel_name,
        n_parts: parts.length,
        combined_odd: +combinedOdd.toFixed(2),  // ODD da QUADRA/QUINTUPLA/etc
        individual_odds: parts.map(p => p.odd),
        possible_duplas: possibleDuplas.slice(0, 10),
        posted_at: Math.min(...parts.map(p => p.posted_at)),
        result,
        parts: parts.map(p => ({
          message_id: p.message_id,
          posted_at: p.posted_at,
          market: p.market,
          line: p.line,
          odd: p.odd,
          teams: p.teams,
          raw_text: (p.raw_text || '').slice(0, 200),
          ocr_extracted: !!p.ocr_extracted,
        })),
      }
    }).sort((a, b) => b.posted_at - a.posted_at)

    // Stats
    const wins = combos.filter(c => c.result === 'W').length
    const losses = combos.filter(c => c.result === 'L').length
    const pending = combos.filter(c => c.result === null).length

    return new Response(JSON.stringify({
      ok: true,
      total_combos: combos.length,
      total_tips: tips.length,
      stats: {
        wins, losses, pending,
        win_rate: (wins + losses) > 0 ? +(wins / (wins + losses) * 100).toFixed(1) : null,
      },
      combos: combos.slice(0, 100),
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=180' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/tipster-quality-score — TQS por (channel × market × odd_band)
// Bayesian shrinkage com prior global. Output: score 0-100 + multiplier pra picks.
// Usado pelo football.js pra boost confidence quando alinhado com tipsters bons.
export async function handleTipsterQualityScore(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const { results } = await env.SB_DB.prepare(
      `SELECT channel_id, channel_name, market, market_tag, odd, result FROM telegram_tips WHERE result IN ('W','L')`
    ).all()
    const tips = results || []
    if (!tips.length) return new Response(JSON.stringify({ ok: true, scores: [], global_wr: null }), { status: 200, headers: corsHeaders() })

    // Global WR (prior pra Bayesian shrinkage)
    const totalW = tips.filter(t => t.result === 'W').length
    const globalWR = totalW / tips.length

    // Buckets: channel × market × odd_band
    const oddBand = (o) => {
      if (!o) return 'unknown'
      if (o < 1.5) return '1.0-1.5'
      if (o < 2.0) return '1.5-2.0'
      if (o < 3.0) return '2.0-3.0'
      if (o < 5.0) return '3.0-5.0'
      if (o < 10.0) return '5.0-10.0'
      return '10.0+'
    }
    const buckets = {}
    for (const t of tips) {
      const key = `${t.channel_id}|${t.market || 'unknown'}|${oddBand(t.odd)}`
      if (!buckets[key]) buckets[key] = {
        channel_id: t.channel_id, channel_name: t.channel_name,
        market: t.market || 'unknown', odd_band: oddBand(t.odd),
        wins: 0, losses: 0, total_odd: 0,
      }
      buckets[key][t.result === 'W' ? 'wins' : 'losses']++
      buckets[key].total_odd += t.odd || 0
    }

    // Calcula TQS via Bayesian: posterior = (k*prior + wins) / (k*prior + k*(1-prior) + n)
    // k=8 (prior strength). Score 0-100 = posterior × 100.
    const K = 8
    const scores = Object.values(buckets).map(b => {
      const n = b.wins + b.losses
      const posterior = (K * globalWR + b.wins) / (K + n)
      const expected_value = b.total_odd / n * posterior - 1   // ROI esperado por unidade
      return {
        channel_id: b.channel_id,
        channel_name: b.channel_name,
        market: b.market,
        odd_band: b.odd_band,
        n, wins: b.wins, losses: b.losses,
        raw_wr: +(b.wins / n * 100).toFixed(1),
        tqs: +(posterior * 100).toFixed(1),  // 0-100
        ev_pct: +(expected_value * 100).toFixed(1),
        avg_odd: +(b.total_odd / n).toFixed(2),
      }
    }).filter(s => s.n >= 3)  // mínimo 3 amostras
      .sort((a, b) => b.tqs - a.tqs)

    // Top buckets com TQS alta (>= 50% e EV > 0)
    const profitable = scores.filter(s => s.tqs >= 50 && s.ev_pct > 0)

    return new Response(JSON.stringify({
      ok: true,
      method: 'bayesian_tqs',
      global_wr: +(globalWR * 100).toFixed(1),
      total_tips_resolved: tips.length,
      sample_buckets: scores.length,
      profitable_buckets: profitable.length,
      scores: scores.slice(0, 100),
      profitable,
      meta: { prior_strength: K, min_sample: 3 },
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// Helper exportado pra football.js usar diretamente
export async function getTipsterQualityScores(env) {
  if (!env.SB_DB) return { scores: {}, global_wr: 0.5 }
  try {
    const { results } = await env.SB_DB.prepare(
      `SELECT channel_id, channel_name, market, odd, result FROM telegram_tips WHERE result IN ('W','L')`
    ).all()
    const tips = results || []
    if (!tips.length) return { scores: {}, global_wr: 0.5 }
    const totalW = tips.filter(t => t.result === 'W').length
    const globalWR = totalW / tips.length
    const oddBand = (o) => o < 2 ? 'low' : o < 5 ? 'mid' : o < 10 ? 'high' : 'very_high'
    const buckets = {}
    for (const t of tips) {
      const key = `${t.channel_id}|${t.market || 'unknown'}|${oddBand(t.odd)}`
      if (!buckets[key]) buckets[key] = { wins: 0, losses: 0 }
      buckets[key][t.result === 'W' ? 'wins' : 'losses']++
    }
    const K = 8
    const scores = {}
    for (const [key, b] of Object.entries(buckets)) {
      const n = b.wins + b.losses
      if (n < 3) continue
      const posterior = (K * globalWR + b.wins) / (K + n)
      scores[key] = { tqs: posterior, n, wins: b.wins, losses: b.losses }
    }
    return { scores, global_wr: globalWR }
  } catch {
    return { scores: {}, global_wr: 0.5 }
  }
}

// POST /internal/group-combos?channel=X&window_min=5
// FAIXA VIP-style: posta um BILHETE em N fotos consecutivas (cada foto = 1 leg).
// Cada foto tem sua odd individual. A combined_odd = produto de TODAS.
// Ex: 4 fotos (13 × 10 × 11 × 10) = QUADRA ODD 14300.
//
// Algoritmo: agrupa tips do mesmo canal em janela curta (±5min) como UM combo.
// Reset do "antes mesma odd" — agora junta por TIMESTAMP independente da odd.
export async function handleGroupCombos(request, env) {
  const secret = request.headers.get('X-Ingest-Secret')
  if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
  }
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const channelId = url.searchParams.get('channel') || ''
    const windowMin = parseInt(url.searchParams.get('window_min') || '5', 10)
    const windowMs = windowMin * 60_000
    const reset = url.searchParams.get('reset') === '1'  // re-agrupa todos se reset=1

    // Reset: limpa combo_group_id existentes pra re-grouping
    if (reset) {
      let resetSql = `UPDATE telegram_tips SET combo_group_id = NULL`
      if (channelId) resetSql += ` WHERE channel_id = '${channelId.replace(/'/g, '')}'`
      await env.SB_DB.prepare(resetSql).run().catch(()=>{})
    }

    let sql = `SELECT id, channel_id, message_id, posted_at, odd, raw_text FROM telegram_tips WHERE odd IS NOT NULL AND combo_group_id IS NULL`
    const binds = []
    if (channelId) { sql += ` AND channel_id = ?`; binds.push(channelId) }
    sql += ` ORDER BY channel_id, posted_at`
    const { results } = await env.SB_DB.prepare(sql).bind(...binds).all()
    const tips = results || []

    // Agrupa por canal × janela temporal (NÃO mais por odd igual)
    // Cada foto consecutiva no mesmo canal em ±windowMs = parte do mesmo combo
    const groups = []
    let i = 0
    while (i < tips.length) {
      const group = [tips[i]]
      let j = i + 1
      while (j < tips.length) {
        const prev = group[group.length - 1]
        const curr = tips[j]
        // Mesmo canal + dentro da janela (gap entre tips consecutivas)
        if (curr.channel_id === prev.channel_id &&
            Math.abs(curr.posted_at - prev.posted_at) <= windowMs) {
          group.push(curr)
          j++
        } else break
      }
      if (group.length >= 2) groups.push(group)
      i = j > i ? j : i + 1
    }

    // Update D1
    let updated = 0
    for (const group of groups) {
      const groupId = `combo_${group[0].id}_${Date.now().toString(36)}`
      for (const tip of group) {
        await env.SB_DB.prepare(`UPDATE telegram_tips SET combo_group_id = ? WHERE id = ?`).bind(groupId, tip.id).run().catch(()=>{})
        updated++
      }
    }

    // Stats: distribuição de tamanho dos grupos
    const sizeDist = {}
    for (const g of groups) {
      sizeDist[g.length] = (sizeDist[g.length] || 0) + 1
    }

    return new Response(JSON.stringify({
      ok: true,
      analyzed: tips.length,
      groups_found: groups.length,
      tips_grouped: updated,
      window_min: windowMin,
      size_distribution: sizeDist,   // {2: 50, 3: 20, 4: 5} etc
    }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// POST /internal/cleanup-standalone-greens — remove rows market_tag='green_standalone'
// (são mensagens-resultado, não tips reais — inflam métricas se mantidas)
export async function handleCleanupStandaloneGreens(request, env) {
  const secret = request.headers.get('X-Ingest-Secret')
  if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
  }
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    const r = await env.SB_DB.prepare(`DELETE FROM telegram_tips WHERE market_tag = 'green_standalone'`).run()
    return new Response(JSON.stringify({ ok: true, deleted: r.meta?.changes || 0 }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// POST /internal/update-tips-results — script verify-greens manda updates W/L + standalone greens
export async function handleUpdateTipsResults(request, env) {
  const secret = request.headers.get('X-Ingest-Secret')
  if (secret !== env.SB_INGEST_SECRET && secret !== env.SB_MASTER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: corsHeaders() })
  }
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const body = await request.json()
    const { channel_id, channel_name, updates = [], standalone_greens = [] } = body
    let updated = 0, inserted = 0

    // 1. UPDATE tips matched (resultado de tip prévia)
    for (const u of updates) {
      try {
        const r = await env.SB_DB.prepare(
          `UPDATE telegram_tips SET result = ?, settled_at = ? WHERE channel_id = ? AND message_id = ?`
        ).bind(u.result, Date.now(), channel_id, u.tip_message_id).run()
        if (r.meta?.changes > 0) updated++
      } catch {}
    }

    // 2. Standalone greens — APENAS LOG, não inserir como tip
    // (mensagens-resultado isoladas inflam WR. Mantemos só matched W/L.)
    // Se quiser persistir, usar tabela telegram_jackpots separada (futuro).

    return new Response(JSON.stringify({
      ok: true, updated, inserted_greens: inserted,
      total_processed: updates.length + standalone_greens.length,
    }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/report?days=180 — RELATÓRIO COMPLETO pra IA ler
// Análise multi-dimensional: tipsters, markets, horários, ligas, consensus, trends.
// Output otimizado pra ser feature de ML (estrutura limpa, métricas calculáveis).
export async function handleTelegramReport(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const days = Math.min(parseInt(url.searchParams.get('days') || '180', 10), 365)
    const cutoff = Date.now() - days * 86400_000
    const { results } = await env.SB_DB.prepare(`SELECT * FROM telegram_tips WHERE posted_at >= ? ORDER BY posted_at DESC`).bind(cutoff).all()
    const tips = results || []
    if (!tips.length) return new Response(JSON.stringify({ ok: true, message: 'no tips', total: 0 }), { status: 200, headers: corsHeaders() })

    // ─── Helpers ─────────────────────────────────────────────────────────
    const wins = (arr) => arr.filter(t => t.result === 'W').length
    const losses = (arr) => arr.filter(t => t.result === 'L').length
    const resolved = (arr) => arr.filter(t => t.result === 'W' || t.result === 'L').length
    const pending = (arr) => arr.filter(t => t.result === null).length
    const wr = (arr) => { const r = resolved(arr); return r > 0 ? +(wins(arr)/r*100).toFixed(1) : null }
    // ROI: assume flat 1u, win = (odd-1), loss = -1
    const roi = (arr) => {
      const r = resolved(arr)
      if (r === 0) return null
      let net = 0
      for (const t of arr) {
        if (t.result === 'W') net += (t.odd || 1) - 1
        else if (t.result === 'L') net -= 1
      }
      return +(net / r * 100).toFixed(1)
    }
    const avg = (arr, key) => {
      const v = arr.map(t => t[key]).filter(x => x != null && Number.isFinite(x))
      return v.length ? +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : null
    }

    // ─── 1. POR CANAL ────────────────────────────────────────────────────
    const byChannel = {}
    for (const t of tips) {
      const k = t.channel_name
      if (!byChannel[k]) byChannel[k] = []
      byChannel[k].push(t)
    }
    const channels = Object.entries(byChannel).map(([name, arr]) => ({
      name,
      total: arr.length,
      wins: wins(arr), losses: losses(arr), pending: pending(arr),
      win_rate: wr(arr), roi_pct: roi(arr),
      avg_odd: avg(arr, 'odd'),
      avg_confidence: avg(arr, 'confidence_score'),
      ocr_pct: +((arr.filter(t => t.ocr_extracted).length / arr.length) * 100).toFixed(0),
      first_tip: Math.min(...arr.map(t => t.posted_at)),
      last_tip: Math.max(...arr.map(t => t.posted_at)),
    })).sort((a,b) => b.total - a.total)

    // ─── 2. POR MERCADO ──────────────────────────────────────────────────
    const byMarket = {}
    for (const t of tips) {
      const k = t.market || 'unknown'
      if (!byMarket[k]) byMarket[k] = []
      byMarket[k].push(t)
    }
    const markets = Object.entries(byMarket).map(([name, arr]) => ({
      name, total: arr.length,
      wins: wins(arr), losses: losses(arr),
      win_rate: wr(arr), roi_pct: roi(arr),
      avg_odd: avg(arr, 'odd'),
    })).sort((a,b) => b.total - a.total)

    // ─── 3. POR FAIXA DE ODD ─────────────────────────────────────────────
    const oddBands = [
      { label: '1.0-1.5',  min: 1.0,  max: 1.5  },
      { label: '1.5-2.0',  min: 1.5,  max: 2.0  },
      { label: '2.0-3.0',  min: 2.0,  max: 3.0  },
      { label: '3.0-5.0',  min: 3.0,  max: 5.0  },
      { label: '5.0-10.0', min: 5.0,  max: 10.0 },
      { label: '10.0+',    min: 10.0, max: Infinity },
    ]
    const oddBandStats = oddBands.map(b => {
      const arr = tips.filter(t => t.odd >= b.min && t.odd < b.max)
      return { ...b, total: arr.length, wins: wins(arr), losses: losses(arr), win_rate: wr(arr), roi_pct: roi(arr) }
    })

    // ─── 4. POR HORA DO DIA (BRT) ────────────────────────────────────────
    const byHour = {}
    for (const t of tips) {
      const h = new Date(t.posted_at - 3*3600_000).getUTCHours()  // BRT
      if (!byHour[h]) byHour[h] = []
      byHour[h].push(t)
    }
    const hours = Object.entries(byHour).map(([h, arr]) => ({
      hour_brt: parseInt(h, 10),
      total: arr.length, wins: wins(arr), losses: losses(arr),
      win_rate: wr(arr), roi_pct: roi(arr),
    })).sort((a,b) => a.hour_brt - b.hour_brt)

    // ─── 5. POR DIA DA SEMANA ────────────────────────────────────────────
    const dows = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
    const byDow = {}
    for (const t of tips) {
      const d = dows[new Date(t.posted_at - 3*3600_000).getUTCDay()]
      if (!byDow[d]) byDow[d] = []
      byDow[d].push(t)
    }
    const daysOfWeek = Object.entries(byDow).map(([d, arr]) => ({
      day: d, total: arr.length, wins: wins(arr), losses: losses(arr),
      win_rate: wr(arr), roi_pct: roi(arr),
    }))

    // ─── 6. CONSENSUS — quando 3+ canais batem em mesma tip ──────────────
    const consensusBuckets = {}
    for (const t of tips) {
      const teams = t.teams ? JSON.parse(t.teams) : []
      const key = `${t.market || '?'}|${t.market_tag || '?'}|${t.line || ''}|${teams.join(',')}`
      if (!consensusBuckets[key]) consensusBuckets[key] = []
      consensusBuckets[key].push(t)
    }
    const consensusFound = Object.entries(consensusBuckets)
      .filter(([_, arr]) => arr.length >= 3)
      .map(([key, arr]) => ({
        key,
        unique_channels: new Set(arr.map(t => t.channel_id)).size,
        total: arr.length,
        wins: wins(arr), losses: losses(arr), pending: pending(arr),
        win_rate: wr(arr), avg_odd: avg(arr, 'odd'),
      }))
      .filter(c => c.unique_channels >= 2)
      .sort((a,b) => b.unique_channels - a.unique_channels)
      .slice(0, 100)

    // ─── 7. SUMÁRIO GERAL ────────────────────────────────────────────────
    const overall = {
      total_tips: tips.length,
      resolved: resolved(tips),
      pending: pending(tips),
      wins: wins(tips), losses: losses(tips),
      overall_win_rate: wr(tips),
      overall_roi: roi(tips),
      via_ocr: tips.filter(t => t.ocr_extracted).length,
      via_text: tips.filter(t => !t.ocr_extracted).length,
      unique_channels: channels.length,
      unique_markets: markets.length - (markets.find(m => m.name === 'unknown') ? 1 : 0),
      time_range: {
        oldest: tips.length ? Math.min(...tips.map(t => t.posted_at)) : null,
        newest: tips.length ? Math.max(...tips.map(t => t.posted_at)) : null,
      },
    }

    // ─── 8. TOP/BOTTOM TIPSTERS por critério ─────────────────────────────
    const minSample = 10  // mínimo pra ranquear
    const ranked = channels.filter(c => resolved({length: c.wins+c.losses, filter: () => []}) >= 0 && (c.wins+c.losses) >= minSample)
    const top_by_roi = [...ranked].filter(c => c.roi_pct != null).sort((a,b) => b.roi_pct - a.roi_pct).slice(0, 10)
    const top_by_wr  = [...ranked].filter(c => c.win_rate != null).sort((a,b) => b.win_rate - a.win_rate).slice(0, 10)
    const top_by_volume = channels.slice(0, 10)
    const worst = [...ranked].filter(c => c.roi_pct != null).sort((a,b) => a.roi_pct - b.roi_pct).slice(0, 5)

    return new Response(JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      analysis_window_days: days,
      overall,
      by_channel: channels,
      by_market: markets,
      by_odd_band: oddBandStats,
      by_hour_brt: hours,
      by_day_of_week: daysOfWeek,
      consensus: consensusFound,
      rankings: {
        top_by_roi,
        top_by_win_rate: top_by_wr,
        top_by_volume,
        worst_by_roi: worst,
        min_sample_for_ranking: minSample,
      },
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/ml-features — features estruturadas pra ML model consumir
// Retorna matriz pra cada (channel, market, conf_band, odd_band) → WR + ROI + N
export async function handleTelegramMLFeatures(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const cutoff = Date.now() - 365 * 86400_000
    const { results } = await env.SB_DB.prepare(`SELECT channel_id, channel_name, market, market_tag, line, odd, confidence_score, result FROM telegram_tips WHERE posted_at >= ? AND (result = 'W' OR result = 'L')`).bind(cutoff).all()
    const tips = results || []

    const features = {}
    for (const t of tips) {
      const oddBand = t.odd < 1.5 ? '1.0-1.5' : t.odd < 2.0 ? '1.5-2.0' : t.odd < 3.0 ? '2.0-3.0' : t.odd < 5.0 ? '3.0-5.0' : '5.0+'
      const confBand = t.confidence_score >= 0.8 ? 'high' : t.confidence_score >= 0.6 ? 'medium' : 'low'
      const k = `${t.channel_id}|${t.market || '?'}|${oddBand}|${confBand}`
      if (!features[k]) features[k] = { wins: 0, losses: 0, channel_id: t.channel_id, channel_name: t.channel_name, market: t.market, odd_band: oddBand, conf_band: confBand }
      if (t.result === 'W') features[k].wins++
      else if (t.result === 'L') features[k].losses++
    }
    const arr = Object.values(features).map(f => {
      const tot = f.wins + f.losses
      return { ...f, total: tot, win_rate: tot > 0 ? +(f.wins/tot).toFixed(3) : null }
    }).filter(f => f.total >= 5).sort((a,b) => b.total - a.total)

    return new Response(JSON.stringify({
      ok: true,
      total_features: arr.length,
      sample_size: tips.length,
      features: arr,
    }), { status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=900' }) })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/telegram/consensus?date=YYYY-MM-DD — pra fixtures de hoje, conta quantos tipsters
// concordam em cada market+selection. Sinal de "consenso social".
export async function handleConsensus(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const hours = Math.min(parseInt(url.searchParams.get('hours') || '12', 10), 72)
    const cutoff = Date.now() - hours * 3600_000
    // Agrupa por (market+market_tag+line) e team mention
    const { results } = await env.SB_DB.prepare(`
      SELECT market, market_tag, line, teams, COUNT(DISTINCT channel_id) AS unique_channels,
             COUNT(*) AS total_tips, AVG(odd) AS avg_odd
      FROM telegram_tips
      WHERE posted_at >= ? AND market IS NOT NULL
      GROUP BY market, market_tag, line, teams
      HAVING unique_channels >= 2
      ORDER BY unique_channels DESC, total_tips DESC
      LIMIT 50
    `).bind(cutoff).all()
    const consensus = (results || []).map(r => ({
      market: r.market, market_tag: r.market_tag, line: r.line,
      teams: r.teams ? JSON.parse(r.teams) : [],
      unique_channels: r.unique_channels, total_tips: r.total_tips,
      avg_odd: +r.avg_odd?.toFixed(2),
    }))
    return new Response(JSON.stringify({ ok: true, hours, consensus }), {
      status: 200,
      headers: corsHeaders({ 'Cache-Control': 'public, max-age=180' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}

// GET /v1/picks/greens?days=7 — picks vencedores recentes pra prova social
// v2: combina telegram_tips (tipsters) + premium_pick_exposures (engine Premium).
// Separa singles e combos. Informa odd, lucro em unidade, mercado, tier, fonte.
// Nunca mistura pick pendente com green real.
export async function handlePicksGreens(request, env) {
  if (!env.SB_DB) return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), { status: 503, headers: corsHeaders() })
  try {
    await ensureTable(env.SB_DB)
    const url = new URL(request.url)
    const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10), 90)
    const source = url.searchParams.get('source') || 'all' // 'all'|'premium'|'tipsters'
    const cutoff = Date.now() - days * 86400_000

    // ── 1. Greens do engine Premium (premium_pick_exposures) ─────────────
    let premiumGreens = []
    if (source === 'all' || source === 'premium') {
      const { results: premRows } = await env.SB_DB.prepare(`
        SELECT
          id, pick_date, sport, home_team, away_team, league,
          market, selection, line, odd,
          tier, premium_tier_quality, value_bet_level, desajuste_level,
          source, has_steam, is_combo, combo_id,
          result_status, profit_unit, settled_at,
          premium_quality_score
        FROM premium_pick_exposures
        WHERE result_status = 'green'
          AND tier = 'single'
          AND settled_at >= ?
        ORDER BY settled_at DESC
        LIMIT 200
      `).bind(cutoff).all().catch(() => ({ results: [] }))

      premiumGreens = (premRows || []).map(r => ({
        _source_type: 'premium_engine',
        id:            r.id,
        date:          r.pick_date,
        settled_at:    r.settled_at,
        sport:         r.sport,
        match:         `${r.home_team || ''} vs ${r.away_team || ''}`,
        home_team:     r.home_team,
        away_team:     r.away_team,
        league:        r.league,
        market:        r.market,
        selection:     r.selection,
        line:          r.line,
        odd:           r.odd,
        profit_unit:   r.profit_unit,
        tier:          r.premium_tier_quality,
        pqs:           r.premium_quality_score,
        value_bet:     r.value_bet_level,
        desajuste:     r.desajuste_level,
        source:        r.source || 'premium',
        is_combo:      0,
        result:        'green',
        verified:      true,   // resolvido via ESPN
      }))
    }

    // ── 2. Greens de tipsters (telegram_tips) ────────────────────────────
    let tipsterGreens = []
    if (source === 'all' || source === 'tipsters') {
      const { results: tipRows } = await env.SB_DB.prepare(`
        SELECT
          id, channel_id, channel_name, message_id,
          posted_at, raw_text, sport, market, market_tag,
          line, odd, stake, stake_type, teams,
          confidence_score, result, settled_at,
          matched_pick_id, combo_group_id,
          ocr_extracted, has_media, created_at
        FROM telegram_tips
        WHERE result = 'W' AND posted_at >= ?
        ORDER BY posted_at DESC
        LIMIT 200
      `).bind(cutoff).all().catch(() => ({ results: [] }))

      tipsterGreens = (tipRows || []).map(r => {
        const teams = r.teams ? (() => { try { return JSON.parse(r.teams) } catch { return [] } })() : []
        return {
          _source_type: 'tipster',
          id:            r.id,
          date:          new Date(r.posted_at).toISOString().slice(0, 10),
          settled_at:    r.settled_at || r.posted_at,
          sport:         r.sport,
          match:         teams.join(' vs '),
          home_team:     teams[0] || null,
          away_team:     teams[1] || null,
          league:        null,
          market:        r.market,
          selection:     r.market_tag,
          line:          r.line,
          odd:           r.odd,
          profit_unit:   r.odd ? +(r.odd - 1).toFixed(2) : null,
          tier:          null,
          pqs:           null,
          value_bet:     null,
          desajuste:     null,
          source:        r.channel_name || 'tipster',
          is_combo:      r.combo_group_id ? 1 : 0,
          combo_group_id: r.combo_group_id,
          result:        'green',
          verified:      true,
        }
      })
    }

    // ── 3. Combos vencedores (tipsters) ──────────────────────────────────
    const comboWins = {}
    for (const g of tipsterGreens) {
      if (!g.combo_group_id) continue
      if (!comboWins[g.combo_group_id]) comboWins[g.combo_group_id] = []
      comboWins[g.combo_group_id].push(g)
    }
    const winningCombos = Object.entries(comboWins).map(([groupId, parts]) => ({
      combo_group_id: groupId,
      source:         parts[0].source,
      n_parts:        parts.length,
      combined_odd:   +parts.reduce((acc, p) => acc * (p.odd || 1), 1).toFixed(2),
      posted_at:      Math.min(...parts.map(p => p.settled_at || 0)),
      profit_unit:    +(parts.reduce((acc, p) => acc * (p.odd || 1), 1) - 1).toFixed(2),
      parts:          parts.map(p => ({
        market: p.market, selection: p.selection,
        match:  p.match, odd: p.odd,
      })),
    })).sort((a, b) => b.combined_odd - a.combined_odd)

    // ── 4. Merge e sort ──────────────────────────────────────────────────
    const allGreens = [
      ...premiumGreens,
      ...tipsterGreens.filter(g => !g.is_combo),
    ].sort((a, b) => (b.settled_at || 0) - (a.settled_at || 0))

    // ── 5. Métricas ──────────────────────────────────────────────────────
    const withOdd = allGreens.filter(g => g.odd)
    const avgOdd = withOdd.length > 0
      ? +(withOdd.reduce((s, g) => s + g.odd, 0) / withOdd.length).toFixed(2)
      : null
    const totalProfit = premiumGreens.reduce((s, g) => s + (g.profit_unit || 0), 0)
    const maxOdd = withOdd.length > 0 ? Math.max(...withOdd.map(g => g.odd)) : null

    return new Response(JSON.stringify({
      ok: true,
      days,
      source_filter: source,
      total_greens:       allGreens.length,
      premium_greens:     premiumGreens.length,
      tipster_greens:     tipsterGreens.filter(g => !g.is_combo).length,
      winning_combos:     winningCombos.length,
      avg_odd:            avgOdd,
      best_odd:           maxOdd,
      profit_units_premium: +totalProfit.toFixed(2),
      greens:             allGreens,
      winning_combos_detail: winningCombos.slice(0, 20),
      // Separação explícita
      singles:  allGreens.filter(g => !g.is_combo),
      combos:   winningCombos,
    }, null, 2), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders() })
  }
}
