/**
 * Cron Harvester: ESPN → D1 (matches_raw + shot_events + officials)
 * ─────────────────────────────────────────────────────────────────
 * Roda no cron hourly (0 * * * *) via env.SB_DB.
 *
 * Estratégia:
 *   1. Lista scoreboards de hoje + ontem em todas ligas top
 *   2. Para cada jogo com status='post' ou 'in', busca /summary (tem plays)
 *   3. Normaliza plays → shot_events com xG calculado pelo nosso modelo
 *   4. Extrai árbitro do summary.article.plays[] + venue coords
 *   5. Tudo em transaction D1 (batch) — idempotente via UPSERT match_id
 *
 * Resultado: D1 acumula ~50-100 jogos/dia, ~300-800 chutes/dia. Em 30 dias
 * temos ~15-25k chutes — suficiente para retreinar modelo próprio (Fase 5).
 */

import { xgFromEspnPlay, XG_MODEL_VERSION } from '../models/xgModel.js';

const ESPN_LEAGUES = [
  // Top-5 europeias
  'eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1',
  // 2ª divisão das grandes
  'eng.2', 'esp.2', 'ger.2', 'ita.2', 'fra.2',
  // Europa (resto)
  'por.1', 'ned.1', 'bel.1', 'sco.1', 'tur.1', 'gre.1', 'rus.1', 'aut.1', 'sui.1',
  // Brasil
  'bra.1', 'bra.2', 'bra.3',
  'bra.copa_do_brazil', 'bra.copa_do_nordeste',
  'bra.camp.paulista', 'bra.camp.carioca', 'bra.camp.mineiro', 'bra.camp.gaucho',
  // Am\u00e9rica do Sul
  'arg.1', 'arg.copa', 'col.1', 'chi.1', 'uru.1', 'par.1', 'per.1', 'ecu.1', 'ven.1', 'bol.1',
  // Am\u00e9rica do Norte
  'usa.1', 'usa.2', 'mex.1', 'mex.2', 'can.1', 'crc.1',
  // \u00c1sia & Oceania
  'jpn.1', 'kor.1', 'chn.1', 'aus.1', 'ksa.1', 'uae.1', 'qat.1',
  // Competi\u00e7\u00f5es internacionais
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'uefa.super_cup',
  'conmebol.libertadores', 'conmebol.sudamericana', 'conmebol.america', 'conmebol.recopa',
  'concacaf.champions', 'concacaf.gold',
  'fifa.world', 'fifa.cwc',
];

function normTeam(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìî]/g, 'i')
    .replace(/[óòôõö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/\bfc\b|\bsc\b|\bac\b|\bcf\b|\bafc\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

async function fetchScoreboard(leagueSlug, dateStr) {
  const d = dateStr.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/scoreboard?dates=${d}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.events || [];
}

async function fetchMatchSummary(leagueSlug, eventId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  return await res.json();
}

function extractOfficials(summary) {
  const out = [];
  const officials = summary?.gameInfo?.officials || summary?.boxscore?.officials || [];
  for (const o of officials) {
    const name = o.fullName || o.displayName || o.name;
    if (!name) continue;
    out.push({
      role: (o.position?.displayName || o.position?.name || 'center').toLowerCase(),
      name,
      norm: normTeam(name),
    });
  }
  return out;
}

function extractLineups(summary, match) {
  const out = [];
  const homeTeamId = summary?.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.id;
  const rosters = summary?.rosters || summary?.boxscore?.teams || [];
  for (const roster of rosters) {
    const teamId = roster.team?.id;
    const isHome = teamId === homeTeamId;
    const teamName = isHome ? match.home_team : match.away_team;
    const formation = roster.formation?.displayName || roster.formation?.name || null;
    const players = roster.roster || roster.players || [];
    for (const p of players) {
      const name = p.athlete?.displayName || p.athlete?.fullName;
      if (!name) continue;
      out.push({
        match_id: match.match_id,
        team: teamName, team_norm: normTeam(teamName),
        is_home: isHome ? 1 : 0,
        formation, is_confirmed: 1,
        player_name: name, player_norm: normTeam(name),
        jersey: p.jersey || p.athlete?.jersey || null,
        position: p.position?.abbreviation || p.position?.name || null,
        is_starter: p.starter === true || p.active === true ? 1 : 0,
        is_captain: p.captain === true ? 1 : 0,
      });
    }
  }
  return out;
}

async function fetchWeather(lat, lon, kickoffIso) {
  if (!lat || !lon || !kickoffIso) return null;
  try {
    const d = new Date(kickoffIso);
    if (isNaN(d.getTime())) return null;
    const date = d.toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                `&hourly=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,weather_code` +
                `&start_date=${date}&end_date=${date}&timezone=UTC`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    const h = d.getUTCHours();
    const hr = data.hourly || {};
    const idx = hr.time ? hr.time.findIndex(t => t.startsWith(`${date}T${String(h).padStart(2,'0')}`)) : -1;
    const pick = idx >= 0 ? idx : Math.min(12, (hr.time || []).length - 1);
    if (pick < 0) return null;
    const temp = hr.temperature_2m?.[pick];
    const precip = hr.precipitation?.[pick] || 0;
    const wind = hr.wind_speed_10m?.[pick] || 0;
    const humidity = hr.relative_humidity_2m?.[pick] || 0;
    const code = hr.weather_code?.[pick];
    // Impacto em gols: chuva forte → -8%, vento >40kmh → -5%, neve → -10%
    let mult = 1.0;
    if (precip > 4) mult -= 0.08;
    else if (precip > 1) mult -= 0.03;
    if (wind > 40) mult -= 0.05;
    else if (wind > 25) mult -= 0.02;
    if ([71,73,75,77,85,86].includes(code)) mult -= 0.10;   // snow
    mult = Math.max(0.82, mult);
    const condition = precip > 2 ? 'rain' : [71,73,75].includes(code) ? 'snow'
                    : [45,48].includes(code) ? 'fog' : [0,1].includes(code) ? 'clear' : 'cloudy';
    return { temp_c: temp, precip_mm: precip, wind_kmh: wind, humidity_pct: humidity,
             condition, goal_impact_mult: +mult.toFixed(3) };
  } catch (err) {
    return null;
  }
}

function extractVenue(event) {
  const comp = event.competitions?.[0];
  const venue = comp?.venue || event?.venue;
  if (!venue) return {};
  return {
    name: venue.fullName || venue.displayName || null,
    lat: venue.address?.coordinates?.latitude ?? null,
    lon: venue.address?.coordinates?.longitude ?? null,
    attendance: comp?.attendance ?? null,
  };
}

function extractShotsFromSummary(summary, match) {
  const plays = summary?.plays || [];
  const shots = [];
  const homeTeamId = summary?.boxscore?.teams?.find(t => t.homeAway === 'home')?.team?.id
                    || summary?.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.id;

  // Primeiro pass: identifica todos os chutes com \u00edndice no array de plays (para xA lookup)
  for (let i = 0; i < plays.length; i++) {
    const play = plays[i];
    const teamId = play.team?.id;
    const isHome = teamId === homeTeamId;
    const shotFeat = xgFromEspnPlay(play, isHome);
    if (!shotFeat) continue;
    const teamName = isHome ? match.home_team : match.away_team;

    // ── xA aproximado: busca o play anterior (\u226410s, mesmo time) que seja pass/assist
    let xaPlayer = null;
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const prev = plays[j];
      if (prev.team?.id !== teamId) break;
      const prevTxt = (prev.text || '').toLowerCase();
      if (/pass|cross|assist|through ball|corner/.test(prevTxt)) {
        xaPlayer = prev.participants?.[0]?.athlete?.displayName || prev.athlete?.displayName || null;
        break;
      }
    }

    shots.push({
      match_id: match.match_id,
      team: teamName,
      team_norm: normTeam(teamName),
      player_name: play.participants?.[0]?.athlete?.displayName || play.athlete?.displayName || null,
      assist_player: xaPlayer,       // xA attribution
      minute: play.clock?.displayValue ? parseInt(play.clock.displayValue) : null,
      period: play.period?.number || null,
      shot_type: shotFeat.shotType,
      body_part: shotFeat.bodyPart,
      x_coord: shotFeat.x,
      y_coord: shotFeat.y,
      distance: shotFeat.distance,
      angle_deg: shotFeat.angle,
      on_target: shotFeat.onTarget,
      is_goal: shotFeat.isGoal,
      xg_computed: shotFeat.xg,
      xg_model_ver: XG_MODEL_VERSION,
      is_home: isHome ? 1 : 0,
    });
  }
  return shots;
}

// F2.49: extrai totals do boxscore quando plays=0 (Brasileirão, ligas sem
// play-by-play detalhado). ESPN cobre Brasileiro Serie A/B/C com boxscore mas
// sem play-by-play. Retorna { home: {shots, sot, corners, ...}, away: {...} }
function extractBoxscoreTotals(summary, match) {
  const teams = summary?.boxscore?.teams || [];
  if (teams.length !== 2) return null;
  const parse = (statsArr) => {
    const out = {};
    for (const s of (statsArr || [])) {
      const k = (s.name || '').toLowerCase();
      const v = parseFloat(s.displayValue);
      if (!Number.isFinite(v)) continue;
      if (k === 'totalshots') out.shots = v;
      else if (k === 'shotsontarget') out.shots_on_target = v;
      else if (k === 'woncorners') out.corners = v;
      else if (k === 'foulscommitted') out.fouls = v;
      else if (k === 'yellowcards') out.yellow = v;
      else if (k === 'redcards') out.red = v;
      else if (k === 'possessionpct') out.possession_pct = v;
      else if (k === 'offsides') out.offsides = v;
    }
    return out;
  };
  // Identifica home vs away pelo homeAway
  const home = teams.find(t => t.homeAway === 'home') || teams[0];
  const away = teams.find(t => t.homeAway === 'away') || teams[1];
  return {
    home: { ...parse(home.statistics), team_name: home.team?.displayName || match.home_team },
    away: { ...parse(away.statistics), team_name: away.team?.displayName || match.away_team },
  };
}

function extractCornersFromSummary(summary, match) {
  const plays = summary?.plays || []
  const corners = []
  const homeTeamId = summary?.boxscore?.teams?.find(t => t.homeAway === 'home')?.team?.id
                    || summary?.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.id

  for (const play of plays) {
    const typeText = (play.type?.text || '').toLowerCase()
    const typeAbbr = (play.type?.abbreviation || '').toLowerCase()
    const playText = (play.text || '').toLowerCase()
    // ESPN uses "Corner Kick" as type.text or "CK" as abbreviation
    const isCorner = typeText.includes('corner') || typeAbbr === 'ck'
                  || (playText.includes('corner kick') && !playText.includes('short corner'))
    if (!isCorner) continue

    const teamId = play.team?.id
    if (!teamId) continue
    const isHome = teamId === homeTeamId
    const teamName = isHome ? match.home_team : match.away_team

    corners.push({
      match_id: match.match_id,
      team:      teamName,
      team_norm: normTeam(teamName),
      is_home:   isHome ? 1 : 0,
      minute:    play.clock?.displayValue ? parseInt(play.clock.displayValue) : null,
      period:    play.period?.number || null,
    })
  }
  return corners
}

// PPDA = passes permitidos pela defesa / a\u00e7\u00f5es defensivas no ter\u00e7o ofensivo
// Aproximado: conta passes do advers\u00e1rio no ter\u00e7o defensivo do time × a\u00e7\u00f5es defensivas
function computePPDA(plays, teamId, homeTeamId) {
  let oppPasses = 0, defActions = 0;
  for (const p of plays) {
    const txt = (p.text || '').toLowerCase();
    const typeTxt = (p.type?.text || '').toLowerCase();
    const pTeam = p.team?.id;
    const pIsHome = pTeam === homeTeamId;
    const weAreHome = teamId === homeTeamId;
    const isSameTeam = pTeam === teamId;

    // Passes do advers\u00e1rio no nosso ter\u00e7o defensivo (x \u2264 33 se somos home, x \u2265 67 se away)
    if (!isSameTeam && /pass|cross/.test(typeTxt + ' ' + txt)) {
      const x = p.coordinate?.x;
      if (x != null) {
        if (weAreHome && x <= 33) oppPasses++;
        if (!weAreHome && x >= 67) oppPasses++;
      }
    }
    // Nossas a\u00e7\u00f5es defensivas no terço alto (pressing)
    if (isSameTeam && /tackle|interception|foul|clearance|duel/.test(typeTxt + ' ' + txt)) {
      const x = p.coordinate?.x;
      if (x != null) {
        if (weAreHome && x >= 50) defActions++;
        if (!weAreHome && x <= 50) defActions++;
      }
    }
  }
  if (defActions === 0) return null;
  return +(oppPasses / defActions).toFixed(2);
}

export async function ingestMatches(env, options = {}) {
  // Auto-migrate: garante que corner_events existe (idempotente)
  await env.SB_DB.prepare(
    `CREATE TABLE IF NOT EXISTS corner_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       match_id TEXT NOT NULL, team TEXT NOT NULL, team_norm TEXT NOT NULL,
       is_home INTEGER NOT NULL, minute INTEGER, period INTEGER,
       created_at TEXT DEFAULT (datetime('now'))
     )`
  ).run().catch(() => {});
  await env.SB_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_corners_match ON corner_events(match_id)`
  ).run().catch(() => {});
  await env.SB_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_corners_team ON corner_events(team_norm, match_id)`
  ).run().catch(() => {});

  const runId = `run_${Date.now()}`;
  const started = Date.now();
  const daysBack = options.daysBack ?? 1;
  const includeFuture = options.includeFuture ?? false;

  const dates = [];
  const today = new Date();
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    dates.push(ymd(d));
  }
  if (includeFuture) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() + 1);
    dates.push(ymd(d));
  }

  // Rota\u00e7\u00e3o de ligas: CF limita ~1000 subrequests/invocation. Dividimos em 4 buckets
  // rotativos por hora (hour % 4). Cada cron pega 1/4 das ligas = ~13 ligas/run.
  // options.allLeagues=true for\u00e7a processar todas (uso manual)
  let leaguesToProcess = ESPN_LEAGUES;
  if (!options.allLeagues) {
    const bucket = options.bucket ?? (new Date().getUTCHours() % 8);
    leaguesToProcess = ESPN_LEAGUES.filter((_, i) => i % 8 === bucket);
  }

  const stats = { fetched: 0, inserted: 0, shots: 0, errors: 0, errorSample: null,
                  bucket: options.bucket ?? null, leaguesProcessed: leaguesToProcess.length };

  for (const league of leaguesToProcess) {
    for (const date of dates) {
      try {
        const events = await fetchScoreboard(league, date);
        stats.fetched += events.length;
        for (const ev of events) {
          try {
            await ingestOneEvent(env, league, ev, stats);
          } catch (err) {
            stats.errors++;
            if (!stats.errorSample) stats.errorSample = `${league}/${ev.id}: ${err.message}`;
          }
        }
      } catch (err) {
        stats.errors++;
        if (!stats.errorSample) stats.errorSample = `${league}@${date}: ${err.message}`;
      }
    }
  }

  const duration = Date.now() - started;
  await env.SB_DB.prepare(
    `INSERT INTO ingestion_log (run_id, source, matches_fetched, matches_inserted, shots_inserted, errors, error_sample, duration_ms)
     VALUES (?, 'espn', ?, ?, ?, ?, ?, ?)`
  ).bind(runId, stats.fetched, stats.inserted, stats.shots, stats.errors, stats.errorSample, duration).run();

  return { runId, ...stats, durationMs: duration };
}

async function ingestOneEvent(env, league, ev, stats) {
  const comp = ev.competitions?.[0];
  if (!comp) return;
  const home = comp.competitors?.find(c => c.homeAway === 'home');
  const away = comp.competitors?.find(c => c.homeAway === 'away');
  if (!home?.team?.displayName || !away?.team?.displayName) return;

  const status = ev.status?.type?.state || 'scheduled';
  const matchId = `espn|${ev.id}`;
  const venue = extractVenue(ev);

  const match = {
    match_id: matchId,
    source: 'espn',
    external_id: ev.id,
    league_slug: league,
    league_name: ev.league?.name || null,
    season: ev.season?.year ? String(ev.season.year) : null,
    match_date: (ev.date || '').slice(0, 10),
    kickoff_iso: ev.date || null,
    status,
    home_team: home.team.displayName,
    away_team: away.team.displayName,
    home_team_norm: normTeam(home.team.displayName),
    away_team_norm: normTeam(away.team.displayName),
    score_home: home.score != null ? parseInt(home.score) : null,
    score_away: away.score != null ? parseInt(away.score) : null,
    score_ht_home: null,
    score_ht_away: null,
    venue: venue.name,
    venue_lat: venue.lat,
    venue_lon: venue.lon,
    attendance: venue.attendance,
  };

  // UPSERT do match
  await env.SB_DB.prepare(`
    INSERT INTO matches_raw (match_id, source, external_id, league_slug, league_name, season,
      match_date, kickoff_iso, status, home_team, away_team, home_team_norm, away_team_norm,
      score_home, score_away, venue, venue_lat, venue_lon, attendance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(match_id) DO UPDATE SET
      status=excluded.status,
      score_home=excluded.score_home,
      score_away=excluded.score_away,
      attendance=excluded.attendance,
      updated_at=datetime('now')
  `).bind(
    match.match_id, match.source, match.external_id, match.league_slug, match.league_name, match.season,
    match.match_date, match.kickoff_iso, match.status, match.home_team, match.away_team,
    match.home_team_norm, match.away_team_norm,
    match.score_home, match.score_away, match.venue, match.venue_lat, match.venue_lon, match.attendance
  ).run();
  stats.inserted++;

  // Só puxa plays/officials se jogo acabou ou está em andamento
  if (status !== 'post' && status !== 'in') return;

  // Verifica se já ingerimos shots deste match
  const existing = await env.SB_DB.prepare(
    `SELECT COUNT(*) as c FROM shot_events WHERE match_id = ?`
  ).bind(matchId).first();
  if (existing?.c > 0 && status === 'post') return;  // já ingerido, skip

  const summary = await fetchMatchSummary(league, ev.id);
  if (!summary) return;

  // Shots
  const shots = extractShotsFromSummary(summary, match);
  if (shots.length) {
    // Batch insert (D1 suporta batch)
    const stmts = shots.map(s => env.SB_DB.prepare(`
      INSERT INTO shot_events (match_id, team, team_norm, player_name, assist_player, minute, period,
        shot_type, body_part, x_coord, y_coord, distance, angle_deg, on_target, is_goal,
        xg_computed, xg_model_ver, is_home)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      s.match_id, s.team, s.team_norm, s.player_name, s.assist_player, s.minute, s.period,
      s.shot_type, s.body_part, s.x_coord, s.y_coord, s.distance, s.angle_deg,
      s.on_target, s.is_goal, s.xg_computed, s.xg_model_ver, s.is_home
    ));
    await env.SB_DB.prepare(`DELETE FROM shot_events WHERE match_id = ?`).bind(matchId).run();
    for (let i = 0; i < stmts.length; i += 100) await env.SB_DB.batch(stmts.slice(i, i + 100));
    stats.shots += shots.length;

    // Compute PPDA + team metrics agregados
    const plays = summary?.plays || [];
    const homeTeamId = summary?.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.id;
    const awayTeamId = summary?.header?.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.id;
    const homeShots = shots.filter(s => s.is_home === 1);
    const awayShots = shots.filter(s => s.is_home === 0);
    const homePPDA = homeTeamId ? computePPDA(plays, homeTeamId, homeTeamId) : null;
    const awayPPDA = awayTeamId ? computePPDA(plays, awayTeamId, homeTeamId) : null;
    const xaHome = homeShots.reduce((a, s) => a + (s.assist_player ? s.xg_computed : 0), 0);
    const xaAway = awayShots.reduce((a, s) => a + (s.assist_player ? s.xg_computed : 0), 0);

    await env.SB_DB.prepare(`DELETE FROM match_team_metrics WHERE match_id = ?`).bind(matchId).run();
    await env.SB_DB.batch([
      env.SB_DB.prepare(`
        INSERT INTO match_team_metrics (match_id, team_norm, is_home, ppda, shots, shots_on_target, xg_total, xa_total)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      `).bind(matchId, normTeam(match.home_team), homePPDA, homeShots.length,
              homeShots.filter(s => s.on_target).length,
              +homeShots.reduce((a, s) => a + s.xg_computed, 0).toFixed(3),
              +xaHome.toFixed(3)),
      env.SB_DB.prepare(`
        INSERT INTO match_team_metrics (match_id, team_norm, is_home, ppda, shots, shots_on_target, xg_total, xa_total)
        VALUES (?, ?, 0, ?, ?, ?, ?, ?)
      `).bind(matchId, normTeam(match.away_team), awayPPDA, awayShots.length,
              awayShots.filter(s => s.on_target).length,
              +awayShots.reduce((a, s) => a + s.xg_computed, 0).toFixed(3),
              +xaAway.toFixed(3)),
    ]);
  }

  // Corners
  const corners = extractCornersFromSummary(summary, match);
  if (corners.length) {
    await env.SB_DB.prepare(`DELETE FROM corner_events WHERE match_id = ?`).bind(matchId).run();
    const cStmts = corners.map(c => env.SB_DB.prepare(`
      INSERT INTO corner_events (match_id, team, team_norm, is_home, minute, period)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(c.match_id, c.team, c.team_norm, c.is_home, c.minute, c.period));
    for (let i = 0; i < cStmts.length; i += 100) await env.SB_DB.batch(cStmts.slice(i, i + 100));
    stats.corners = (stats.corners || 0) + corners.length;
  }

  // F2.49: Fallback boxscore totals — quando ESPN não tem play-by-play (Brasileirão, etc),
  // grava shots/corners totais em match_team_metrics + 1 corner_event sintético por team.
  // HT estimado downstream via HT_RATIO (0.42).
  if (shots.length === 0 || corners.length === 0) {
    const totals = extractBoxscoreTotals(summary, match);
    if (totals?.home && totals?.away) {
      // Garante schema (ALTER cols se schema antigo)
      await Promise.allSettled([
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN corners INTEGER DEFAULT 0').run(),
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN fouls INTEGER DEFAULT 0').run(),
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN yellow INTEGER DEFAULT 0').run(),
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN red INTEGER DEFAULT 0').run(),
      ]);
      // Se shots.length===0 (no play-by-play), grava totals em match_team_metrics
      if (shots.length === 0) {
        await env.SB_DB.prepare(`DELETE FROM match_team_metrics WHERE match_id = ?`).bind(matchId).run();
        await env.SB_DB.batch([
          env.SB_DB.prepare(`INSERT INTO match_team_metrics
            (match_id, team_norm, is_home, possession_pct, shots, shots_on_target, corners, fouls, yellow, red, xg_total, xa_total)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, 0)`).bind(
              matchId, normTeam(match.home_team),
              totals.home.possession_pct ?? null,
              totals.home.shots ?? 0, totals.home.shots_on_target ?? 0,
              totals.home.corners ?? 0, totals.home.fouls ?? 0,
              totals.home.yellow ?? 0, totals.home.red ?? 0,
            ),
          env.SB_DB.prepare(`INSERT INTO match_team_metrics
            (match_id, team_norm, is_home, possession_pct, shots, shots_on_target, corners, fouls, yellow, red, xg_total, xa_total)
            VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0)`).bind(
              matchId, normTeam(match.away_team),
              totals.away.possession_pct ?? null,
              totals.away.shots ?? 0, totals.away.shots_on_target ?? 0,
              totals.away.corners ?? 0, totals.away.fouls ?? 0,
              totals.away.yellow ?? 0, totals.away.red ?? 0,
            ),
        ]);
        stats.shots += (totals.home.shots || 0) + (totals.away.shots || 0);
      }
      stats.boxscore_fallback = (stats.boxscore_fallback || 0) + 1;
    }
  }

  // Lineups
  const lineups = extractLineups(summary, match);
  if (lineups.length) {
    await env.SB_DB.prepare(`DELETE FROM lineups WHERE match_id = ?`).bind(matchId).run();
    const stmts = lineups.map(l => env.SB_DB.prepare(`
      INSERT INTO lineups (match_id, team, team_norm, is_home, formation, is_confirmed,
        player_name, player_norm, jersey, position, is_starter, is_captain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(l.match_id, l.team, l.team_norm, l.is_home, l.formation, l.is_confirmed,
            l.player_name, l.player_norm, l.jersey, l.position, l.is_starter, l.is_captain));
    // D1 batch limit: 100 por chamada
    for (let i = 0; i < stmts.length; i += 100) await env.SB_DB.batch(stmts.slice(i, i + 100));
  }

  // Weather (Open-Meteo) — s\u00f3 busca se jogo j\u00e1 aconteceu (1x por match, cache permanente)
  const weatherExists = await env.SB_DB.prepare(
    `SELECT 1 FROM weather_snapshots WHERE match_id = ?`
  ).bind(matchId).first();
  if (!weatherExists && match.venue_lat && match.venue_lon && match.kickoff_iso && status === 'post') {
    const w = await fetchWeather(match.venue_lat, match.venue_lon, match.kickoff_iso);
    if (w) {
      await env.SB_DB.prepare(`
        INSERT INTO weather_snapshots (match_id, temp_c, humidity_pct, wind_kmh, precip_mm,
          condition, goal_impact_mult, source, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open-meteo', datetime('now'))
        ON CONFLICT(match_id) DO UPDATE SET
          temp_c=excluded.temp_c, humidity_pct=excluded.humidity_pct,
          wind_kmh=excluded.wind_kmh, precip_mm=excluded.precip_mm,
          condition=excluded.condition, goal_impact_mult=excluded.goal_impact_mult,
          fetched_at=datetime('now')
      `).bind(matchId, w.temp_c, w.humidity_pct, w.wind_kmh, w.precip_mm,
              w.condition, w.goal_impact_mult).run();
    }
  }

  // Officials
  const officials = extractOfficials(summary);
  if (officials.length) {
    await env.SB_DB.prepare(`DELETE FROM officials WHERE match_id = ?`).bind(matchId).run();
    const stmts = officials.map(o => env.SB_DB.prepare(`
      INSERT INTO officials (match_id, role, referee_name, referee_norm)
      VALUES (?, ?, ?, ?)
    `).bind(matchId, o.role, o.name, o.norm));
    await env.SB_DB.batch(stmts);
  }
}

/**
 * Recomputa agregados team_xg_rolling a partir de shot_events.
 * Roda após cada ingest (idempotente, TRUNCATE + INSERT).
 */
export async function recomputeTeamXG(env, season) {
  const seasonFilter = season || String(new Date().getFullYear());

  // Agregado por time na season (window='season')
  const rows = await env.SB_DB.prepare(`
    SELECT
      s.team_norm,
      MAX(s.team) as team_display,
      m.league_slug,
      COUNT(DISTINCT s.match_id) as games,
      SUM(s.is_goal) as goals_for,
      SUM(s.xg_computed) as xg_for
    FROM shot_events s
    JOIN matches_raw m ON m.match_id = s.match_id
    WHERE m.season = ? AND m.status = 'post'
    GROUP BY s.team_norm, m.league_slug
  `).bind(seasonFilter).all();

  // xG contra = somar xG dos chutes do ADVERSÁRIO em cada jogo
  const againstRows = await env.SB_DB.prepare(`
    SELECT
      CASE WHEN s.is_home=1 THEN m.away_team_norm ELSE m.home_team_norm END as team_norm,
      m.league_slug,
      SUM(s.xg_computed) as xg_against,
      SUM(s.is_goal) as goals_against
    FROM shot_events s
    JOIN matches_raw m ON m.match_id = s.match_id
    WHERE m.season = ? AND m.status = 'post'
    GROUP BY team_norm, m.league_slug
  `).bind(seasonFilter).all();

  const againstMap = {};
  for (const r of (againstRows.results || [])) {
    againstMap[`${r.team_norm}|${r.league_slug}`] = r;
  }

  const stmts = [];
  for (const row of (rows.results || [])) {
    const key = `${row.team_norm}|${row.league_slug}`;
    const ag = againstMap[key] || { xg_against: 0, goals_against: 0 };
    const games = row.games || 1;
    const xgFor = row.xg_for || 0;
    const xgAgainst = ag.xg_against || 0;
    const goalsFor = row.goals_for || 0;
    const goalsAgainst = ag.goals_against || 0;
    const xgDiff = xgFor - xgAgainst;
    stmts.push(env.SB_DB.prepare(`
      INSERT INTO team_xg_rolling (team_norm, team_display, league_slug, season, window,
        games, goals_for, goals_against, xg_for, xg_against, xg_per90, xga_per90, xg_diff,
        overperf, underperf, updated_at)
      VALUES (?, ?, ?, ?, 'season', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(team_norm, league_slug, season, window) DO UPDATE SET
        team_display=excluded.team_display,
        games=excluded.games,
        goals_for=excluded.goals_for,
        goals_against=excluded.goals_against,
        xg_for=excluded.xg_for,
        xg_against=excluded.xg_against,
        xg_per90=excluded.xg_per90,
        xga_per90=excluded.xga_per90,
        xg_diff=excluded.xg_diff,
        overperf=excluded.overperf,
        underperf=excluded.underperf,
        updated_at=datetime('now')
    `).bind(
      row.team_norm, row.team_display, row.league_slug, seasonFilter,
      games, goalsFor, goalsAgainst, xgFor, xgAgainst,
      +(xgFor / games).toFixed(3), +(xgAgainst / games).toFixed(3), +xgDiff.toFixed(3),
      goalsFor > xgFor + 2.5 ? 1 : 0,
      goalsFor < xgFor - 2.5 ? 1 : 0,
    ));
  }
  if (stmts.length) await env.SB_DB.batch(stmts);
  return { teamsAggregated: stmts.length, season: seasonFilter };
}

/**
 * Recomputa corners_per_game + corners_ht_per_game em team_stats
 * a partir de corner_events. Roda após cada ingest (idempotente).
 * Preenche separado: home | away | all  ×  season
 */
export async function recomputeTeamCorners(env, season) {
  const seasonFilter = season || String(new Date().getFullYear());

  // Aggregate corners per team × home_away (home | away)
  const splitRows = await env.SB_DB.prepare(`
    SELECT
      c.team_norm,
      MAX(c.team) as team_display,
      CASE WHEN c.is_home = 1 THEN 'home' ELSE 'away' END as ha,
      COUNT(DISTINCT c.match_id) as games,
      COUNT(*) as total_corners,
      SUM(CASE WHEN c.period = 1 THEN 1 ELSE 0 END) as corners_ht
    FROM corner_events c
    JOIN matches_raw m ON m.match_id = c.match_id
    WHERE m.season = ? AND m.status = 'post'
    GROUP BY c.team_norm, ha
  `).bind(seasonFilter).all().catch(() => ({ results: [] }));

  // Aggregate 'all' (home + away together)
  const allRows = await env.SB_DB.prepare(`
    SELECT
      c.team_norm,
      MAX(c.team) as team_display,
      'all' as ha,
      COUNT(DISTINCT c.match_id) as games,
      COUNT(*) as total_corners,
      SUM(CASE WHEN c.period = 1 THEN 1 ELSE 0 END) as corners_ht
    FROM corner_events c
    JOIN matches_raw m ON m.match_id = c.match_id
    WHERE m.season = ? AND m.status = 'post'
    GROUP BY c.team_norm
  `).bind(seasonFilter).all().catch(() => ({ results: [] }));

  const combined = [...(splitRows.results || []), ...(allRows.results || [])];
  if (!combined.length) return { teamsAggregated: 0, season: seasonFilter };

  const stmts = combined.map(r => {
    const games            = r.games || 1;
    const cornersPerGame   = +(r.total_corners / games).toFixed(2);
    const cornersHtPerGame = +(r.corners_ht     / games).toFixed(2);
    const teamName         = r.team_display || r.team_norm;
    return env.SB_DB.prepare(`
      INSERT INTO team_stats (team_name, sport, season, home_away, games_played,
        corners_per_game, corners_ht_per_game, data_quality, source, updated_at)
      VALUES (?, 'football', ?, ?, ?, ?, ?, 'REAL', 'espn_computed', datetime('now'))
      ON CONFLICT(team_name, sport, season, home_away) DO UPDATE SET
        corners_per_game    = excluded.corners_per_game,
        corners_ht_per_game = excluded.corners_ht_per_game,
        games_played        = MAX(games_played, excluded.games_played),
        data_quality        = 'REAL',
        source              = 'espn_computed',
        updated_at          = datetime('now')
    `).bind(teamName, seasonFilter, r.ha, r.games, cornersPerGame, cornersHtPerGame);
  });

  for (let i = 0; i < stmts.length; i += 100) await env.SB_DB.batch(stmts.slice(i, i + 100));
  return { teamsAggregated: stmts.length, season: seasonFilter };
}

/**
 * F2.51: Backfill boxscore para jogos 'post' que estão SEM match_team_metrics.
 * Casos: jogos brasileiros/sulamericanos ingeridos antes do F2.49 deploy (que adicionou
 * o fallback boxscore). Cron normal só processa today/yesterday → esses jogos ficam
 * sem boxscore pra sempre. Esta função roda 1x sob demanda e popula match_team_metrics
 * via ESPN /summary.
 *
 * @param {object} env - CF env
 * @param {object} opts - { leagueFilter?: string[] | null, limit: number }
 *   leagueFilter: array de league_slugs (default: ligas SEM play-by-play)
 *   limit: cap de matches/invocation (default 80 — caber em CF subrequest budget)
 * @returns { matchesProcessed, mtmInserted, errors, sample }
 */
export async function runBoxscoreBackfill(env, opts = {}) {
  if (!env?.SB_DB) return { error: 'no db' };
  const leagueFilter = opts.leagueFilter || [
    // Ligas sem play-by-play na ESPN (precisam de boxscore fallback)
    'bra.1', 'bra.2', 'bra.3', 'bra.copa_do_brazil', 'bra.copa_do_nordeste',
    'bra.camp.paulista', 'bra.camp.carioca', 'bra.camp.mineiro', 'bra.camp.gaucho',
    'conmebol.libertadores', 'conmebol.sudamericana', 'conmebol.america', 'conmebol.recopa',
    'arg.1', 'arg.copa', 'col.1', 'chi.1', 'uru.1', 'par.1', 'per.1', 'ecu.1', 'ven.1', 'bol.1',
    'mex.1', 'mex.2',
  ];
  const limit = Math.min(opts.limit || 80, 150);

  const placeholders = leagueFilter.map(() => '?').join(',');
  const { results: pendingMatches } = await env.SB_DB.prepare(`
    SELECT m.match_id, m.external_id, m.league_slug, m.home_team, m.away_team
    FROM matches_raw m
    LEFT JOIN match_team_metrics mtm ON mtm.match_id = m.match_id
    WHERE m.status = 'post'
      AND m.source = 'espn'
      AND m.league_slug IN (${placeholders})
      AND mtm.match_id IS NULL
    ORDER BY m.match_date DESC
    LIMIT ?
  `).bind(...leagueFilter, limit).all();

  const stats = { matchesProcessed: 0, mtmInserted: 0, errors: 0, errorSample: null,
                  pending: pendingMatches.length, leaguesFiltered: leagueFilter.length };

  for (const m of pendingMatches) {
    try {
      const summary = await fetchMatchSummary(m.league_slug, m.external_id);
      if (!summary) { stats.errors++; continue; }
      const totals = extractBoxscoreTotals(summary, m);
      if (!totals?.home || !totals?.away) { stats.errors++; continue; }
      // Garante schema (idempotente)
      await Promise.allSettled([
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN corners INTEGER DEFAULT 0').run(),
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN fouls INTEGER DEFAULT 0').run(),
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN yellow INTEGER DEFAULT 0').run(),
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN red INTEGER DEFAULT 0').run(),
        env.SB_DB.prepare('ALTER TABLE match_team_metrics ADD COLUMN possession_pct REAL').run(),
      ]);
      // INSERT idempotente (deletamos antes pq mtm não tem unique constraint em (match_id, is_home))
      await env.SB_DB.prepare('DELETE FROM match_team_metrics WHERE match_id = ?').bind(m.match_id).run();
      await env.SB_DB.batch([
        env.SB_DB.prepare(`INSERT INTO match_team_metrics
          (match_id, team_norm, is_home, possession_pct, shots, shots_on_target, corners, fouls, yellow, red, xg_total, xa_total)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, 0)`).bind(
            m.match_id, normTeam(m.home_team),
            totals.home.possession_pct ?? null,
            totals.home.shots ?? 0, totals.home.shots_on_target ?? 0,
            totals.home.corners ?? 0, totals.home.fouls ?? 0,
            totals.home.yellow ?? 0, totals.home.red ?? 0,
          ),
        env.SB_DB.prepare(`INSERT INTO match_team_metrics
          (match_id, team_norm, is_home, possession_pct, shots, shots_on_target, corners, fouls, yellow, red, xg_total, xa_total)
          VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0)`).bind(
            m.match_id, normTeam(m.away_team),
            totals.away.possession_pct ?? null,
            totals.away.shots ?? 0, totals.away.shots_on_target ?? 0,
            totals.away.corners ?? 0, totals.away.fouls ?? 0,
            totals.away.yellow ?? 0, totals.away.red ?? 0,
          ),
      ]);
      stats.matchesProcessed++;
      stats.mtmInserted += 2;
    } catch (e) {
      stats.errors++;
      if (!stats.errorSample) stats.errorSample = `${m.match_id}: ${e.message}`;
    }
  }
  return stats;
}
