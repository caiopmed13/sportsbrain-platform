// src/services/teamIntelligenceProfiles.js
// ─────────────────────────────────────────────────────────────────────────────
// P2.4 — Team Intelligence Profiles
//
// Pure-JS functions (no D1, no async, no external deps) that convert raw
// feature objects (from sofascoreIntelBulk.js) into rich structured profiles
// ready for the frontend and the Golden picks engine.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Safely cap a numeric value to [0, 100].
 * @param {number|null|undefined} v
 * @returns {number|null}
 */
function cap100(v) {
  if (v == null || !isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(100, v)));
}

/**
 * Format a rate (0-1 float) as an integer percentage string, e.g. 0.63 → "63%".
 * @param {number} rate
 * @returns {string}
 */
function pct(rate) {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Compute the overall PPG (points per game) from the form object.
 * Returns null when form is absent or when total games = 0.
 * @param {object|null} form
 * @returns {number|null}
 */
function overallPPG(form) {
  if (!form) return null;
  const games = (form.wins ?? 0) + (form.draws ?? 0) + (form.losses ?? 0);
  if (!games) return null;
  return (form.points ?? 0) / games;
}

/**
 * Compute the recent PPG from the recentForm5 object (points are over ≤5 games).
 * The stored `points` already equals wins*3 + draws, over however many recent games.
 * We normalise to per-game.
 * @param {object|null} rf5
 * @returns {number|null}
 */
function recentPPG(rf5) {
  if (!rf5) return null;
  const games = (rf5.wins ?? 0) + (rf5.draws ?? 0) + (rf5.losses ?? 0);
  if (!games) return null;
  return (rf5.points ?? 0) / games;
}

/**
 * Derive a trend string for form: "up" | "down" | "stable" | "unknown".
 * Requires at least 5 recent matches in recentForm5; otherwise "unknown".
 * @param {object|null} recentForm5
 * @param {object|null} form
 * @returns {"up"|"down"|"stable"|"unknown"}
 */
function computeFormTrend(recentForm5, form) {
  if (!recentForm5) return 'unknown';
  const recentGames = (recentForm5.wins ?? 0) + (recentForm5.draws ?? 0) + (recentForm5.losses ?? 0);
  if (recentGames < 5) return 'unknown';

  const rPPG = recentPPG(recentForm5);
  const oPPG = overallPPG(form);
  if (rPPG == null || oPPG == null) return 'unknown';

  if (rPPG >= oPPG + 0.3) return 'up';
  if (rPPG <= oPPG - 0.3) return 'down';
  return 'stable';
}

/**
 * Derive an attack trend: "up" | "down" | "stable" | "unknown".
 * @param {object|null} recentForm5
 * @param {object|null} form
 * @returns {"up"|"down"|"stable"|"unknown"}
 */
function computeAttackTrend(recentForm5, form) {
  if (!recentForm5 || form == null) return 'unknown';
  const rGf = recentForm5.gfPerMatch;
  const oGf = form.gfPerMatch;
  if (rGf == null || oGf == null) return 'unknown';
  if (rGf >= oGf + 0.2) return 'up';
  if (rGf <= oGf - 0.2) return 'down';
  return 'stable';
}

/**
 * Derive a defense trend: "up" (improving) | "down" (worsening) | "stable" | "unknown".
 * Lower ga = improvement → "up".
 * @param {object|null} recentForm5
 * @param {object|null} form
 * @returns {"up"|"down"|"stable"|"unknown"}
 */
function computeDefenseTrend(recentForm5, form) {
  if (!recentForm5 || form == null) return 'unknown';
  const rGa = recentForm5.gaPerMatch;
  const oGa = form.gaPerMatch;
  if (rGa == null || oGa == null) return 'unknown';
  if (rGa <= oGa - 0.2) return 'up';   // fewer goals conceded recently → improving
  if (rGa >= oGa + 0.2) return 'down'; // more goals conceded recently → worsening
  return 'stable';
}

/**
 * Compute a 0-100 form score.
 * @param {number|null} ppg
 * @param {"up"|"down"|"stable"|"unknown"} trend
 * @param {object|null} recentForm5
 * @returns {number|null}
 */
function computeFormScore(ppg, trend, recentForm5) {
  if (ppg == null) return null;
  let score = (ppg / 3) * 60;
  if (trend === 'up') score += 20;
  if (recentForm5?.inForm) score += 20;
  else if (recentForm5?.outOfForm) score -= 10;
  return cap100(score);
}

/**
 * Compute a 0-100 strength score for a home or away split.
 * Formula: winRate*60 + (1 - gaPerMatch/3)*40, capped to [0,100].
 * @param {object|null} split
 * @returns {number|null}
 */
function computeSplitStrengthScore(split) {
  if (!split) return null;
  const wr  = split.winRate   ?? 0;
  const gam = split.gaPerMatch ?? 3;
  const raw = wr * 60 + (1 - Math.min(gam, 3) / 3) * 40;
  return cap100(raw);
}

/**
 * Compute a 0-100 attack momentum score.
 * Formula: (goalsForAvg / 3) * 80 + (trend=='up' ? 20 : 0), capped.
 * @param {number|null} gfAvg
 * @param {"up"|"down"|"stable"|"unknown"} trend
 * @returns {number|null}
 */
function computeAttackMomentumScore(gfAvg, trend) {
  if (gfAvg == null) return null;
  const raw = (Math.min(gfAvg, 3) / 3) * 80 + (trend === 'up' ? 20 : 0);
  return cap100(raw);
}

/**
 * Compute a 0-100 defense momentum score.
 * Formula: (1 - gaAvg/3) * 80 + (trend=='up' ? 20 : 0), capped.
 * "up" for defense means improving (conceding less).
 * @param {number|null} gaAvg
 * @param {"up"|"down"|"stable"|"unknown"} trend
 * @returns {number|null}
 */
function computeDefenseMomentumScore(gaAvg, trend) {
  if (gaAvg == null) return null;
  const raw = (1 - Math.min(gaAvg, 3) / 3) * 80 + (trend === 'up' ? 20 : 0);
  return cap100(raw);
}

/**
 * Compute a 0-100 totals profile score.
 * @param {number|null} over25Rate
 * @param {number|null} avgTotalGoals
 * @returns {number|null}
 */
function computeTotalsScore(over25Rate, avgTotalGoals) {
  if (over25Rate == null) return null;
  const raw = over25Rate * 60 + Math.min((avgTotalGoals ?? 0) / 4, 1) * 40;
  return cap100(raw);
}

/**
 * Compute first-half profile score.
 * @param {object|null} htStats
 * @returns {number|null}
 */
function computeFirstHalfScore(htStats) {
  if (!htStats) return null;
  const raw = (htStats.over05Rate ?? 0) * 50 + (htStats.bttsRate ?? 0) * 50;
  return cap100(raw);
}

/**
 * Compute a data quality score (0-100) from matchesAvailable.
 * @param {number} matchesAvailable
 * @returns {number}
 */
function computeDataQualityScore(matchesAvailable) {
  if (matchesAvailable >= 20) return 100;
  if (matchesAvailable >= 10) return 75;
  if (matchesAvailable >= 5)  return 50;
  if (matchesAvailable >= 1)  return 25;
  return 0;
}

/**
 * Determine confidence string from matchesAvailable.
 * @param {number} matchesAvailable
 * @returns {"high"|"medium"|"low"|"none"}
 */
function computeConfidence(matchesAvailable) {
  if (matchesAvailable >= 10) return 'high';
  if (matchesAvailable >= 5)  return 'medium';
  if (matchesAvailable >= 1)  return 'low';
  return 'none';
}

/**
 * Build the list of missing fields for a team profile.
 * @param {object} p — partially-built profile
 * @returns {string[]}
 */
function buildMissingFields(p) {
  const missing = [];
  if (!p.form || p.form.win_rate == null)        missing.push('form');
  if (!p.home)                                    missing.push('home_split');
  if (!p.away)                                    missing.push('away_split');
  if (!p.btts || p.btts.rate == null)             missing.push('btts');
  if (!p.first_half || !p.first_half.data_available) missing.push('first_half');
  if (!p.attack || p.attack.goals_for_avg == null) missing.push('attack');
  if (!p.defense || p.defense.goals_against_avg == null) missing.push('defense');
  return missing;
}

/**
 * Build the team-level label array from the profile.
 * CRITICAL: rate === 0 is a valid value — never hide a label because rate===0.
 * Only hide when rate is null or undefined.
 * @param {object} p — full profile (partially built)
 * @returns {string[]}
 */
function buildTeamLabels(p) {
  const labels = [];
  const { form, home, away, attack, defense, btts, data_quality } = p;

  // ── Form labels ──────────────────────────────────────────────────────────
  if (form) {
    const { trend, form_score } = form;
    if (trend === 'up' && form_score != null && form_score >= 60)
      labels.push('Forma em alta');
    if (trend === 'down' && form_score != null && form_score < 40)
      labels.push('Forma em queda');
    if (trend === 'stable' && form_score != null && form_score >= 40 && form_score <= 60)
      labels.push('Oscilando');
  }

  // ── Home/away win rate labels ────────────────────────────────────────────
  if (home && home.win_rate != null) {
    if (home.win_rate >= 0.55)
      labels.push(`Mandante forte: ${pct(home.win_rate)} em casa`);
    else if (home.win_rate <= 0.35)
      labels.push(`Mandante fraco: só ${pct(home.win_rate)} em casa`);
  }

  if (away && away.win_rate != null) {
    if (away.win_rate >= 0.50)
      labels.push(`Visitante forte: ${pct(away.win_rate)} fora`);
    else if (away.win_rate <= 0.30)
      labels.push(`Visitante fraco: só ${pct(away.win_rate)} fora`);
  }

  // ── Attack labels ────────────────────────────────────────────────────────
  if (attack) {
    if (attack.trend === 'up')   labels.push('Ataque em crescimento');
    if (attack.trend === 'down') labels.push('Ataque em queda');
    if (attack.goals_for_avg != null && attack.goals_for_avg >= 1.8)
      labels.push(`Volume ofensivo alto: ${attack.goals_for_avg.toFixed(1)}gl/jogo`);
  }

  // ── Defense labels ───────────────────────────────────────────────────────
  if (defense) {
    if (defense.goals_against_avg != null && defense.goals_against_avg >= 1.8)
      labels.push('Defesa vulnerável');
    if (defense.goals_against_avg != null && defense.goals_against_avg <= 0.9)
      labels.push('Defesa sólida');
  }

  // ── BTTS label ───────────────────────────────────────────────────────────
  // Show even when rate===0; only hide if rate is null/undefined.
  if (btts && btts.rate != null) {
    if (btts.rate >= 0.60)
      labels.push(`BTTS alto: ${pct(btts.rate)}`);
    else if (btts.rate <= 0.35)
      labels.push(`BTTS baixo: só ${pct(btts.rate)}`);
    else
      labels.push(`BTTS moderado: ${pct(btts.rate)}`);
  }

  // ── Data quality labels ──────────────────────────────────────────────────
  if (data_quality) {
    const ma = p._matchesAvailable ?? 0;
    if (ma >= 20)           labels.push('Histórico forte');
    else if (ma > 0 && ma < 5) labels.push('Amostra limitada');
    else if (ma === 0)      labels.push('Sem dados disponíveis');
  }

  return labels;
}

/**
 * Build a PT-BR summary sentence for a single team.
 * @param {object} p — full profile
 * @param {string} teamName
 * @returns {string}
 */
function buildTeamSummaryPt(p, teamName) {
  const name = teamName || 'Time';
  const ma = p._matchesAvailable ?? 0;

  if (ma === 0) {
    return `${name}: sem dados disponíveis para análise.`;
  }
  if (ma < 5) {
    return `${name}: histórico limitado — apenas ${ma} jogo${ma !== 1 ? 's' : ''} disponíve${ma !== 1 ? 'is' : 'l'}. Dados insuficientes para análise confiável.`;
  }

  const parts = [];

  // Form
  const formTrend = p.form?.trend;
  if (formTrend === 'up')   parts.push('forma em alta');
  else if (formTrend === 'down') parts.push('forma em queda');
  else if (formTrend === 'stable') parts.push('forma estável');

  // Attack
  const gfAvg = p.attack?.goals_for_avg;
  if (gfAvg != null) parts.push(`${gfAvg.toFixed(1)} gols/jogo`);

  // BTTS
  const bttsRate = p.btts?.rate;
  if (bttsRate != null) parts.push(`BTTS em ${pct(bttsRate)}`);

  const detail = parts.length ? `${name} apresenta ${parts.join(', ')}.` : `${name} com ${ma} jogos analisados.`;

  const extras = [];
  if (p.home?.win_rate != null && p.home.win_rate >= 0.55)
    extras.push(`Mandante forte em casa (${pct(p.home.win_rate)}).`);
  if (p.defense?.goals_against_avg != null && p.defense.goals_against_avg >= 1.8)
    extras.push('Defesa vulnerável.');

  return [detail, ...extras].join(' ');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a structured intelligence profile for a single team.
 *
 * @param {object} opts
 * @param {number}      opts.teamId      — team ID
 * @param {string}      opts.teamName    — human-readable name
 * @param {object|null} opts.teamFeats   — result of computeTeamFeaturesFromMatches
 * @param {object|null} opts.homeSplit   — result of computeSplitFeaturesFromMatches (side='home')
 * @param {object|null} opts.awaySplit   — result of computeSplitFeaturesFromMatches (side='away')
 * @param {string}      opts.asOfDate    — ISO date string, e.g. "2026-05-11"
 * @returns {object} Structured team intelligence profile
 */
export function buildTeamIntelligenceProfile({ teamId, teamName, teamFeats, homeSplit, awaySplit, asOfDate }) {
  // ── Data quality ──────────────────────────────────────────────────────────
  const matchesAvailable = teamFeats?.dataQuality?.matchesAvailable ?? 0;
  const dataQualityScore  = computeDataQualityScore(matchesAvailable);
  const confidence        = computeConfidence(matchesAvailable);

  const sampleWarnings = [];
  if (matchesAvailable < 5 && matchesAvailable > 0)
    sampleWarnings.push(`Apenas ${matchesAvailable} jogo(s) disponível(is) — amostra pequena.`);
  if (matchesAvailable === 0)
    sampleWarnings.push('Nenhum dado de partida disponível.');

  const warnings = [...sampleWarnings];

  // ── Form ──────────────────────────────────────────────────────────────────
  const rawForm     = teamFeats?.form ?? null;
  const rawRf5      = teamFeats?.recentForm5 ?? null;
  const formTrend   = computeFormTrend(rawRf5, rawForm);
  const oPPG        = overallPPG(rawForm);
  const formScore   = computeFormScore(oPPG, formTrend, rawRf5);

  const overallGames = rawForm
    ? (rawForm.wins ?? 0) + (rawForm.draws ?? 0) + (rawForm.losses ?? 0)
    : 0;

  const form = rawForm ? {
    last5_wins:      rawRf5?.wins   ?? null,
    last5_draws:     rawRf5?.draws  ?? null,
    last5_losses:    rawRf5?.losses ?? null,
    win_rate:        overallGames ? +(((rawForm.wins ?? 0) / overallGames).toFixed(3)) : null,
    draw_rate:       overallGames ? +(((rawForm.draws ?? 0) / overallGames).toFixed(3)) : null,
    loss_rate:       overallGames ? +(((rawForm.losses ?? 0) / overallGames).toFixed(3)) : null,
    points_per_game: oPPG != null ? +oPPG.toFixed(2) : null,
    goals_for_avg:   rawForm.gfPerMatch ?? null,
    goals_against_avg: rawForm.gaPerMatch ?? null,
    trend:           formTrend,
    form_score:      formScore,
  } : null;

  // ── Home split ────────────────────────────────────────────────────────────
  const home = homeSplit ? {
    matches:          homeSplit.matchesUsed ?? 0,
    win_rate:         homeSplit.winRate     ?? null,
    draw_rate:        homeSplit.drawRate    ?? null,
    loss_rate:        homeSplit.lossRate    ?? null,
    goals_for_avg:    homeSplit.gfPerMatch  ?? null,
    goals_against_avg: homeSplit.gaPerMatch ?? null,
    btts_rate:        homeSplit.bttsRate    ?? null,
    over25_rate:      homeSplit.over25Rate  ?? null,
    clean_sheet_rate: homeSplit.cleanSheetRate ?? null,
    strength_score:   computeSplitStrengthScore(homeSplit),
  } : null;

  // ── Away split ────────────────────────────────────────────────────────────
  const away = awaySplit ? {
    matches:          awaySplit.matchesUsed ?? 0,
    win_rate:         awaySplit.winRate     ?? null,
    draw_rate:        awaySplit.drawRate    ?? null,
    loss_rate:        awaySplit.lossRate    ?? null,
    goals_for_avg:    awaySplit.gfPerMatch  ?? null,
    goals_against_avg: awaySplit.gaPerMatch ?? null,
    btts_rate:        awaySplit.bttsRate    ?? null,
    over25_rate:      awaySplit.over25Rate  ?? null,
    clean_sheet_rate: awaySplit.cleanSheetRate ?? null,
    strength_score:   computeSplitStrengthScore(awaySplit),
  } : null;

  // ── Attack ────────────────────────────────────────────────────────────────
  const attackTrend = computeAttackTrend(rawRf5, rawForm);
  const gfAvg       = rawForm?.gfPerMatch ?? null;
  const recentGfAvg = rawRf5?.gfPerMatch  ?? null;
  const attack = {
    goals_for_avg:          gfAvg,
    recent_goals_for_avg:   recentGfAvg,
    trend:                  attackTrend,
    attack_momentum_score:  computeAttackMomentumScore(gfAvg, attackTrend),
  };

  // ── Defense ───────────────────────────────────────────────────────────────
  const defenseTrend = computeDefenseTrend(rawRf5, rawForm);
  const gaAvg        = rawForm?.gaPerMatch ?? null;
  const recentGaAvg  = rawRf5?.gaPerMatch  ?? null;

  // clean_sheet_rate from overall matches
  let cleanSheetRate = null;
  if (rawForm && matchesAvailable > 0) {
    // We don't have raw CS count stored in teamFeats; approximate via defense score
    // Use away+home split if available, else leave null
    if (home && away) {
      const totalSplitMatches = (home.matches ?? 0) + (away.matches ?? 0);
      if (totalSplitMatches > 0) {
        const homeCS = (home.clean_sheet_rate ?? 0) * (home.matches ?? 0);
        const awayCS = (away.clean_sheet_rate ?? 0) * (away.matches ?? 0);
        cleanSheetRate = +((homeCS + awayCS) / totalSplitMatches).toFixed(3);
      }
    } else if (home) {
      cleanSheetRate = home.clean_sheet_rate ?? null;
    } else if (away) {
      cleanSheetRate = away.clean_sheet_rate ?? null;
    }
  }

  const defense = {
    goals_against_avg:        gaAvg,
    recent_goals_against_avg: recentGaAvg,
    clean_sheet_rate:         cleanSheetRate,
    trend:                    defenseTrend,
    defense_momentum_score:   computeDefenseMomentumScore(gaAvg, defenseTrend),
  };

  // ── BTTS ──────────────────────────────────────────────────────────────────
  const bttsRate     = teamFeats?.bttsRate ?? null;
  const bttsHomeRate = homeSplit?.bttsRate  ?? null;
  const bttsAwayRate = awaySplit?.bttsRate  ?? null;
  // recent_rate: not directly stored; leave null (recentForm5 doesn't track BTTS)
  const bttsRecentRate = null;

  const bttsProfileScore = bttsRate != null ? cap100(bttsRate * 100) : null;

  let bttsLabel = null;
  if (bttsRate != null) {
    if (bttsRate >= 0.60)        bttsLabel = `BTTS alto: ${pct(bttsRate)}`;
    else if (bttsRate <= 0.35)   bttsLabel = `BTTS baixo: só ${pct(bttsRate)}`;
    else                          bttsLabel = `BTTS moderado: ${pct(bttsRate)}`;
  }

  const btts = {
    rate:               bttsRate,
    home_rate:          bttsHomeRate,
    away_rate:          bttsAwayRate,
    recent_rate:        bttsRecentRate,
    btts_profile_score: bttsProfileScore,
    label:              bttsLabel,
  };

  // ── Totals ────────────────────────────────────────────────────────────────
  const over25Rate    = teamFeats?.over25Rate ?? null;
  const avgTotalGoals = (gfAvg != null && gaAvg != null) ? +(gfAvg + gaAvg).toFixed(2) : null;
  const totalsScore   = computeTotalsScore(over25Rate, avgTotalGoals);

  const totals = {
    over15_rate:          bttsRate,          // proxy: if both scored (BTTS), at least 2 goals → over 1.5
    over25_rate:          over25Rate,
    under25_rate:         over25Rate != null ? +(1 - over25Rate).toFixed(3) : null,
    avg_total_goals:      avgTotalGoals,
    totals_profile_score: totalsScore,
  };

  // ── First half ────────────────────────────────────────────────────────────
  const htStats     = teamFeats?.htStats ?? null;
  const htScore     = computeFirstHalfScore(htStats);
  const first_half = {
    data_available:           htStats != null,
    matches_with_data:        htStats != null ? matchesAvailable : 0,
    goal_rate:                htStats?.avgGoals   ?? null,
    btts_rate:                htStats?.bttsRate   ?? null,
    over05_rate:              htStats?.over05Rate ?? null,
    first_half_profile_score: htScore,
  };

  // ── Discipline ────────────────────────────────────────────────────────────
  // D1 doesn't store cards → always unavailable for now
  const discipline = {
    data_available: false,
  };

  // ── Data quality block ────────────────────────────────────────────────────
  const data_quality = {
    dataQualityScore,
    confidence,
    missing_fields: [],   // filled below after profile is assembled
    sample_warnings: sampleWarnings,
  };

  // ── Assemble partial profile for label / missing field computation ─────────
  const partial = {
    team_id:              teamId,
    team_name:            teamName,
    as_of_date:           asOfDate,
    history_window_days:  180,
    matches_count:        matchesAvailable,
    form,
    home,
    away,
    attack,
    defense,
    btts,
    totals,
    first_half,
    discipline,
    data_quality,
    // internal — used by helpers, stripped before return
    _matchesAvailable:    matchesAvailable,
  };

  // Fill missing_fields now that profile shape is known
  partial.data_quality.missing_fields = buildMissingFields(partial);

  // ── Labels ────────────────────────────────────────────────────────────────
  const labels = buildTeamLabels(partial);

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary_pt = buildTeamSummaryPt(partial, teamName);

  // ── Final profile (remove internal _ field) ───────────────────────────────
  return {
    team_id:             teamId,
    team_name:           teamName,
    as_of_date:          asOfDate,
    history_window_days: 180,
    matches_count:       matchesAvailable,
    form,
    home,
    away,
    attack,
    defense,
    btts,
    totals,
    first_half,
    discipline,
    data_quality,
    labels,
    warnings,
    summary_pt,
  };
}

// ─── Match-level profile ──────────────────────────────────────────────────────

/**
 * Build a match-level intelligence profile from two team profiles and H2H data.
 *
 * @param {object} opts
 * @param {object}      opts.game           — { id?, home_team, away_team, kickoff }
 * @param {object|null} opts.homeProfile    — result of buildTeamIntelligenceProfile for the home team
 * @param {object|null} opts.awayProfile    — result of buildTeamIntelligenceProfile for the away team
 * @param {object|null} opts.h2h            — raw H2H object from bulk loader
 * @param {string}      opts.h2hConfidence  — 'high'|'medium'|'none'
 * @param {string}      opts.confidence     — 'high'|'low'|'none'
 * @returns {object} Structured match intelligence profile
 */
export function buildMatchIntelligenceProfile({ game, homeProfile, awayProfile, h2h, h2hConfidence, confidence }) {
  // ── Data quality ──────────────────────────────────────────────────────────
  const homeQS = homeProfile?.data_quality?.dataQualityScore ?? null;
  const awayQS = awayProfile?.data_quality?.dataQualityScore ?? null;
  let matchDataQuality = null;
  if (homeQS != null && awayQS != null) matchDataQuality = Math.round((homeQS + awayQS) / 2);
  else if (homeQS != null)              matchDataQuality = homeQS;
  else if (awayQS != null)              matchDataQuality = awayQS;

  // ── Matchup scores ────────────────────────────────────────────────────────
  const homeAdvantageScore  = homeProfile?.home?.win_rate != null
    ? Math.round(homeProfile.home.win_rate * 100) : null;

  const awayResistanceScore = awayProfile?.away?.win_rate != null
    ? Math.round(awayProfile.away.win_rate * 100) : null;

  const homeBtts = homeProfile?.btts?.rate ?? null;
  const awayBtts = awayProfile?.btts?.rate ?? null;
  const bttsMatchScore = (homeBtts != null && awayBtts != null)
    ? Math.round((homeBtts + awayBtts) / 2 * 100) : null;

  const homeOver25 = homeProfile?.totals?.over25_rate ?? null;
  const awayOver25 = awayProfile?.totals?.over25_rate ?? null;
  const over25MatchScore = (homeOver25 != null && awayOver25 != null)
    ? Math.round((homeOver25 + awayOver25) / 2 * 100) : null;

  // Upset risk: high when home is much stronger and away might surprise
  let upsetRiskScore = null;
  const homeFormScore = homeProfile?.form?.form_score ?? null;
  const awayFormScore = awayProfile?.form?.form_score ?? null;
  if (homeFormScore != null && awayFormScore != null && homeFormScore > 0) {
    upsetRiskScore = Math.round((awayFormScore / homeFormScore) * 50);
    upsetRiskScore = Math.max(0, Math.min(100, upsetRiskScore));
  }

  const volatilityScore = (bttsMatchScore != null && over25MatchScore != null)
    ? Math.round(bttsMatchScore * 0.5 + over25MatchScore * 0.5) : null;

  // Golden support score
  let goldenSupportScore = null;
  if (matchDataQuality != null) {
    let boost = 0;
    if (confidence === 'high')                                 boost += 20;
    if (homeProfile?.form?.trend === 'up')                    boost += 10;
    if (awayProfile?.form?.trend === 'down')                  boost += 5;
    if (h2hConfidence && h2hConfidence !== 'none')            boost += 10;
    if (bttsMatchScore != null && bttsMatchScore >= 60)       boost += 5;
    if (over25MatchScore != null && over25MatchScore >= 60)   boost += 5;
    goldenSupportScore = Math.min(100, Math.round(matchDataQuality * 0.6 + boost));
  }

  const matchup = {
    home_advantage_score:   homeAdvantageScore,
    away_resistance_score:  awayResistanceScore,
    btts_match_score:       bttsMatchScore,
    over25_match_score:     over25MatchScore,
    upset_risk_score:       upsetRiskScore,
    volatility_score:       volatilityScore,
    golden_support_score:   goldenSupportScore,
  };

  // ── Match labels ──────────────────────────────────────────────────────────
  const matchLabels = [];
  const homeName = game?.home_team ?? 'Mandante';
  const awayName = game?.away_team ?? 'Visitante';

  if (homeProfile && awayProfile) {
    if (homeProfile.form?.trend === 'up')
      matchLabels.push(`${homeName} - Forma em alta`);
    if (awayProfile.form?.trend === 'up')
      matchLabels.push(`${awayName} - Forma em alta`);
    if (awayProfile.away?.win_rate != null && awayProfile.away.win_rate >= 0.50)
      matchLabels.push(`${awayName} - Visitante forte fora`);

    if (h2h) {
      if (h2h.homeTeamWinRate != null && h2h.homeTeamWinRate > 0.50)
        matchLabels.push('H2H favorável ao mandante');
      else if (h2h.homeTeamWinRate != null && h2h.homeTeamWinRate >= 0.33 && h2h.homeTeamWinRate <= 0.50)
        matchLabels.push('H2H equilibrado');
    }

    if (!h2hConfidence || h2hConfidence === 'none')
      matchLabels.push('Sem H2H recente');

    if (
      (bttsMatchScore != null && bttsMatchScore >= 65) ||
      (over25MatchScore != null && over25MatchScore >= 65)
    ) {
      matchLabels.push('Confronto de alto volume');
    }

    if (
      bttsMatchScore != null && bttsMatchScore <= 30 &&
      over25MatchScore != null && over25MatchScore <= 30
    ) {
      matchLabels.push('Confronto esperado de poucos gols');
    }
  }

  // ── Combined warnings ─────────────────────────────────────────────────────
  const matchWarnings = [
    ...(homeProfile?.warnings ?? []).map(w => `[${homeName}] ${w}`),
    ...(awayProfile?.warnings ?? []).map(w => `[${awayName}] ${w}`),
  ];

  // ── Evidence pack ─────────────────────────────────────────────────────────
  const evidenceMissing = [];
  if (!homeProfile) evidenceMissing.push('home_profile');
  if (!awayProfile) evidenceMissing.push('away_profile');
  if (!h2h)         evidenceMissing.push('h2h_context');
  if (!homeProfile?.form || !awayProfile?.form) evidenceMissing.push('recent_form');
  if (homeBtts == null && awayBtts == null) evidenceMissing.push('btts_data');

  const evidence_pack = {
    has_team_profile:    !!(homeProfile || awayProfile),
    has_home_away_split: !!(homeProfile?.home || awayProfile?.away),
    has_btts_profile:    !!(homeProfile?.btts?.rate != null || awayProfile?.btts?.rate != null),
    has_recent_form:     !!(homeProfile?.form?.last5_wins != null || awayProfile?.form?.last5_wins != null),
    has_h2h_context:     !!(h2h && h2h.totalMatches > 0),
    data_quality_score:  matchDataQuality ?? 0,
    missing:             evidenceMissing,
  };

  // ── ML features ───────────────────────────────────────────────────────────
  const ml_features = {
    teamFormScore_home:       homeProfile?.form?.form_score       ?? null,
    teamFormScore_away:       awayProfile?.form?.form_score       ?? null,
    attackMomentum_home:      homeProfile?.attack?.attack_momentum_score  ?? null,
    attackMomentum_away:      awayProfile?.attack?.attack_momentum_score  ?? null,
    defenseMomentum_home:     homeProfile?.defense?.defense_momentum_score ?? null,
    defenseMomentum_away:     awayProfile?.defense?.defense_momentum_score ?? null,
    bttsProfile_home:         homeProfile?.btts?.btts_profile_score ?? null,
    bttsProfile_away:         awayProfile?.btts?.btts_profile_score ?? null,
    over25Profile_home:       homeProfile?.totals?.totals_profile_score ?? null,
    over25Profile_away:       awayProfile?.totals?.totals_profile_score ?? null,
    homeStrengthScore:        homeProfile?.home?.strength_score   ?? null,
    awayStrengthScore:        awayProfile?.away?.strength_score   ?? null,
    h2hMatches:               h2h?.totalMatches                   ?? null,
    h2hConfidence:            h2hConfidence                       ?? 'none',
    dataQuality_home:         homeQS,
    dataQuality_away:         awayQS,
    matchDataQuality:         matchDataQuality,
  };

  // ── Match summary ─────────────────────────────────────────────────────────
  const summaryParts = [];

  if (homeProfile && awayProfile) {
    const hTrend   = homeProfile.form?.trend;
    const aTrend   = awayProfile.form?.trend;
    const hAttack  = homeProfile.attack?.trend;
    const aDefense = awayProfile.defense?.goals_against_avg;

    if (hTrend === 'up') summaryParts.push('mandante com forma em alta');
    if (hAttack === 'up') summaryParts.push('ataque em crescimento');
    if (aDefense != null && aDefense >= 1.8) summaryParts.push('visitante apresenta defesa vulnerável');

    const avgBtts = (homeBtts != null && awayBtts != null)
      ? Math.round((homeBtts + awayBtts) / 2 * 100)
      : null;
    if (avgBtts != null) summaryParts.push(`BTTS em média ${avgBtts}% para ambas as equipes`);

    const qualityLabel = matchDataQuality != null
      ? (matchDataQuality >= 75 ? 'alta' : matchDataQuality >= 50 ? 'média' : 'baixa')
      : 'desconhecida';
    summaryParts.push(`qualidade de dados: ${qualityLabel}`);
  } else if (homeProfile || awayProfile) {
    summaryParts.push('dados parciais disponíveis — apenas uma das equipes tem perfil');
  } else {
    summaryParts.push('sem dados suficientes para análise');
  }

  const summary_pt = `${homeName} vs ${awayName} — ${summaryParts.join('. ')}.`;

  // ── Final match profile ───────────────────────────────────────────────────
  return {
    fixture_id:        game?.id ?? null,
    home_team:         game?.home_team ?? null,
    away_team:         game?.away_team ?? null,
    kickoff:           game?.kickoff   ?? null,
    confidence,
    h2h_confidence:    h2hConfidence,
    dataQualityScore:  matchDataQuality,
    homeProfile,
    awayProfile,
    h2h:               h2h ?? null,
    matchup,
    labels:            matchLabels,
    warnings:          matchWarnings,
    evidence_pack,
    ml_features,
    summary_pt,
  };
}
