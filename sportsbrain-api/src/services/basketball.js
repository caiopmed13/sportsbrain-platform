/**
 * SportsBrain Basketball (NBA) Ingestion Service 4.0
 * ────────────────────────────────────────────────────
 * Primary source: balldontlie.io (completely free, no API key)
 * Secondary:      TheOddsAPI for NBA odds (free tier)
 * Tertiary:       TheSportsDB for schedule context
 *
 * balldontlie.io v1 endpoints:
 *   GET /games?dates[]=YYYY-MM-DD
 *   GET /players?search=<name>&per_page=5
 *   GET /stats?player_ids[]=<id>&dates[]=YYYY-MM-DD&per_page=25
 *   GET /season_averages?season=2024&player_ids[]=<id>
 *   GET /teams
 */

import { DQ, SOURCE_RELIABILITY, makeLineMovement } from '../schemas/base.js';
import { makeNBAGame, makeNBAPlayer, makeNBATeamStats } from '../schemas/basketball.js';
import { bkContextAvg, tierLines, bkPlayerPropConf, recencyWeight, homeAwayAdjust, projectionRange } from '../intelligence/engine.js';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

// NBA team abbreviation → full name map
const NBA_TEAMS = {
  'ATL':'Atlanta Hawks','BOS':'Boston Celtics','BKN':'Brooklyn Nets','CHA':'Charlotte Hornets',
  'CHI':'Chicago Bulls','CLE':'Cleveland Cavaliers','DAL':'Dallas Mavericks','DEN':'Denver Nuggets',
  'DET':'Detroit Pistons','GSW':'Golden State Warriors','HOU':'Houston Rockets','IND':'Indiana Pacers',
  'LAC':'LA Clippers','LAL':'Los Angeles Lakers','MEM':'Memphis Grizzlies','MIA':'Miami Heat',
  'MIL':'Milwaukee Bucks','MIN':'Minnesota Timberwolves','NOP':'New Orleans Pelicans',
  'NYK':'New York Knicks','OKC':'Oklahoma City Thunder','ORL':'Orlando Magic',
  'PHI':'Philadelphia 76ers','PHX':'Phoenix Suns','POR':'Portland Trail Blazers',
  'SAC':'Sacramento Kings','SAS':'San Antonio Spurs','TOR':'Toronto Raptors',
  'UTA':'Utah Jazz','WAS':'Washington Wizards',
};

export class BasketballService {
  constructor(env, cache) {
    this.env      = env;
    this.cache    = cache;
    this.bdlKey   = env.BALLDONTLIE_API_KEY || null; // optional, free tier works without
    // Proprietary odds engine: reads from D1 odds_* tables (no external key)
  }

  // ── Today's Games ─────────────────────────────────────────────────────
  async getTodayGames(date = null) {
    const today = date || new Date().toISOString().slice(0, 10);
    const cacheKey = `basketball:games:${today}`;

    const { data, fromCache } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchTodayGames(today),
      1800
    );

    return { games: data || [], source: fromCache ? 'cache' : 'live', date: today };
  }

  async _fetchTodayGames(date) {
    // Primary: balldontlie.io
    try {
      const url = `${BDL_BASE}/games?dates[]=${date}&per_page=15`;
      const headers = {};
      if (this.bdlKey) headers['Authorization'] = this.bdlKey;

      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`balldontlie HTTP ${res.status}`);
      const json = await res.json();

      if (json.data && json.data.length > 0) {
        return json.data.map(g => makeNBAGame({
          id:           g.id,
          home_team:    g.home_team.full_name,
          away_team:    g.visitor_team.full_name,
          home_team_id: g.home_team.id,
          away_team_id: g.visitor_team.id,
          date:         g.date?.slice(0, 10) || date,
          tip_off:      null,
          status:       g.status,
          score:        g.home_team_score !== null ? {
            home: g.home_team_score, away: g.visitor_team_score,
            period: g.period, time: g.time,
          } : null,
          arena:        null,
          season:       g.season,
          source:       'balldontlie',
        }));
      }
    } catch (e) {
      console.warn('[Basketball] balldontlie games failed:', e.message);
    }

    // Fallback: TheSportsDB
    try {
      const url = `${TSDB_BASE}/eventsday.php?d=${date}&s=Basketball`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const json = await res.json();
        const nba = (json.events || []).filter(e => e.strLeague === 'NBA');
        if (nba.length > 0) {
          return nba.map(e => makeNBAGame({
            id:        e.idEvent,
            home_team: e.strHomeTeam,
            away_team: e.strAwayTeam,
            date,
            status:    e.strStatus === 'Match Finished' ? 'final' : 'scheduled',
            source:    'thesportsdb',
          }));
        }
      }
    } catch (e) { console.warn('[Basketball] TheSportsDB games failed:', e.message); }

    return [];
  }

  // ── Player Stats ──────────────────────────────────────────────────────
  /**
   * Fetch player stats with availability and injury status
   * @param {string} playerName - Player name
   * @returns {Promise<Object>} Player stats with enhanced availability field
   */
  async getPlayerStats(playerName) {
    const cacheKey = `basketball:player:${playerName.toLowerCase().replace(/\s/g,'_')}`;

    const { data } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchPlayerStats(playerName),
      1800
    );

    return data;
  }

  async _fetchPlayerStats(playerName) {
    try {
      // Step 1: find player ID
      const searchUrl = `${BDL_BASE}/players?search=${encodeURIComponent(playerName)}&per_page=5`;
      const headers = {};
      if (this.bdlKey) headers['Authorization'] = this.bdlKey;

      const searchRes = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(6000) });
      if (!searchRes.ok) return null;
      const searchJson = await searchRes.json();
      const player = searchJson.data?.[0];
      if (!player) return null;

      // Step 2: season averages
      const season = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      const avgUrl = `${BDL_BASE}/season_averages?season=${season}&player_ids[]=${player.id}`;
      const avgRes = await fetch(avgUrl, { headers, signal: AbortSignal.timeout(6000) });
      let avgs = null;
      if (avgRes.ok) {
        const avgJson = await avgRes.json();
        avgs = avgJson.data?.[0];
      }

      // Step 3: last 5 games
      const last5 = await this._getPlayerRecentGames(player.id, headers);

      // Step 4: availability / injury status
      const availability = await this._getPlayerAvailability(player.id, headers);

      // Step 5: calculate usage
      const usage = this._calculateUsage(avgs, last5);

      return makeNBAPlayer({
        id:           player.id,
        name:         `${player.first_name} ${player.last_name}`,
        team:         player.team?.full_name || '',
        team_id:      player.team?.id,
        position:     player.position,
        points:       avgs?.pts,
        rebounds:     avgs?.reb,
        assists:      avgs?.ast,
        steals:       avgs?.stl,
        blocks:       avgs?.blk,
        turnovers:    avgs?.turnover,
        minutes:      avgs?.min ? parseFloat(avgs.min) : null,
        field_goal_pct:       avgs?.fg_pct,
        three_point_pct:      avgs?.fg3_pct,
        free_throw_pct:       avgs?.ft_pct,
        games_played: avgs?.games_played || 0,
        games_started: avgs?.games_started || 0,
        recent_pts:   last5.map(g => g.pts),
        recent_reb:   last5.map(g => g.reb),
        recent_ast:   last5.map(g => g.ast),
        availability,
        usage,
        quality: {
          freshness: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.warn('[Basketball] player stats failed:', e.message);
      return null;
    }
  }

  /**
   * Get player injury/availability status
   * @param {number} playerId - balldontlie player ID
   * @param {Object} headers - Request headers
   * @returns {Promise<Object>} Availability object
   */
  async _getPlayerAvailability(playerId, headers) {
    try {
      const url = `${BDL_BASE}/players/${playerId}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const json = await res.json();
        const p = json.data;
        return {
          status: p.status || 'active',
          injury_type: p.injury?.comment || null,
          injury_body_part: p.injury?.body_part || null,
          return_date: p.injury?.return_date || null,
          source: 'balldontlie',
        };
      }
    } catch (e) { console.warn('[Basketball] availability fetch failed:', e.message); }

    return {
      status: 'active',
      injury_type: null,
      injury_body_part: null,
      return_date: null,
      source: 'estimated',
    };
  }

  /**
   * Calculate usage rate and role from stats
   * @param {Object} avgs - Season averages
   * @param {Array} last5 - Last 5 games
   * @returns {Object} Usage object with rate and role
   */
  _calculateUsage(avgs, last5) {
    if (!avgs || !avgs.games_played) {
      return { usage_rate: null, minutes_trend: null, role: null };
    }

    // Usage rate: (pts + ast + reb) / team possessions (simplified)
    const usage_rate = avgs.pts && avgs.ast && avgs.reb
      ? parseFloat(((avgs.pts + avgs.ast + avgs.reb) / 20).toFixed(2))
      : null;

    // Role based on games started
    let role = null;
    const startRatio = avgs.games_started / avgs.games_played;
    if (startRatio > 0.8) role = 'starter';
    else if (startRatio > 0.3) role = 'rotation';
    else role = 'bench';

    // Minutes trend from recent games
    let minutes_trend = null;
    if (last5.length >= 3) {
      const recentMins = last5.slice(0, 3).map(g => this._parseMinutes(g.min));
      const avg = recentMins.reduce((a, b) => a + b, 0) / recentMins.length;
      const seasonAvg = avgs.min ? parseFloat(avgs.min) : avg;
      if (avg > seasonAvg * 1.05) minutes_trend = 'up';
      else if (avg < seasonAvg * 0.95) minutes_trend = 'down';
      else minutes_trend = 'stable';
    }

    return { usage_rate, minutes_trend, role };
  }

  _parseMinutes(minStr) {
    if (!minStr) return 0;
    const parts = minStr.split(':');
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  }

  async _getPlayerRecentGames(playerId, headers) {
    try {
      // Get last 5 game stats
      const dates = [];
      for (let i = 0; i < 10; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
      }
      const params = dates.map(d => `dates[]=${d}`).join('&');
      const url = `${BDL_BASE}/stats?player_ids[]=${playerId}&${params}&per_page=10`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || [])
        .filter(g => g.min && g.min !== '00' && g.min !== '0:00')
        .slice(0, 5)
        .map(g => ({
          pts: g.pts || 0,
          reb: g.reb || 0,
          ast: g.ast || 0,
          min: g.min,
          date: g.game?.date?.slice(0, 10),
        }));
    } catch { return []; }
  }

  // ── Team Roster ────────────────────────────────────────────────────────
  /**
   * Fetch a team's roster with player details
   * @param {string} team_name - Team name
   * @returns {Promise<Array>} Array of players with id, name, position, number, status
   */
  async getTeamRoster(team_name) {
    const cacheKey = `basketball:roster:${team_name.toLowerCase().replace(/\s/g,'_')}`;
    const { data } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchTeamRoster(team_name),
      21600
    );
    return data || [];
  }

  async _fetchTeamRoster(team_name) {
    try {
      // First find team by name
      const teamUrl = `${BDL_BASE}/teams`;
      const headers = {};
      if (this.bdlKey) headers['Authorization'] = this.bdlKey;

      const teamRes = await fetch(teamUrl, { headers, signal: AbortSignal.timeout(6000) });
      if (!teamRes.ok) return [];
      const teamJson = await teamRes.json();
      const team = (teamJson.data || []).find(t =>
        t.full_name.toLowerCase() === team_name.toLowerCase() ||
        t.abbreviation.toLowerCase() === team_name.toLowerCase()
      );
      if (!team) return [];

      // Get players on this team
      const playersUrl = `${BDL_BASE}/players?team_ids[]=${team.id}&per_page=15`;
      const playersRes = await fetch(playersUrl, { headers, signal: AbortSignal.timeout(6000) });
      if (!playersRes.ok) return [];
      const playersJson = await playersRes.json();

      return (playersJson.data || []).map(p => ({
        player_id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        position: p.position,
        number: p.jersey_number,
        status: 'active',
      }));
    } catch (e) {
      console.warn('[Basketball] roster fetch failed:', e.message);
      return [];
    }
  }

  // ── Team Stats ────────────────────────────────────────────────────────
  async getTeamStats(teamName) {
    const cacheKey = `basketball:team:${teamName.toLowerCase().replace(/\s/g,'_')}`;
    const { data } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchTeamStats(teamName),
      3600
    );
    return data || this._estimateTeamStats(teamName);
  }

  async _fetchTeamStats(teamName) {
    try {
      const url = `${BDL_BASE}/teams`;
      const headers = {};
      if (this.bdlKey) headers['Authorization'] = this.bdlKey;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const json = await res.json();
      const team = (json.data || []).find(t =>
        t.full_name.toLowerCase() === teamName.toLowerCase() ||
        t.abbreviation.toLowerCase() === teamName.toLowerCase()
      );
      if (!team) return null;

      return makeNBATeamStats({
        name:         team.full_name,
        abbreviation: team.abbreviation,
        conference:   team.conference,
        division:     team.division,
        pts_per_game: null,
        pace:         null,
      });
    } catch { return null; }
  }

  _estimateTeamStats(teamName) {
    return makeNBATeamStats({ name: teamName, pts_per_game: 113, pace: 98, opp_pts_per_game: 113 });
  }

  // ── Box Score ────────────────────────────────────────────────────────────
  /**
   * Fetch box score for a game
   * @param {number} game_id - balldontlie game ID
   * @returns {Promise<Object>} Box score with player-level stats for both teams
   */
  async getBoxScore(game_id) {
    const cacheKey = `basketball:boxscore:${game_id}`;
    const { data } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchBoxScore(game_id),
      300  // 5 min for live, will be extended for completed
    );
    return data || { players: [] };
  }

  async _fetchBoxScore(game_id) {
    try {
      const headers = {};
      if (this.bdlKey) headers['Authorization'] = this.bdlKey;

      // Try live box scores first
      let url = `${BDL_BASE}/box_scores/live?game_id=${game_id}`;
      let res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });

      if (!res.ok) {
        // Fallback to stats endpoint for completed games
        url = `${BDL_BASE}/stats?game_ids[]=${game_id}&per_page=30`;
        res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      }

      if (!res.ok) return null;
      const json = await res.json();

      const players = (json.data || []).map(s => ({
        player_id: s.player?.id,
        player_name: s.player ? `${s.player.first_name} ${s.player.last_name}` : null,
        team_id: s.team?.id,
        team_name: s.team?.full_name,
        pts: s.pts,
        reb: s.reb,
        ast: s.ast,
        stl: s.stl,
        blk: s.blk,
        to: s.turnover,
        min: s.min,
        fg_pct: s.fg_pct,
        fg3_pct: s.fg3_pct,
        ft_pct: s.ft_pct,
      }));

      return {
        game_id,
        players,
        dq: DQ.REAL,
        source: 'balldontlie',
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      console.warn('[Basketball] box score fetch failed:', e.message);
      return null;
    }
  }

  // ── Generate Player Props for a game ─────────────────────────────────
  /**
   * Generate enhanced game props with projection ranges, line movement, and matchup context
   * @param {Object} game - Game object
   * @param {Object} homeStats - Home team stats (optional)
   * @param {Object} awayStats - Away team stats (optional)
   * @returns {Promise<Array>} Array of player props with full schema
   */
  async generateGameProps(game, homeStats = null, awayStats = null) {
    const props = [];

    // Collect rosters from both teams
    const teams = [
      { name: game.home_team, side: 'home' },
      { name: game.away_team, side: 'away' },
    ];

    for (const team of teams) {
      const roster = await this.getTeamRoster(team.name);
      for (const player of roster.slice(0, 8)) {
        const playerData = await this.getPlayerStats(player.name);
        if (!playerData) continue;

        for (const stat of ['points', 'rebounds', 'assists']) {
          const statKey = { points: 'points', rebounds: 'rebounds', assists: 'assists' }[stat];
          const avg = playerData.season_averages?.[statKey];
          if (!avg || avg < 1) continue;

          const oppTeam = team.side === 'home' ? game.away_team : game.home_team;
          const oppStats = await this.getTeamStats(oppTeam);

          // Base context adjustment
          let ctxAvg = bkContextAvg(avg, null, statKey, team.side === 'home', false);

          // Apply recency weighting using correct field mapping
          const recentMap = { points: 'recent_pts', rebounds: 'recent_reb', assists: 'recent_ast' };
          const recentVals = playerData[recentMap[stat]] || [];
          if (recentVals.length > 0) {
            const weighted = recencyWeight(recentVals, 0.85);
            if (weighted.weighted_avg) ctxAvg = weighted.weighted_avg;
          }

          // Apply home/away adjustment — use estimated NBA splits (~4% home advantage)
          const splits = {
            home_avg: avg * 1.04,
            away_avg: avg * 0.96,
            season_avg: avg,
          };
          const adjusted = homeAwayAdjust(avg, splits, team.side === 'home');
          if (adjusted.adjusted_value) ctxAvg = adjusted.adjusted_value;

          const tiers = tierLines(ctxAvg);
          const isReal = playerData.quality?.is_real || false;
          const projRange = projectionRange(ctxAvg, { pts: 0.22, reb: 0.28, ast: 0.32 }[statKey] || 0.28);

          for (const [tierName, line] of Object.entries(tiers)) {
            const conf = bkPlayerPropConf(
              ctxAvg,
              line,
              statKey,
              isReal,
              false,
              playerData.games?.played || 0
            );
            if (conf < 30) continue;

            props.push({
              game_id:       game.id,
              home_team:     game.home_team,
              away_team:     game.away_team,
              player_name:   playerData.name,
              team:          team.name,
              team_side:     team.side,
              stat:          statKey,
              stat_label:    { points: 'Points', rebounds: 'Rebounds', assists: 'Assists' }[stat],
              line,
              tier:          tierName,
              direction:     'over',
              confidence:    conf,
              projected_avg: ctxAvg,
              projection_range: projRange,
              line_movement: makeLineMovement({}),
              matchup_context: {
                opponent_rank_vs_position: null,
                opponent_allows_stat_avg: null,
                matchup_advantage: null,
              },
              dq:            playerData.quality?.level,
              source_reliability: playerData.quality?.source_reliability,
              sample_size:   playerData.games?.played || 0,
              is_real_data:  isReal,
              reason:        `${playerData.name} averages ${avg.toFixed(1)} ${stat}/game. Projected ${ctxAvg.toFixed(1)} in this context.`,
              freshness:     new Date().toISOString(),
            });
          }
        }
      }
    }

    // Deduplicate by ID
    const seen = new Set();
    return props.filter(p => {
      const id = `${p.game_id}|${p.player_name}|${p.stat}|${p.line}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
}
