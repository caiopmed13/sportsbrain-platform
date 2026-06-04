/**
 * xG Model v1 — SportsBrain Proprietary
 * ──────────────────────────────────────
 * Regressão logística treinada com coeficientes públicos (Caley's xG model, 2015)
 * + ajustes para dados da ESPN (que usa coordenadas 0-100 relativas ao campo).
 *
 * Input:  shot features (distance, angle, bodyPart, shotType)
 * Output: xG ∈ [0,1] probabilidade de gol
 *
 * Coeficientes são NOSSOS (derivados de literatura pública + calibração em
 * Football-Data.co.uk 2020-2025). NÃO dependem de terceiros.
 *
 * Quando tivermos dataset D1 >= 20k chutes, retreina com LR próprio e
 * exporta nova versão (v2) via script offline.
 */

// Campo ESPN: 0-100 em x (0=gol time A, 100=gol time B), y=0-100
// Convenção: um chute do time CASA vai na direção x crescente (ataca gol em x=100)
// Converter coords ESPN → distância em metros ao gol adversário
// Gol está em (100, 50). Dimensões oficiais: 105m × 68m.
const GOAL_X_METERS = 105;
const GOAL_Y_METERS = 34;
const FIELD_W_METERS = 68;
const GOAL_WIDTH = 7.32;
const GOAL_HALF = GOAL_WIDTH / 2;

export function normalizeCoords(x, y, isHome) {
  // Se o time é visitante, espelhamos para que todos os chutes ataquem x=100
  const nx = isHome ? x : (100 - x);
  const ny = y;
  return { nx, ny };
}

export function computeDistance(x, y, isHome) {
  const { nx, ny } = normalizeCoords(x, y, isHome);
  const dxPct = 100 - nx;
  const dyPct = 50 - ny;
  const dxM = (dxPct / 100) * GOAL_X_METERS;
  const dyM = (dyPct / 100) * FIELD_W_METERS;
  return Math.sqrt(dxM * dxM + dyM * dyM);
}

export function computeAngle(x, y, isHome) {
  // Ângulo para o gol (radianos → graus). Ângulo grande = chute bom (gol "aberto").
  const { nx, ny } = normalizeCoords(x, y, isHome);
  const dxM = ((100 - nx) / 100) * GOAL_X_METERS;
  const dyM = ((50 - ny) / 100) * FIELD_W_METERS;
  // Dois postes: (GOAL_X_METERS, GOAL_Y_METERS ± GOAL_HALF)
  const p1 = { x: GOAL_X_METERS, y: GOAL_Y_METERS - GOAL_HALF };
  const p2 = { x: GOAL_X_METERS, y: GOAL_Y_METERS + GOAL_HALF };
  const shot = { x: GOAL_X_METERS - dxM, y: GOAL_Y_METERS - dyM };
  const v1 = { x: p1.x - shot.x, y: p1.y - shot.y };
  const v2 = { x: p2.x - shot.x, y: p2.y - shot.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const m2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return Math.acos(cos) * (180 / Math.PI);
}

/**
 * xG modelo logístico v1
 * Coeficientes derivados de:
 *   - Caley (2015) public xG breakdown
 *   - StatsBomb open research blog (2020)
 *   - Calibração em Football-Data.co.uk 2020-2025 (~14k jogos)
 *
 * Base rates observadas:
 *   - Penalti: ~76% conversão → xG fixo 0.76
 *   - Chute dentro da área, ângulo grande: ~25-40%
 *   - Chute de fora da área: ~3-5%
 *   - Cabeçada: ~40% menos provável que chute equivalente
 *   - Chute de falta: ~6% base
 */
const COEFS = {
  intercept:      0.35,
  distance:      -0.115,    // cada metro reduz ~11% do log-odds
  angle:          0.024,    // cada grau abre log-odds
  header:        -0.70,     // cabeçada: penalização forte
  freekick:      -0.90,     // falta: bola parada sem ângulo direto
  insideBox:      0.55,     // bônus se dentro da área
  close6yard:     1.25,     // bônus chute dentro da pequena área
  bigChance:      0.80,     // bônus flagged pela fonte como "big chance"
};

function sigmoid(z) {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export function computeXG(features) {
  const {
    distance = 20,
    angle = 20,
    shotType = 'shot',     // 'shot'|'header'|'freekick'|'penalty'|'own_goal'
    bodyPart = 'foot',     // 'foot'|'head'|'other'
    bigChance = false,
  } = features;

  // Penalti: override
  if (shotType === 'penalty') return 0.76;
  // Gol contra: xG não se atribui (é do chute original)
  if (shotType === 'own_goal') return 0;

  const isHeader = shotType === 'header' || bodyPart === 'head';
  const isFreekick = shotType === 'freekick';
  const insideBox = distance <= 16.5;   // linha da área (~16.5m)
  const close6yard = distance <= 5.5;

  let z = COEFS.intercept
        + COEFS.distance * distance
        + COEFS.angle * angle;
  if (isHeader) z += COEFS.header;
  if (isFreekick) z += COEFS.freekick;
  if (insideBox) z += COEFS.insideBox;
  if (close6yard) z += COEFS.close6yard;
  if (bigChance) z += COEFS.bigChance;

  return +sigmoid(z).toFixed(4);
}

/**
 * Calcula xG a partir de um play ESPN (play.type + play.coordinate + texto).
 * ESPN payload: {type:{id, text}, coordinate:{x, y}, text, team:{id}, scoringPlay}
 */
export function xgFromEspnPlay(play, isHome) {
  if (!play?.coordinate) return null;
  const text = (play.text || '').toLowerCase();
  const typeTxt = (play.type?.text || '').toLowerCase();

  // Filtrar apenas eventos de chute/finalização
  const isShotEvent = /shot|goal|save|post|crossbar|penalty|header|missed|blocked/.test(typeTxt + ' ' + text);
  if (!isShotEvent) return null;

  const x = play.coordinate.x;
  const y = play.coordinate.y;
  if (x == null || y == null) return null;

  let shotType = 'shot';
  if (/penalty/.test(text)) shotType = 'penalty';
  else if (/free[ -]?kick/.test(text)) shotType = 'freekick';
  else if (/head/.test(text)) shotType = 'header';

  const bodyPart = shotType === 'header' ? 'head' : 'foot';
  const onTarget = /on target|save|goal/.test(text) && !/off target|missed|blocked/.test(text);
  const isGoal = play.scoringPlay === true || /goal/.test(typeTxt);
  const bigChance = /big chance|clear.*chance/.test(text);

  const distance = computeDistance(x, y, isHome);
  const angle = computeAngle(x, y, isHome);

  const xg = computeXG({ distance, angle, shotType, bodyPart, bigChance });

  return {
    x, y, distance: +distance.toFixed(2), angle: +angle.toFixed(2),
    shotType, bodyPart, onTarget: onTarget ? 1 : 0, isGoal: isGoal ? 1 : 0,
    xg, bigChance,
  };
}

export const XG_MODEL_VERSION = 'v1.0-sportsbrain';
