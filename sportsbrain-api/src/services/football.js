/**
 * SportsBrain Football Ingestion Service 4.0
 * ───────────────────────────────────────────
 * Sources (in priority order):
 *  1. API-Football (RapidAPI) — comprehensive, 100 req/day free
 *  2. football-data.org      — European leagues, 10 req/min free
 *  3. TheSportsDB             — schedule/context, free
 *  4. SportsBrain estimates   — no external call, always available
 *
 * Each source is tried in order; failures fall back gracefully.
 * Data quality flags reflect which source was actually used.
 */

import { DQ, SOURCE_RELIABILITY, makeLineMovement, makeContext } from '../schemas/base.js';
import { makeFootballGame, makeTeamStats, makeFootballPlayer } from '../schemas/football.js';
import { HistoryService } from './history.js';
import { estimateShots, estimateCorners, recencyWeight, projectionRange } from '../intelligence/engine.js';

// ── League Config ─────────────────────────────────────────────────────────
const LEAGUES = {
  'PL':   { id: 'PL',  name: 'Premier League',    country: 'England',   fdOrg: 'PL',  apif: 39 },
  'PD':   { id: 'PD',  name: 'La Liga',            country: 'Spain',     fdOrg: 'PD',  apif: 140 },
  'BL1':  { id: 'BL1', name: 'Bundesliga',         country: 'Germany',   fdOrg: 'BL1', apif: 78 },
  'SA':   { id: 'SA',  name: 'Serie A',             country: 'Italy',     fdOrg: 'SA',  apif: 135 },
  'FL1':  { id: 'FL1', name: 'Ligue 1',             country: 'France',    fdOrg: 'FL1', apif: 61 },
  'BSA':  { id: 'BSA', name: 'Brasileirão',         country: 'Brazil',    fdOrg: null,  apif: 71 },
  'UCL':  { id: 'UCL', name: 'Champions League',   country: 'Europe',    fdOrg: 'CL',  apif: 2 },
  'WC':   { id: 'WC',  name: 'World Cup',           country: 'World',     fdOrg: 'WC',  apif: 1 },
};

export class FootballService {
  constructor(env, cache) {
    this.env   = env;
    this.cache = cache;
    this.fdKey   = env.FOOTBALL_DATA_API_KEY  || null;
    this.apifKey = env.API_FOOTBALL_KEY       || null;
  }

  // ── Today's Games ─────────────────────────────────────────────────────
  async getTodayGames(date = null) {
    const today = date || new Date().toISOString().slice(0, 10);
    const cacheKey = `football:games:${today}`;

    const { data, fromCache } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchTodayGames(today),
      1800
    );

    return { games: data || [], source: fromCache ? 'cache' : 'live', date: today };
  }

  async _fetchTodayGames(date) {
    // Priority 1: API-Football
    if (this.apifKey) {
      try {
        const games = await this._apifTodayGames(date);
        if (games && games.length > 0) return games;
      } catch (e) { console.warn('[Football] API-Football failed:', e.message); }
    }

    // Priority 2: football-data.org
    if (this.fdKey) {
      try {
        const games = await this._fdOrgTodayGames(date);
        if (games && games.length > 0) return games;
      } catch (e) { console.warn('[Football] football-data.org failed:', e.message); }
    }

    // Priority 3: TheSportsDB (free, no key)
    try {
      const games = await this._tsdbTodayGames(date);
      if (games && games.length > 0) return games;
    } catch (e) { console.warn('[Football] TheSportsDB failed:', e.message); }

    return [];
  }

  // ── API-Football source ───────────────────────────────────────────────
  async _apifTodayGames(date) {
    const url = `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${date}`;
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key':  this.apifKey,
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
    const json = await res.json();
    if (!json.response || !json.response.length) return [];

    return json.response.map(f => makeFootballGame({
      id:          String(f.fixture.id),
      home_team:   f.teams.home.name,
      away_team:   f.teams.away.name,
      league:      f.league.name,
      competition_id: String(f.league.id),
      kickoff:     f.fixture.date,
      status:      this._mapApifStatus(f.fixture.status.short),
      score:       f.goals.home !== null ? {
        home: f.goals.home, away: f.goals.away,
        ht: f.score.halftime ? { home: f.score.halftime.home, away: f.score.halftime.away } : null,
      } : null,
      venue:       f.fixture.venue?.name || null,
      season:      String(f.league.season),
      source:      'api-football',
    }));
  }

  _mapApifStatus(s) {
    const map = { 'NS': 'scheduled', '1H': 'live', 'HT': 'ht', '2H': 'live', 'FT': 'ft', 'PST': 'postponed' };
    return map[s] || 'scheduled';
  }

  // ─── Fixture statistics (corners, shots, cards, fouls) — pra auto-verify ───
  async getFixtureStats(fixtureId) {
    if (!this.apifKey) throw new Error('API-Football key missing')
    const url = `https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${fixtureId}`
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': this.apifKey,
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`API-Football stats HTTP ${res.status}`)
    const json = await res.json()
    const arr = json.response || []
    // Reagrupa: { home: {corners, shots, cards, fouls}, away: {...} }
    const result = { home: {}, away: {}, raw: arr }
    if (arr.length === 2) {
      const [t1, t2] = arr
      const parse = (statsArr) => {
        const out = {}
        for (const s of (statsArr.statistics || [])) {
          const k = (s.type || '').toLowerCase()
          if (/corner/.test(k)) out.corners = +s.value || 0
          else if (/total\s*shot/.test(k)) out.shots = +s.value || 0
          else if (/shot.*on.*goal|on target/.test(k)) out.shots_on_target = +s.value || 0
          else if (/yellow.*card/.test(k)) out.yellow_cards = +s.value || 0
          else if (/red.*card/.test(k)) out.red_cards = +s.value || 0
          else if (/^fouls/.test(k)) out.fouls = +s.value || 0
          else if (/offside/.test(k)) out.offsides = +s.value || 0
          else if (/possession/.test(k)) out.possession = parseFloat(s.value) || 0
        }
        out.total_cards = (out.yellow_cards || 0) + (out.red_cards || 0)
        return out
      }
      result.home = parse(t1)
      result.away = parse(t2)
      result.totals = {
        corners: (result.home.corners || 0) + (result.away.corners || 0),
        shots: (result.home.shots || 0) + (result.away.shots || 0),
        shots_on_target: (result.home.shots_on_target || 0) + (result.away.shots_on_target || 0),
        cards: (result.home.total_cards || 0) + (result.away.total_cards || 0),
        fouls: (result.home.fouls || 0) + (result.away.fouls || 0),
        offsides: (result.home.offsides || 0) + (result.away.offsides || 0),
      }
    }
    return result
  }

  // ── football-data.org source ──────────────────────────────────────────
  async _fdOrgTodayGames(date) {
    const url = `https://api.football-data.org/v4/matches?dateFrom=${date}&dateTo=${date}`;
    const res = await fetch(url, {
      headers: { 'X-Auth-Token': this.fdKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`football-data.org HTTP ${res.status}`);
    const json = await res.json();
    if (!json.matches?.length) return [];

    return json.matches.map(m => makeFootballGame({
      id:          String(m.id),
      home_team:   m.homeTeam.name,
      away_team:   m.awayTeam.name,
      league:      m.competition.name,
      competition_id: m.competition.code,
      kickoff:     m.utcDate,
      status:      m.status === 'SCHEDULED' ? 'scheduled' : m.status === 'FINISHED' ? 'ft' : 'live',
      score:       m.score.fullTime?.home !== null ? {
        home: m.score.fullTime.home, away: m.score.fullTime.away,
        ht: m.score.halfTime ? { home: m.score.halfTime.home, away: m.score.halfTime.away } : null,
      } : null,
      matchday:    m.matchday,
      season:      m.season?.startDate?.slice(0, 4),
      source:      'football-data.org',
    }));
  }

  // ── TheSportsDB source (free, no key) ────────────────────────────────
  async _tsdbTodayGames(date) {
    // TheSportsDB has a free endpoint for events by day
    const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.events || !json.events.length) return [];

    return json.events.map(e => makeFootballGame({
      id:        e.idEvent,
      home_team: e.strHomeTeam,
      away_team: e.strAwayTeam,
      league:    e.strLeague,
      kickoff:   e.dateEvent && e.strTime ? `${e.dateEvent}T${e.strTime}Z` : null,
      status:    e.strStatus === 'Match Finished' ? 'ft' : 'scheduled',
      score:     e.intHomeScore !== null && e.intHomeScore !== '' ? {
        home: parseInt(e.intHomeScore) || 0,
        away: parseInt(e.intAwayScore) || 0,
      } : null,
      source: 'thesportsdb',
    }));
  }

  // ── Team Stats ────────────────────────────────────────────────────────
  async getTeamStats(teamName) {
    const cacheKey = `football:team:${teamName.toLowerCase().replace(/\s/g, '_')}`;

    const { data } = await this.cache.getOrFetch(
      cacheKey,
      async () => {
        // Priority 1: D1 historical data (real, accumulated from past games)
        try {
          const history = new HistoryService(this.env);
          const dbRow = await history.getTeamStatsFromDB(teamName, 'football', 'all');
          if (dbRow && dbRow.games_played >= 3) {
            // Build nested schema compatible with estimateShots/estimateCorners
            // NOTE: DB stores goals_for/goals_against as per-game averages (not totals)
            return {
              name:        dbRow.team_name,
              played:      dbRow.games_played,
              home_away:   dbRow.home_away || 'all',
              record: { won: dbRow.wins, drawn: dbRow.draws, lost: dbRow.losses },
              goals: {
                per_game_for:     dbRow.goals_for     || null,   // already per-game
                per_game_against: dbRow.goals_against || null,   // already per-game
              },
              shots: {
                per_game:            dbRow.shots_per_game,
                on_target_per_game:  dbRow.shots_on_target_per_game,
                first_half_per_game: dbRow.shots_first_half_per_game,
              },
              corners: {
                per_game:            dbRow.corners_per_game,
                first_half_per_game: dbRow.corners_first_half_per_game,
              },
              tendencies: {
                both_teams_score_pct: dbRow.btts_pct,
                over_2_5_goals_pct:   dbRow.over_2_5_goals_pct,
              },
              data_quality: 'REAL',
              quality: { level: 'REAL', sampleSize: dbRow.games_played },
            };
          }
        } catch (_) {}

        // Priority 2: API-Football external fetch
        return this._fetchTeamStats(teamName);
      },
      3600
    );

    return data || this._estimateTeamStats(teamName);
  }

  async _fetchTeamStats(teamName) {
    if (!this.apifKey) return null;
    try {
      // Search for team ID first
      const searchUrl = `https://api-football-v1.p.rapidapi.com/v3/teams?search=${encodeURIComponent(teamName)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'X-RapidAPI-Key': this.apifKey, 'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com' },
        signal: AbortSignal.timeout(6000),
      });
      if (!searchRes.ok) return null;
      const searchJson = await searchRes.json();
      const team = searchJson.response?.[0];
      if (!team) return null;

      // Get current season stats
      const season = new Date().getFullYear();
      const statsUrl = `https://api-football-v1.p.rapidapi.com/v3/teams/statistics?team=${team.team.id}&season=${season}`;
      const statsRes = await fetch(statsUrl, {
        headers: { 'X-RapidAPI-Key': this.apifKey, 'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com' },
        signal: AbortSignal.timeout(6000),
      });
      if (!statsRes.ok) return null;
      const statsJson = await statsRes.json();
      const s = statsJson.response;
      if (!s) return null;

      const played = s.fixtures?.played?.total || 0;
      return makeTeamStats({
        name:                     s.team.name,
        played,
        won:                      s.fixtures?.wins?.total || 0,
        drawn:                    s.fixtures?.draws?.total || 0,
        lost:                     s.fixtures?.loses?.total || 0,
        goals_for:                s.goals?.for?.total?.total || 0,
        goals_against:            s.goals?.against?.total?.total || 0,
        shots_per_game:           s.shots?.total?.total ? parseFloat((s.shots.total.total / played).toFixed(1)) : null,
        shots_on_target_per_game: s.shots?.on?.total ? parseFloat((s.shots.on.total / played).toFixed(1)) : null,
        clean_sheets:             s.clean_sheet?.total || 0,
        btts_pct:                 (s.both_teams_scored?.total && played)
                                    ? parseFloat(((s.both_teams_scored.total / played) * 100).toFixed(1))
                                    : null,
      });
    } catch (e) {
      console.warn('[Football] team stats fetch failed:', e.message);
      return null;
    }
  }

  _estimateTeamStats(teamName) {
    // League-average estimates when no real data available
    return makeTeamStats({
      name:               teamName,
      played:             0,
      shots_per_game:     13.2,
      shots_on_target_per_game: 4.4,
      corners_per_game:   5.1,
      corners_ht_per_game: 2.2,
    });
  }

  // ── Standings ────────────────────────────────────────────────────────────
  /**
   * Fetch league standings with multiple source fallbacks
   * @param {string} competition_id - League ID (e.g., 'PL', 39 for API-Football)
   * @returns {Promise<Object>} Standings with position, team_name, stats, form
   */
  async getStandings(competition_id) {
    const cacheKey = `football:standings:${competition_id}`;

    const { data } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchStandings(competition_id),
      3600
    );

    return data || [];
  }

  async _fetchStandings(competition_id) {
    // Priority 1: API-Football
    if (this.apifKey) {
      try {
        const url = `https://api-football-v1.p.rapidapi.com/v3/standings?league=${competition_id}&season=2024`;
        const res = await fetch(url, {
          headers: {
            'X-RapidAPI-Key': this.apifKey,
            'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.response && json.response[0]?.standings) {
            return json.response[0].standings.map(s => ({
              position: s.rank,
              team_name: s.team.name,
              played: s.all?.played || 0,
              won: s.all?.win || 0,
              drawn: s.all?.draw || 0,
              lost: s.all?.lose || 0,
              goals_for: s.all?.goals?.for || 0,
              goals_against: s.all?.goals?.against || 0,
              goal_diff: (s.all?.goals?.for || 0) - (s.all?.goals?.against || 0),
              points: s.points,
              form_last_5: s.form || null,
              dq: DQ.REAL,
              source: 'api-football',
            }));
          }
        }
      } catch (e) { console.warn('[Football] API-Football standings failed:', e.message); }
    }

    // Priority 2: TheSportsDB
    try {
      const url = `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${competition_id}&s=2024-2025`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json = await res.json();
        if (json.table) {
          return json.table.map(t => ({
            position: t.intRank,
            team_name: t.strTeam,
            played: t.intPlayed || 0,
            won: t.intWin || 0,
            drawn: t.intDraw || 0,
            lost: t.intLoss || 0,
            goals_for: t.intGoalsFor || 0,
            goals_against: t.intGoalsAgainst || 0,
            goal_diff: (t.intGoalsFor || 0) - (t.intGoalsAgainst || 0),
            points: t.intPoints || 0,
            form_last_5: null,
            dq: DQ.EST,
            source: 'thesportsdb',
          }));
        }
      }
    } catch (e) { console.warn('[Football] TheSportsDB standings failed:', e.message); }

    return [];
  }

  // ── Team Availability ────────────────────────────────────────────────────
  /**
   * Check player availability / injury status for a team
   * @param {string} team_name - Team name
   * @returns {Promise<Object>} Players array with injury status
   */
  async getTeamAvailability(team_name) {
    const cacheKey = `football:availability:${team_name.toLowerCase().replace(/\s/g, '_')}`;

    const { data } = await this.cache.getOrFetch(
      cacheKey,
      () => this._fetchTeamAvailability(team_name),
      900
    );

    return data || { players: [] };
  }

  async _fetchTeamAvailability(team_name) {
    if (!this.apifKey) {
      return { players: [], dq: DQ.EST, source: 'estimated' };
    }

    try {
      // Search for team ID first
      const searchUrl = `https://api-football-v1.p.rapidapi.com/v3/teams?search=${encodeURIComponent(team_name)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'X-RapidAPI-Key': this.apifKey, 'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com' },
        signal: AbortSignal.timeout(6000),
      });
      if (!searchRes.ok) return { players: [] };
      const searchJson = await searchRes.json();
      const team = searchJson.response?.[0];
      if (!team) return { players: [] };

      // Get injuries for team
      const injUrl = `https://api-football-v1.p.rapidapi.com/v3/injuries?team=${team.team.id}&season=2024`;
      const injRes = await fetch(injUrl, {
        headers: { 'X-RapidAPI-Key': this.apifKey, 'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com' },
        signal: AbortSignal.timeout(6000),
      });

      if (injRes.ok) {
        const injJson = await injRes.json();
        return {
          players: (injJson.response || []).map(inj => ({
            name: inj.player?.name,
            status: inj.player?.injured ? 'out' : 'active',
            injury_type: inj.type,
            return_estimate: inj.player?.replacement?.name || null,
            source: 'api-football',
          })),
          dq: DQ.REAL,
          source: 'api-football',
        };
      }
    } catch (e) { console.warn('[Football] team availability failed:', e.message); }

    return { players: [], dq: DQ.EST, source: 'estimated' };
  }

  // ── Props Generation ──────────────────────────────────────────────────
  /**
   * Generate enhanced game props with line movement, context, and projection ranges
   * @param {Object} game - Game object
   * @param {Object} homeStats - Home team stats
   * @param {Object} awayStats - Away team stats
   * @returns {Promise<Array>} Array of prop objects with full schema
   */
  async generateGameProps(game, homeStats, awayStats) {
    const shots   = estimateShots(homeStats?.shots, awayStats?.shots);
    const corners = estimateCorners(homeStats, awayStats);

    const props = [];

    // Shots props
    if (shots.home !== null) {
      const shotsAvg = shots.total;
      const shotsRange = projectionRange(shotsAvg, 0.25);

      props.push({
        game_id: game.id,
        stat: 'shots_total',
        line: shotsRange.median,
        avg: shotsAvg,
        projection_range: shotsRange,
        line_movement: makeLineMovement({}),
        market_context: { public_betting_pct: null, sharp_action: null, consensus_pick: null },
        dq: shots.dq,
        source: 'estimated',
      });
    }

    // Corners props
    if (corners.total !== null) {
      const cornersAvg = corners.total;
      const cornersRange = projectionRange(cornersAvg, 0.28);

      props.push({
        game_id: game.id,
        stat: 'corners_total',
        line: cornersRange.median,
        avg: cornersAvg,
        projection_range: cornersRange,
        line_movement: makeLineMovement({}),
        market_context: { public_betting_pct: null, sharp_action: null, consensus_pick: null },
        dq: corners.dq,
        source: 'estimated',
      });
    }

    return props;
  }

  // ── Enhanced Team Stats ───────────────────────────────────────────────────
  /**
   * Get team stats with enhanced schema fields and recency weighting
   * @param {string} teamName - Team name
   * @returns {Promise<Object>} Enhanced team statistics
   */
  async getTeamStatsEnhanced(teamName) {
    const baseStats = await this.getTeamStats(teamName);
    if (!baseStats) return null;

    // Apply recency weighting if recent games available
    let enhancedShots = baseStats.shots?.per_game;
    let enhancedCorners = baseStats.corners?.per_game;

    // Use renamed fields from schema
    return {
      ...baseStats,
      both_teams_score_pct: baseStats.tendencies?.both_teams_score_pct,
      over_2_5_goals_pct: baseStats.tendencies?.over_2_5_goals_pct,
      shots_first_half_per_game: baseStats.shots?.first_half_per_game,
      corners_first_half_per_game: baseStats.corners?.first_half_per_game,
    };
  }
}
