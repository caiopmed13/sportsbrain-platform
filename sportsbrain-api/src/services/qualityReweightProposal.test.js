// qualityReweightProposal.test.js
// No external test framework — pure node ESM runner.

import {
  evaluateQualityReweightProposal,
  buildProposedWeightChanges,
  buildQualityReweightProposal,
  buildQualityReweightImpactSimulation,
  buildQualityReweightSummary,
} from './qualityReweightProposal.js';

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ---------------------------------------------------------------------------
// Test 1 — proposal empty
// ---------------------------------------------------------------------------
test('Test 1 — proposal empty: empty input yields reweight_applied=false', () => {
  const result = evaluateQualityReweightProposal({});
  assert(result.quality_reweight_proposal.reweight_applied === false, 'reweight_applied should be false');
  const status = result.quality_reweight_proposal.status;
  assert(status === 'empty' || status === 'generated', `status should be empty or generated, got: ${status}`);
});

// ---------------------------------------------------------------------------
// Test 2 — increase weight
// ---------------------------------------------------------------------------
test('Test 2 — increase weight: positive edge with sufficient sample', () => {
  const result = evaluateQualityReweightProposal({
    segment_quality_rankings: {
      rankings: [
        {
          segment_type: 'market',
          segment_key: 'moneyline',
          sample_size: 15,
          hit_rate: 0.6,
          edge_vs_break_even: 0.08,
          rank_score: 50,
        },
      ],
    },
  });
  const change = result.proposed_weight_changes.changes[0];
  assert(change.change === 'increase_weight', `expected increase_weight, got: ${change.change}`);
  assert(change.proposed_weight > 1.0, `proposed_weight should be > 1.0, got: ${change.proposed_weight}`);
  assert(change.applied === false, 'applied should always be false');
});

// ---------------------------------------------------------------------------
// Test 3 — reduce weight
// ---------------------------------------------------------------------------
test('Test 3 — reduce weight: negative edge with sufficient sample', () => {
  const result = evaluateQualityReweightProposal({
    segment_quality_rankings: {
      rankings: [
        {
          segment_type: 'market',
          segment_key: 'spread',
          sample_size: 12,
          hit_rate: 0.4,
          edge_vs_break_even: -0.08,
          rank_score: 20,
        },
      ],
    },
  });
  const change = result.proposed_weight_changes.changes[0];
  assert(change.change === 'reduce_weight', `expected reduce_weight, got: ${change.change}`);
  assert(change.proposed_weight < 1.0, `proposed_weight should be < 1.0, got: ${change.proposed_weight}`);
});

// ---------------------------------------------------------------------------
// Test 4 — keep weight
// ---------------------------------------------------------------------------
test('Test 4 — keep weight: edge near break-even', () => {
  const result = evaluateQualityReweightProposal({
    segment_quality_rankings: {
      rankings: [
        {
          segment_type: 'market',
          segment_key: 'totals',
          sample_size: 12,
          hit_rate: 0.5,
          edge_vs_break_even: 0.02,
          rank_score: 30,
        },
      ],
    },
  });
  const change = result.proposed_weight_changes.changes[0];
  assert(change.change === 'keep_weight', `expected keep_weight, got: ${change.change}`);
});

// ---------------------------------------------------------------------------
// Test 5 — insufficient sample no change
// ---------------------------------------------------------------------------
test('Test 5 — insufficient sample: no change when sample_size < 10', () => {
  const result = evaluateQualityReweightProposal({
    segment_quality_rankings: {
      rankings: [
        {
          segment_type: 'market',
          segment_key: 'futures',
          sample_size: 5,
          hit_rate: 0.7,
          edge_vs_break_even: 0.1,
          rank_score: 60,
        },
      ],
    },
  });
  const change = result.proposed_weight_changes.changes[0];
  assert(change.change === 'no_change_insufficient_sample', `expected no_change_insufficient_sample, got: ${change.change}`);
});

// ---------------------------------------------------------------------------
// Test 6 — weight bounds
// ---------------------------------------------------------------------------
test('Test 6 — weight bounds: proposed_weight clamped to [0.75, 1.25]', () => {
  // Upper bound: very large positive edge
  const resultHigh = evaluateQualityReweightProposal({
    segment_quality_rankings: {
      rankings: [
        {
          segment_type: 'market',
          segment_key: 'ml_high',
          sample_size: 20,
          hit_rate: 0.9,
          edge_vs_break_even: 0.5,
          rank_score: 99,
        },
      ],
    },
  });
  const changeHigh = resultHigh.proposed_weight_changes.changes[0];
  assert(changeHigh.proposed_weight <= 1.25, `upper bound: proposed_weight should be <= 1.25, got: ${changeHigh.proposed_weight}`);

  // Lower bound: very large negative edge
  const resultLow = evaluateQualityReweightProposal({
    segment_quality_rankings: {
      rankings: [
        {
          segment_type: 'market',
          segment_key: 'ml_low',
          sample_size: 20,
          hit_rate: 0.1,
          edge_vs_break_even: -0.5,
          rank_score: 1,
        },
      ],
    },
  });
  const changeLow = resultLow.proposed_weight_changes.changes[0];
  assert(changeLow.proposed_weight >= 0.75, `lower bound: proposed_weight should be >= 0.75, got: ${changeLow.proposed_weight}`);
});

// ---------------------------------------------------------------------------
// Test 7 — impact simulation invariants
// ---------------------------------------------------------------------------
test('Test 7 — impact simulation: engine_weights_changed and reweight_applied always false', () => {
  const result = evaluateQualityReweightProposal({
    segment_quality_rankings: {
      rankings: [
        {
          segment_type: 'market',
          segment_key: 'moneyline',
          sample_size: 15,
          hit_rate: 0.6,
          edge_vs_break_even: 0.08,
          rank_score: 50,
        },
      ],
    },
    resolved_rows: [1, 2, 3],
  });
  const sim = result.quality_reweight_impact_simulation;
  assert(sim.engine_weights_changed === false, 'engine_weights_changed must be false');
  assert(sim.reweight_applied === false, 'reweight_applied must be false');
});

// ---------------------------------------------------------------------------
// Test 8 — unsafe reweight_applied sanitized
// ---------------------------------------------------------------------------
test('Test 8 — unsafe field sanitized: reweight_applied=true in input is blocked', () => {
  const result = evaluateQualityReweightProposal({ reweight_applied: true });
  assert(result.quality_reweight_proposal.reweight_applied === false, 'reweight_applied must be false in output');
  const violations = result.quality_reweight_proposal.violations;
  const status = result.quality_reweight_proposal.status;
  assert(
    (violations && violations.length > 0) || status === 'critical_violation',
    `expected violations or critical_violation status, got status=${status}, violations=${JSON.stringify(violations)}`
  );
});

// ---------------------------------------------------------------------------
// Test 9 — output serializable
// ---------------------------------------------------------------------------
test('Test 9 — output is JSON-serializable', () => {
  let threw = false;
  try {
    JSON.stringify(evaluateQualityReweightProposal({
      segment_quality_rankings: {
        rankings: [
          {
            segment_type: 'market',
            segment_key: 'moneyline',
            sample_size: 15,
            hit_rate: 0.6,
            edge_vs_break_even: 0.08,
            rank_score: 50,
          },
        ],
      },
    }));
  } catch (_) {
    threw = true;
  }
  assert(!threw, 'JSON.stringify should not throw');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
