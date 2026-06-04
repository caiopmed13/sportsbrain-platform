/**
 * PersistenceService — SportsBrain Data API 4.3
 * ──────────────────────────────────────────────
 * Encapsulates all D1 write operations for historical data accumulation.
 *
 * Design principles:
 *  • All methods are fire-and-forget safe — errors are caught and logged,
 *    never thrown. Callers use ctx.waitUntil() so failures are non-blocking.
 *  • INSERT OR REPLACE for games (TEXT PK), team_stats, player_stats
 *    (UNIQUE indexes created in Fase 40 migration).
 *  • INSERT OR IGNORE for prop_results (idempotent via prop_key UNIQUE index).
 *  • Batch writes use D1 .batch() for efficiency.
 *  • Only called when source !== 'cache' (write-through pattern).
 */

export class PersistenceService {
  constructor(env) {
    this.db = env.SB_DB || null;
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  _now() {
    return new Date().toISOString();
  }

  _currentSeason() {
    const y = new Date().getFullYear();
    const m = new Date().getMonth() + 1; // 1-12
    // Football: season starts ~Aug. Basketball: season starts ~Oct.
    return m >= 8 ? y : y - 1;
  }

  _propKey(sport, gameId, playerSlug, stat, line, date) {
    return `${sport}:${gameId}:${playerSlug}:${stat}:${line}:${date}`;
  }

  _slugify(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  // ── Games ──────────────────────────────────────────────────────────────

  /**
   * Upsert a single game into the games table.
   * Uses INSERT OR REPLACE because id is the TEXT PRIMARY KEY.
   */
  async upsertGame(game, sport) {
    if (!this.db || !game?.id) return;
    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO games
          (id, sport, home_team, away_team, league, competition_id,
           game_date, kickoff, status,
           score_home, score_away, score_ht_home, score_ht_away,
           season, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        String(game.id),
        sport,
        game.home_team || null,
        game.away_team || null,
        game.league    || null,
        game.competition_id || null,
        game.date      || game.game_date || null,
        game.kickoff   || game.tip_off   || null,
        game.status    || 'scheduled',
        game.score?.home ?? game.score_home ?? null,
        game.score?.away ?? game.score_away ?? null,
        game.score?.ht_home ?? game.score_ht_home ?? null,
        game.score?.ht_away ?? game.score_ht_away ?? null,
        game.season    || this._currentSeason(),
        game.source    || 'api',
        this._now(),
        this._now()
      ).run();
    } catch (e) {
      console.warn('[Persist] upsertGame error:', e.message, 'game:', game.id);
    }
  }

  /**
   * Batch-upsert an array of games.
   * Splits into chunks of 20 to stay within D1 batch limits.
   */
  async upsertGames(games, sport) {
    if (!this.db || !games?.length) return;
    const CHUNK = 20;
    for (let i = 0; i < games.length; i += CHUNK) {
      const chunk = games.slice(i, i + CHUNK);
      try {
        const stmts = chunk.map(game =>
          this.db.prepare(`
            INSERT OR REPLACE INTO games
              (id, sport, home_team, away_team, league, competition_id,
               game_date, kickoff, status,
               score_home, score_away, score_ht_home, score_ht_away,
               season, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            String(game.id),
            sport,
            game.home_team || null,
            game.away_team || null,
            game.league    || null,
            game.competition_id || null,
            game.date      || game.game_date || null,
            game.kickoff   || game.tip_off   || null,
            game.status    || 'scheduled',
            game.score?.home ?? game.score_home ?? null,
            game.score?.away ?? game.score_away ?? null,
            game.score?.ht_home ?? game.score_ht_home ?? null,
            game.score?.ht_away ?? game.score_ht_away ?? null,
            game.season    || this._currentSeason(),
            game.source    || 'api',
            this._now(),
            this._now()
          )
        );
        await this.db.batch(stmts);
      } catch (e) {
        console.warn('[Persist] upsertGames batch error:', e.message);
      }
    }
  }

  // ── Team Stats ─────────────────────────────────────────────────────────

  /**
   * Upsert team stats for one team.
   * UNIQUE index: (team_name, sport, season, home_away) → INSERT OR REPLACE.
   *
   * @param {Object} stats  — output of makeTeamStats()
   * @param {string} sport  — 'football' | 'basketball'
   * @param {string} homeAway — 'home' | 'away' | 'all'
   */
  async upsertTeamStats(stats, sport, homeAway = 'all') {
    if (!this.db || !stats?.name) return;
    const season = this._currentSeason();
    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO team_stats
          (team_name, sport, season, home_away,
           played, won, drawn, lost,
           goals_for, goals_against,
           shots_per_game, shots_on_target_per_game,
           corners_per_game, corners_first_half_per_game,
           shots_first_half_per_game,
           xg_per_game, clean_sheets,
           both_teams_score_pct, over_2_5_goals_pct,
           form_json, data_quality, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        stats.name,
        sport,
        season,
        homeAway,
        stats.played || 0,
        stats.record?.won   || 0,
        stats.record?.drawn || 0,
        stats.record?.lost  || 0,
        stats.goals?.for    || 0,
        stats.goals?.against|| 0,
        stats.shots?.per_game ?? stats.shots_per_game ?? null,
        stats.shots?.on_target_per_game ?? stats.shots_on_target_per_game ?? null,
        stats.corners?.per_game ?? stats.corners_per_game ?? null,
        stats.corners_first_half_per_game ?? null,
        stats.shots_first_half_per_game ?? null,
        stats.xg_per_game ?? null,
        stats.clean_sheets ?? 0,
        stats.both_teams_score_pct ?? null,
        stats.over_2_5_goals_pct   ?? null,
        stats.form ? JSON.stringify(stats.form) : null,
        stats.quality?.level || 'EST',
        stats.quality?.source || 'api',
        this._now()
      ).run();
    } catch (e) {
      console.warn('[Persist] upsertTeamStats error:', e.message, 'team:', stats.name);
    }
  }

  // ── Player Stats ───────────────────────────────────────────────────────

  /**
   * Upsert NBA player stats.
   * UNIQUE index: (player_name, sport, season) → INSERT OR REPLACE.
   *
   * @param {Object} player — output of BasketballService.getPlayerStats()
   */
  async upsertPlayerStats(player) {
    if (!this.db || !player?.name) return;
    const season = this._currentSeason();
    const avgs   = player.season_averages || {};
    try {
      await this.db.prepare(`
        INSERT OR REPLACE INTO player_stats
          (player_name, sport, team, season, position,
           games_played,
           pts_avg, reb_avg, ast_avg, stl_avg, blk_avg, to_avg,
           min_avg, fg_pct, fg3_pct, ft_pct,
           injury_status, data_quality, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        player.name || `${player.first_name} ${player.last_name}`.trim(),
        'basketball',
        player.team || null,
        season,
        player.position || null,
        avgs.games_played ?? avgs.gp ?? null,
        avgs.points ?? avgs.pts ?? null,
        avgs.rebounds ?? avgs.reb ?? null,
        avgs.assists  ?? avgs.ast ?? null,
        avgs.steals   ?? avgs.stl ?? null,
        avgs.blocks   ?? avgs.blk ?? null,
        avgs.turnovers ?? avgs.to ?? null,
        avgs.minutes  ?? avgs.min ?? null,
        avgs.field_goal_pct ?? avgs.fg_pct ?? null,
        avgs.three_point_pct ?? avgs.fg3_pct ?? null,
        avgs.free_throw_pct  ?? avgs.ft_pct  ?? null,
        player.availability?.status || player.injury_status || 'available',
        player.quality?.level || 'REAL',
        player.quality?.source || 'balldontlie',
        this._now()
      ).run();
    } catch (e) {
      console.warn('[Persist] upsertPlayerStats error:', e.message, 'player:', player.name);
    }
  }

  // ── Prop Results ───────────────────────────────────────────────────────

  /**
   * Insert prop results (pre-game snapshot).
   * Uses INSERT OR IGNORE — we never overwrite a prop once stored.
   * actual_value and result are null at creation time; updated post-game.
   *
   * @param {Array}  props    — array of prop objects (output of route builders)
   * @param {string} sport    — 'football' | 'basketball'
   * @param {string} gameDate — YYYY-MM-DD
   * @param {string} gameId   — game identifier
   */
  async insertPropResults(props, sport, gameDate, gameId) {
    if (!this.db || !props?.length) return;
    const CHUNK = 20;
    const validProps = props.filter(p => p && (p.line != null || p.stat));

    for (let i = 0; i < validProps.length; i += CHUNK) {
      const chunk = validProps.slice(i, i + CHUNK);
      try {
        const stmts = chunk.map(p => {
          const playerSlug = this._slugify(p.player_name || p.home_team || 'team');
          const stat       = p.stat || 'total';
          const line       = p.line || p.projected_avg || 0;
          const propKey    = this._propKey(sport, gameId || p.match_id || p.game_id, playerSlug, stat, line, gameDate);

          return this.db.prepare(`
            INSERT OR IGNORE INTO prop_results
              (prop_key, game_id, sport, player_name, team, stat, line, direction,
               tier, is_ht, projected_avg, conf_at_time, ev_at_time,
               actual_value, result, data_quality, game_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
          `).bind(
            propKey,
            String(gameId || p.match_id || p.game_id || ''),
            sport,
            p.player_name || null,
            p.team        || null,
            stat,
            line,
            p.direction   || 'over',
            p.tier        || 'median',
            p.is_ht       ? 1 : 0,
            p.projected_avg ?? p.avg ?? null,
            p.confidence  ?? p.conf ?? null,
            p.ev_pct      ?? null,
            p.quality?.level || p.dataQuality || 'EST',
            gameDate,
            this._now()
          );
        });
        await this.db.batch(stmts);
      } catch (e) {
        console.warn('[Persist] insertPropResults batch error:', e.message);
      }
    }
  }

  // ── Convenience: persist full football game package ──────────────────

  /**
   * Full football persistence after a live fetch:
   *   1. upsertGames
   *   2. upsertTeamStats for every home/away pair
   *   3. insertPropResults for every game's props
   */
  async persistFootballPackage(games, teamStatsMap, propsMap, date) {
    if (!this.db) return;

    // 1. Games
    await this.upsertGames(games, 'football');

    // 2. Team stats
    for (const [teamName, stats] of Object.entries(teamStatsMap || {})) {
      if (stats) await this.upsertTeamStats(stats, 'football', stats.home_away || 'all');
    }

    // 3. Props
    for (const [gameId, propsData] of Object.entries(propsMap || {})) {
      if (propsData?.props?.length) {
        await this.insertPropResults(propsData.props, 'football', date, gameId);
      }
    }
  }

  /**
   * Full basketball persistence after a live fetch:
   *   1. upsertGames
   *   2. upsertPlayerStats for each player encountered
   *   3. insertPropResults
   */
  async persistBasketballPackage(games, playerStatsMap, propsMap, date) {
    if (!this.db) return;

    // 1. Games
    await this.upsertGames(games, 'basketball');

    // 2. Player stats
    for (const [, playerData] of Object.entries(playerStatsMap || {})) {
      if (playerData) await this.upsertPlayerStats(playerData);
    }

    // 3. Props
    for (const [gameId, propsData] of Object.entries(propsMap || {})) {
      if (propsData?.props?.length) {
        await this.insertPropResults(propsData.props, 'basketball', date, gameId);
      }
    }
  }
}
