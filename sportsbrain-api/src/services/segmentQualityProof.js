// segmentQualityProof.js
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network
// version: p3.9.2

const PROOF_VERSION = 'p3.9.2'

const UNSAFE_FIELDS = [
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
  'auto_apply_exclusions',
]

// ─── internal sanitizer ──────────────────────────────────────────────────────

function sanitizeInput(raw) {
  const violations = []
  const sanitized = { ...raw }
  for (const field of UNSAFE_FIELDS) {
    if (raw[field] === true) {
      violations.push(field)
      sanitized[field] = false
    }
  }
  return { sanitized, violations }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function emptyBucket() {
  return { count: 0, green: 0, red: 0 }
}

function incrementBucket(map, key, isGreen, isRed) {
  if (!map[key]) map[key] = emptyBucket()
  map[key].count++
  if (isGreen) map[key].green++
  if (isRed) map[key].red++
}

function deriveConfidenceBucket(row) {
  if (row.bet_confidence_tier) return row.bet_confidence_tier
  const score = row.bet_confidence_score
  if (score == null) return 'unknown'
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

function deriveOddsBucket(odd) {
  if (odd == null) return 'unknown'
  if (odd < 1.5) return 'low'
  if (odd < 2.0) return 'medium'
  if (odd < 3.0) return 'high'
  return 'very_high'
}

// ─── buildSegmentsFromResolvedRows ───────────────────────────────────────────

export function buildSegmentsFromResolvedRows(rows, _options = {}) {
  if (!rows || rows.length === 0) return null

  const by_sport = {}
  const by_market = {}
  const by_confidence_bucket = {}
  const by_trust_level = {}
  const by_odds_bucket = {}

  for (const row of rows) {
    const isGreen = row.result_status === 'green'
    const isRed = row.result_status === 'red'

    if (row.sport) incrementBucket(by_sport, row.sport, isGreen, isRed)
    if (row.market) incrementBucket(by_market, row.market, isGreen, isRed)

    const confidenceBucket = deriveConfidenceBucket(row)
    incrementBucket(by_confidence_bucket, confidenceBucket, isGreen, isRed)

    const trustKey = row.trust_level ?? 'unknown'
    incrementBucket(by_trust_level, trustKey, isGreen, isRed)

    const oddsBucket = deriveOddsBucket(row.odd)
    incrementBucket(by_odds_bucket, oddsBucket, isGreen, isRed)
  }

  return { by_sport, by_market, by_confidence_bucket, by_trust_level, by_odds_bucket }
}

// ─── buildSegmentQualityProof ─────────────────────────────────────────────────

export function buildSegmentQualityProof(input, violations) {
  const sampleSize = input.sample_size ?? 0
  const allSegments = input.all_segments ?? []

  const actionableSegmentsCount = allSegments.filter((s) => (s.sample_size ?? 0) >= 5).length
  const promisingSegmentsCount = allSegments.filter((s) => s.status === 'positive_edge').length
  const weakSegmentsCount = allSegments.filter((s) => s.status === 'negative_edge').length
  const insufficientSegmentsCount = allSegments.filter((s) => s.status === 'insufficient_sample').length
  const segmentsCount = allSegments.length

  let qualityProofLevel
  let status

  if (violations && violations.length > 0) {
    status = 'critical_violation'
    qualityProofLevel = 'none'
  } else if (sampleSize === 0 && segmentsCount === 0) {
    status = 'empty'
    qualityProofLevel = 'none'
  } else if (sampleSize === 0) {
    status = 'insufficient_data'
    qualityProofLevel = 'none'
  } else {
    // sampleSize > 0 — mark as evaluated; quality_proof_level encodes depth
    status = 'evaluated'
    if (sampleSize < 10) {
      qualityProofLevel = 'insufficient'
    } else if (promisingSegmentsCount > weakSegmentsCount) {
      qualityProofLevel = 'segment_promising'
    } else if (weakSegmentsCount > promisingSegmentsCount && actionableSegmentsCount >= 3) {
      qualityProofLevel = 'segment_risky'
    } else if (actionableSegmentsCount >= 2) {
      qualityProofLevel = 'segment_watch'
    } else {
      qualityProofLevel = 'early_signal'
    }
  }

  return {
    status,
    proof_version: PROOF_VERSION,
    sample_size: sampleSize,
    segments_count: segmentsCount,
    actionable_segments_count: actionableSegmentsCount,
    promising_segments_count: promisingSegmentsCount,
    weak_segments_count: weakSegmentsCount,
    insufficient_segments_count: insufficientSegmentsCount,
    quality_proof_level: qualityProofLevel,
    can_beta: false,
    can_sell: false,
  }
}

// ─── buildSegmentQualityRankings ──────────────────────────────────────────────

export function buildSegmentQualityRankings(input) {
  const allSegments = input.all_segments ?? []

  if (allSegments.length === 0) {
    return {
      status: 'empty',
      top_segments: [],
      bottom_segments: [],
      most_sampled_segments: [],
      least_sampled_segments: [],
    }
  }

  const scored = allSegments.map((s) => ({
    segment_type: s.segment_type ?? s.dimension ?? null,
    segment_key: s.segment_key ?? s.segment ?? s.key ?? null,
    sample_size: s.sample_size ?? 0,
    hit_rate: s.hit_rate ?? null,
    edge_vs_break_even: s.edge_vs_break_even ?? null,
    rank_score: Math.round(
      (s.hit_rate ?? 0) * 60 +
      Math.max(0, (s.edge_vs_break_even ?? 0)) * 30 +
      Math.min(10, (s.sample_size ?? 0) / 5)
    ),
  }))

  const byRankDesc = [...scored].sort((a, b) => b.rank_score - a.rank_score)
  const actionable = scored.filter((s) => (s.sample_size ?? 0) >= 5)
  const byRankAsc = [...actionable].sort((a, b) => a.rank_score - b.rank_score)
  const bySampleDesc = [...scored].sort((a, b) => b.sample_size - a.sample_size)
  const bySampleAscPositive = scored.filter((s) => (s.sample_size ?? 0) > 0)
    .sort((a, b) => a.sample_size - b.sample_size)

  return {
    status: 'available',
    top_segments: byRankDesc.slice(0, 5),
    bottom_segments: byRankAsc.slice(0, 5),
    most_sampled_segments: bySampleDesc.slice(0, 5),
    least_sampled_segments: bySampleAscPositive.slice(0, 5),
  }
}

// ─── buildConfidenceCalibrationReview ────────────────────────────────────────

export function buildConfidenceCalibrationReview(input) {
  const byConfidenceBucket = input.by_confidence_bucket ?? []

  // Normalize: support both array and object forms
  let buckets = []
  if (Array.isArray(byConfidenceBucket)) {
    buckets = byConfidenceBucket
  } else if (typeof byConfidenceBucket === 'object') {
    buckets = Object.entries(byConfidenceBucket).map(([key, val]) => ({
      key,
      count: val.count ?? 0,
      green: val.green ?? 0,
      red: val.red ?? 0,
    }))
  }

  const warnings = []
  const blockers = []

  if (buckets.length === 0 || buckets.length < 2) {
    return {
      status: 'evaluated',
      confidence_buckets_count: buckets.length,
      high_confidence_hit_rate: null,
      medium_confidence_hit_rate: null,
      low_confidence_hit_rate: null,
      calibration_status: 'not_available',
      warnings,
      blockers,
    }
  }

  function hitRateForBucket(b) {
    if (!b) return null
    const total = (b.green ?? 0) + (b.red ?? 0)
    if (total < 3) return null
    return b.green / total
  }

  const highBucket = buckets.find((b) => b.key === 'high')
  const mediumBucket = buckets.find((b) => b.key === 'medium')
  const lowBucket = buckets.find((b) => b.key === 'low')

  const highRate = hitRateForBucket(highBucket)
  const mediumRate = hitRateForBucket(mediumBucket)
  const lowRate = hitRateForBucket(lowBucket)

  // Determine calibration_status using only non-null rates
  let calibrationStatus
  const availableRates = [highRate, lowRate].filter((r) => r !== null)

  if (availableRates.length < 1) {
    calibrationStatus = 'insufficient_data'
  } else if (highRate !== null && lowRate !== null) {
    const diff = highRate - lowRate
    if (diff > 0.05) {
      calibrationStatus = 'aligned'
    } else if (diff > 0) {
      calibrationStatus = 'weakly_aligned'
    } else if (diff < -0.03) {
      calibrationStatus = 'inverted'
      warnings.push('high_confidence_underperforming_low')
    } else if (Math.abs(diff) <= 0.03) {
      calibrationStatus = 'mixed'
    } else {
      calibrationStatus = 'insufficient_data'
    }
  } else {
    calibrationStatus = 'insufficient_data'
  }

  return {
    status: 'evaluated',
    confidence_buckets_count: buckets.length,
    high_confidence_hit_rate: highRate,
    medium_confidence_hit_rate: mediumRate,
    low_confidence_hit_rate: lowRate,
    calibration_status: calibrationStatus,
    warnings,
    blockers,
  }
}

// ─── buildSegmentQualityProofSummary ─────────────────────────────────────────

export function buildSegmentQualityProofSummary(input, violations) {
  const sampleSize = input.sample_size ?? 0
  const promisingCount = input.promising_segments_count ?? 0
  const weakCount = input.weak_segments_count ?? 0
  const recommendExcludeCount =
    input.segment_exclusion_recommendations?.recommendations?.filter(
      (r) => r.recommendation === 'recommend_exclude'
    ).length ?? 0

  let headline
  let nextAction
  const hasCritical = violations && violations.length > 0

  if (hasCritical) {
    headline = 'Violação crítica detectada. Revisão obrigatória antes de continuar.'
    nextAction = 'Corrigir violações de safety antes de qualquer avaliação.'
  } else if (sampleSize === 0) {
    headline = 'Sem amostra disponível para prova de qualidade por segmento.'
    nextAction = 'Continuar acumulando amostra resolvida (green/red).'
  } else if (sampleSize < 10) {
    headline = 'Amostra insuficiente para prova de qualidade por segmento.'
    nextAction = 'Continuar acumulando amostra e revisar segmentos fracos.'
  } else if (promisingCount > weakCount) {
    headline = `${promisingCount} segmento(s) promissor(es) identificado(s). Aguardar aprovação manual.`
    nextAction = 'Monitorar segmentos promissores e aguardar threshold mínimo.'
  } else if (weakCount > 0) {
    headline = `${weakCount} segmento(s) fraco(s) detectado(s). Revisar antes de qualquer beta.`
    nextAction = 'Continuar acumulando amostra e revisar segmentos fracos.'
  } else {
    headline = 'Prova de qualidade por segmento em andamento. Dados insuficientes para decisão.'
    nextAction = 'Continuar acumulando amostra e revisar segmentos fracos.'
  }

  return {
    status: 'evaluated',
    headline,
    summary_text:
      'Análise de qualidade segmentada em fase P3.9.2. Nenhuma entrega ou beta permitida sem aprovação manual explícita.',
    sample_size: sampleSize,
    promising_segments_count: promisingCount,
    weak_segments_count: weakCount,
    recommend_exclude_count: recommendExcludeCount,
    manual_review_required: true,
    safe_to_beta: false,
    safe_to_sell: false,
    next_action: nextAction,
  }
}

// ─── mergeSegmentsWithBreakEven ───────────────────────────────────────────────

function mergeSegmentsWithBreakEven(distribution, breakEvenSegments) {
  // Build a flat list of segments from distribution map, optionally merge break-even data
  const allSegments = []

  const dims = [
    ['by_sport', 'sport'],
    ['by_market', 'market'],
    ['by_confidence_bucket', 'confidence_bucket'],
    ['by_trust_level', 'trust_level'],
    ['by_odds_bucket', 'odds_bucket'],
  ]

  for (const [field, segType] of dims) {
    const bucket = distribution[field]
    if (!bucket) continue

    const entries = Array.isArray(bucket)
      ? bucket
      : Object.entries(bucket).map(([key, val]) => ({ key, ...val }))

    for (const entry of entries) {
      const key = entry.key ?? entry.segment_key ?? null
      const count = entry.count ?? 0
      const green = entry.green ?? 0
      const red = entry.red ?? 0
      const totalResolved = green + red
      const hitRate = totalResolved > 0 ? green / totalResolved : null

      // Try to find break-even match
      const beMatch = breakEvenSegments
        ? breakEvenSegments.find(
            (s) =>
              (s.segment_type === segType || s.dimension === segType) &&
              (s.segment_key === key || s.segment === key || s.key === key)
          )
        : null

      const status = beMatch?.status ?? (count >= 5 ? 'insufficient_sample' : 'insufficient_sample')
      const edgeVsBreakEven = beMatch?.edge_vs_break_even ?? null

      allSegments.push({
        segment_type: segType,
        segment_key: key,
        sample_size: count,
        hit_rate: hitRate,
        edge_vs_break_even: edgeVsBreakEven,
        status: beMatch?.status ?? 'insufficient_sample',
      })
    }
  }

  return allSegments
}

// ─── main export ─────────────────────────────────────────────────────────────

export function evaluateSegmentQualityProof(input = {}, _options = {}) {
  const { sanitized, violations } = sanitizeInput(input)
  const safeInput = { ...input, ...sanitized }

  // ── 1. Build distribution from rows or use pre-built distribution ───────────
  let distribution = null

  if (safeInput.rows && safeInput.rows.length > 0) {
    distribution = buildSegmentsFromResolvedRows(safeInput.rows)
  }

  if (!distribution) {
    // Try resolved_sample_distribution or quality_snapshot_distribution
    const rsd = safeInput.resolved_sample_distribution
    const qsd = safeInput.quality_snapshot_distribution
    if (rsd && typeof rsd === 'object') {
      distribution = rsd
    } else if (qsd && typeof qsd === 'object') {
      distribution = qsd
    }
  }

  // ── 2. Merge with break-even segments if available ────────────────────────
  const breakEvenSegments = safeInput.segment_break_even_matrix?.segments ?? null
  let allSegments = []

  if (distribution) {
    allSegments = mergeSegmentsWithBreakEven(distribution, breakEvenSegments)
  } else if (breakEvenSegments) {
    allSegments = breakEvenSegments.map((s) => ({
      segment_type: s.segment_type ?? s.dimension ?? null,
      segment_key: s.segment_key ?? s.segment ?? s.key ?? null,
      sample_size: s.sample_size ?? 0,
      hit_rate: s.hit_rate ?? null,
      edge_vs_break_even: s.edge_vs_break_even ?? null,
      status: s.status ?? 'insufficient_sample',
    }))
  }

  // ── 3. Compute sample_size ─────────────────────────────────────────────────
  const sampleSizeFromAudit = safeInput.resolved_sample_audit?.resolved_valid ?? 0
  const sampleSizeFromSnapshot = safeInput.first_real_quality_snapshot?.resolved_valid ?? 0
  const sampleSizeFromRows = safeInput.rows?.length ?? 0
  const sampleSize = sampleSizeFromAudit || sampleSizeFromSnapshot || sampleSizeFromRows

  // ── 4. Build all 4 blocks ──────────────────────────────────────────────────
  const proofInput = {
    sample_size: sampleSize,
    all_segments: allSegments,
    segment_break_even_matrix: safeInput.segment_break_even_matrix,
    resolved_sample_audit: safeInput.resolved_sample_audit,
    first_real_quality_snapshot: safeInput.first_real_quality_snapshot,
  }

  const segment_quality_proof = buildSegmentQualityProof(proofInput, violations)

  const segment_quality_rankings = buildSegmentQualityRankings({ all_segments: allSegments })

  const byConfidenceBucket =
    distribution?.by_confidence_bucket ??
    (distribution?.by_trust_level
      ? Object.entries(distribution.by_trust_level).map(([key, val]) => ({ key, ...val }))
      : [])

  const confidence_calibration_review = buildConfidenceCalibrationReview({
    by_confidence_bucket: byConfidenceBucket,
  })

  const summaryInput = {
    sample_size: sampleSize,
    promising_segments_count: segment_quality_proof.promising_segments_count,
    weak_segments_count: segment_quality_proof.weak_segments_count,
    segment_exclusion_recommendations: safeInput.segment_exclusion_recommendations,
  }

  const p39_segment_quality_summary = buildSegmentQualityProofSummary(summaryInput, violations)

  return {
    segment_quality_proof,
    segment_quality_rankings,
    confidence_calibration_review,
    p39_segment_quality_summary,
  }
}
