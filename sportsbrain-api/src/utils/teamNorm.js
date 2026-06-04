// src/utils/teamNorm.js
// ──────────────────────────────────────────────────────────────────────────
// Fonte única de verdade para normalização de nomes de times.
// Usado em: index.js, premiumValidation.js, sofascore.js, sofascoreIngest.js
// ──────────────────────────────────────────────────────────────────────────

/**
 * Normaliza nome de time: remove acentos, lowercase, strip special chars.
 * "Atlético Mineiro" → "atletico mineiro"
 * "Grêmio" → "gremio"
 * "FC Barcelona" → "fc barcelona"
 * "Red Bull Bragantino" → "red bull bragantino"
 */
export function normTeam(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove combining diacritical marks (U+0300–U+036F)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Aliases: mapeamento de variações conhecidas para forma canônica normalizada.
const TEAM_ALIASES = {
  // Brasil
  'bragantino':           'red bull bragantino',
  'rb bragantino':        'red bull bragantino',
  'red bull':             'red bull bragantino',
  'atletico mg':          'atletico mineiro',
  'atletico paranaense':  'atletico paranaense',
  'cap':                  'atletico paranaense',
  'furacao':              'atletico paranaense',
  'vasco':                'vasco da gama',
  'sport':                'sport recife',
  'ceara':                'ceara sc',
  'abc':                  'abc natal',
  'csa':                  'csa alagoas',
  // Argentina
  'river':                'river plate',
  'boca':                 'boca juniors',
  'racing':               'racing club',
  'independiente':        'independiente avellaneda',
  'lanus':                'lanus',
  // Paraguai / Bolívia / Venezuela
  'libertad':             'club libertad',
  'libertad asuncion':    'club libertad',
  'cerro':                'cerro porteno',
  'cerro porteno':        'cerro porteno',
  'junior':               'atletico junior',
  'junior barranquilla':  'atletico junior',
  'carabobo':             'carabobo fc',
  // Europa
  'man city':             'manchester city',
  'man utd':              'manchester united',
  'man united':           'manchester united',
  'atletico madrid':      'atletico de madrid',
  'atletico de madrid':   'atletico de madrid',
  'betis':                'real betis',
  'real betis':           'real betis',
  'villarreal':           'villarreal cf',
  'levante':              'levante ud',
  // Copa Sul-Americana / Libertadores
  'union santa fe':       'union de santa fe',
  'u de chile':           'universidad de chile',
  'u de concepcion':      'universidad de concepcion',
  'deportivo lara':       'deportivo lara',
  'metropolitanos':       'metropolitanos fc',
};

/**
 * Resolve alias de time: "bragantino" → "red bull bragantino".
 * Retorna forma canônica normalizada ou o input normalizado se não houver alias.
 */
export function resolveTeamAlias(name) {
  const n = normTeam(name);
  return TEAM_ALIASES[n] || n;
}

/**
 * Lookup fuzzy no score map.
 * scMap: normKey("home|away") → entry
 * Estratégias (em ordem):
 *   1. exact match via normTeam
 *   2. exact match via resolveTeamAlias
 *   3. substring match (≥4 chars)
 */
export function fuzzyFindGameInMap(scMap, homePick, awayPick) {
  const hN = normTeam(homePick);
  const aN = normTeam(awayPick);
  const hA = resolveTeamAlias(homePick);
  const aA = resolveTeamAlias(awayPick);

  // 1. Exact
  if (scMap[`${hN}|${aN}`]) return scMap[`${hN}|${aN}`];
  if (scMap[`${aN}|${hN}`]) { const g = scMap[`${aN}|${hN}`]; return { ...g, home: g.away, away: g.home }; }

  // 2. Alias exact
  if (hA !== hN || aA !== aN) {
    if (scMap[`${hA}|${aA}`]) return scMap[`${hA}|${aA}`];
    if (scMap[`${aA}|${hA}`]) { const g = scMap[`${aA}|${hA}`]; return { ...g, home: g.away, away: g.home }; }
  }

  // 3. Substring (≥4 chars both sides)
  const minLen = 4;
  for (const [key, val] of Object.entries(scMap)) {
    const [mH, mA] = key.split('|');
    if (!mH || !mA) continue;
    const hMatch = hN.length >= minLen && mH.length >= minLen && (mH.includes(hN) || hN.includes(mH));
    const aMatch = aN.length >= minLen && mA.length >= minLen && (mA.includes(aN) || aN.includes(mA));
    if (hMatch && aMatch) return val;
    // reversed (pick home = map away)
    const hR = aN.length >= minLen && mH.length >= minLen && (mH.includes(aN) || aN.includes(mH));
    const aR = hN.length >= minLen && mA.length >= minLen && (mA.includes(hN) || hN.includes(mA));
    if (hR && aR) return { ...val, home: val.away, away: val.home };
  }
  return null;
}

/**
 * Calcula confiança de match entre um evento do pick e um evento de uma fonte.
 * Retorna { confidence: 'exact'|'high'|'medium'|'low'|'failed', reasons: string[] }
 *
 * pickTeams: { home: string, away: string }
 * sourceTeams: { home: string, away: string }
 * opts: { kickoffDeltaMin?: number }
 */
export function matchEventAcrossSources(pickTeams, sourceTeams, opts = {}) {
  const pH = resolveTeamAlias(pickTeams.home);
  const pA = resolveTeamAlias(pickTeams.away);
  const sH = resolveTeamAlias(sourceTeams.home);
  const sA = resolveTeamAlias(sourceTeams.away);

  const reasons = [];

  // Exact canonical match
  const exactH = pH === sH;
  const exactA = pA === sA;
  if (exactH && exactA) {
    reasons.push('exact team name match');
    return { confidence: 'exact', reasons };
  }

  // Substring match — both teams
  const subH = pH.includes(sH) || sH.includes(pH) || (pH.length >= 4 && sH.length >= 4 && (pH.split(' ').some(w => sH.includes(w)) || sH.split(' ').some(w => pH.includes(w))));
  const subA = pA.includes(sA) || sA.includes(pA) || (pA.length >= 4 && sA.length >= 4 && (pA.split(' ').some(w => sA.includes(w)) || sA.split(' ').some(w => pA.includes(w))));

  if (subH && subA) {
    reasons.push('substring team name match');
    if (opts.kickoffDeltaMin != null && opts.kickoffDeltaMin <= 5) {
      reasons.push('kickoff within 5min');
      return { confidence: 'high', reasons };
    }
    return { confidence: 'medium', reasons };
  }

  // One side matches exactly
  if (exactH || exactA) {
    reasons.push('one team matched exactly');
    return { confidence: 'low', reasons };
  }

  reasons.push('no team name overlap');
  return { confidence: 'failed', reasons };
}
