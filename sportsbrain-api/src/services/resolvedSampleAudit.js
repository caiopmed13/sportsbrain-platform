// resolvedSampleAudit.js — Cloudflare Workers Node.js ESM, pure functions, no DB, no network
// audit_version: p3.9.0

const MICRO_TEST_THRESHOLD = 30

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function classifyRow(row) {
  if (row.training_eligible !== 1) return 'excluded'
  const s = row.result_status
  if (s === 'green') return 'valid_green'
  if (s === 'red') return 'valid_red'
  if (s === 'pending' || s === null || s === undefined) return 'pending'
  if (s === 'unknown') return 'unknown'
  return 'invalid' // void, push, unsupported
}

function buildBuckets(arr) {
  return (arr || []).map(b => ({
    key: b.key,
    count: b.count,
    green: b.green || 0,
    red: b.red || 0,
    hit_rate:
      (b.green || 0) + (b.red || 0) > 0
        ? +((b.green || 0) / ((b.green || 0) + (b.red || 0))).toFixed(4)
        : 0,
  }))
}

function confidenceBucket(score) {
  if (score === null || score === undefined) return 'unknown'
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

function oddsBucket(odd) {
  if (odd === null || odd === undefined) return null
  if (odd < 1.8) return 'low'
  if (odd <= 2.5) return 'medium'
  return 'high'
}

/** Group rows into { key -> { count, green, red } } using a keyFn. */
function groupRows(rows, keyFn) {
  const map = {}
  for (const row of rows) {
    const k = keyFn(row)
    if (k === null || k === undefined) continue
    if (!map[k]) map[k] = { key: k, count: 0, green: 0, red: 0 }
    map[k].count++
    if (row.result_status === 'green') map[k].green++
    if (row.result_status === 'red') map[k].red++
  }
  return Object.values(map)
}

// ---------------------------------------------------------------------------
// main export
// ---------------------------------------------------------------------------

export function evaluateResolvedSampleAudit(input = {}, options = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : []
  const modeA = rows.length > 0

  // -------------------------------------------------------------------------
  // counts
  // -------------------------------------------------------------------------
  let training_eligible_total,
    green_count,
    red_count,
    pending_training_eligible,
    unknown_result_count,
    excluded_count,
    invalid_result_count

  let validRows = []        // training_eligible=1 AND green/red
  let pendingRows = []      // training_eligible=1 AND pending
  let allEligibleRows = []  // training_eligible=1

  if (modeA) {
    training_eligible_total = 0
    green_count = 0
    red_count = 0
    pending_training_eligible = 0
    unknown_result_count = 0
    excluded_count = 0
    invalid_result_count = 0

    for (const row of rows) {
      const cls = classifyRow(row)
      if (cls !== 'excluded') training_eligible_total++
      switch (cls) {
        case 'valid_green':
          green_count++
          validRows.push(row)
          allEligibleRows.push(row)
          break
        case 'valid_red':
          red_count++
          validRows.push(row)
          allEligibleRows.push(row)
          break
        case 'pending':
          pending_training_eligible++
          pendingRows.push(row)
          allEligibleRows.push(row)
          break
        case 'unknown':
          unknown_result_count++
          allEligibleRows.push(row)
          break
        case 'invalid':
          invalid_result_count++
          allEligibleRows.push(row)
          break
        case 'excluded':
          excluded_count++
          break
      }
    }
  } else {
    training_eligible_total = input.training_eligible_total || 0
    green_count = input.green_count || 0
    red_count = input.red_count || 0
    pending_training_eligible = input.pending_training_eligible || 0
    unknown_result_count = input.unknown_result_count || 0
    excluded_count = input.excluded_count || 0
    // resolved_valid from input must equal green_count + red_count per spec
    // but we derive invalid from training_eligible_total if possible
    invalid_result_count =
      training_eligible_total -
      green_count -
      red_count -
      pending_training_eligible -
      unknown_result_count
    if (invalid_result_count < 0) invalid_result_count = 0
  }

  const resolved_valid = green_count + red_count
  const remaining_to_threshold = Math.max(0, MICRO_TEST_THRESHOLD - resolved_valid)
  const can_count_for_micro_test = resolved_valid >= MICRO_TEST_THRESHOLD
  const resolved_training_eligible =
    green_count + red_count + pending_training_eligible + unknown_result_count

  // -------------------------------------------------------------------------
  // resolved_sample_audit
  // -------------------------------------------------------------------------
  let auditStatus
  if (resolved_valid < MICRO_TEST_THRESHOLD) {
    auditStatus = 'needs_more_resolved'
  } else if (resolved_valid >= MICRO_TEST_THRESHOLD) {
    auditStatus = 'ready_for_threshold'
  } else {
    auditStatus = 'audited'
  }

  const resolved_sample_audit = {
    status: auditStatus,
    audit_version: 'p3.9.0',
    resolved_valid,
    micro_test_threshold: MICRO_TEST_THRESHOLD,
    remaining_to_threshold,
    training_eligible_total,
    resolved_training_eligible,
    pending_training_eligible,
    green_count,
    red_count,
    invalid_result_count,
    unknown_result_count,
    excluded_count,
    counting_rule: "training_eligible=1 AND result_status IN ('green','red')",
    can_count_for_micro_test,
  }

  // -------------------------------------------------------------------------
  // resolved_sample_distribution
  // -------------------------------------------------------------------------
  let bySport, byMarket, byTrustLevel, byConfidenceBucket, byOddsBucket

  if (modeA) {
    bySport = buildBuckets(groupRows(validRows, r => r.sport || null))
    byMarket = buildBuckets(groupRows(validRows, r => r.market || null))
    byTrustLevel = buildBuckets(groupRows(validRows, r => r.trust_level || null))
    byConfidenceBucket = buildBuckets(
      groupRows(validRows, r => confidenceBucket(r.bet_confidence_score))
    )
    byOddsBucket = buildBuckets(
      groupRows(validRows, r => oddsBucket(r.odd))
    )
  } else {
    bySport = buildBuckets(input.by_sport)
    byMarket = buildBuckets(input.by_market)
    byTrustLevel = buildBuckets(input.by_trust_level)
    byConfidenceBucket = buildBuckets(input.by_confidence_bucket)
    byOddsBucket = buildBuckets(input.by_odds_bucket)
  }

  // by_result_status: always derived from counts (both modes)
  const byResultStatus = []
  if (green_count > 0) byResultStatus.push({ key: 'green', count: green_count, green: green_count, red: 0, hit_rate: 1 })
  if (red_count > 0) byResultStatus.push({ key: 'red', count: red_count, green: 0, red: red_count, hit_rate: 0 })

  const hasDistribution =
    bySport.length > 0 ||
    byMarket.length > 0 ||
    byTrustLevel.length > 0 ||
    byConfidenceBucket.length > 0 ||
    byOddsBucket.length > 0 ||
    byResultStatus.length > 0

  const resolved_sample_distribution = {
    status: hasDistribution ? 'available' : 'empty',
    total_resolved_valid: resolved_valid,
    by_sport: bySport,
    by_market: byMarket,
    by_confidence_bucket: byConfidenceBucket,
    by_odds_bucket: byOddsBucket,
    by_trust_level: byTrustLevel,
    by_result_status: byResultStatus,
  }

  // -------------------------------------------------------------------------
  // pending_resolution_queue
  // -------------------------------------------------------------------------
  let oldestPending = null
  let newestPending = null
  let pendingBySport = []
  let pendingByMarket = []

  if (modeA && pendingRows.length > 0) {
    const timestamps = pendingRows
      .map(r => r.entry_captured_at)
      .filter(Boolean)
      .sort()
    if (timestamps.length > 0) {
      oldestPending = timestamps[0]
      newestPending = timestamps[timestamps.length - 1]
    }
    pendingBySport = buildBuckets(groupRows(pendingRows, r => r.sport || null))
    pendingByMarket = buildBuckets(groupRows(pendingRows, r => r.market || null))
  }

  let pendingStatus
  if (pending_training_eligible === 0) {
    pendingStatus = 'empty'
  } else if (resolved_valid < MICRO_TEST_THRESHOLD && pending_training_eligible > 0) {
    pendingStatus = 'needs_resolver'
  } else {
    pendingStatus = 'available'
  }

  const pending_resolution_queue = {
    status: pendingStatus,
    pending_training_eligible,
    oldest_pending_created_at: oldestPending,
    newest_pending_created_at: newestPending,
    by_sport: pendingBySport,
    by_market: pendingByMarket,
    estimated_remaining_to_threshold: Math.max(0, MICRO_TEST_THRESHOLD - resolved_valid),
    resolver_next_action: 'wait_for_games_to_finish',
  }

  // -------------------------------------------------------------------------
  // resolved_audit_summary
  // -------------------------------------------------------------------------
  const manual_activation_allowed = resolved_valid >= MICRO_TEST_THRESHOLD
  const auto_activation_allowed = manual_activation_allowed

  let summaryStatus, headline, summary_text, next_action
  if (resolved_valid < MICRO_TEST_THRESHOLD) {
    summaryStatus = 'needs_more_resolved'
    headline = 'Amostra resolvida ainda abaixo do threshold.'
    summary_text = 'O micro-test ainda não deve ser ativado.'
    next_action = 'Aguardar resolver produzir mais green/red.'
  } else {
    summaryStatus = 'ready_for_threshold'
    headline = 'Amostra resolvida atingiu o threshold.'
    summary_text = 'O micro-test pode ser ativado.'
    next_action = 'Validar distribuição e ativar micro-test.'
  }

  const resolved_audit_summary = {
    status: summaryStatus,
    headline,
    summary_text,
    resolved_valid,
    remaining_to_threshold,
    manual_activation_allowed,
    auto_activation_allowed,
    next_action,
  }

  return {
    resolved_sample_audit,
    resolved_sample_distribution,
    pending_resolution_queue,
    resolved_audit_summary,
  }
}
