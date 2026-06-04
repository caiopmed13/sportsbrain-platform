// ══════════════════════════════════════════════════════════════════════════
// Poisson + xG — replaces goal-average λ with xG-based λ when available
// ══════════════════════════════════════════════════════════════════════════
import { probabilitiesFromLambdas } from '../services/poisson.js';
import { getTeamFeatures } from '../enrich/teamFeatures.js';
import { predictSoccerMatch } from '../services/poisson.js';

const TAG = '[ml:poissonXG]';

const HOME_BOOST = 1.15;
const AWAY_DAMP  = 0.95;

// λ_home = avg(home.xg, away.xga) * HOME_BOOST
// λ_away = avg(away.xg, home.xga) * AWAY_DAMP
export function lambdasFromXG({ home_xg, home_xga, away_xg, away_xga }) {
  const lambdaH = ((home_xg + away_xga) / 2) * HOME_BOOST;
  const lambdaA = ((away_xg + home_xga) / 2) * AWAY_DAMP;
  return { lambdaH, lambdaA };
}

// Main entry — tries xG path first, falls back to goal-average Poisson.
// event: { id, home, away, league }
export async function predictSoccerXG(env, event) {
  try {
    const feats = await getTeamFeatures(env, event.id);
    const hxg  = feats?.home?.xg;
    const hxga = feats?.home?.xga;
    const axg  = feats?.away?.xg;
    const axga = feats?.away?.xga;
    if ([hxg, hxga, axg, axga].some(v => v == null || !isFinite(v))) {
      // Fallback
      const fb = await predictSoccerMatch(env, event);
      if (fb) return { ...fb, source: 'poisson_goalavg' };
      return null;
    }
    const { lambdaH, lambdaA } = lambdasFromXG({
      home_xg: hxg, home_xga: hxga, away_xg: axg, away_xga: axga,
    });
    const probs = probabilitiesFromLambdas(lambdaH, lambdaA);
    return { ...probs, lambda_home: lambdaH, lambda_away: lambdaA, source: 'poisson_xg' };
  } catch (e) {
    console.warn(`${TAG} err: ${e.message}`);
    try {
      const fb = await predictSoccerMatch(env, event);
      if (fb) return { ...fb, source: 'poisson_goalavg' };
    } catch {}
    return null;
  }
}
