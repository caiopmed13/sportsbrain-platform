// ─────────────────────────────────────────────────────────────
// PROPRIETARY MODULE — implementation withheld from the public portfolio.
// Bulk/batched variant of the signal blender: pre-loads the data needed to
// enrich many picks at once to minimize per-pick database round-trips, then
// resolves each pick's signal set from the in-memory context.
// ─────────────────────────────────────────────────────────────

const __WITHHELD = 'Proprietary module — implementation withheld from public portfolio.';

export async function prepareBulkSignalContext(picks, env, opts) { throw new Error(__WITHHELD); }
export function buildBulkSignalSummary(ctx, extra) { throw new Error(__WITHHELD); }
export async function getSignalsForPickWithBulk(pick, env, ctx) { throw new Error(__WITHHELD); }
export async function getSignalsForPickPreferBulk(pick, env, ctx, fallbackRef) { throw new Error(__WITHHELD); }
