// qualityReweightProposal.js
// Pure-function service — no DB, no network, no imports from other project files.
// Version: p3.9.3

const VERSION = 'p3.9.3';

// Safety invariants — these are ALWAYS false regardless of input
const SAFE_FIELDS = {
  can_beta: false,
  can_sell: false,
  delivery_allowed: false,
  real_delivery: false,
  reweight_applied: false,
  engine_weights_changed: false,
};

// ---------------------------------------------------------------------------
// Weight change logic
// ---------------------------------------------------------------------------

function computeWeightChange(seg) {
  const sample = seg.sample_size ?? 0;
  const edge = seg.edge_vs_break_even ?? null;

  if (sample < 10) {
    return {
      change: 'no_change_insufficient_sample',
      proposed_weight: 1.0,
    };
  }

  if (edge === null) {
    return {
      change: 'keep_weight',
      proposed_weight: 1.0,
    };
  }

  if (edge >= 0.05) {
    const proposed_weight = Math.min(1.25, 1.0 + edge * 2);
    return { change: 'increase_weight', proposed_weight };
  }

  if (edge <= -0.05) {
    const proposed_weight = Math.max(0.75, 1.0 + edge * 2);
    return { change: 'reduce_weight', proposed_weight };
  }

  return { change: 'keep_weight', proposed_weight: 1.0 };
}

function reasonForChange(change) {
  switch (change) {
    case 'increase_weight': return 'positive_edge_with_actionable_sample';
    case 'reduce_weight': return 'negative_edge_with_actionable_sample';
    case 'keep_weight': return 'near_break_even_keep_neutral';
    case 'no_change_insufficient_sample': return 'insufficient_sample_for_reweight';
    default: return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Exported builders
// ---------------------------------------------------------------------------

export function buildProposedWeightChanges(input) {
  const rankings = input.segment_quality_rankings?.rankings;
  const segments = input.segment_break_even_matrix?.segments;

  const source = (Array.isArray(rankings) && rankings.length > 0)
    ? rankings
    : (Array.isArray(segments) && segments.length > 0)
      ? segments
      : [];

  if (source.length === 0) {
    return { status: 'empty', changes_count: 0, changes: [] };
  }

  const changes = source.map((seg) => {
    const { change, proposed_weight } = computeWeightChange(seg);
    return {
      segment_type: seg.segment_type ?? null,
      segment_key: seg.segment_key ?? null,
      current_weight: 1.0,
      proposed_weight,
      change,
      reason: reasonForChange(change),
      edge_vs_break_even: seg.edge_vs_break_even ?? null,
      sample_size: seg.sample_size ?? 0,
      shadow_only: true,
      applied: false,
    };
  });

  return {
    status: 'available',
    changes_count: changes.length,
    changes,
  };
}

export function buildQualityReweightProposal(input, violations) {
  const changes = input._changes ?? [];

  const proposed_changes_count = changes.length;
  const increase_weight_count = changes.filter(c => c.change === 'increase_weight').length;
  const reduce_weight_count = changes.filter(c => c.change === 'reduce_weight').length;
  const keep_weight_count = changes.filter(c => c.change === 'keep_weight').length;
  const no_change_count = changes.filter(c => c.change === 'no_change_insufficient_sample').length;

  let status;
  if (violations && violations.length > 0) {
    status = 'critical_violation';
  } else if (proposed_changes_count === 0) {
    status = 'empty';
  } else {
    status = 'generated';
  }

  return {
    status,
    proposal_version: VERSION,
    shadow_only: true,
    reweight_applied: false,
    engine_weights_changed: false,
    proposed_changes_count,
    increase_weight_count,
    reduce_weight_count,
    keep_weight_count,
    no_change_count,
    can_beta: false,
    can_sell: false,
    violations: violations ?? [],
  };
}

export function buildQualityReweightImpactSimulation(input, changes, resolvedRows) {
  const rows_evaluated = Array.isArray(resolvedRows) ? resolvedRows.length : 0;

  const weights = changes.map(c => c.proposed_weight);
  const average_weight_after_simulated =
    weights.length > 0
      ? weights.reduce((a, b) => a + b, 0) / weights.length
      : 1.0;

  const positive_segments_weighted_up = changes.filter(c => c.change === 'increase_weight').length;
  const negative_segments_weighted_down = changes.filter(c => c.change === 'reduce_weight').length;

  return {
    status: 'simulated',
    simulation_version: VERSION,
    shadow_only: true,
    reweight_applied: false,
    rows_evaluated,
    average_weight_before: 1.0,
    average_weight_after_simulated,
    positive_segments_weighted_up,
    negative_segments_weighted_down,
    engine_weights_changed: false,
  };
}

export function buildQualityReweightSummary(input, proposal, changes) {
  const increase_weight_count = changes.filter(c => c.change === 'increase_weight').length;
  const reduce_weight_count = changes.filter(c => c.change === 'reduce_weight').length;

  return {
    status: 'generated',
    headline: 'Proposta de reweight gerada em modo shadow.',
    summary_text: 'Pesos sugeridos foram calculados, mas não aplicados ao motor real.',
    increase_weight_count,
    reduce_weight_count,
    reweight_applied: false,
    engine_weights_changed: false,
    safe_to_beta: false,
    safe_to_sell: false,
  };
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

export function evaluateQualityReweightProposal(rawInput, options) {
  const input = rawInput ?? {};
  const violations = [];

  // Sanitize unsafe fields — record violations if caller tried to set them true
  if (input.reweight_applied === true) {
    violations.push({
      field: 'reweight_applied',
      attempted_value: true,
      forced_value: false,
      reason: 'reweight_applied must always be false in shadow mode',
    });
  }
  if (input.engine_weights_changed === true) {
    violations.push({
      field: 'engine_weights_changed',
      attempted_value: true,
      forced_value: false,
      reason: 'engine_weights_changed must always be false in shadow mode',
    });
  }

  // Build proposed weight changes
  const weightChangesResult = buildProposedWeightChanges(input);
  const changes = weightChangesResult.changes;

  // Attach changes to input context for proposal builder
  const inputWithChanges = { ...input, _changes: changes };

  const quality_reweight_proposal = buildQualityReweightProposal(inputWithChanges, violations);
  const proposed_weight_changes = weightChangesResult;
  const quality_reweight_impact_simulation = buildQualityReweightImpactSimulation(
    input,
    changes,
    input.resolved_rows ?? null
  );
  const quality_reweight_summary = buildQualityReweightSummary(
    input,
    quality_reweight_proposal,
    changes
  );

  return {
    quality_reweight_proposal,
    proposed_weight_changes,
    quality_reweight_impact_simulation,
    quality_reweight_summary,
  };
}
