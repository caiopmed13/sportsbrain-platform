// breakEvenOddsReview.js
// Cloudflare Workers Node.js ESM — pure functions, no DB, no network
// version: p3.9.2

const REVIEW_VERSION = 'p3.9.2'
const DEFAULT_MINIMUM_SEGMENT_SAMPLE = 5
const DEFAULT_MINIMUM_ACTIONABLE_SAMPLE = 10
const EDGE_POSITIVE_THRESHOLD = 0.03
const EDGE_NEGATIVE_THRESHOLD = -0.03

const UNSAFE_FIELDS = [
  'can_beta',
  'can_sell',
  'delivery_allowed',
  'real_delivery',
]

// ─── internal helpers ────────────────────────────────────────────────────────

function round4(value) {
  return Math.round(value * 10000) / 10000
}

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

// ─── normalizeDecimalOdds ────────────────────────────────────────────────────

export function normalizeDecimalOdds(value) {
  if (value == null) return null
  const num = Number(value)
  if (isNaN(num)) return null
  if (num <= 1.0) return null
  return num
}

// ─── computeBreakEvenHitRate ─────────────────────────────────────────────────

export function computeBreakEvenHitRate(decimalOdds) {
  return round4(1 / decimalOdds)
}

// ─── computeSegmentBreakEven ─────────────────────────────────────────────────

export function computeSegmentBreakEven(segment, options) {
  const minSample = options?.minimum_segment_sample ?? DEFAULT_MINIMUM_SEGMENT_SAMPLE
  const minActionable = options?.minimum_actionable_sample ?? DEFAULT_MINIMUM_ACTIONABLE_SAMPLE

  const sampleSize = segment.sample_size ?? 0

  if (sampleSize < minSample) {
    return {
      ...segment,
      break_even_hit_rate: null,
      edge_vs_break_even: null,
      status: 'insufficient_sample',
      actionability: 'not_actionable_sample_small',
    }
  }

  const validOdds = normalizeDecimalOdds(segment.average_odds)

  if (validOdds == null) {
    return {
      ...segment,
      break_even_hit_rate: null,
      edge_vs_break_even: null,
      status: 'not_available',
      actionability: 'not_actionable_sample_small',
    }
  }

  const breakEvenHitRate = round4(1 / validOdds)
  const hitRate = segment.hit_rate ?? 0
  const edgeVsBreakEven = round4(hitRate - breakEvenHitRate)

  let status
  let actionability

  if (edgeVsBreakEven >= EDGE_POSITIVE_THRESHOLD) {
    status = 'positive_edge'
    actionability = 'candidate_keep'
  } else if (edgeVsBreakEven >= EDGE_NEGATIVE_THRESHOLD) {
    status = 'near_break_even'
    actionability = 'watch'
  } else {
    status = 'negative_edge'
    actionability = sampleSize >= minActionable ? 'candidate_exclude' : 'watch'
  }

  return {
    ...segment,
    break_even_hit_rate: breakEvenHitRate,
    edge_vs_break_even: edgeVsBreakEven,
    status,
    actionability,
  }
}

// ─── buildSegmentBreakEvenMatrix ─────────────────────────────────────────────

export function buildSegmentBreakEvenMatrix(segments, options) {
  if (!segments || segments.length === 0) {
    return {
      status: 'empty',
      matrix_version: REVIEW_VERSION,
      segments_count: 0,
      segments: [],
    }
  }

  const computed = segments.map((seg) => computeSegmentBreakEven(seg, options))

  return {
    status: 'available',
    matrix_version: REVIEW_VERSION,
    segments_count: computed.length,
    segments: computed,
  }
}

// ─── buildBreakEvenOddsReview ─────────────────────────────────────────────────

export function buildBreakEvenOddsReview(segmentsWithBreakEven, violations) {
  if (!segmentsWithBreakEven || segmentsWithBreakEven.length === 0) {
    return {
      status: 'empty',
      review_version: REVIEW_VERSION,
      segments_evaluated: 0,
      positive_edge_count: 0,
      near_break_even_count: 0,
      negative_edge_count: 0,
      insufficient_sample_count: 0,
      not_available_count: 0,
      minimum_segment_sample: DEFAULT_MINIMUM_SEGMENT_SAMPLE,
      minimum_actionable_sample: DEFAULT_MINIMUM_ACTIONABLE_SAMPLE,
      can_beta: false,
      can_sell: false,
    }
  }

  let status = 'evaluated'

  if (violations && violations.length > 0) {
    status = 'critical_violation'
  }

  const positive_edge_count = segmentsWithBreakEven.filter((s) => s.status === 'positive_edge').length
  const near_break_even_count = segmentsWithBreakEven.filter((s) => s.status === 'near_break_even').length
  const negative_edge_count = segmentsWithBreakEven.filter((s) => s.status === 'negative_edge').length
  const insufficient_sample_count = segmentsWithBreakEven.filter((s) => s.status === 'insufficient_sample').length
  const not_available_count = segmentsWithBreakEven.filter((s) => s.status === 'not_available').length

  return {
    status,
    review_version: REVIEW_VERSION,
    segments_evaluated: segmentsWithBreakEven.length,
    positive_edge_count,
    near_break_even_count,
    negative_edge_count,
    insufficient_sample_count,
    not_available_count,
    minimum_segment_sample: DEFAULT_MINIMUM_SEGMENT_SAMPLE,
    minimum_actionable_sample: DEFAULT_MINIMUM_ACTIONABLE_SAMPLE,
    can_beta: false,
    can_sell: false,
  }
}

// ─── buildSegmentsFromDistribution ───────────────────────────────────────────

function buildSegmentsFromDistribution(resolved_sample_distribution) {
  const segments = []

  const bySport = resolved_sample_distribution?.by_sport ?? []
  const byMarket = resolved_sample_distribution?.by_market ?? []

  for (const item of bySport) {
    const count = item.count ?? 0
    segments.push({
      segment_type: 'sport',
      segment_key: item.key,
      sample_size: count,
      green: item.green ?? 0,
      red: item.red ?? 0,
      hit_rate: item.hit_rate ?? (count > 0 ? (item.green ?? 0) / count : 0),
      average_odds: item.average_odds ?? null,
    })
  }

  for (const item of byMarket) {
    const count = item.count ?? 0
    segments.push({
      segment_type: 'market',
      segment_key: item.key,
      sample_size: count,
      green: item.green ?? 0,
      red: item.red ?? 0,
      hit_rate: item.hit_rate ?? (count > 0 ? (item.green ?? 0) / count : 0),
      average_odds: item.average_odds ?? null,
    })
  }

  return segments
}

// ─── main export ─────────────────────────────────────────────────────────────

export function evaluateBreakEvenOddsReview(input = {}, options = {}) {
  const { sanitized, violations } = sanitizeInput(input)
  const safeInput = { ...input, ...sanitized }

  let segments = safeInput.segments

  // If no segments but distribution data is available, build from distribution
  if ((!segments || segments.length === 0) && safeInput.resolved_sample_distribution) {
    const built = buildSegmentsFromDistribution(safeInput.resolved_sample_distribution)
    if (built.length > 0) {
      segments = built
    }
  }

  segments = segments ?? []

  const computedSegments = segments.map((seg) => computeSegmentBreakEven(seg, options))

  const segment_break_even_matrix = buildSegmentBreakEvenMatrix(segments, options)
  const break_even_odds_review = buildBreakEvenOddsReview(computedSegments, violations)

  return {
    break_even_odds_review,
    segment_break_even_matrix,
  }
}
