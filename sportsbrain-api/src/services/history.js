/**
 * HistoryService — SportsBrain Data API 4.6
 * ──────────────────────────────────────────
 * Runs daily (via Cron) to:
 *  1. Fetch yesterday's completed games from API-Football (football) and
 *     balldontlie.io (NBA basketball) — fully free
 *  2. For each completed football game: fetch per-game stats (shots, SOT,
 *     corners, cards, possession)
 *  3. Upsert everything into D1 (games + stats columns)
 *  4. Recalculate team_stats aggregates from ALL stored games so that
 *     FtProps / BkProps always use real historical averages
 *
 * Supported football leagues (API-Football IDs):
 *   71 = Brasileirão Série A   |  39 = Premier League
 *   78 = Bundesliga            | 140 = La Liga
 *  135 = Serie A (Italy)       |  61 = Ligue 1
 *    2 = UEFA Champions League |   3 = UEFA Europa League
 *
 * Basketball: uses balldontlie.io v1 (no API key required, free forever)
 */

const APIF_HOST  = 'api-football-v1.p.rapidapi.com';
const APIF_BASE  = `https://${APIF_HOST}/v3`;
const BDL_BASE   = 'https://api.balldontlie.io/v1';
const BDL_KEY    = 'a3b81c26-c2c1-4867-adca-1e4c34b7bcf6'; // public demo key (free)

// Football leagues to ingest daily
const FOOTBALL_LEAGUES = [71, 39, 78, 140, 135, 61, 2, 3];

// Current NBA season (starts Oct, ends Apr next year)
function currentNBASeason() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

export class HistoryService {
  constructor(env) {
    this.db      = env.SB_DB   || null;
    this.apifKey = env.API_FOOTBALL_KEY || null;
    this.log     = [];
  }

  _now() { return new Date().toISOString(); }

  _ymd(date) { return (date || new Date()).toISOString().slice(0, 10); }

  _yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return this._ymd(d);
  }

  // ── Main entry point (called by scheduled cron) ─────────────────────────
  async runDailyIngest() {
    const date = this._yesterday();
    this.log = [];
    console.log(`[History] Starting daily ingest for ${date}`);

    const [ftGames, bkGames] = await Promise.allSettled([
      this._ingestFootball(date),
      this._ingestBasketball(date),
    ]);

    const ftCount = ftGames.status === 'fulfilled' ? ftGames.value : 0;
    const bkCount = bkGames.status === 'fulfilled' ? bkGames.value : 0;

    // Recalculate team_stats aggregates after new data is stored
    await this._recalcAllTeamStats();

    const summary = {
      date,
      football_games: ftCount,
      basketball_games: bkCount,
      log: this.log,
    };
    console.log('[History] Ingest complete:', JSON.stringify(summary));
    return summary;
  }

  // ── Football ingestion ──────────────────────────────────────────────────
  async _ingestFootball(date) {
    if (!this.apifKey) {
      this.log.push('SKIP football: no API_FOOTBALL_KEY');
      return 0;
    }

    let saved = 0;
    for (const leagueId of FOOTBALL_LEAGUES) {
      try {
        const fixtures = await this._apifFixtures(date, leagueId);
        const finished = fixtures.filter(f => f.fixture?.status?.short === 'FT');

        for (const f of finished) {
          const gameId   = String(f.fixture.id);
          const homeTeam = f.teams?.home?.name || '';
          const awayTeam = f.teams?.away?.name || '';
          const league   = f.league?.name || '';
          const season   = f.league?.season || new Date().getFullYear();

          // Fetch per-game stats (shots, corners, SOT, cards, possession)
          const stats = await this._apifFixtureStats(f.fixture.id);

          const homeS = stats.find(s => s.team?.id === f.teams?.home?.id)?.statistics || [];
          const awayS = stats.find(s => s.team?.id === f.teams?.away?.id)?.statistics || [];

          const getStat = (arr, type) => {
            const item = arr.find(s => s.type === type);
            if (!item) return null;
            const v = item.value;
            if (v === null || v === undefined) return null;
            // Some values come as "47%" strings
            if (typeof v === 'string' && v.endsWith('%')) return parseFloat(v);
            return typeof v === 'number' ? v : parseInt(v, 10) || null;
          };

          await this._upsertFootballGame({
            id: gameId,
            home_team: homeTeam,
            away_team: awayTeam,
            league,
            competition_id: String(leagueId),
            game_date: date,
            kickoff: f.fixture?.date || null,
            status: 'ft',
            score_home: f.goals?.home ?? null,
            score_away: f.goals?.away ?? null,
            score_ht_home: f.score?.halftime?.home ?? null,
            score_ht_away: f.score?.halftime?.away ?? null,
            season: String(season),
            // Stats
            stats_home_shots:      getStat(homeS, 'Total Shots'),
            stats_away_shots:      getStat(awayS, 'Total Shots'),
            stats_home_sot:        getStat(homeS, 'Shots on Goal'),
            stats_away_sot:        getStat(awayS, 'Shots on Goal'),
            stats_home_corners:    getStat(homeS, 'Corner Kicks'),
            stats_away_corners:    getStat(awayS, 'Corner Kicks'),
            stats_home_cards:      (getStat(homeS, 'Yellow Cards') || 0) + (getStat(homeS, 'Red Cards') || 0),
            stats_away_cards:      (getStat(awayS, 'Yellow Cards') || 0) + (getStat(awayS, 'Red Cards') || 0),
            stats_home_blocked:    getStat(homeS, 'Blocked Shots'),
            stats_away_blocked:    getStat(awayS, 'Blocked Shots'),
            stats_home_offsides:   getStat(homeS, 'Offsides'),
            stats_away_offsides:   getStat(awayS, 'Offsides'),
            stats_home_possession: getStat(homeS, 'Ball Possession'),
            stats_away_possession: getStat(awayS, 'Ball Possession'),
          });
          saved++;
        }

        this.log.push(`League ${leagueId}: ${finished.length} games saved`);
        // Small delay to respect rate limits (100 req/day free tier)
        await new Promise(r => setTimeout(r, 300));

      } catch (e) {
        this.log.push(`League ${leagueId} error: ${e.message}`);
      }
    }
    return saved;
  }

  // ── Basketball (NBA) ingestion via balldontlie.io ───────────────────────
  async _ingestBasketball(date) {
    try {
      const season = currentNBASeason();
      // Fetch games on date
      const url = `${BDL_BASE}/games?dates[]=${date}&per_page=50`;
      const headers = BDL_KEY ? { 'Authorization': BDL_KEY } : {};
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { this.log.push(`BDL games fetch failed: ${res.status}`); return 0; }

      const json = await res.json();
      const games = (json.data || []).filter(g => g.status === 'Final');

      let saved = 0;
      for (const g of games) {
        // Fetch box score for player stats
        const boxUrl = `${BDL_BASE}/box_scores?game_ids[]=${g.id}`;
        let players = [];
        try {
          const boxRes = await fetch(boxUrl, { headers, signal: AbortSignal.timeout(8000) });
          if (boxRes.ok) {
            const boxJson = await boxRes.json();
            players = boxJson.data || [];
          }
        } catch (_) {}

        await this._upsertBasketballGame({
          id: String(g.id),
          home_team: g.home_team?.full_name || g.home_team?.abbreviation || '',
          away_team: g.visitor_team?.full_name || g.visitor_team?.abbreviation || '',
          league: 'NBA',
          game_date: date,
          status: 'ft',
          score_home: g.home_team_score,
          score_away: g.visitor_team_score,
          season: String(season),
        }, players);
        saved++;
      }

      this.log.push(`NBA: ${saved} games saved`);
      return saved;
    } catch (e) {
      this.log.push(`NBA error: ${e.message}`);
      return 0;
    }
  }

  // ── API-Football helpers ────────────────────────────────────────────────
  async _apifFixtures(date, leagueId) {
    const url = `${APIF_BASE}/fixtures?date=${date}&league=${leagueId}&season=${new Date().getFullYear()}`;
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': this.apifKey, 'X-RapidAPI-Host': APIF_HOST },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`APIF fixtures ${res.status}`);
    const json = await res.json();
    return json.response || [];
  }

  async _apifFixtureStats(fixtureId) {
    await new Promise(r => setTimeout(r, 200)); // rate limit buffer
    const url = `${APIF_BASE}/fixtures/statistics?fixture=${fixtureId}`;
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': this.apifKey, 'X-RapidAPI-Host': APIF_HOST },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.response || [];
  }

  // ── D1 write helpers ────────────────────────────────────────────────────
  async _upsertFootballGame(g) {
    if (!this.db) return;
    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO games (
          id, sport, home_team, away_team, league, competition_id,
          game_date, kickoff, status,
          score_home, score_away, score_ht_home, score_ht_away, season, source,
          stats_home_shots, stats_away_shots,
          stats_home_sot,   stats_away_sot,
          stats_home_corners, stats_away_corners,
          stats_home_cards,   stats_away_cards,
          stats_home_blocked, stats_away_blocked,
          stats_home_offsides, stats_away_offsides,
          stats_home_possession, stats_away_possession,
          updated_at
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )
      `).bind(
        g.id, 'football', g.home_team, g.away_team, g.league, g.competition_id,
        g.game_date, g.kickoff, g.status,
        g.score_home, g.score_away, g.score_ht_home, g.score_ht_away,
        g.season, 'apif',
        g.stats_home_shots, g.stats_away_shots,
        g.stats_home_sot,   g.stats_away_sot,
        g.stats_home_corners, g.stats_away_corners,
        g.stats_home_cards,   g.stats_away_cards,
        g.stats_home_blocked, g.stats_away_blocked,
        g.stats_home_offsides, g.stats_away_offsides,
        g.stats_home_possession, g.stats_away_possession,
        this._now()
      ).run();
    } catch (e) {
      console.warn('[History] upsertFootballGame error:', e.message, g.id);
    }
  }

  async _upsertBasketballGame(g, players = []) {
    if (!this.db) return;
    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO games (
          id, sport, home_team, away_team, league,
          game_date, status, score_home, score_away, season, source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        g.id, 'basketball', g.home_team, g.away_team, g.league,
        g.game_date, g.status, g.score_home, g.score_away,
        g.season, 'bdl', this._now()
      ).run();

      // Upsert player box scores into player_stats
      for (const p of players) {
        if (!p.player?.id) continue;
        const name = `${p.player.first_name} ${p.player.last_name}`;
        try {
          await this.db.prepare(`
            INSERT OR REPLACE INTO player_stats (
              player_name, sport, team, season,
              games_played, pts_per_game, reb_per_game, ast_per_game,
              stl_per_game, blk_per_game, to_per_game, fg_pct, ft_pct, three_pct,
              source, updated_at
            ) VALUES (?, 'basketball', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bdl', ?)
          `).bind(
            name, p.team?.full_name || '', g.season,
            p.pts ?? null, p.reb ?? null, p.ast ?? null,
            p.stl ?? null, p.blk ?? null, p.turnover ?? null,
            p.fg_pct ?? null, p.ft_pct ?? null, p.fg3_pct ?? null,
            this._now()
          ).run();
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[History] upsertBasketballGame error:', e.message, g.id);
    }
  }

  // ── Team stats aggregation from D1 (runs after ingest) ─────────────────
  // Rebuilds team_stats for every team that has at least 3 stored games.
  // Uses rolling window: last 38 games for football, last 82 for basketball.
  async _recalcAllTeamStats() {
    if (!this.db) return;

    try {
      // ── Football: aggregate per home/away/all ────────────────────────
      // Step 1: Get distinct teams with enough data
      const ftTeams = await this.db.prepare(`
        SELECT team_name, season FROM (
          SELECT home_team AS team_name, season FROM games
          WHERE sport='football' AND status='ft' AND stats_home_shots IS NOT NULL
          UNION
          SELECT away_team AS team_name, season FROM games
          WHERE sport='football' AND status='ft' AND stats_away_shots IS NOT NULL
        )
        GROUP BY team_name, season
        HAVING COUNT(*) >= 3
      `).all();

      for (const { team_name, season } of (ftTeams.results || [])) {
        await this._upsertFtTeamStats(team_name, season, 'home');
        await this._upsertFtTeamStats(team_name, season, 'away');
        await this._upsertFtTeamStats(team_name, season, 'all');
      }

      // ── Basketball: aggregate per team ───────────────────────────────
      const bkTeams = await this.db.prepare(`
        SELECT team_name, season FROM (
          SELECT home_team AS team_name, season FROM games WHERE sport='basketball' AND status='ft'
          UNION
          SELECT away_team AS team_name, season FROM games WHERE sport='basketball' AND status='ft'
        )
        GROUP BY team_name, season HAVING COUNT(*) >= 3
      `).all();

      for (const { team_name, season } of (bkTeams.results || [])) {
        await this._upsertBkTeamStats(team_name, season);
      }

      this.log.push(`team_stats recalculated for ${(ftTeams.results?.length || 0)} football + ${(bkTeams.results?.length || 0)} basketball teams`);
    } catch (e) {
      console.warn('[History] recalcAllTeamStats error:', e.message);
    }
  }

  async _upsertFtTeamStats(teamName, season, homeAway) {
    // Build WHERE clause depending on perspective
    let whereClause, shotCol, sotCol, cornersCol, cardsCol, blockedCol, possCol, goalsForCol, goalsAgainstCol;
    if (homeAway === 'home') {
      whereClause   = `home_team = ? AND stats_home_shots IS NOT NULL`;
      shotCol       = 'stats_home_shots';
      sotCol        = 'stats_home_sot';
      cornersCol    = 'stats_home_corners';
      cardsCol      = 'stats_home_cards';
      blockedCol    = 'stats_home_blocked';
      possCol       = 'stats_home_possession';
      goalsForCol   = 'score_home';
      goalsAgainstCol='score_away';
    } else if (homeAway === 'away') {
      whereClause   = `away_team = ? AND stats_away_shots IS NOT NULL`;
      shotCol       = 'stats_away_shots';
      sotCol        = 'stats_away_sot';
      cornersCol    = 'stats_away_corners';
      cardsCol      = 'stats_away_cards';
      blockedCol    = 'stats_away_blocked';
      possCol       = 'stats_away_possession';
      goalsForCol   = 'score_away';
      goalsAgainstCol='score_home';
    } else {
      // 'all' — union home+away perspective
      // Use a combined query
      whereClause   = `(home_team = ? OR away_team = ?)`;
      shotCol       = `CASE WHEN home_team=? THEN stats_home_shots ELSE stats_away_shots END`;
      sotCol        = `CASE WHEN home_team=? THEN stats_home_sot   ELSE stats_away_sot   END`;
      cornersCol    = `CASE WHEN home_team=? THEN stats_home_corners ELSE stats_away_corners END`;
      cardsCol      = `CASE WHEN home_team=? THEN stats_home_cards ELSE stats_away_cards END`;
      blockedCol    = `CASE WHEN home_team=? THEN stats_home_blocked ELSE stats_away_blocked END`;
      possCol       = `CASE WHEN home_team=? THEN stats_home_possession ELSE stats_away_possession END`;
      goalsForCol   = `CASE WHEN home_team=? THEN score_home ELSE score_away END`;
      goalsAgainstCol=`CASE WHEN home_team=? THEN score_away ELSE score_home END`;
    }

    try {
      let row;
      if (homeAway === 'all') {
        // Bind teamName 9 extra times for the CASE expressions
        row = await this.db.prepare(`
          SELECT
            COUNT(*) AS played,
            SUM(CASE WHEN (home_team=? AND score_home > score_away) OR (away_team=? AND score_away > score_home) THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN score_home = score_away THEN 1 ELSE 0 END) AS drawn,
            SUM(CASE WHEN (home_team=? AND score_home < score_away) OR (away_team=? AND score_away < score_home) THEN 1 ELSE 0 END) AS lost,
            ROUND(AVG(${goalsForCol}), 2)    AS goals_for_pg,
            ROUND(AVG(${goalsAgainstCol}), 2) AS goals_against_pg,
            ROUND(AVG(${shotCol}), 2)   AS shots_pg,
            ROUND(AVG(${sotCol}), 2)    AS sot_pg,
            ROUND(AVG(${cornersCol}), 2) AS corners_pg,
            ROUND(AVG(${cardsCol}), 2)  AS cards_pg,
            ROUND(AVG(${possCol}), 2)   AS possession_pg,
            SUM(CASE WHEN ${goalsAgainstCol} = 0 THEN 1 ELSE 0 END) AS clean_sheets,
            SUM(CASE WHEN score_home > 0 AND score_away > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS btts_pct,
            SUM(CASE WHEN (score_home + score_away) > 2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS over25_pct
          FROM games
          WHERE sport='football' AND status='ft' AND season=?
            AND (home_team=? OR away_team=?)
            AND (stats_home_shots IS NOT NULL OR stats_away_shots IS NOT NULL)
          LIMIT 38
        `).bind(
          teamName, teamName,   // won CASE
          teamName, teamName,   // lost CASE
          teamName, teamName,   // goalsFor CASE
          teamName, teamName,   // goalsAgainst CASE
          teamName, teamName,   // shots CASE
          teamName, teamName,   // sot CASE
          teamName, teamName,   // corners CASE
          teamName, teamName,   // cards CASE
          teamName, teamName,   // possession CASE
          teamName, teamName,   // clean_sheets CASE
          season,
          teamName, teamName    // WHERE
        ).first();
      } else {
        row = await this.db.prepare(`
          SELECT
            COUNT(*) AS played,
            SUM(CASE WHEN ${homeAway === 'home' ? 'score_home > score_away' : 'score_away > score_home'} THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN score_home = score_away THEN 1 ELSE 0 END) AS drawn,
            SUM(CASE WHEN ${homeAway === 'home' ? 'score_home < score_away' : 'score_away < score_home'} THEN 1 ELSE 0 END) AS lost,
            ROUND(AVG(${goalsForCol}), 2)    AS goals_for_pg,
            ROUND(AVG(${goalsAgainstCol}), 2) AS goals_against_pg,
            ROUND(AVG(${shotCol}), 2)   AS shots_pg,
            ROUND(AVG(${sotCol}), 2)    AS sot_pg,
            ROUND(AVG(${cornersCol}), 2) AS corners_pg,
            ROUND(AVG(${cardsCol}), 2)  AS cards_pg,
            ROUND(AVG(${possCol}), 2)   AS possession_pg,
            SUM(CASE WHEN ${goalsAgainstCol} = 0 THEN 1 ELSE 0 END) AS clean_sheets,
            SUM(CASE WHEN score_home > 0 AND score_away > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS btts_pct,
            SUM(CASE WHEN (score_home + score_away) > 2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS over25_pct
          FROM games
          WHERE sport='football' AND status='ft' AND season=?
            AND ${whereClause}
          ORDER BY game_date DESC
          LIMIT 38
        `).bind(season, teamName).first();
      }

      if (!row || row.played < 3) return;

      await this.db.prepare(`
        INSERT OR REPLACE INTO team_stats (
          team_name, sport, season, home_away,
          games_played, wins, draws, losses,
          goals_for, goals_against,
          shots_per_game, shots_on_target_per_game,
          corners_per_game, shots_first_half_per_game,
          corners_first_half_per_game,
          btts_pct, over_2_5_goals_pct,
          data_quality, source, updated_at
        ) VALUES (?, 'football', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REAL', 'history', ?)
      `).bind(
        teamName, season, homeAway,
        row.played, row.won, row.drawn, row.lost,
        row.goals_for_pg, row.goals_against_pg,
        row.shots_pg,
        row.sot_pg,
        row.corners_pg,
        row.shots_pg   != null ? Math.round(row.shots_pg   * 0.43 * 10) / 10 : null,  // ~43% shots in 1T
        row.corners_pg != null ? Math.round(row.corners_pg * 0.44 * 10) / 10 : null,  // ~44% corners in 1T
        row.btts_pct, row.over25_pct,
        this._now()
      ).run();
    } catch (e) {
      console.warn('[History] upsertFtTeamStats error:', e.message, teamName, homeAway);
    }
  }

  async _upsertBkTeamStats(teamName, season) {
    if (!this.db) return;
    try {
      const row = await this.db.prepare(`
        SELECT
          COUNT(*) AS played,
          ROUND(AVG(CASE WHEN home_team=? THEN score_home ELSE score_away END), 1) AS pts_for,
          ROUND(AVG(CASE WHEN home_team=? THEN score_away ELSE score_home END), 1) AS pts_against
        FROM games
        WHERE sport='basketball' AND status='ft' AND season=?
          AND (home_team=? OR away_team=?)
        LIMIT 82
      `).bind(teamName, teamName, season, teamName, teamName).first();

      if (!row || row.played < 3) return;

      await this.db.prepare(`
        INSERT OR REPLACE INTO team_stats (
          team_name, sport, season, home_away,
          games_played, pts_per_game, opp_pts_per_game,
          data_quality, source, updated_at
        ) VALUES (?, 'basketball', ?, 'all', ?, ?, ?, 'REAL', 'history', ?)
      `).bind(
        teamName, season,
        row.played, row.pts_for, row.pts_against,
        this._now()
      ).run();
    } catch (e) {
      console.warn('[History] upsertBkTeamStats error:', e.message, teamName);
    }
  }

  // ── On-demand: fetch team stats from D1 ────────────────────────────────
  // Called by FootballService.getTeamStats() as primary lookup before API-Football
  async getTeamStatsFromDB(teamName, sport = 'football', homeAway = 'all') {
    if (!this.db) return null;
    const season = new Date().getFullYear();
    try {
      // Fuzzy match (partial name) — e.g. "Cruzeiro" matches "Cruzeiro EC"
      const row = await this.db.prepare(`
        SELECT * FROM team_stats
        WHERE sport = ? AND season = ? AND home_away = ?
          AND (team_name = ? OR team_name LIKE ? OR ? LIKE '%' || team_name || '%')
        ORDER BY games_played DESC
        LIMIT 1
      `).bind(
        sport, season, homeAway,
        teamName,
        `%${teamName}%`,
        teamName
      ).first();
      return row || null;
    } catch (e) {
      return null;
    }
  }
}
