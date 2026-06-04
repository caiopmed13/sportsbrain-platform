// cartolaIngest.js — F2.52
// Ingest stats por jogador do Brasileirão A via Cartola FC API pública.
// Endpoint: api.cartola.globo.com (sem auth, JSON limpo).
//
// Por que: ESPN não tem play-by-play pra Brasileirão. Cartola tem scout
// agregado por jogador por rodada (FF, FD, FT, G, A, DS, FC, FS, CA).
//
// Schema novo: player_match_aggs (cria automaticamente se não existir).
// Granularidade: 1 row por (player, partida).
//
// Source mapping:
//   FF = Finalização Fora (shot off target)
//   FD = Finalização Defendida (shot saved)
//   FT = Finalização na Trave (shot on post)
//   G  = Gol
//   total_shots     = FF + FD + FT + G
//   shots_on_target = FD + FT + G  (qualquer chute que ia no gol)

const CARTOLA_BASE = 'https://api.cartola.globo.com';
const HTTP_TIMEOUT_MS = 12_000;

function normPlayer(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normTeam(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b|\be\.?c\.?\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return await res.json();
}

/**
 * Garante schema da tabela player_match_aggs. Idempotente.
 */
async function ensureSchema(env) {
  await Promise.allSettled([
    env.SB_DB.prepare(`
      CREATE TABLE IF NOT EXISTS player_match_aggs (
        match_id TEXT NOT NULL,
        source TEXT NOT NULL,
        season INTEGER,
        rodada INTEGER,
        partida_data TEXT,
        team_norm TEXT,
        is_home INTEGER,
        player_name TEXT,
        player_norm TEXT,
        shots INTEGER DEFAULT 0,
        shots_on_target INTEGER DEFAULT 0,
        goals INTEGER DEFAULT 0,
        assists INTEGER DEFAULT 0,
        tackles INTEGER DEFAULT 0,
        fouls_committed INTEGER DEFAULT 0,
        fouls_suffered INTEGER DEFAULT 0,
        yellow INTEGER DEFAULT 0,
        red INTEGER DEFAULT 0,
        minutes_played INTEGER,
        scout_raw TEXT,
        ingested_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (match_id, player_norm, source)
      )
    `).run(),
    env.SB_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pma_player_norm ON player_match_aggs(player_norm)`).run(),
    env.SB_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pma_team_norm ON player_match_aggs(team_norm)`).run(),
    env.SB_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pma_rodada ON player_match_aggs(season, rodada)`).run(),
  ]);
}

/**
 * Ingere uma rodada do Brasileirão A via Cartola.
 * @param {object} env
 * @param {number} rodada
 * @param {number} season - default ano atual
 * @returns {object} stats
 */
export async function ingestCartolaRound(env, rodada, season = null) {
  if (!env?.SB_DB) return { error: 'no db' };
  if (!Number.isFinite(rodada) || rodada < 1 || rodada > 38) return { error: 'invalid rodada' };
  const seasonInt = season || new Date().getUTCFullYear();

  await ensureSchema(env);

  // 1) Partidas da rodada (mapping partida_id → clube_casa/visitante + data)
  const partidasJson = await fetchJson(`${CARTOLA_BASE}/partidas/${rodada}`);
  const clubes = partidasJson?.clubes || {};
  const partidas = partidasJson?.partidas || [];
  if (!partidas.length) return { rodada, error: 'no partidas' };

  // Mapeia clube_id → { partida_id, is_home, opponent, data, match_id }
  const clubeToPartida = new Map();
  for (const p of partidas) {
    const pid = p.partida_id;
    const data = (p.partida_data || '').replace(' ', 'T');
    const home = clubes[String(p.clube_casa_id)] || {};
    const away = clubes[String(p.clube_visitante_id)] || {};
    const matchId = `cartola|${seasonInt}|${pid}`;
    clubeToPartida.set(String(p.clube_casa_id), {
      partida_id: pid, match_id: matchId, is_home: 1,
      team_norm: normTeam(home.nome || home.abreviacao),
      partida_data: data,
    });
    clubeToPartida.set(String(p.clube_visitante_id), {
      partida_id: pid, match_id: matchId, is_home: 0,
      team_norm: normTeam(away.nome || away.abreviacao),
      partida_data: data,
    });
  }

  // 2) Pontuados da rodada (scout por jogador)
  const pontuadosJson = await fetchJson(`${CARTOLA_BASE}/atletas/pontuados/${rodada}`);
  const atletas = pontuadosJson?.atletas || {};

  const stmts = [];
  let playersIngested = 0;
  let shootersCount = 0;

  for (const [aid, a] of Object.entries(atletas)) {
    const scout = a?.scout || {};
    const ff = scout.FF || 0;
    const fd = scout.FD || 0;
    const ft = scout.FT || 0;
    const g  = scout.G  || 0;
    const totalShots = ff + fd + ft + g;
    const shotsOT = fd + ft + g;

    const clubeId = String(a.clube_id || '');
    const partidaInfo = clubeToPartida.get(clubeId);
    if (!partidaInfo) continue;  // jogador de clube sem partida nesta rodada (estranho mas skip)

    const playerName = a.apelido || a.nome || `cartola_${aid}`;
    const playerNorm = normPlayer(playerName);
    if (!playerNorm) continue;

    if (totalShots > 0) shootersCount++;

    stmts.push(env.SB_DB.prepare(`
      INSERT INTO player_match_aggs
        (match_id, source, season, rodada, partida_data, team_norm, is_home,
         player_name, player_norm, shots, shots_on_target, goals,
         assists, tackles, fouls_committed, fouls_suffered, yellow, red, scout_raw)
      VALUES (?, 'cartola', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id, player_norm, source) DO UPDATE SET
        shots=excluded.shots,
        shots_on_target=excluded.shots_on_target,
        goals=excluded.goals,
        assists=excluded.assists,
        tackles=excluded.tackles,
        fouls_committed=excluded.fouls_committed,
        fouls_suffered=excluded.fouls_suffered,
        yellow=excluded.yellow,
        red=excluded.red,
        scout_raw=excluded.scout_raw,
        ingested_at=datetime('now')
    `).bind(
      partidaInfo.match_id, seasonInt, rodada, partidaInfo.partida_data,
      partidaInfo.team_norm, partidaInfo.is_home,
      playerName, playerNorm,
      totalShots, shotsOT, g,
      scout.A || 0,
      scout.DS || 0,
      scout.FC || 0,
      scout.FS || 0,
      scout.CA || 0,
      scout.CV || 0,  // cartão vermelho
      JSON.stringify(scout),
    ));
    playersIngested++;
  }

  // Batch inserts (D1 limit ~100)
  for (let i = 0; i < stmts.length; i += 80) {
    await env.SB_DB.batch(stmts.slice(i, i + 80));
  }

  return {
    rodada, season: seasonInt,
    partidas: partidas.length,
    players_ingested: playersIngested,
    shooters: shootersCount,
  };
}

/**
 * Backfill múltiplas rodadas. Util pra primeira ingestão.
 */
export async function backfillCartola(env, opts = {}) {
  const season = opts.season || new Date().getUTCFullYear();
  const fromRodada = opts.fromRodada || 1;
  const toRodada = opts.toRodada || 38;

  // Descobre rodada atual via /mercado/status
  let currentRodada = toRodada;
  try {
    const status = await fetchJson(`${CARTOLA_BASE}/mercado/status`);
    if (Number.isFinite(status?.rodada_atual)) currentRodada = Math.min(toRodada, status.rodada_atual);
  } catch {}

  const results = [];
  for (let r = fromRodada; r <= currentRodada; r++) {
    try {
      const s = await ingestCartolaRound(env, r, season);
      results.push(s);
    } catch (e) {
      results.push({ rodada: r, error: e.message });
    }
  }

  const totalShooters = results.reduce((a, r) => a + (r.shooters || 0), 0);
  const totalPlayers = results.reduce((a, r) => a + (r.players_ingested || 0), 0);
  return {
    season,
    rodadas_processadas: results.length,
    rodada_atual: currentRodada,
    total_players: totalPlayers,
    total_shooters: totalShooters,
    per_rodada: results,
  };
}
