/**
 * /internal/ingest-boosts  (POST) — recebe da GH Actions diariamente 2am
 * /v1/aumentadas/latest    (GET)  — frontend lê os boosts mais recentes
 * /v1/aumentadas/trigger   (POST) — dispara o cron AGORA (GitHub Actions workflow_dispatch)
 *
 * Storage: D1 (SB_DB) tabela aumentadas_snapshots — só guarda o último snapshot
 * com histórico de até 7 dias. Auto-cria tabela no primeiro POST.
 *
 * Trigger manual:
 *   Vars necessárias no worker:
 *     GH_PAT       — Personal Access Token com escopo "actions:write"
 *     GH_REPO      — ex: "caioperp/sportsbrain"
 *     GH_WORKFLOW  — ex: "scrape-bet365-boosts.yml" (default)
 */
import { corsHeaders } from './health.js'
import { isValidIngestSecret } from '../utils/ingestAuth.js'

async function ensureTable(db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS aumentadas_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, captured_at INTEGER NOT NULL, count INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`
  )
}

async function ensureMatchTable(db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS bet365_matches_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at INTEGER NOT NULL, count INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`
  )
}

async function ensureMarketsTable(db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS bet365_markets_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at INTEGER NOT NULL, count INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`
  )
}

export async function handleAumentadasIngest(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
      status: 405, headers: corsHeaders(),
    })
  }
  if (!isValidIngestSecret(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401, headers: corsHeaders(),
    })
  }
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE' }), {
      status: 503, headers: corsHeaders(),
    })
  }
  let body
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ ok: false, error: 'BAD_JSON' }), {
      status: 400, headers: corsHeaders(),
    })
  }
  const { source, capturedAt, boosts, matches, markets } = body
  if (!Array.isArray(boosts) && !Array.isArray(matches) && !Array.isArray(markets)) {
    return new Response(JSON.stringify({ ok: false, error: 'BOOSTS_OR_MATCHES_OR_MARKETS_REQUIRED' }), {
      status: 400, headers: corsHeaders(),
    })
  }

  try {
    const ts = capturedAt || Date.now()
    let savedBoosts = 0, savedMatches = 0, savedMarkets = 0

    if (Array.isArray(boosts) && boosts.length) {
      await ensureTable(env.SB_DB)
      const payload = JSON.stringify(boosts)
      await env.SB_DB.prepare(
        `INSERT INTO aumentadas_snapshots (source, captured_at, count, payload, created_at) VALUES (?,?,?,?,?)`
      ).bind(source || 'bet365', ts, boosts.length, payload, Date.now()).run()
      savedBoosts = boosts.length
      // Cleanup: mantém só últimos 30 dias
      const cutoff = Date.now() - 30 * 86400_000
      await env.SB_DB.prepare(`DELETE FROM aumentadas_snapshots WHERE created_at < ?`).bind(cutoff).run()
    }

    if (Array.isArray(matches) && matches.length) {
      await ensureMatchTable(env.SB_DB)
      const mPayload = JSON.stringify(matches)
      await env.SB_DB.prepare(
        `INSERT INTO bet365_matches_snapshots (captured_at, count, payload, created_at) VALUES (?,?,?,?)`
      ).bind(ts, matches.length, mPayload, Date.now()).run()
      savedMatches = matches.length
      const cutoff = Date.now() - 30 * 86400_000
      await env.SB_DB.prepare(`DELETE FROM bet365_matches_snapshots WHERE created_at < ?`).bind(cutoff).run()
    }

    // Lineups capturadas pelo CDP scraper (proprietário) — Fase B
    if (Array.isArray(body.lineups) && body.lineups.length) {
      try {
        await env.SB_DB.exec(`CREATE TABLE IF NOT EXISTS bet365_lineups (fixture_id TEXT PRIMARY KEY, payload TEXT, captured_at INTEGER)`).catch(() => {})
        for (const L of body.lineups) {
          if (!L.fixtureId) continue
          await env.SB_DB.prepare(`INSERT OR REPLACE INTO bet365_lineups VALUES (?,?,?)`)
            .bind(L.fixtureId, JSON.stringify(L), Date.now()).run().catch(() => {})
        }
      } catch {}
    }

    if (Array.isArray(markets) && markets.length) {
      await ensureMarketsTable(env.SB_DB)
      const mkPayload = JSON.stringify(markets)
      await env.SB_DB.prepare(
        `INSERT INTO bet365_markets_snapshots (captured_at, count, payload, created_at) VALUES (?,?,?,?)`
      ).bind(ts, markets.length, mkPayload, Date.now()).run()
      savedMarkets = markets.length
      const cutoff = Date.now() - 30 * 86400_000
      await env.SB_DB.prepare(`DELETE FROM bet365_markets_snapshots WHERE created_at < ?`).bind(cutoff).run()
    }

    return new Response(JSON.stringify({
      ok: true, boosts: savedBoosts, matches: savedMatches, markets: savedMarkets, capturedAt: ts,
    }), { status: 200, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}

// GET /v1/bet365/matches/latest — retorna o último snapshot de partidas Bet365 com odds 1/X/2
export async function handleBet365MatchesLatest(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE', matches: [] }), {
      status: 503, headers: corsHeaders({ 'Cache-Control': 'no-store' }),
    })
  }
  try {
    await ensureMatchTable(env.SB_DB)
    const row = await env.SB_DB.prepare(
      `SELECT captured_at, count, payload FROM bet365_matches_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first()
    if (!row) {
      return new Response(JSON.stringify({ ok: true, matches: [], capturedAt: null }), {
        status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=60' }),
      })
    }
    let matches = []
    try { matches = JSON.parse(row.payload) } catch {}
    return new Response(JSON.stringify({
      ok: true, capturedAt: row.captured_at, count: row.count, matches,
    }), {
      status: 200, headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message, matches: [] }), {
      status: 500, headers: corsHeaders(),
    })
  }
}

// Dispara o workflow manualmente via GitHub Actions API (workflow_dispatch)
export async function handleAumentadasTrigger(request, env) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
      status: 405, headers: corsHeaders(),
    })
  }
  const pat = env.GH_PAT
  const repo = env.GH_REPO            // ex: "caioperp/sportsbrain"
  const workflow = env.GH_WORKFLOW || 'scrape-bet365-boosts.yml'
  const branch = env.GH_BRANCH || 'master'
  if (!pat || !repo) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'NOT_CONFIGURED',
      message: 'Configure GH_PAT e GH_REPO via wrangler secret/var no worker',
    }), { status: 503, headers: corsHeaders() })
  }
  try {
    const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'sportsbrain-worker',
      },
      body: JSON.stringify({ ref: branch }),
    })
    if (!res.ok) {
      const detail = await res.text()
      return new Response(JSON.stringify({
        ok: false, error: 'GH_API_ERROR', status: res.status, detail: detail.slice(0, 400),
      }), { status: 502, headers: corsHeaders() })
    }
    return new Response(JSON.stringify({
      ok: true,
      message: 'Workflow disparado. Resultado disponível em ~3min.',
      workflow, repo,
      pollIntervalSec: 15,
      // Novo scraper API faz NAV per-match → ~270s scrape + ~90s setup GH runner = ~6min
      maxWaitSec: 600,
    }), { status: 202, headers: corsHeaders() })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'NETWORK', detail: e.message }), {
      status: 500, headers: corsHeaders(),
    })
  }
}

// GET /v1/bet365/markets/latest — retorna o último snapshot de mercados Bet365
// (1X2, O/U, BTTS, Player Props, NBA Props) extraídos dos coupons do scraper
// API. Pipeline: bet365-api.mjs extractMarkets() → /internal/ingest-boosts →
// bet365_markets_snapshots → este endpoint.
export async function handleBet365MarketsLatest(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE', markets: [] }), {
      status: 503, headers: corsHeaders({ 'Cache-Control': 'no-store' }),
    })
  }
  try {
    await ensureMarketsTable(env.SB_DB)
    const row = await env.SB_DB.prepare(
      `SELECT captured_at, count, payload FROM bet365_markets_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first()
    if (!row) {
      return new Response(JSON.stringify({ ok: true, markets: [], capturedAt: null, message: 'no_data_yet' }), {
        status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=60' }),
      })
    }
    let markets = []
    try { markets = JSON.parse(row.payload) } catch {}
    return new Response(JSON.stringify({
      ok: true,
      capturedAt: row.captured_at,
      count: row.count,
      markets,
    }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message, markets: [] }), {
      status: 500, headers: corsHeaders(),
    })
  }
}

export async function handleAumentadasLatest(request, env) {
  if (!env.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_UNAVAILABLE', boosts: [] }), {
      status: 503, headers: corsHeaders({ 'Cache-Control': 'no-store' }),
    })
  }
  try {
    await ensureTable(env.SB_DB)
    const row = await env.SB_DB.prepare(
      `SELECT source, captured_at, count, payload FROM aumentadas_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first()
    if (!row) {
      return new Response(JSON.stringify({ ok: true, boosts: [], capturedAt: null, message: 'no_data_yet' }), {
        status: 200, headers: corsHeaders({ 'Cache-Control': 'public, max-age=60' }),
      })
    }
    let boosts = []
    try { boosts = JSON.parse(row.payload) } catch {}
    return new Response(JSON.stringify({
      ok: true,
      source: row.source,
      capturedAt: row.captured_at,
      count: row.count,
      boosts,
    }), {
      status: 200,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_ERROR', detail: e.message, boosts: [] }), {
      status: 500, headers: corsHeaders(),
    })
  }
}
