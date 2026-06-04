// syntheticCohortReview.js
// Pure-function service — no DB, no network, no side effects.
// ESM only. Review version: p3.8.28

export const REVIEW_VERSION = 'p3.8.28'

const DEFAULT_MEMBERS = [
  { member_id: 'sim-cohort-001', synthetic: true },
  { member_id: 'sim-cohort-002', synthetic: true },
  { member_id: 'sim-cohort-003', synthetic: true },
]

function reviewMember(member) {
  const email_present = !!(member.email)
  const user_id_present = !!(member.user_id || member.real_user_id)
  // real_user is ALWAYS forced false in output — but we detect the input value
  const real_user_detected = !!(member.real_user)
  const delivery_target_present = !!(member.delivery_target)
  const personal_data_present = !!(member.personal_data)
  const payment_data_present = !!(member.payment_data)
  const contact_channel_present = !!(member.contact_channel)

  const issues = []
  if (email_present) issues.push('email_present — value sanitized')
  if (user_id_present) issues.push('user_id_present — value sanitized')
  if (real_user_detected) issues.push('real_user flag detected in input')
  if (delivery_target_present) issues.push('delivery_target present')
  if (personal_data_present) issues.push('personal_data present')
  if (payment_data_present) issues.push('payment_data present')
  if (contact_channel_present) issues.push('contact_channel present')

  const passed =
    !email_present &&
    !user_id_present &&
    !real_user_detected &&
    !delivery_target_present &&
    !personal_data_present &&
    !payment_data_present &&
    !contact_channel_present

  return {
    member_id: member.member_id || 'unknown',
    synthetic: true, // always synthetic in output
    real_user: false, // ALWAYS forced false
    email_present,
    user_id_present,
    delivery_target_present,
    personal_data_present,
    payment_data_present,
    contact_channel_present,
    passed,
    issues,
  }
}

function buildSafetyMatrix(members) {
  const reviewed = members.map(reviewMember)
  const failed_members_count = reviewed.filter(m => !m.passed).length
  return {
    status: failed_members_count === 0 ? 'passed' : 'blocked',
    members_count: reviewed.length,
    failed_members_count,
    members: reviewed,
  }
}

function buildReview(matrix, memberCount) {
  const hasViolations = matrix.failed_members_count > 0
  const anyEmailDetected = matrix.members.some(m => m.email_present)
  const anyRealUser = matrix.members.some(m => m.email_present || m.user_id_present)

  const warnings = []
  const blockers = []

  if (anyEmailDetected) blockers.push('real_email_detected')
  if (anyRealUser) blockers.push('potential_real_user_data')

  return {
    status: hasViolations ? (anyEmailDetected ? 'critical_violation' : 'blocked') : 'passed',
    review_version: REVIEW_VERSION,
    simulation_only: true,
    members_reviewed: memberCount,
    synthetic_members_count: memberCount,
    real_users_detected: false, // ALWAYS false — invariant
    real_emails_detected: anyEmailDetected,
    personal_data_detected: matrix.members.some(m => m.personal_data_present),
    delivery_targets_detected: matrix.members.some(m => m.delivery_target_present),
    passed: !hasViolations,
    warnings,
    blockers,
  }
}

function buildFindings(matrix) {
  const hasViolations = matrix.failed_members_count > 0
  const baseFindings = [
    { finding_id: 'synthetic_members_only', severity: 'info', passed: true },
    { finding_id: 'no_real_emails', severity: 'info', passed: !matrix.members.some(m => m.email_present) },
    { finding_id: 'no_user_ids', severity: 'info', passed: !matrix.members.some(m => m.user_id_present) },
    { finding_id: 'no_delivery_targets', severity: 'info', passed: !matrix.members.some(m => m.delivery_target_present) },
    { finding_id: 'no_personal_data', severity: 'info', passed: !matrix.members.some(m => m.personal_data_present) },
  ]

  // Promote failing base findings to critical
  const findings = baseFindings.map(f => {
    if (!f.passed) return { ...f, severity: 'critical' }
    return f
  })

  const critical_findings_count = findings.filter(f => f.severity === 'critical').length

  return {
    status: hasViolations ? 'violations_found' : 'clean',
    findings_count: findings.length,
    critical_findings_count,
    findings,
    recommendations: hasViolations
      ? ['Remove all real emails and user IDs from the cohort before proceeding.']
      : ['Continue shadow-only review. No real users present.'],
  }
}

function buildSummary(matrix) {
  const noViolations = matrix.failed_members_count === 0
  return {
    status: noViolations ? 'safe' : 'blocked',
    headline: noViolations ? 'Coorte sintética validada.' : 'Violações detectadas na coorte.',
    summary_text: noViolations
      ? 'A coorte contém apenas placeholders sem email, user_id ou alvo de entrega.'
      : 'Foram encontrados dados que violam as regras de segurança da coorte sintética.',
    safe_for_dry_invite: noViolations,
    safe_for_real_invite: false, // ALWAYS false
    safe_to_sell: false,         // ALWAYS false
  }
}

export function evaluateSyntheticCohortReview(input = {}, _options = {}) {
  const rawMembers =
    input.non_user_cohort_members &&
    Array.isArray(input.non_user_cohort_members.members) &&
    input.non_user_cohort_members.members.length > 0
      ? input.non_user_cohort_members.members
      : DEFAULT_MEMBERS

  const synthetic_member_safety_matrix = buildSafetyMatrix(rawMembers)
  const synthetic_cohort_review = buildReview(synthetic_member_safety_matrix, rawMembers.length)
  const synthetic_cohort_findings = buildFindings(synthetic_member_safety_matrix)
  const synthetic_cohort_review_summary = buildSummary(synthetic_member_safety_matrix)

  return {
    synthetic_cohort_review,
    synthetic_member_safety_matrix,
    synthetic_cohort_findings,
    synthetic_cohort_review_summary,
  }
}
