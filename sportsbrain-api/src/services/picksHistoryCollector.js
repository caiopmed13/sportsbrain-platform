// ══════════════════════════════════════════════════════════════════════════
// Picks History Collector — P3.9 R6K-F3
// ══════════════════════════════════════════════════════════════════════════
//
// Coleta TODOS os singles que a IA gerou em uma invocation do Premium —
// não apenas tier1 (Daily Singles), mas também as legs individuais dos
// combos (tier2, tier3, tier4, bet_builder, results_acca, etc).
//
// Por que: a IA precisa medir sua própria performance de TODOS os palpites
// que faz. Se ela cria um Mega com 10 legs, esses 10 mercados são apostas
// individuais que ela tem opinião sobre — e devem entrar no track record
// para WR/ROI por mercado/odd_bucket/verdict.
//
// Dedup: chave (event_id, market, selection, pick_date). Se a mesma leg
// aparece em tier1 E como leg de um combo, salva uma vez (a versão tier1
// vence — origem mais direta).
//
// PRIORIDADE de origin (primeiro encontrado vence o dedup):
//   tier1_single > tier2_leg > tier3_leg > tier4_leg > bet_builder_leg
//   > results_acca_leg > top_picks_today > tipster_leg
//
// NÃO altera ranking, scoring, threshold global, motor de picks.
// NÃO escreve no D1 — apenas coleta as rows; o caller faz batch INSERT.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Origens possíveis. Frozen.
 */
export const ORIGINS = Object.freeze([
  'tier1_single',
  'tier2_leg',
  'tier3_leg',
  'tier4_leg',
  'bet_builder_leg',
  'results_acca_leg',
  'top_picks_today',
  'tipster_leg',
]);

const ORIGIN_PRIORITY = new Map(ORIGINS.map((o, i) => [o, i]));

/**
 * Famílias de método de geração da IA.
 */
export const METHOD_FAMILIES = Object.freeze([
  'ai_singles',
  'ai_combo',
  'tipster',
  'faixa',
  'mega',
]);

function safeStr(v) {
  if (v == null) return '';
  return String(v).trim();
}

function normKey(s) {
  return safeStr(s).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
}

function todayBR() {
  const t = new Date(Date.now() - 3 * 3600_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(t.getUTCDate()).padStart(2,'0')}`;
}

/**
 * Identifica o método family pelo origin.
 *
 * @param {string} origin
 * @param {object} src — item ou parent
 * @returns {string}
 */
function methodFamilyFor(origin, src) {
  if (origin === 'tier1_single') return 'ai_singles';
  if (origin === 'tipster_leg' || src?._is_telegram_tip || src?.source === 'tipster') return 'tipster';
  if (src?.is_faixa || src?._is_faixa_mirror || src?.source === 'faixa_mirror') return 'faixa';
  if (origin === 'tier4_leg' || src?._tier === 'tier4') return 'mega';
  return 'ai_combo';
}

/**
 * Constrói a chave de dedup canônica.
 */
function dedupKey({ event_id, market, selection, pick_date }) {
  return `${pick_date}|${normKey(event_id)}|${normKey(market)}|${normKey(selection)}`;
}

/**
 * Mapeia uma leg/single para uma row de pick_history (shape compatível
 * com o existing schema + colunas R6K-F3).
 *
 * @param {object} item — leg ou single
 * @param {object} parent — combo pai (ou null)
 * @param {string} origin
 * @param {string} pick_date
 * @param {string} sport
 * @returns {object|null}
 */
function rowFromItem(item, parent, origin, pick_date, sport) {
  if (!item || typeof item !== 'object') return null;

  const event_id = item.fixture_id ?? item.event_id ?? item.bet365_event_id ?? null;
  const market   = item.market ?? item.stat ?? null;
  const selection = item.selection ?? item.direction ?? null;

  // Defensive: precisa pelo menos de market para fazer sentido.
  if (safeStr(market) === '') return null;

  const method_family = methodFamilyFor(origin, parent || item);

  // Risk tags: stringify se existir
  let risk_tags_json = null;
  if (Array.isArray(item.risk_tags) && item.risk_tags.length > 0) {
    try { risk_tags_json = JSON.stringify(item.risk_tags); } catch (_) {}
  }

  const parent_combo_id = parent && (parent.id ?? parent.combo_id ?? null);

  return {
    id:               null, // caller computa via dedup key + pid
    pick_date,
    sport,
    match:            item.match ?? parent?.match ?? null,
    home_team:        item.home_team ?? parent?.home_team ?? null,
    away_team:        item.away_team ?? parent?.away_team ?? null,
    league:           item.league ?? parent?.league ?? null,
    market,
    selection,
    line:             item.line ?? null,
    direction:        item.direction ?? null,
    odd:              Number(item.odd ?? item.real_odd ?? 0) || null,
    fixture_id:       event_id,

    // R6K-F3 colunas
    origin,
    parent_combo_id:  parent_combo_id || null,
    method_family,
    math_verdict:     item.math_verdict ?? null,
    design_verdict:   item.design_verdict ?? null,
    risk_tags_json,

    // metadata para WR/ROI/calibration
    ev_pct:           Number.isFinite(Number(item.ev_pct)) ? Number(item.ev_pct) : null,
    prob:             Number.isFinite(Number(item.prob)) ? Number(item.prob) : null,

    // dedup helpers (não vão pro DB diretamente; caller usa)
    _dedup_key:       dedupKey({ event_id, market, selection, pick_date }),
  };
}

/**
 * Itera uma fonte (array de items ou array de combos com legs), produzindo
 * rows. Combos delegam para suas legs.
 *
 * @param {Array} arr
 * @param {string} originSingles — origin para singles
 * @param {string|null} originLegs — origin para legs (se source é combo)
 * @param {string} pick_date
 * @param {string} sport
 * @param {Map<string,object>} dedupMap — chave → row já coletada
 */
function collectFromArray(arr, { originSingles, originLegs }, pick_date, sport, dedupMap) {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    // É combo? (tem legs)
    if (Array.isArray(item.legs) && item.legs.length > 0 && originLegs) {
      for (const leg of item.legs) {
        const row = rowFromItem(leg, item, originLegs, pick_date, sport);
        if (!row) continue;
        const existing = dedupMap.get(row._dedup_key);
        if (!existing) {
          dedupMap.set(row._dedup_key, row);
        } else {
          // Mantém o de origin mais alta na prioridade
          const eP = ORIGIN_PRIORITY.get(existing.origin) ?? 999;
          const nP = ORIGIN_PRIORITY.get(row.origin) ?? 999;
          if (nP < eP) dedupMap.set(row._dedup_key, row);
        }
      }
    } else if (originSingles) {
      const row = rowFromItem(item, null, originSingles, pick_date, sport);
      if (!row) continue;
      const existing = dedupMap.get(row._dedup_key);
      if (!existing) {
        dedupMap.set(row._dedup_key, row);
      } else {
        const eP = ORIGIN_PRIORITY.get(existing.origin) ?? 999;
        const nP = ORIGIN_PRIORITY.get(row.origin) ?? 999;
        if (nP < eP) dedupMap.set(row._dedup_key, row);
      }
    }
  }
}

/**
 * Coleta todas as rows (singles + legs) do payload do Premium em uma só
 * passada, deduplicadas.
 *
 * @param {object} payload — payload Premium (depois de _premiumBody)
 * @param {object} [opts]
 * @param {string} [opts.pick_date]
 * @param {string} [opts.sport]
 * @returns {object[]} array de rows prontas para batch INSERT
 */
export function collectAllSinglesForHistory(payload, opts = {}) {
  const pick_date = opts.pick_date || todayBR();
  const sport = opts.sport || payload?.sport || 'football';
  const dedup = new Map();

  if (!payload || typeof payload !== 'object') return [];

  // tier1 — singles
  collectFromArray(payload?.tier1?.picks, { originSingles: 'tier1_single', originLegs: null }, pick_date, sport, dedup);

  // tier2/3/4 — legs de combos
  collectFromArray(payload?.tier2?.combos, { originSingles: null, originLegs: 'tier2_leg' }, pick_date, sport, dedup);
  collectFromArray(payload?.tier3?.combos, { originSingles: null, originLegs: 'tier3_leg' }, pick_date, sport, dedup);
  collectFromArray(payload?.tier4?.combos, { originSingles: null, originLegs: 'tier4_leg' }, pick_date, sport, dedup);

  // bet_builder
  collectFromArray(payload?.bet_builder?.light?.combos, { originSingles: null, originLegs: 'bet_builder_leg' }, pick_date, sport, dedup);
  collectFromArray(payload?.bet_builder?.mid?.combos,   { originSingles: null, originLegs: 'bet_builder_leg' }, pick_date, sport, dedup);
  collectFromArray(payload?.bet_builder?.plus?.combos,  { originSingles: null, originLegs: 'bet_builder_leg' }, pick_date, sport, dedup);

  // results_acca
  collectFromArray(payload?.results_acca?.dupla?.combos,     { originSingles: null, originLegs: 'results_acca_leg' }, pick_date, sport, dedup);
  collectFromArray(payload?.results_acca?.treble?.combos,    { originSingles: null, originLegs: 'results_acca_leg' }, pick_date, sport, dedup);
  collectFromArray(payload?.results_acca?.fold?.combos,      { originSingles: null, originLegs: 'results_acca_leg' }, pick_date, sport, dedup);
  collectFromArray(payload?.results_acca?.mega_fold?.combos, { originSingles: null, originLegs: 'results_acca_leg' }, pick_date, sport, dedup);

  // top_picks_today — singles
  collectFromArray(payload?.top_picks_today, { originSingles: 'top_picks_today', originLegs: 'top_picks_today' }, pick_date, sport, dedup);

  return Array.from(dedup.values());
}

/**
 * Helper: produz um ID estável (compatível com schema atual: date|match|stat
 * style). Determinístico e dependente do pick_date + event_id + market +
 * selection + origin.
 *
 * @param {object} row
 * @returns {string}
 */
export function buildHistoryRowId(row) {
  const date = safeStr(row.pick_date);
  const ev   = normKey(row.fixture_id ?? row.match);
  const mk   = normKey(row.market);
  const sel  = normKey(row.selection);
  const orig = normKey(row.origin);
  return `${date}|${ev}|${mk}|${sel}|${orig}`;
}
