// ─────────────────────────────────────────────────────────────
// PROPRIETARY MODULE — implementation withheld from the public portfolio.
// Decomposes curated multi-leg "VIP" combos into a family of derivative
// betting products (singles, doubles, triples, mega-parlays) with risk-profile
// routing, market/sport eligibility gating and display-safety sanitization.
// ─────────────────────────────────────────────────────────────

const __WITHHELD = 'Proprietary module — implementation withheld from public portfolio.';

// ── Exported configuration constants (values withheld) ──────────────────────
export const DISPLAY_LIMITS = {};            // withheld
export const HARD_SANITY_MAX_BLOCKS = null;  // withheld
export const MEGA_CHUNK_SIZE = null;         // withheld
export const MAX_GROUPS_PER_METHOD = {};     // withheld
export const MIN_HT_EVIDENCE_SCORE = null;   // withheld
export const MIN_SUPER_MEGA_BLOCKS = null;   // withheld
export const SUPER_MEGA_METHODS = new Set(); // withheld
export const ENABLE_DRAW_BTTS_METHOD = false;// withheld
export const MAX_FULL_MEGA_LEGS = null;      // withheld
export const MAX_DISPLAY_ODD = null;         // withheld

// ── Exported functions (implementation withheld) ────────────────────────────
export function shortHash(str) { throw new Error(__WITHHELD); }
export function calcStakeUnit(combined_odd, risk_profile) { throw new Error(__WITHHELD); }
export function routeVipToTier(item) { throw new Error(__WITHHELD); }
export function splitByRiskProfile(rawCombos, method) { throw new Error(__WITHHELD); }
export function inferSport(leg) { throw new Error(__WITHHELD); }
export function isMarketCompatibleWithSport(leg) { throw new Error(__WITHHELD); }
export function isDrawSelection(selection, market, pick) { throw new Error(__WITHHELD); }
export function isTeamWinnerSelection(selection, home, away) { throw new Error(__WITHHELD); }
export function normalizeHtMarketLabel(leg) { throw new Error(__WITHHELD); }
export function computeHtBlockConfidence(args) { throw new Error(__WITHHELD); }
export function isHtTemplateSpam(blocks) { throw new Error(__WITHHELD); }
export function applyMegaSanityLimits(combo) { throw new Error(__WITHHELD); }
export function isEvReliable(combo) { throw new Error(__WITHHELD); }
export function megaSizeTier(blockCount) { throw new Error(__WITHHELD); }
export function buildMegaBlocksPool(blocks, method) { throw new Error(__WITHHELD); }
export function buildGameBlock(combo, method, riskProfile) { throw new Error(__WITHHELD); }
export function buildComboFromBlocks(blocks, extraFields) { throw new Error(__WITHHELD); }
export function buildDedupKey(item) { throw new Error(__WITHHELD); }
export function toSingle(block, megaId, groupId) { throw new Error(__WITHHELD); }
export function buildBalancedVipDoubles(blocks) { throw new Error(__WITHHELD); }
export function buildVipTriplesBalanced(blocks) { throw new Error(__WITHHELD); }
export function buildMethodGroupId(method, riskProfile, blocks) { throw new Error(__WITHHELD); }
export function decomposeVipCombo(rawBlocks, method, riskProfile) { throw new Error(__WITHHELD); }
export function decomposeVipToMegas(rawBlocks, method, riskProfile) { throw new Error(__WITHHELD); }
export function buildSuperMegaGroup(rawBlocks, method, riskProfile, opts) { throw new Error(__WITHHELD); }
export function deduplicateVipResults(vipItems, existingItems) { throw new Error(__WITHHELD); }
export function computeMegaCoverageDebug(rawBlocks, method, riskProfile) { throw new Error(__WITHHELD); }
