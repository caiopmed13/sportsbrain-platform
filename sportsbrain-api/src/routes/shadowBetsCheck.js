// src/routes/shadowBetsCheck.js
// GET /v1/admin/shadow-bets-check — direct D1 shadow_bets table diagnostic
// Auth: X-Admin-Key = SB_MASTER_KEY
// ?explain=1 — adds confidence_score_explain breakdown (P3.8.5.3)

import { corsHeaders } from './health.js'
import { explainBetConfidenceScore } from '../services/betConfidence.js'
import { queryMicroTestReport } from '../services/microTestAnalytics.js'
import { evaluateMicroTestPolicy } from '../services/microTestPolicy.js'
import { evaluateSegmentHealth } from '../services/segmentHealth.js'
import { evaluateBetaAdmission } from '../services/betaAdmission.js'
import { evaluatePrivateBetaSandbox } from '../services/privateBetaSandbox.js'
import { evaluateSimulatedCohortMonitor } from '../services/simulatedCohortMonitor.js'
import { evaluateOperatorDecisionPacket } from '../services/operatorDecisionPacket.js'
import { evaluateManualReviewGovernance } from '../services/manualReviewGovernance.js'
import { evaluateEvidenceExport } from '../services/evidenceExport.js'
import { evaluateExportContract } from '../services/exportContract.js'
import { evaluateSnapshotSimulation } from '../services/snapshotSimulation.js'
import { evaluateRegressionLockdown } from '../services/regressionLockdown.js'
import { evaluateAdminExportPreview } from '../services/adminExportPreview.js'
import { applyImmutableNoSellEnvelope } from '../services/immutableNoSell.js'
import { evaluateReportRedaction } from '../services/reportRedaction.js'
import { evaluateExportAbuseProtection } from '../services/exportAbuseProtection.js'
import { evaluateAdminPreviewUx } from '../services/adminPreviewUx.js'
import { evaluateInternalExportRenderer } from '../services/internalExportRenderer.js'
import { evaluateAdminDownloadDryRun } from '../services/adminDownloadDryRun.js'
import { evaluateRedactionRegressionLock } from '../services/redactionRegressionLock.js'
import { evaluateAdminExportArchive } from '../services/adminExportArchive.js'
import { evaluateReportHistorySimulation } from '../services/reportHistorySimulation.js'
import { evaluateAdminAccessAudit } from '../services/adminAccessAudit.js'
import { evaluateInternalExportStorage } from '../services/internalExportStorage.js'
import { evaluateAdminAccessReplay } from '../services/adminAccessReplay.js'
import { evaluateReleaseFreezeSentinel } from '../services/releaseFreezeSentinel.js'
import { evaluateReleaseFreezeBaseline } from '../services/releaseFreezeBaseline.js'
import { evaluateSafetyInvariantSnapshot } from '../services/safetyInvariantSnapshot.js'
import { evaluateControlledUnfreezeDesign } from '../services/controlledUnfreezeDesign.js'
import { evaluateCapabilityUnlockMatrix } from '../services/capabilityUnlockMatrix.js'
import { evaluateControlledUnfreezeSimulation } from '../services/controlledUnfreezeSimulation.js'
import { evaluatePreBetaGovernanceGate } from '../services/preBetaGovernanceGate.js'
import { evaluatePreBetaReadinessCouncil } from '../services/preBetaReadinessCouncil.js'
import { evaluateOperatorSignoffSimulation } from '../services/operatorSignoffSimulation.js'
import { evaluatePrivateBetaNonDelivery } from '../services/privateBetaNonDelivery.js'
import { evaluateNonUserCohortContract } from '../services/nonUserCohortContract.js'
import { evaluatePrivateBetaInvitationSimulation } from '../services/privateBetaInvitationSimulation.js'
import { evaluateDeliveryKillSwitch } from '../services/deliveryKillSwitch.js'
import { evaluateSyntheticCohortReview } from '../services/syntheticCohortReview.js'
import { evaluatePrivateBetaDryInviteReport } from '../services/privateBetaDryInviteReport.js'
import { evaluateDeliveryIncidentDrill } from '../services/deliveryIncidentDrill.js'
import { evaluateBetaSafetyIncidentLedger } from '../services/betaSafetyIncidentLedger.js'
import { evaluateIncidentRecoverySimulation } from '../services/incidentRecoverySimulation.js'
import { evaluateOperatorEscalationProtocol } from '../services/operatorEscalationProtocol.js'
import { evaluateP38GovernanceClosure } from '../services/p38GovernanceClosure.js'
import { evaluateP38SafetyFinalization } from '../services/p38SafetyFinalization.js'
import { evaluateP39TransitionPlan } from '../services/p39TransitionPlan.js'
import { evaluateResolvedSampleAudit } from '../services/resolvedSampleAudit.js'
import { evaluateMicroTestActivationReadiness } from '../services/microTestActivationReadiness.js'
import { evaluateQualityProofKickoff } from '../services/qualityProofKickoff.js'
import { evaluateMicroTestManualActivationGuard } from '../services/microTestManualActivationGuard.js'
import { evaluatePostActivationMonitor } from '../services/postActivationMonitor.js'
import { evaluateFirstRealQualitySnapshot } from '../services/firstRealQualitySnapshot.js'
import { evaluateBreakEvenOddsReview } from '../services/breakEvenOddsReview.js'
import { evaluateSegmentQualityProof } from '../services/segmentQualityProof.js'
import { evaluateSegmentExclusionRecommendations } from '../services/segmentExclusionRecommendations.js'
import { evaluateSegmentExclusionDryRun } from '../services/segmentExclusionDryRun.js'
import { evaluateQualityReweightProposal } from '../services/qualityReweightProposal.js'
import { evaluateShadowRecommendationPolicy } from '../services/shadowRecommendationPolicy.js'
import { evaluateShadowReweightBacktest } from '../services/shadowReweightBacktest.js'
import { evaluateRecommendationStabilityCheck } from '../services/recommendationStabilityCheck.js'
import { evaluateQualityProofDecisionGate } from '../services/qualityProofDecisionGate.js'
import { evaluateQualityProofTrendMonitor } from '../services/qualityProofTrendMonitor.js'
import { evaluateSegmentDecisionHistory } from '../services/segmentDecisionHistory.js'
import { evaluateBetaSimulationReadiness } from '../services/betaSimulationReadiness.js'
import { evaluateBetaSimulationCohortPlan } from '../services/betaSimulationCohortPlan.js'
import { evaluateSyntheticDeliveryUxContract } from '../services/syntheticDeliveryUxContract.js'
import { evaluateQualityProofReviewBoard } from '../services/qualityProofReviewBoard.js'
import { evaluateInternalPickCardContract } from '../services/internalPickCardContract.js'
import { evaluateSyntheticBetaExperiencePreview } from '../services/syntheticBetaExperiencePreview.js'
import { evaluateSyntheticFeedbackLoop } from '../services/syntheticFeedbackLoop.js'

export async function handleShadowBetsCheck(request, env) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminKey  = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key') || ''
  const hasMaster = env.SB_MASTER_KEY && adminKey === env.SB_MASTER_KEY
  if (!hasMaster && env.SB_MASTER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  if (!env?.SB_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'DB_NOT_CONFIGURED' }), {
      status: 503, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  const explain = new URL(request.url).searchParams.get('explain') === '1'

  try {
    const [
      summaryRow,
      byTrainingRows,
      byTierRows,
      byAuditRows,
      byResultRows,
      confidenceHealthRow,
      sampleRows,
      auditHealthRow,
      byTrustRows,
      accumWindowRow,
      resolvedRowsResult,
    ] = await env.SB_DB.batch([
      // 1. totals + last-24h + latest
      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total_rows,
          SUM(CASE WHEN pick_date >= date('now', '-1 day') THEN 1 ELSE 0 END) as rows_last_24h,
          MAX(entry_captured_at) as latest_created_at
        FROM shadow_bets
      `),
      // 2. by training_eligible (0 = lab, 1 = main)
      env.SB_DB.prepare(`
        SELECT training_eligible, COUNT(*) as n
        FROM shadow_bets
        GROUP BY training_eligible
      `),
      // 3. by bet_confidence_tier
      env.SB_DB.prepare(`
        SELECT bet_confidence_tier, COUNT(*) as n
        FROM shadow_bets
        GROUP BY bet_confidence_tier
        ORDER BY n DESC
        LIMIT 10
      `),
      // 4. by audit_status
      env.SB_DB.prepare(`
        SELECT audit_status, COUNT(*) as n
        FROM shadow_bets
        GROUP BY audit_status
        ORDER BY n DESC
        LIMIT 10
      `),
      // 5. by result_status
      env.SB_DB.prepare(`
        SELECT result_status, COUNT(*) as n
        FROM shadow_bets
        GROUP BY result_status
        ORDER BY n DESC
      `),
      // 6. confidence annotation health (P3.8.4.8)
      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total_rows,
          SUM(CASE WHEN bet_confidence_score IS NOT NULL THEN 1 ELSE 0 END) as rows_with_score,
          SUM(CASE WHEN bet_confidence_score IS NULL THEN 1 ELSE 0 END) as rows_without_score,
          SUM(CASE WHEN bet_confidence_tier IS NOT NULL AND bet_confidence_tier != 'no_bet' THEN 1 ELSE 0 END) as rows_with_real_tier,
          SUM(CASE WHEN bet_confidence_tier IS NULL OR bet_confidence_tier = 'no_bet' THEN 1 ELSE 0 END) as rows_without_tier,
          AVG(CASE WHEN bet_confidence_score IS NOT NULL THEN bet_confidence_score END) as avg_score,
          MIN(bet_confidence_score) as min_score,
          MAX(bet_confidence_score) as max_score,
          MAX(entry_captured_at) as latest_annotation_at
        FROM shadow_bets
      `),
      // 7. sample 5 most recent rows
      env.SB_DB.prepare(`
        SELECT id, pick_date, audit_status, trust_level, bet_confidence_tier,
               bet_confidence_score, training_eligible, result_status, odd, entry_captured_at
        FROM shadow_bets
        ORDER BY rowid DESC
        LIMIT 5
      `),
      // 8. P3.8.6.9 audit annotation health
      env.SB_DB.prepare(`
        SELECT
          COUNT(*) as total_rows,
          SUM(CASE WHEN audit_status IS NOT NULL AND audit_status != 'unknown' THEN 1 ELSE 0 END) as rows_with_known_audit,
          SUM(CASE WHEN audit_status = 'unknown' OR audit_status IS NULL THEN 1 ELSE 0 END) as rows_with_unknown_audit,
          SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) as training_eligible_count
        FROM shadow_bets
      `),
      // 9. by trust_level
      env.SB_DB.prepare(`
        SELECT trust_level, COUNT(*) as n
        FROM shadow_bets
        GROUP BY trust_level
        ORDER BY n DESC
        LIMIT 8
      `),
      // 10. P3.8.7 accumulation window
      env.SB_DB.prepare(`
        SELECT
          SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) as training_eligible_total,
          SUM(CASE WHEN training_eligible = 1 AND result_status IN ('green','red') THEN 1 ELSE 0 END) as resolved_valid,
          SUM(CASE WHEN training_eligible = 1 AND result_status = 'pending' THEN 1 ELSE 0 END) as pending_training_eligible,
          SUM(CASE WHEN result_status = 'green' THEN 1 ELSE 0 END) as green_count,
          SUM(CASE WHEN result_status = 'red' THEN 1 ELSE 0 END) as red_count,
          MAX(CASE WHEN result_status IN ('green','red','unknown','void') THEN settled_at END) as last_resolver_run
        FROM shadow_bets
      `),
      // 11. P3.9.2 resolved rows for segment quality proof (limited to 500)
      env.SB_DB.prepare(`
        SELECT sport, market, bet_confidence_score, bet_confidence_tier, odd, trust_level, result_status
        FROM shadow_bets
        WHERE training_eligible = 1
          AND result_status IN ('green','red')
        ORDER BY created_at DESC
        LIMIT 500
      `),
    ])

    const summary = summaryRow.results[0] ?? {}
    const totalRows = summary?.total_rows ?? 0

    const byTraining = Object.fromEntries(
      (byTrainingRows?.results || []).map(r => [
        r.training_eligible === 1 ? 'main' : 'lab',
        r.n,
      ])
    )

    const byTier = Object.fromEntries(
      (byTierRows?.results || []).map(r => [r.bet_confidence_tier ?? 'null', r.n])
    )

    const byAudit = Object.fromEntries(
      (byAuditRows?.results || []).map(r => [r.audit_status ?? 'null', r.n])
    )

    const byResult = Object.fromEntries(
      (byResultRows?.results || []).map(r => [r.result_status ?? 'null', r.n])
    )

    // Confidence annotation health (P3.8.4.8)
    const ch = confidenceHealthRow?.results?.[0] ?? {}
    const chTotal = ch.total_rows ?? 0
    const chWithScore = ch.rows_with_score ?? 0
    const scoreCoveragePct = chTotal === 0 ? 0 : Math.round((chWithScore / chTotal) * 1000) / 10
    const confidenceAnnotationHealth = {
      total_rows:            chTotal,
      rows_with_score:       chWithScore,
      rows_without_score:    ch.rows_without_score ?? 0,
      rows_with_real_tier:   ch.rows_with_real_tier ?? 0,
      rows_without_tier:     ch.rows_without_tier ?? 0,
      score_coverage_pct:    scoreCoveragePct,
      avg_score:             ch.avg_score != null ? +parseFloat(ch.avg_score).toFixed(4) : null,
      min_score:             ch.min_score ?? null,
      max_score:             ch.max_score ?? null,
      latest_annotation_at:  ch.latest_annotation_at ?? null,
      by_confidence_tier:    byTier,
    }

    // Audit annotation health (P3.8.6.9)
    const ah = auditHealthRow?.results?.[0] ?? {}
    const ahTotal = ah.total_rows ?? 0
    const ahKnown = ah.rows_with_known_audit ?? 0
    const auditCoveragePct = ahTotal === 0 ? 0 : Math.round((ahKnown / ahTotal) * 1000) / 10
    const byTrustLevel = Object.fromEntries(
      (byTrustRows?.results || []).map(r => [r.trust_level ?? 'null', r.n])
    )
    const auditAnnotationHealth = {
      total_rows:               ahTotal,
      rows_with_known_audit:    ahKnown,
      rows_with_unknown_audit:  ah.rows_with_unknown_audit ?? 0,
      audit_coverage_pct:       auditCoveragePct,
      training_eligible_count:  ah.training_eligible_count ?? 0,
      by_audit_status:          byAudit,
      by_trust_level:           byTrustLevel,
    }

    // P3.8.7 accumulation window
    const aw = accumWindowRow?.results?.[0] ?? {}
    const awResolved = aw.resolved_valid ?? 0
    const MICRO_TEST_THRESHOLD = 30
    const canMicroTest = awResolved >= MICRO_TEST_THRESHOLD
    const microTestEnabled = env?.MICRO_TEST_ENABLED === 'true'
    const microTestActive = canMicroTest && microTestEnabled
    let microTestStatus
    if (awResolved < MICRO_TEST_THRESHOLD) {
      microTestStatus = 'waiting_for_threshold'
    } else if (canMicroTest && microTestEnabled) {
      microTestStatus = 'active'
    } else if (canMicroTest) {
      microTestStatus = 'ready'
    } else {
      microTestStatus = 'blocked'
    }
    const accumulationWindow = {
      shadow_accumulation_status: 'active',
      training_eligible_total:    aw.training_eligible_total ?? 0,
      resolved_valid:             awResolved,
      pending_training_eligible:  aw.pending_training_eligible ?? 0,
      green_count:                aw.green_count ?? 0,
      red_count:                  aw.red_count ?? 0,
      unknown_as_red_count:       0,
      audit_coverage_pct:         auditCoveragePct,
      can_micro_test:             canMicroTest,
      remaining_to_micro_test:    Math.max(0, MICRO_TEST_THRESHOLD - awResolved),
      micro_test_threshold:       MICRO_TEST_THRESHOLD,
      last_resolver_run:          aw.last_resolver_run ?? null,
      micro_test_gate: {
        micro_test_status:  microTestStatus,
        micro_test_active:  microTestActive,
        can_beta:           false,
        can_sell:           false,
      },
    }

    // ── P3.8.5.3: explain debug (only when ?explain=1) ──────────────────────
    let confidenceScoreExplain = null
    if (explain) {
      try {
        const explainRows = await env.SB_DB.prepare(`
          SELECT id, home_team, away_team, market, selection, odd, legs_count,
                 audit_status, trust_level, can_post, market_available,
                 availability_confidence, clv_status, golden_score,
                 golden_support_score, source_family, bet_confidence_score,
                 bet_confidence_tier, odds_snapshot_id, training_eligible
          FROM shadow_bets
          ORDER BY COALESCE(bet_confidence_score, -1) ASC, rowid DESC
          LIMIT 10
        `).all()

        const samples = (explainRows?.results || []).map(row => {
          const pseudo = {
            // audit_status stored as plain string in DB
            audit_status:            row.audit_status || null,
            trust_level:             row.trust_level  || null,
            can_post:                row.can_post === 1,
            market_available:        row.market_available === 1 ? true
                                   : row.market_available === 0 ? false
                                   : null,
            availability_confidence: row.availability_confidence || null,
            odds_snapshot_id:        row.odds_snapshot_id || null,
            clv_status:              row.clv_status || null,
            golden_score:            row.golden_score ?? null,
            golden_support_score:    row.golden_support_score ?? null,
            odd:                     row.odd ?? null,
            legs_count:              row.legs_count ?? 1,
            source_family:           row.source_family || null,
            training_eligible:       row.training_eligible ?? null,
          }
          const ex = explainBetConfidenceScore(pseudo)
          return {
            id:               row.id,
            home_team:        row.home_team,
            away_team:        row.away_team,
            market:           row.market,
            selection:        row.selection,
            odd:              row.odd,
            stored_score:     row.bet_confidence_score,
            stored_tier:      row.bet_confidence_tier,
            recomputed_score: ex.score,
            recomputed_tier:  ex.tier,
            components:       ex.components,
            input_flags:      ex.input_flags,
            blockers:         ex.blockers,
            notes:            ex.notes,
          }
        })

        // Aggregate dominant zero reasons across samples
        const dominantZeroReasons = {
          missing_audit:             0,
          missing_trust:             0,
          can_post_false:            0,
          market_unavailable:        0,
          missing_odds_snapshot:     0,
          missing_clv:               0,
          missing_evidence_pack:     0,
          validation_sample_missing: 0,
          risk_penalty_maxed:        0,
        }
        for (const s of samples) {
          for (const b of s.blockers) {
            if (b in dominantZeroReasons) dominantZeroReasons[b]++
          }
        }

        confidenceScoreExplain = {
          samples_checked:       samples.length,
          samples,
          dominant_zero_reasons: dominantZeroReasons,
        }
      } catch (explainErr) {
        confidenceScoreExplain = { error: explainErr.message, samples_checked: 0 }
      }
    }

    const microTestReadiness = {
      can_micro_test: canMicroTest,
      micro_test_active: microTestActive,
    }
    const microTestReport = await queryMicroTestReport(env, microTestReadiness)
    const microTestPolicy = evaluateMicroTestPolicy(microTestReport)
    const segmentHealth = evaluateSegmentHealth(microTestReport, microTestPolicy)
    const betaAdmission = evaluateBetaAdmission({
      micro_test_report:          microTestReport,
      micro_test_policy:          microTestPolicy,
      candidate_segments:         segmentHealth.candidate_segments,
      risk_segments:              segmentHealth.risk_segments,
      controlled_expansion_review: segmentHealth.controlled_expansion_review,
      beta_hold_review:           segmentHealth.beta_hold_review,
      micro_test_active:          microTestActive,
      can_sell:                   false,
    }, {
      beta_manual_approval:              env?.BETA_MANUAL_APPROVAL === 'true',
      private_cohort_simulation_enabled: env?.PRIVATE_COHORT_SIMULATION_ENABLED === 'true',
      private_cohort_size:               parseInt(env?.PRIVATE_COHORT_SIZE || '0', 10),
      private_cohort_max_daily_picks:    parseInt(env?.PRIVATE_COHORT_MAX_DAILY_PICKS || '0', 10),
    })
    const sandbox = evaluatePrivateBetaSandbox({
      beta_admission_contract:   betaAdmission.beta_admission_contract,
      manual_approval_gate:      betaAdmission.manual_approval_gate,
      private_cohort_simulation: betaAdmission.private_cohort_simulation,
      beta_admission_review:     betaAdmission.beta_admission_review,
      candidate_segments:        segmentHealth.candidate_segments,
      risk_segments:             segmentHealth.risk_segments,
      micro_test_active:         microTestActive,
      micro_test_report:         microTestReport,
      micro_test_policy:         microTestPolicy,
      can_sell:                  false,
      can_start_public_beta:     false,
    }, {
      private_beta_sandbox_enabled: env?.PRIVATE_BETA_SANDBOX_ENABLED === 'true',
      max_ledger_entries:           parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_LEDGER_ENTRIES || '25', 10),
      max_picks_per_run:            parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_PICKS_PER_RUN || '3', 10),
      strict_mode:                  env?.PRIVATE_BETA_SANDBOX_STRICT_MODE !== 'false',
    })
    const cohortMonitor = evaluateSimulatedCohortMonitor({
      private_beta_sandbox:      sandbox.private_beta_sandbox,
      sandbox_delivery_policy:   sandbox.sandbox_delivery_policy,
      sandbox_risk_controls:     sandbox.sandbox_risk_controls,
      simulated_delivery_ledger: sandbox.simulated_delivery_ledger,
      sandbox_audit_summary:     sandbox.sandbox_audit_summary,
      operator_review_console:   sandbox.operator_review_console,
      beta_admission_contract:   betaAdmission.beta_admission_contract,
      manual_approval_gate:      betaAdmission.manual_approval_gate,
      private_cohort_simulation: betaAdmission.private_cohort_simulation,
      beta_admission_review:     betaAdmission.beta_admission_review,
      candidate_segments:        segmentHealth.candidate_segments,
      risk_segments:             segmentHealth.risk_segments,
      micro_test_active:         microTestActive,
      micro_test_report:         microTestReport,
      micro_test_policy:         microTestPolicy,
      can_sell:                  false,
      can_start_public_beta:     false,
    }, {
      max_ledger_entries: parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_LEDGER_ENTRIES || '25', 10),
      max_picks_per_run:  parseInt(env?.PRIVATE_BETA_SANDBOX_MAX_PICKS_PER_RUN  || '3', 10),
    })
    const decisionPacket = evaluateOperatorDecisionPacket({
      micro_test_active:            microTestActive,
      micro_test_report:            microTestReport,
      micro_test_policy:            microTestPolicy,
      candidate_segments:           segmentHealth.candidate_segments,
      risk_segments:                segmentHealth.risk_segments,
      beta_admission_review:        betaAdmission.beta_admission_review,
      beta_admission_contract:      betaAdmission.beta_admission_contract,
      manual_approval_gate:         betaAdmission.manual_approval_gate,
      private_beta_sandbox:         sandbox.private_beta_sandbox,
      sandbox_audit_summary:        sandbox.sandbox_audit_summary,
      simulated_delivery_ledger:    sandbox.simulated_delivery_ledger,
      operator_review_console:      sandbox.operator_review_console,
      simulated_cohort_monitor:     cohortMonitor.simulated_cohort_monitor,
      ledger_health:                cohortMonitor.ledger_health,
      ledger_exposure:              cohortMonitor.ledger_exposure,
      delivery_drift_report:        cohortMonitor.delivery_drift_report,
      operator_approval_checklist:  cohortMonitor.operator_approval_checklist,
      cohort_monitoring_review:     cohortMonitor.cohort_monitoring_review,
      can_beta:                     false,
      can_sell:                     false,
      real_users:                   false,
      real_delivery:                false,
    })
    const reviewGovernance = evaluateManualReviewGovernance({
      operator_decision_packet:    decisionPacket.operator_decision_packet,
      launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
      beta_dry_run_report:         decisionPacket.beta_dry_run_report,
      launch_governance:           decisionPacket.launch_governance,
      governance_audit_summary:    decisionPacket.governance_audit_summary,
      micro_test_report:           microTestReport,
      micro_test_policy:           microTestPolicy,
      micro_test_active:           microTestActive,
      candidate_segments:          segmentHealth.candidate_segments,
      risk_segments:               segmentHealth.risk_segments,
      beta_admission_review:       betaAdmission.beta_admission_review,
      private_beta_sandbox:        sandbox.private_beta_sandbox,
      simulated_delivery_ledger:   sandbox.simulated_delivery_ledger,
      simulated_cohort_monitor:    cohortMonitor.simulated_cohort_monitor,
      operator_approval_checklist: cohortMonitor.operator_approval_checklist,
      cohort_monitoring_review:    cohortMonitor.cohort_monitoring_review,
      can_beta:                    false,
      can_sell:                    false,
      real_users:                  false,
      real_delivery:               false,
    })

    const evidenceExport = evaluateEvidenceExport({
      operator_decision_packet:    decisionPacket.operator_decision_packet,
      launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
      beta_dry_run_report:         decisionPacket.beta_dry_run_report,
      launch_governance:           decisionPacket.launch_governance,
      governance_audit_summary:    decisionPacket.governance_audit_summary,
      operator_next_actions:       decisionPacket.operator_next_actions,
      micro_test_report:           microTestReport,
      micro_test_policy:           microTestPolicy,
      micro_test_active:           microTestActive,
      micro_test_status:           microTestStatus,
      can_micro_test:              canMicroTest,
      resolved_valid:              awResolved,
      candidate_segments:          segmentHealth.candidate_segments,
      risk_segments:               segmentHealth.risk_segments,
      beta_admission_review:       betaAdmission.beta_admission_review,
      beta_admission_contract:     betaAdmission.beta_admission_contract,
      private_beta_sandbox:        sandbox.private_beta_sandbox,
      simulated_delivery_ledger:   sandbox.simulated_delivery_ledger,
      simulated_cohort_monitor:    cohortMonitor.simulated_cohort_monitor,
      operator_approval_checklist: cohortMonitor.operator_approval_checklist,
      cohort_monitoring_review:    cohortMonitor.cohort_monitoring_review,
      manual_review_artifact:      reviewGovernance.manual_review_artifact,
      approval_simulation:         reviewGovernance.approval_simulation,
      no_launch_governance:        reviewGovernance.no_launch_governance,
      release_hard_locks:          reviewGovernance.release_hard_locks,
      operator_review_audit_trail: reviewGovernance.operator_review_audit_trail,
      manual_review_summary:       reviewGovernance.manual_review_summary,
      can_beta:                    false,
      can_sell:                    false,
      real_users:                  false,
      real_delivery:               false,
    })

    const exportContractResult = evaluateExportContract({
      evidence_export_packet:      evidenceExport.evidence_export_packet,
      operator_report_render:      evidenceExport.operator_report_render,
      operator_report_summary:     evidenceExport.operator_report_summary,
      decision_fingerprint:        evidenceExport.decision_fingerprint,
      export_validation_summary:   evidenceExport.export_validation_summary,
      governance_regression_suite: evidenceExport.governance_regression_suite,
      manual_review_artifact:      reviewGovernance.manual_review_artifact,
      approval_simulation:         reviewGovernance.approval_simulation,
      no_launch_governance:        reviewGovernance.no_launch_governance,
      release_hard_locks:          reviewGovernance.release_hard_locks,
      manual_review_summary:       reviewGovernance.manual_review_summary,
      operator_decision_packet:    decisionPacket.operator_decision_packet,
      launch_governance:           decisionPacket.launch_governance,
      launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
      can_beta:                    false,
      can_sell:                    false,
    })
    const snapshotSimResult = evaluateSnapshotSimulation({
      decision_fingerprint:        evidenceExport.decision_fingerprint,
      launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
      manual_review_artifact:      reviewGovernance.manual_review_artifact,
      no_launch_governance:        reviewGovernance.no_launch_governance,
      can_beta:                    false,
      can_sell:                    false,
    })
    const regressionLockdownResult = evaluateRegressionLockdown({
      download_enabled:            false,
      download_publicly_available: false,
      can_beta:                    false,
      can_sell:                    false,
      release_allowed:             false,
      export_allows_beta:          false,
      export_allows_sell:          false,
      commercial_claims_allowed:   false,
      real_users:                  false,
      real_delivery:               false,
      commercial_claims_guard:     exportContractResult.commercial_claims_guard,
      historical_snapshot_simulation: snapshotSimResult.historical_snapshot_simulation,
      no_launch_governance:        reviewGovernance.no_launch_governance,
      governance_regression_suite: evidenceExport.governance_regression_suite,
    })
    const adminExportPreviewResult = evaluateAdminExportPreview({
      admin_key_present:           true,
      admin_key_valid:             true,
      operator_report_render:      evidenceExport.operator_report_render,
      decision_fingerprint:        evidenceExport.decision_fingerprint,
      launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
      manual_review_artifact:      reviewGovernance.manual_review_artifact,
      no_launch_governance:        reviewGovernance.no_launch_governance,
      commercial_claims_guard:     exportContractResult.commercial_claims_guard,
      operator_report_download_contract: exportContractResult.operator_report_download_contract,
      regression_lockdown:         regressionLockdownResult.regression_lockdown,
      can_beta:                    false,
      can_sell:                    false,
    })
    const sbcRedactionResult = evaluateReportRedaction({
      operator_report_render:  evidenceExport.operator_report_render,
      internal_report_preview: adminExportPreviewResult.internal_report_preview,
    })
    const sbcAbuseResult = evaluateExportAbuseProtection({
      redacted_operator_report: sbcRedactionResult.redacted_operator_report,
      commercial_claims_guard:  exportContractResult.commercial_claims_guard,
      regression_lockdown:      regressionLockdownResult.regression_lockdown,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
    })
    const sbcUxResult = evaluateAdminPreviewUx({
      admin_export_access_control:   adminExportPreviewResult.admin_export_access_control,
      internal_download_preflight:   sbcAbuseResult.internal_download_preflight,
      report_redaction_policy:       sbcRedactionResult.report_redaction_policy,
      export_abuse_protection:       sbcAbuseResult.export_abuse_protection,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
      launch_no_launch_decision:     decisionPacket.launch_no_launch_decision,
      manual_review_artifact:        reviewGovernance.manual_review_artifact,
      export_integrity_contract:     exportContractResult.export_integrity_contract,
      regression_lockdown:           regressionLockdownResult.regression_lockdown,
      commercial_claims_guard:       exportContractResult.commercial_claims_guard,
    })
    const sbcRendererResult = evaluateInternalExportRenderer({
      operator_report_render:        evidenceExport.operator_report_render,
      decision_fingerprint:          evidenceExport.decision_fingerprint,
      launch_no_launch_decision:     decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:      decisionPacket.decision_evidence_matrix,
      manual_review_artifact:        reviewGovernance.manual_review_artifact,
      no_launch_governance:          reviewGovernance.no_launch_governance,
      regression_lockdown:           regressionLockdownResult.regression_lockdown,
      commercial_claims_guard:       exportContractResult.commercial_claims_guard,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
      operator_next_actions:         decisionPacket.operator_next_actions,
      evidence_export_packet:        evidenceExport.evidence_export_packet,
    })
    const sbcDryRunResult = evaluateAdminDownloadDryRun({
      format:               'json',
      _rendered_content:    sbcRendererResult._rendered_content,
      decision_fingerprint: evidenceExport.decision_fingerprint,
    })
    const sbcRegressionLockResult = evaluateRedactionRegressionLock({
      rendered_export_formats: sbcRendererResult._rendered_content,
      report_redaction_policy: sbcRedactionResult.report_redaction_policy,
    })
    const sbcArchiveResult = evaluateAdminExportArchive({
      internal_export_renderer:      sbcRendererResult.internal_export_renderer,
      rendered_export_formats:       sbcRendererResult.rendered_export_formats,
      export_format_validation:      sbcRendererResult.export_format_validation,
      format_render_summary:         sbcRendererResult.format_render_summary,
      download_response_contract:    sbcDryRunResult.download_response_contract,
      admin_download_dry_run:        sbcDryRunResult.admin_download_dry_run,
      redaction_regression_lock:     sbcRegressionLockResult.redaction_regression_lock,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
      decision_fingerprint:          evidenceExport.decision_fingerprint,
    })
    const sbcHistoryResult = evaluateReportHistorySimulation({
      decision_fingerprint:        evidenceExport.decision_fingerprint,
      launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
    })
    const sbcAccessAuditResult = evaluateAdminAccessAudit({
      authorized:            true,
      admin_key_present:     true,
      admin_key_valid:       true,
      sb_master_key_present: true,
      selected_format:       'json',
      selected_mode:         'compact',
    })
    const sbcStorageResult = evaluateInternalExportStorage({
      redaction_regression_lock:     sbcRegressionLockResult.redaction_regression_lock,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
      export_format_validation:      sbcRendererResult.export_format_validation,
      internal_export_renderer:      sbcRendererResult.internal_export_renderer,
      commercial_claims_guard:       exportContractResult.commercial_claims_guard,
    })
    const sbcReplayResult = evaluateAdminAccessReplay({})
    const sbcFreezeResult = evaluateReleaseFreezeSentinel({
      regression_lockdown:       regressionLockdownResult.regression_lockdown,
      redaction_regression_lock: sbcRegressionLockResult.redaction_regression_lock,
    })
    const sbcBaselineResult = evaluateReleaseFreezeBaseline({
      release_freeze_policy:         sbcFreezeResult.release_freeze_policy,
      freeze_baseline:               sbcFreezeResult.freeze_baseline,
      freeze_diff_report:            sbcFreezeResult.freeze_diff_report,
      release_freeze_sentinel:       sbcFreezeResult.release_freeze_sentinel,
      freeze_enforcement_summary:    sbcFreezeResult.freeze_enforcement_summary,
      internal_export_storage_contract: sbcStorageResult.internal_export_storage_contract,
      storage_write_simulation:      sbcStorageResult.storage_write_simulation,
      admin_access_replay_simulation: sbcReplayResult.admin_access_replay_simulation,
      admin_access_pattern_review:   sbcReplayResult.admin_access_pattern_review,
      redaction_regression_lock:     sbcRegressionLockResult.redaction_regression_lock,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
    })
    const sbcInvariantResult = evaluateSafetyInvariantSnapshot({})
    const sbcUnfreezeResult = evaluateControlledUnfreezeDesign({
      release_freeze_sentinel:       sbcFreezeResult.release_freeze_sentinel,
      redaction_regression_lock:     sbcRegressionLockResult.redaction_regression_lock,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
      admin_access_audit:            sbcAccessAuditResult.admin_access_audit,
      regression_lockdown:           regressionLockdownResult.regression_lockdown,
    })
    const sbcMatrixResult = evaluateCapabilityUnlockMatrix({
      release_freeze_sentinel:       sbcFreezeResult.release_freeze_sentinel,
      freeze_enforcement_summary:    sbcFreezeResult.freeze_enforcement_summary,
      controlled_unfreeze_design:    sbcUnfreezeResult.controlled_unfreeze_design,
      unfreeze_preconditions_matrix: sbcUnfreezeResult.unfreeze_preconditions_matrix,
      immutable_no_sell_enforcement: adminExportPreviewResult.immutable_no_sell_enforcement,
    })
    const sbcSimulationResult = evaluateControlledUnfreezeSimulation({
      capability_unlock_matrix:      sbcMatrixResult.capability_unlock_matrix,
      capability_risk_profile:       sbcMatrixResult.capability_risk_profile,
      controlled_unfreeze_design:    sbcUnfreezeResult.controlled_unfreeze_design,
      release_freeze_sentinel:       sbcFreezeResult.release_freeze_sentinel,
    })
    const sbcGateResult = evaluatePreBetaGovernanceGate({
      release_freeze_baseline_registry: sbcBaselineResult.release_freeze_baseline_registry,
      baseline_comparison_report:       sbcBaselineResult.baseline_comparison_report,
      safety_invariant_snapshot:        sbcInvariantResult.safety_invariant_snapshot,
      safety_invariant_validation:      sbcInvariantResult.safety_invariant_validation,
      controlled_unfreeze_design:       sbcUnfreezeResult.controlled_unfreeze_design,
      capability_unlock_matrix:         sbcMatrixResult.capability_unlock_matrix,
      controlled_unfreeze_simulation:   sbcSimulationResult.controlled_unfreeze_simulation,
      immutable_no_sell_enforcement:    adminExportPreviewResult.immutable_no_sell_enforcement,
    })
    const sbcCouncilResult = evaluatePreBetaReadinessCouncil({
      pre_beta_governance_gate:         sbcGateResult.pre_beta_governance_gate,
      pre_beta_blocker_matrix:          sbcGateResult.pre_beta_blocker_matrix,
      pre_beta_operator_review:         sbcGateResult.pre_beta_operator_review,
      final_pre_beta_summary:           sbcGateResult.final_pre_beta_summary,
      capability_unlock_matrix:         sbcMatrixResult.capability_unlock_matrix,
      controlled_unfreeze_simulation:   sbcSimulationResult.controlled_unfreeze_simulation,
      release_freeze_sentinel:          sbcFreezeResult.release_freeze_sentinel,
      release_freeze_baseline_registry: sbcBaselineResult.release_freeze_baseline_registry,
      safety_invariant_snapshot:        sbcInvariantResult.safety_invariant_snapshot,
      can_beta:                         false,
      can_sell:                         false,
    })
    const sbcSignoffResult = evaluateOperatorSignoffSimulation({}, {
      OPERATOR_SIGNOFF_SIMULATION_ENABLED: false,
      SIGNOFF_NO_OVERRIDE_LOCK:            true,
    })
    const sbcNonDeliveryResult = evaluatePrivateBetaNonDelivery({
      can_beta: false,
      can_sell: false,
    })
    const sbcCohortResult = evaluateNonUserCohortContract({})
    const sbcInvitationResult = evaluatePrivateBetaInvitationSimulation({
      real_invites_created: false,
      users_created:        false,
    })
    const sbcKillSwitchResult = evaluateDeliveryKillSwitch({
      real_delivery: false,
    })
    const sbcCohortReviewResult = evaluateSyntheticCohortReview({
      non_user_cohort_contract:           sbcCohortResult.non_user_cohort_contract,
      non_user_cohort_members:            sbcCohortResult.non_user_cohort_members,
      non_user_cohort_audit:              sbcCohortResult.non_user_cohort_audit,
      non_user_cohort_summary:            sbcCohortResult.non_user_cohort_summary,
      private_beta_invitation_simulation: sbcInvitationResult.private_beta_invitation_simulation,
      simulated_invitation_ledger:        sbcInvitationResult.simulated_invitation_ledger,
      can_beta: false, can_sell: false, real_users: false, real_delivery: false,
    })
    const sbcDryInviteResult = evaluatePrivateBetaDryInviteReport({
      non_user_cohort_contract:           sbcCohortResult.non_user_cohort_contract,
      non_user_cohort_members:            sbcCohortResult.non_user_cohort_members,
      synthetic_cohort_review:            sbcCohortReviewResult.synthetic_cohort_review,
      synthetic_member_safety_matrix:     sbcCohortReviewResult.synthetic_member_safety_matrix,
      private_beta_invitation_simulation: sbcInvitationResult.private_beta_invitation_simulation,
      simulated_invitation_ledger:        sbcInvitationResult.simulated_invitation_ledger,
      invitation_channel_policy:          sbcInvitationResult.invitation_channel_policy,
      delivery_kill_switch:               sbcKillSwitchResult.delivery_kill_switch,
      channel_kill_switch_matrix:         sbcKillSwitchResult.channel_kill_switch_matrix,
      private_beta_non_delivery_contract: sbcNonDeliveryResult.private_beta_non_delivery_contract,
      non_delivery_enforcement:           sbcNonDeliveryResult.non_delivery_enforcement,
      pre_beta_readiness_council:         sbcCouncilResult.pre_beta_readiness_council,
      operator_signoff_simulation:        sbcSignoffResult.operator_signoff_simulation,
      can_beta: false, can_sell: false,
    })
    const sbcDrillResult = evaluateDeliveryIncidentDrill({
      delivery_kill_switch:               sbcKillSwitchResult.delivery_kill_switch,
      channel_kill_switch_matrix:         sbcKillSwitchResult.channel_kill_switch_matrix,
      delivery_kill_switch_audit:         sbcKillSwitchResult.delivery_kill_switch_audit,
      private_beta_invitation_simulation: sbcInvitationResult.private_beta_invitation_simulation,
      simulated_invitation_ledger:        sbcInvitationResult.simulated_invitation_ledger,
      invitation_channel_policy:          sbcInvitationResult.invitation_channel_policy,
      non_delivery_enforcement:           sbcNonDeliveryResult.non_delivery_enforcement,
      can_beta: false, can_sell: false, real_delivery: false,
      email_delivery_enabled: false, webhook_enabled: false,
    })
    const sbcLedgerResult = evaluateBetaSafetyIncidentLedger({
      delivery_kill_switch:               sbcKillSwitchResult.delivery_kill_switch,
      channel_kill_switch_matrix:         sbcKillSwitchResult.channel_kill_switch_matrix,
      private_beta_invitation_simulation: sbcInvitationResult.private_beta_invitation_simulation,
      simulated_invitation_ledger:        sbcInvitationResult.simulated_invitation_ledger,
      delivery_incident_scenarios:        sbcDrillResult.delivery_incident_scenarios,
      delivery_incident_drill:            sbcDrillResult.delivery_incident_drill,
      incident_real_action_taken:         false,
      real_actions_taken:                 false,
    })
    const sbcRecoveryResult = evaluateIncidentRecoverySimulation({
      beta_safety_incident_ledger:        sbcLedgerResult.beta_safety_incident_ledger,
      simulated_incident_records:         sbcLedgerResult.simulated_incident_records,
      incident_severity_matrix:           sbcLedgerResult.incident_severity_matrix,
      delivery_kill_switch:               sbcKillSwitchResult.delivery_kill_switch,
      channel_kill_switch_matrix:         sbcKillSwitchResult.channel_kill_switch_matrix,
      recovery_real_action_taken:         false,
      operator_notified_externally:       false,
    })
    const sbcEscalationResult = evaluateOperatorEscalationProtocol({
      incident_recovery_simulation:       sbcRecoveryResult.incident_recovery_simulation,
      recovery_action_plan:               sbcRecoveryResult.recovery_action_plan,
      recovery_verification_checklist:    sbcRecoveryResult.recovery_verification_checklist,
      beta_safety_incident_ledger:        sbcLedgerResult.beta_safety_incident_ledger,
      incident_severity_matrix:           sbcLedgerResult.incident_severity_matrix,
      external_escalation_sent:           false,
      operator_notified_externally:       false,
    })
    const sbcClosureResult = evaluateP38GovernanceClosure({
      delivery_kill_switch:               sbcKillSwitchResult.delivery_kill_switch,
      private_beta_non_delivery_contract: sbcNonDeliveryResult.private_beta_non_delivery_contract,
      beta_safety_incident_ledger:        sbcLedgerResult.beta_safety_incident_ledger,
      incident_recovery_simulation:       sbcRecoveryResult.incident_recovery_simulation,
      operator_escalation_protocol:       sbcEscalationResult.operator_escalation_protocol,
      pre_beta_governance_gate:           sbcGateResult.pre_beta_governance_gate,
      can_beta:                           false,
      can_sell:                           false,
    })
    const sbcFinalizationResult = evaluateP38SafetyFinalization({
      delivery_kill_switch:               sbcKillSwitchResult.delivery_kill_switch,
      release_freeze_sentinel:            sbcFreezeResult.release_freeze_sentinel,
      immutable_no_sell_enforcement:      adminExportPreviewResult.immutable_no_sell_enforcement,
      can_beta:                           false,
      can_sell:                           false,
      delivery_allowed:                   false,
      real_delivery:                      false,
      operator_notified_externally:       false,
    })
    const sbcTransitionResult = evaluateP39TransitionPlan({
      resolved_valid:                     awResolved,
      auto_activate_micro_test:           false,
      can_beta:                           false,
      can_sell:                           false,
    })
    const sbcSampleAuditResult = evaluateResolvedSampleAudit({
      training_eligible_total:            aw.training_eligible_total ?? 0,
      resolved_valid:                     awResolved,
      green_count:                        aw.green_count ?? 0,
      red_count:                          aw.red_count ?? 0,
      pending_training_eligible:          aw.pending_training_eligible ?? 0,
      unknown_result_count:               0,
      by_trust_level:                     Object.entries(byTrustLevel).map(([key, count]) => ({ key, count, green: 0, red: 0 })),
    })
    const sbcActivationResult = evaluateMicroTestActivationReadiness({
      resolved_sample_audit:              sbcSampleAuditResult.resolved_sample_audit,
      resolved_valid:                     awResolved,
      micro_test_enabled:                 microTestEnabled,
      micro_test_active:                  microTestActive,
      micro_test_status:                  microTestStatus,
      can_micro_test:                     canMicroTest,
      auto_activate_micro_test:           false,
      can_beta:                           false,
      can_sell:                           false,
    })
    const sbcKickoffResult = evaluateQualityProofKickoff({
      resolved_sample_audit:              sbcSampleAuditResult.resolved_sample_audit,
      resolved_sample_distribution:       sbcSampleAuditResult.resolved_sample_distribution,
      micro_test_activation_readiness:    sbcActivationResult.micro_test_activation_readiness,
      micro_test_report:                  microTestReport,
      micro_test_policy:                  microTestPolicy,
      can_beta:                           false,
      can_sell:                           false,
    })
    const sbcGuardResult = evaluateMicroTestManualActivationGuard({
      resolved_sample_audit:                    sbcSampleAuditResult.resolved_sample_audit,
      micro_test_activation_readiness:          sbcActivationResult.micro_test_activation_readiness,
      activation_prerequisites:                 sbcActivationResult.activation_prerequisites,
      micro_test_manual_activation_checklist:   sbcActivationResult.micro_test_manual_activation_checklist,
      resolved_valid:                           awResolved,
      micro_test_threshold:                     30,
      micro_test_enabled:                       microTestEnabled,
      micro_test_active:                        microTestActive,
      micro_test_status:                        microTestStatus,
      can_micro_test:                           canMicroTest,
      can_beta:                                 false,
      can_sell:                                 false,
    })
    const sbcMonitorResult = evaluatePostActivationMonitor({
      micro_test_env_state:               sbcGuardResult.micro_test_env_state,
      micro_test_manual_activation_guard: sbcGuardResult.micro_test_manual_activation_guard,
      micro_test_report:                  microTestReport,
      micro_test_policy:                  microTestPolicy,
      resolved_sample_audit:              sbcSampleAuditResult.resolved_sample_audit,
      resolved_quality_seed_report:       sbcKickoffResult.resolved_quality_seed_report,
      quality_proof_kickoff:              sbcKickoffResult.quality_proof_kickoff,
      resolved_valid:                     awResolved,
      micro_test_active:                  microTestActive,
      can_beta:                           false,
      can_sell:                           false,
    })
    const sbcSnapshotResult = evaluateFirstRealQualitySnapshot({
      resolved_sample_audit:              sbcSampleAuditResult.resolved_sample_audit,
      resolved_sample_distribution:       sbcSampleAuditResult.resolved_sample_distribution,
      resolved_quality_seed_report:       sbcKickoffResult.resolved_quality_seed_report,
      micro_test_report:                  microTestReport,
      micro_test_policy:                  microTestPolicy,
      segment_health_matrix:              segmentHealth.segment_health_matrix,
      candidate_segments:                 segmentHealth.candidate_segments,
      risk_segments:                      segmentHealth.risk_segments,
      post_activation_monitor:            sbcMonitorResult.post_activation_monitor,
      micro_test_active:                  microTestActive,
      can_beta:                           false,
      can_sell:                           false,
    })
    const sbcP39ActivationSummary = {
      status:              sbcGuardResult.micro_test_manual_activation_guard.status,
      headline:            sbcGuardResult.micro_test_manual_activation_guard.status === 'active_monitoring'
        ? 'Micro-test ativo e monitorado.'
        : sbcGuardResult.micro_test_manual_activation_guard.activation_allowed_now
        ? 'Pronto para ativação manual do micro-test.'
        : 'Micro-test ainda não deve ser ativado.',
      summary_text:        'A ativação continua manual e controlada pelo operador.',
      operator_instruction: sbcGuardResult.micro_test_manual_activation_guard.activation_allowed_now
        ? 'Pode setar MICRO_TEST_ENABLED=true agora.'
        : 'Não alterar MICRO_TEST_ENABLED até activation_allowed_now=true.',
      activation_allowed_now: sbcGuardResult.micro_test_manual_activation_guard.activation_allowed_now,
      micro_test_active:   sbcMonitorResult.post_activation_monitor.micro_test_active,
      has_quality_snapshot: sbcMonitorResult.post_activation_monitor.has_first_quality_snapshot,
      can_beta:            false,
      can_sell:            false,
      next_action:         sbcGuardResult.micro_test_manual_activation_guard.status === 'waiting_for_threshold'
        ? 'Continuar acumulando resultados green/red.'
        : sbcGuardResult.micro_test_manual_activation_guard.status === 'ready_for_manual_activation'
        ? 'Setar MICRO_TEST_ENABLED=true para ativar.'
        : 'Monitorar qualidade e resultados do micro-test.',
    }

    const resolvedRows = resolvedRowsResult?.results ?? []
    // P3.9.2 — segment quality proof first (builds segments from raw rows)
    const sbcQualityProofResult = evaluateSegmentQualityProof({
      rows:                        resolvedRows,
      resolved_sample_audit:       sbcSampleAuditResult.resolved_sample_audit,
      resolved_sample_distribution: sbcSampleAuditResult.resolved_sample_distribution,
      first_real_quality_snapshot: sbcSnapshotResult.first_real_quality_snapshot,
      quality_snapshot_distribution: sbcSnapshotResult.quality_snapshot_distribution,
      can_beta:                    false,
      can_sell:                    false,
    })
    // P3.9.2 — break-even review using distribution data (odds per segment if available)
    const sbcBreakEvenResult = evaluateBreakEvenOddsReview({
      resolved_sample_distribution: sbcSampleAuditResult.resolved_sample_distribution,
      can_beta:                    false,
      can_sell:                    false,
    })
    // P3.9.2 — exclusion recommendations from break-even matrix
    const sbcExclusionResult = evaluateSegmentExclusionRecommendations({
      segment_break_even_matrix:   sbcBreakEvenResult.segment_break_even_matrix,
      segment_quality_proof:       sbcQualityProofResult.segment_quality_proof,
      first_real_quality_snapshot: sbcSnapshotResult.first_real_quality_snapshot,
      can_beta:                    false,
      can_sell:                    false,
    })
    // P3.9.3 — dry-run simulation using resolved rows + exclusion recommendations
    const sbcDryRunP393Result = evaluateSegmentExclusionDryRun({
      segment_exclusion_recommendations: sbcExclusionResult.segment_exclusion_recommendations,
      segment_watchlist:                 sbcExclusionResult.segment_watchlist,
      segment_break_even_matrix:         sbcBreakEvenResult.segment_break_even_matrix,
      resolved_rows:                     resolvedRows,
      resolved_sample_audit:             sbcSampleAuditResult.resolved_sample_audit,
      first_real_quality_snapshot:       sbcSnapshotResult.first_real_quality_snapshot,
      can_beta:                          false,
      can_sell:                          false,
    })
    // P3.9.3 — reweight proposal from segment quality rankings
    const sbcReweightResult = evaluateQualityReweightProposal({
      segment_quality_rankings:          sbcQualityProofResult.segment_quality_rankings,
      segment_break_even_matrix:         sbcBreakEvenResult.segment_break_even_matrix,
      segment_exclusion_recommendations: sbcExclusionResult.segment_exclusion_recommendations,
      segment_watchlist:                 sbcExclusionResult.segment_watchlist,
      confidence_calibration_review:     sbcQualityProofResult.confidence_calibration_review,
      can_beta:                          false,
      can_sell:                          false,
    })
    // P3.9.3 — shadow recommendation policy enforcing all invariants
    const sbcShadowPolicyResult = evaluateShadowRecommendationPolicy({
      segment_exclusion_dry_run:       sbcDryRunP393Result.segment_exclusion_dry_run,
      quality_reweight_proposal:       sbcReweightResult.quality_reweight_proposal,
      segment_recommendation_policy:   sbcExclusionResult.segment_recommendation_policy,
      segment_exclusion_summary:       sbcExclusionResult.segment_exclusion_summary,
      can_beta:                        false,
      can_sell:                        false,
    })
    // P3.9.4 — shadow reweight backtest: simulate ranking delta using resolved rows + proposed weights
    const sbcBacktestResult = evaluateShadowReweightBacktest({
      resolved_rows:                   resolvedRows,
      proposed_weight_changes:         sbcReweightResult.proposed_weight_changes,
      quality_reweight_proposal:       sbcReweightResult.quality_reweight_proposal,
      quality_reweight_impact_simulation: sbcReweightResult.quality_reweight_impact_simulation,
      segment_quality_rankings:        sbcQualityProofResult.segment_quality_rankings,
      segment_break_even_matrix:       sbcBreakEvenResult.segment_break_even_matrix,
      shadow_recommendation_policy:    sbcShadowPolicyResult.shadow_recommendation_policy,
      shadow_policy_enforcement:       sbcShadowPolicyResult.shadow_policy_enforcement,
      can_beta:                        false,
      can_sell:                        false,
    })
    // P3.9.4 — recommendation stability check using synthetic baseline
    const sbcStabilityResult = evaluateRecommendationStabilityCheck({
      segment_exclusion_recommendations: sbcExclusionResult.segment_exclusion_recommendations,
      segment_watchlist:                 sbcExclusionResult.segment_watchlist,
      quality_reweight_proposal:         sbcReweightResult.quality_reweight_proposal,
      proposed_weight_changes:           sbcReweightResult.proposed_weight_changes,
      segment_quality_proof:             sbcQualityProofResult.segment_quality_proof,
      break_even_odds_review:            sbcBreakEvenResult.break_even_odds_review,
      can_beta:                          false,
      can_sell:                          false,
    })
    // P3.9.4 — quality proof decision gate consolidating all evidence
    const sbcGateP394Result = evaluateQualityProofDecisionGate({
      resolved_sample_audit:             sbcSampleAuditResult.resolved_sample_audit,
      first_real_quality_snapshot:       sbcSnapshotResult.first_real_quality_snapshot,
      quality_snapshot_risk_flags:       sbcSnapshotResult.quality_snapshot_risk_flags,
      segment_quality_proof:             sbcQualityProofResult.segment_quality_proof,
      break_even_odds_review:            sbcBreakEvenResult.break_even_odds_review,
      segment_exclusion_recommendations: sbcExclusionResult.segment_exclusion_recommendations,
      segment_exclusion_dry_run:         sbcDryRunP393Result.segment_exclusion_dry_run,
      quality_reweight_proposal:         sbcReweightResult.quality_reweight_proposal,
      shadow_reweight_backtest:          sbcBacktestResult.shadow_reweight_backtest,
      recommendation_stability_check:    sbcStabilityResult.recommendation_stability_check,
      shadow_policy_enforcement:         sbcShadowPolicyResult.shadow_policy_enforcement,
      can_beta:                          false,
      can_sell:                          false,
    })
    // P3.9.5 — Quality Proof Trend Monitor
    const sbcTrendResult = evaluateQualityProofTrendMonitor({
      quality_proof_decision_gate:    sbcGateP394Result.quality_proof_decision_gate,
      quality_proof_gate_evidence:    sbcGateP394Result.quality_proof_gate_evidence,
      p39_quality_decision_summary:   sbcGateP394Result.p39_quality_decision_summary,
      first_real_quality_snapshot:    sbcSnapshotResult.first_real_quality_snapshot,
      quality_snapshot_risk_flags:    sbcSnapshotResult.quality_snapshot_risk_flags,
      segment_quality_proof:          sbcQualityProofResult.segment_quality_proof,
      break_even_odds_review:         sbcBreakEvenResult.break_even_odds_review,
      recommendation_stability_check: sbcStabilityResult.recommendation_stability_check,
      shadow_reweight_backtest:       sbcBacktestResult.shadow_reweight_backtest,
      can_beta:                       false,
      can_sell:                       false,
    })
    // P3.9.5 — Segment Decision History
    const sbcSegHistResult = evaluateSegmentDecisionHistory({
      segment_exclusion_recommendations: sbcExclusionResult.segment_exclusion_recommendations,
      segment_watchlist:                 sbcExclusionResult.segment_watchlist,
      recommendation_stability_matrix:   sbcStabilityResult.recommendation_stability_matrix,
      recommendation_stability_check:    sbcStabilityResult.recommendation_stability_check,
      segment_quality_rankings:          sbcQualityProofResult.segment_quality_rankings,
      quality_reweight_proposal:         sbcReweightResult.quality_reweight_proposal,
      proposed_weight_changes:           sbcReweightResult.proposed_weight_changes,
      can_beta:                          false,
      can_sell:                          false,
    })
    // P3.9.5 — Beta Simulation Readiness
    const sbcBetaSimResult = evaluateBetaSimulationReadiness({
      quality_proof_trend_monitor:         sbcTrendResult.quality_proof_trend_monitor,
      quality_gate_trend_report:           sbcTrendResult.quality_gate_trend_report,
      segment_decision_history_simulation: sbcSegHistResult.segment_decision_history_simulation,
      recommendation_stability_check:      sbcStabilityResult.recommendation_stability_check,
      quality_proof_decision_gate:         sbcGateP394Result.quality_proof_decision_gate,
      shadow_policy_enforcement:           sbcShadowPolicyResult.shadow_policy_enforcement,
      micro_test_activation_readiness:     sbcActivationResult.micro_test_activation_readiness,
      post_activation_monitor:             sbcMonitorResult.post_activation_monitor,
      first_real_quality_snapshot:         sbcSnapshotResult.first_real_quality_snapshot,
      can_beta:                            false,
      can_sell:                            false,
    })
    // P3.9.6 — Beta Simulation Cohort Plan
    const sbcP396CohortResult = evaluateBetaSimulationCohortPlan({
      beta_simulation_readiness_review: sbcBetaSimResult.beta_simulation_readiness_review,
      beta_simulation_blocker_matrix:   sbcBetaSimResult.beta_simulation_blocker_matrix,
      p39_beta_simulation_summary:      sbcBetaSimResult.p39_beta_simulation_summary,
      can_beta:                         false,
      can_sell:                         false,
    })
    // P3.9.6 — Synthetic Delivery UX Contract
    const sbcP396UxContractResult = evaluateSyntheticDeliveryUxContract({
      beta_simulation_cohort_plan:   sbcP396CohortResult.beta_simulation_cohort_plan,
      synthetic_beta_cohort_members: sbcP396CohortResult.synthetic_beta_cohort_members,
      can_beta:                      false,
      can_sell:                      false,
    })
    // P3.9.6 — Quality Proof Review Board
    const sbcP396ReviewBoardResult = evaluateQualityProofReviewBoard({
      quality_proof_decision_gate:         sbcGateP394Result.quality_proof_decision_gate,
      quality_proof_trend_monitor:         sbcTrendResult.quality_proof_trend_monitor,
      quality_gate_trend_report:           sbcTrendResult.quality_gate_trend_report,
      segment_decision_history_simulation: sbcSegHistResult.segment_decision_history_simulation,
      beta_simulation_readiness_review:    sbcBetaSimResult.beta_simulation_readiness_review,
      beta_simulation_cohort_plan:         sbcP396CohortResult.beta_simulation_cohort_plan,
      synthetic_delivery_ux_contract:      sbcP396UxContractResult.synthetic_delivery_ux_contract,
      shadow_policy_enforcement:           sbcShadowPolicyResult.shadow_policy_enforcement,
      p39_quality_decision_summary:        sbcGateP394Result.p39_quality_decision_summary,
      p39_beta_simulation_summary:         sbcBetaSimResult.p39_beta_simulation_summary,
      can_beta:                            false,
      can_sell:                            false,
    })
    // P3.9.7 — Internal Pick Card Contract
    const sbcP397PickCardResult = evaluateInternalPickCardContract({
      synthetic_delivery_ux_contract: sbcP396UxContractResult.synthetic_delivery_ux_contract,
      beta_simulation_cohort_plan:    sbcP396CohortResult.beta_simulation_cohort_plan,
      quality_proof_review_board:     sbcP396ReviewBoardResult.quality_proof_review_board,
      can_beta:                       false,
      can_sell:                       false,
    })
    // P3.9.7 — Synthetic Beta Experience Preview
    const sbcP397ExperienceResult = evaluateSyntheticBetaExperiencePreview({
      internal_pick_card_contract:   sbcP397PickCardResult.internal_pick_card_contract,
      pick_card_safety_validation:   sbcP397PickCardResult.pick_card_safety_validation,
      synthetic_beta_cohort_members: sbcP396CohortResult.synthetic_beta_cohort_members,
      can_beta:                      false,
      can_sell:                      false,
    })
    // P3.9.7 — Synthetic Feedback Loop
    const sbcP397FeedbackResult = evaluateSyntheticFeedbackLoop({
      synthetic_beta_experience_preview: sbcP397ExperienceResult.synthetic_beta_experience_preview,
      synthetic_pick_card_examples:      sbcP397ExperienceResult.synthetic_pick_card_examples,
      pick_card_safety_validation:       sbcP397PickCardResult.pick_card_safety_validation,
      quality_proof_review_board:        sbcP396ReviewBoardResult.quality_proof_review_board,
      can_beta:                          false,
      can_sell:                          false,
    })

    return new Response(JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      table_exists: true,
      total_rows:               totalRows,
      rows_last_24h:            summary?.rows_last_24h ?? 0,
      latest_created_at:        summary?.latest_created_at ?? null,
      by_training_eligible:     byTraining,
      by_result_status:         byResult,
      by_confidence_tier:       byTier,
      by_audit_status:          byAudit,
      confidence_annotation_health: confidenceAnnotationHealth,
      audit_annotation_health:  auditAnnotationHealth,
      accumulation_window:      accumulationWindow,
      micro_test_report:        microTestReport,
      micro_test_policy:        microTestPolicy,
      micro_test_guardrails:    microTestPolicy.guardrails,
      micro_test_risks:         microTestPolicy.risks,
      micro_test_decision_summary: microTestPolicy.summary,
      segment_health_matrix:        segmentHealth.segment_health_matrix,
      candidate_segments:           segmentHealth.candidate_segments,
      risk_segments:                segmentHealth.risk_segments,
      controlled_expansion_review:  segmentHealth.controlled_expansion_review,
      beta_hold_review:             segmentHealth.beta_hold_review,
      beta_admission_contract:      betaAdmission.beta_admission_contract,
      manual_approval_gate:         betaAdmission.manual_approval_gate,
      private_cohort_simulation:    betaAdmission.private_cohort_simulation,
      beta_admission_review:        betaAdmission.beta_admission_review,
      beta_admission_summary:       betaAdmission.beta_admission_summary,
      private_beta_sandbox:         sandbox.private_beta_sandbox,
      sandbox_delivery_policy:      sandbox.sandbox_delivery_policy,
      sandbox_risk_controls:        sandbox.sandbox_risk_controls,
      sandbox_allowed_segments:     sandbox.sandbox_allowed_segments,
      sandbox_blocked_segments:     sandbox.sandbox_blocked_segments,
      simulated_delivery_ledger:    sandbox.simulated_delivery_ledger,
      sandbox_audit_summary:        sandbox.sandbox_audit_summary,
      operator_review_console:      sandbox.operator_review_console,
      simulated_cohort_monitor:    cohortMonitor.simulated_cohort_monitor,
      ledger_health:               cohortMonitor.ledger_health,
      ledger_exposure:             cohortMonitor.ledger_exposure,
      delivery_drift_report:       cohortMonitor.delivery_drift_report,
      sandbox_performance_summary: cohortMonitor.sandbox_performance_summary,
      operator_approval_checklist: cohortMonitor.operator_approval_checklist,
      cohort_monitoring_review:    cohortMonitor.cohort_monitoring_review,
      operator_decision_packet:    decisionPacket.operator_decision_packet,
      beta_dry_run_report:         decisionPacket.beta_dry_run_report,
      launch_governance:           decisionPacket.launch_governance,
      launch_no_launch_decision:   decisionPacket.launch_no_launch_decision,
      decision_evidence_matrix:    decisionPacket.decision_evidence_matrix,
      operator_next_actions:       decisionPacket.operator_next_actions,
      governance_audit_summary:    decisionPacket.governance_audit_summary,
      manual_review_artifact:      reviewGovernance.manual_review_artifact,
      approval_simulation:         reviewGovernance.approval_simulation,
      no_launch_governance:        reviewGovernance.no_launch_governance,
      release_hard_locks:          reviewGovernance.release_hard_locks,
      operator_review_audit_trail: reviewGovernance.operator_review_audit_trail,
      manual_review_summary:       reviewGovernance.manual_review_summary,
      evidence_export_packet:      evidenceExport.evidence_export_packet,
      operator_report_render:      evidenceExport.operator_report_render,
      operator_report_summary:     evidenceExport.operator_report_summary,
      decision_fingerprint:        evidenceExport.decision_fingerprint,
      export_validation_summary:   evidenceExport.export_validation_summary,
      governance_regression_suite:          evidenceExport.governance_regression_suite,
      operator_report_download_contract:    exportContractResult.operator_report_download_contract,
      safe_export_manifest:                 exportContractResult.safe_export_manifest,
      commercial_claims_guard:              exportContractResult.commercial_claims_guard,
      export_integrity_contract:            exportContractResult.export_integrity_contract,
      download_readiness_summary:           exportContractResult.download_readiness_summary,
      historical_snapshot_simulation:       snapshotSimResult.historical_snapshot_simulation,
      snapshot_diff_report:                 snapshotSimResult.snapshot_diff_report,
      regression_lockdown:                  regressionLockdownResult.regression_lockdown,
      admin_export_access_control:          adminExportPreviewResult.admin_export_access_control,
      protected_export_route_contract:      adminExportPreviewResult.protected_export_route_contract,
      internal_report_preview:              adminExportPreviewResult.internal_report_preview,
      admin_export_audit:                   adminExportPreviewResult.admin_export_audit,
      admin_preview_summary:                adminExportPreviewResult.admin_preview_summary,
      immutable_no_sell_enforcement:        adminExportPreviewResult.immutable_no_sell_enforcement,
      report_redaction_policy:              sbcRedactionResult.report_redaction_policy,
      redacted_operator_report:             sbcRedactionResult.redacted_operator_report,
      preview_payload_limits:               sbcAbuseResult.preview_payload_limits,
      export_abuse_protection:              sbcAbuseResult.export_abuse_protection,
      internal_download_preflight:          sbcAbuseResult.internal_download_preflight,
      admin_preview_ux_contract:            sbcUxResult.admin_preview_ux_contract,
      admin_preview_modes:                  sbcUxResult.admin_preview_modes,
      admin_preview_health:                 sbcUxResult.admin_preview_health,
      internal_export_renderer:             sbcRendererResult.internal_export_renderer,
      rendered_export_formats:              sbcRendererResult.rendered_export_formats,
      export_format_validation:             sbcRendererResult.export_format_validation,
      format_render_summary:                sbcRendererResult.format_render_summary,
      download_response_contract:           sbcDryRunResult.download_response_contract,
      admin_download_dry_run:               sbcDryRunResult.admin_download_dry_run,
      download_dry_run_audit:               sbcDryRunResult.download_dry_run_audit,
      redaction_regression_lock:            sbcRegressionLockResult.redaction_regression_lock,
      admin_export_archive_contract:        sbcArchiveResult.admin_export_archive_contract,
      report_version_manifest:              sbcArchiveResult.report_version_manifest,
      archive_integrity_summary:            sbcArchiveResult.archive_integrity_summary,
      archive_simulation_summary:           sbcArchiveResult.archive_simulation_summary,
      versioned_report_history_simulation:  sbcHistoryResult.versioned_report_history_simulation,
      report_history_diff:                  sbcHistoryResult.report_history_diff,
      admin_access_audit:                   sbcAccessAuditResult.admin_access_audit,
      admin_access_risk_review:             sbcAccessAuditResult.admin_access_risk_review,
      access_audit_summary:                 sbcAccessAuditResult.access_audit_summary,
      internal_export_storage_contract:     sbcStorageResult.internal_export_storage_contract,
      storage_write_simulation:             sbcStorageResult.storage_write_simulation,
      storage_retention_policy:             sbcStorageResult.storage_retention_policy,
      storage_safety_manifest:              sbcStorageResult.storage_safety_manifest,
      admin_access_replay_simulation:       sbcReplayResult.admin_access_replay_simulation,
      admin_access_pattern_review:          sbcReplayResult.admin_access_pattern_review,
      release_freeze_policy:                sbcFreezeResult.release_freeze_policy,
      freeze_baseline:                      sbcFreezeResult.freeze_baseline,
      freeze_diff_report:                   sbcFreezeResult.freeze_diff_report,
      release_freeze_sentinel:              sbcFreezeResult.release_freeze_sentinel,
      freeze_enforcement_summary:           sbcFreezeResult.freeze_enforcement_summary,
      release_freeze_baseline_registry:     sbcBaselineResult.release_freeze_baseline_registry,
      baseline_comparison_report:           sbcBaselineResult.baseline_comparison_report,
      freeze_baseline_audit:                sbcBaselineResult.freeze_baseline_audit,
      freeze_registry_summary:              sbcBaselineResult.freeze_registry_summary,
      safety_invariant_snapshot:            sbcInvariantResult.safety_invariant_snapshot,
      safety_invariant_validation:          sbcInvariantResult.safety_invariant_validation,
      safety_invariant_summary:             sbcInvariantResult.safety_invariant_summary,
      controlled_unfreeze_design:           sbcUnfreezeResult.controlled_unfreeze_design,
      unfreeze_preconditions_matrix:        sbcUnfreezeResult.unfreeze_preconditions_matrix,
      unfreeze_risk_assessment:             sbcUnfreezeResult.unfreeze_risk_assessment,
      unfreeze_simulation_guard:            sbcUnfreezeResult.unfreeze_simulation_guard,
      controlled_unfreeze_summary:          sbcUnfreezeResult.controlled_unfreeze_summary,
      capability_unlock_matrix:             sbcMatrixResult.capability_unlock_matrix,
      capability_risk_profile:              sbcMatrixResult.capability_risk_profile,
      capability_unlock_summary:            sbcMatrixResult.capability_unlock_summary,
      controlled_unfreeze_simulation:       sbcSimulationResult.controlled_unfreeze_simulation,
      capability_unlock_attempts:           sbcSimulationResult.capability_unlock_attempts,
      unlock_rollback_plan:                 sbcSimulationResult.unlock_rollback_plan,
      unlock_simulation_audit:              sbcSimulationResult.unlock_simulation_audit,
      pre_beta_governance_gate:             sbcGateResult.pre_beta_governance_gate,
      pre_beta_blocker_matrix:              sbcGateResult.pre_beta_blocker_matrix,
      pre_beta_operator_review:             sbcGateResult.pre_beta_operator_review,
      final_pre_beta_summary:               sbcGateResult.final_pre_beta_summary,
      pre_beta_readiness_council:           sbcCouncilResult.pre_beta_readiness_council,
      readiness_council_votes:              sbcCouncilResult.readiness_council_votes,
      pre_beta_decision_record:             sbcCouncilResult.pre_beta_decision_record,
      pre_beta_council_summary:             sbcCouncilResult.pre_beta_council_summary,
      operator_signoff_simulation:          sbcSignoffResult.operator_signoff_simulation,
      signoff_effectiveness_policy:         sbcSignoffResult.signoff_effectiveness_policy,
      signoff_audit_trail:                  sbcSignoffResult.signoff_audit_trail,
      signoff_summary:                      sbcSignoffResult.signoff_summary,
      private_beta_non_delivery_contract:   sbcNonDeliveryResult.private_beta_non_delivery_contract,
      non_delivery_enforcement:             sbcNonDeliveryResult.non_delivery_enforcement,
      non_delivery_checklist:               sbcNonDeliveryResult.non_delivery_checklist,
      non_delivery_audit:                   sbcNonDeliveryResult.non_delivery_audit,
      non_delivery_summary:                 sbcNonDeliveryResult.non_delivery_summary,
      non_user_cohort_contract:             sbcCohortResult.non_user_cohort_contract,
      non_user_cohort_members:              sbcCohortResult.non_user_cohort_members,
      non_user_cohort_audit:                sbcCohortResult.non_user_cohort_audit,
      non_user_cohort_summary:              sbcCohortResult.non_user_cohort_summary,
      invitation_channel_policy:            sbcInvitationResult.invitation_channel_policy,
      private_beta_invitation_simulation:   sbcInvitationResult.private_beta_invitation_simulation,
      simulated_invitation_ledger:          sbcInvitationResult.simulated_invitation_ledger,
      invitation_simulation_audit:          sbcInvitationResult.invitation_simulation_audit,
      invitation_simulation_summary:        sbcInvitationResult.invitation_simulation_summary,
      delivery_kill_switch:                 sbcKillSwitchResult.delivery_kill_switch,
      channel_kill_switch_matrix:           sbcKillSwitchResult.channel_kill_switch_matrix,
      delivery_kill_switch_audit:           sbcKillSwitchResult.delivery_kill_switch_audit,
      delivery_kill_switch_summary:         sbcKillSwitchResult.delivery_kill_switch_summary,
      synthetic_cohort_review:              sbcCohortReviewResult.synthetic_cohort_review,
      synthetic_member_safety_matrix:       sbcCohortReviewResult.synthetic_member_safety_matrix,
      synthetic_cohort_findings:            sbcCohortReviewResult.synthetic_cohort_findings,
      synthetic_cohort_review_summary:      sbcCohortReviewResult.synthetic_cohort_review_summary,
      private_beta_dry_invite_report:       sbcDryInviteResult.private_beta_dry_invite_report,
      dry_invite_evidence_packet:           sbcDryInviteResult.dry_invite_evidence_packet,
      dry_invite_readiness_checklist:       sbcDryInviteResult.dry_invite_readiness_checklist,
      dry_invite_operator_summary:          sbcDryInviteResult.dry_invite_operator_summary,
      delivery_incident_scenarios:          sbcDrillResult.delivery_incident_scenarios,
      delivery_incident_drill:              sbcDrillResult.delivery_incident_drill,
      incident_response_plan:               sbcDrillResult.incident_response_plan,
      kill_switch_drill_report:             sbcDrillResult.kill_switch_drill_report,
      incident_drill_summary:               sbcDrillResult.incident_drill_summary,
      beta_safety_incident_ledger:          sbcLedgerResult.beta_safety_incident_ledger,
      simulated_incident_records:           sbcLedgerResult.simulated_incident_records,
      incident_severity_matrix:             sbcLedgerResult.incident_severity_matrix,
      incident_ledger_summary:              sbcLedgerResult.incident_ledger_summary,
      incident_recovery_simulation:         sbcRecoveryResult.incident_recovery_simulation,
      recovery_action_plan:                 sbcRecoveryResult.recovery_action_plan,
      recovery_verification_checklist:      sbcRecoveryResult.recovery_verification_checklist,
      incident_response_summary:            sbcRecoveryResult.incident_response_summary,
      operator_escalation_protocol:         sbcEscalationResult.operator_escalation_protocol,
      escalation_decision_matrix:           sbcEscalationResult.escalation_decision_matrix,
      internal_escalation_audit:            sbcEscalationResult.internal_escalation_audit,
      escalation_protocol_summary:          sbcEscalationResult.escalation_protocol_summary,
      p38_governance_closure_packet:        sbcClosureResult.p38_governance_closure_packet,
      p38_completion_matrix:                sbcClosureResult.p38_completion_matrix,
      p38_open_risks_register:              sbcClosureResult.p38_open_risks_register,
      p38_closure_audit:                    sbcClosureResult.p38_closure_audit,
      p38_closure_summary:                  sbcClosureResult.p38_closure_summary,
      p38_safety_freeze_finalization:       sbcFinalizationResult.p38_safety_freeze_finalization,
      final_safety_invariant_check:         sbcFinalizationResult.final_safety_invariant_check,
      final_no_sell_no_delivery_check:      sbcFinalizationResult.final_no_sell_no_delivery_check,
      p38_safety_finalization_summary:      sbcFinalizationResult.p38_safety_finalization_summary,
      p39_transition_plan:                  sbcTransitionResult.p39_transition_plan,
      p39_micro_test_activation_plan:       sbcTransitionResult.p39_micro_test_activation_plan,
      p39_quality_proof_requirements:       sbcTransitionResult.p39_quality_proof_requirements,
      p39_operator_checklist:               sbcTransitionResult.p39_operator_checklist,
      p38_to_p39_operator_summary:          sbcTransitionResult.p38_to_p39_operator_summary,
      resolved_sample_audit:                sbcSampleAuditResult.resolved_sample_audit,
      resolved_sample_distribution:         sbcSampleAuditResult.resolved_sample_distribution,
      pending_resolution_queue:             sbcSampleAuditResult.pending_resolution_queue,
      resolved_audit_summary:               sbcSampleAuditResult.resolved_audit_summary,
      micro_test_activation_readiness:      sbcActivationResult.micro_test_activation_readiness,
      activation_prerequisites:             sbcActivationResult.activation_prerequisites,
      micro_test_manual_activation_checklist: sbcActivationResult.micro_test_manual_activation_checklist,
      activation_risk_review:               sbcActivationResult.activation_risk_review,
      resolved_quality_seed_report:         sbcKickoffResult.resolved_quality_seed_report,
      quality_proof_kickoff:                sbcKickoffResult.quality_proof_kickoff,
      quality_proof_initial_questions:      sbcKickoffResult.quality_proof_initial_questions,
      p39_quality_kickoff_summary:          sbcKickoffResult.p39_quality_kickoff_summary,
      micro_test_env_state:                 sbcGuardResult.micro_test_env_state,
      micro_test_manual_activation_guard:   sbcGuardResult.micro_test_manual_activation_guard,
      manual_activation_guard_checks:       sbcGuardResult.manual_activation_guard_checks,
      activation_guard_audit:               sbcGuardResult.activation_guard_audit,
      post_activation_monitor:              sbcMonitorResult.post_activation_monitor,
      micro_test_progress_tracker:          sbcMonitorResult.micro_test_progress_tracker,
      post_activation_checks:               sbcMonitorResult.post_activation_checks,
      post_activation_operator_notes:       sbcMonitorResult.post_activation_operator_notes,
      first_real_quality_snapshot:          sbcSnapshotResult.first_real_quality_snapshot,
      quality_snapshot_distribution:        sbcSnapshotResult.quality_snapshot_distribution,
      quality_snapshot_risk_flags:          sbcSnapshotResult.quality_snapshot_risk_flags,
      quality_snapshot_summary:             sbcSnapshotResult.quality_snapshot_summary,
      p39_activation_operator_summary:      sbcP39ActivationSummary,
      break_even_odds_review:               sbcBreakEvenResult.break_even_odds_review,
      segment_break_even_matrix:            sbcBreakEvenResult.segment_break_even_matrix,
      segment_quality_proof:                sbcQualityProofResult.segment_quality_proof,
      segment_quality_rankings:             sbcQualityProofResult.segment_quality_rankings,
      confidence_calibration_review:        sbcQualityProofResult.confidence_calibration_review,
      segment_exclusion_recommendations:    sbcExclusionResult.segment_exclusion_recommendations,
      segment_watchlist:                    sbcExclusionResult.segment_watchlist,
      segment_recommendation_policy:        sbcExclusionResult.segment_recommendation_policy,
      segment_exclusion_summary:            sbcExclusionResult.segment_exclusion_summary,
      p39_segment_quality_summary:          sbcQualityProofResult.p39_segment_quality_summary,
      segment_exclusion_dry_run:            sbcDryRunP393Result.segment_exclusion_dry_run,
      dry_run_excluded_segments:            sbcDryRunP393Result.dry_run_excluded_segments,
      segment_exclusion_impact_report:      sbcDryRunP393Result.segment_exclusion_impact_report,
      segment_exclusion_dry_run_summary:    sbcDryRunP393Result.segment_exclusion_dry_run_summary,
      quality_reweight_proposal:            sbcReweightResult.quality_reweight_proposal,
      proposed_weight_changes:              sbcReweightResult.proposed_weight_changes,
      quality_reweight_impact_simulation:   sbcReweightResult.quality_reweight_impact_simulation,
      quality_reweight_summary:             sbcReweightResult.quality_reweight_summary,
      shadow_recommendation_policy:         sbcShadowPolicyResult.shadow_recommendation_policy,
      shadow_policy_enforcement:            sbcShadowPolicyResult.shadow_policy_enforcement,
      segment_policy_audit:                 sbcShadowPolicyResult.segment_policy_audit,
      p39_shadow_policy_summary:            sbcShadowPolicyResult.p39_shadow_policy_summary,
      shadow_reweight_backtest:             sbcBacktestResult.shadow_reweight_backtest,
      shadow_ranking_delta_report:          sbcBacktestResult.shadow_ranking_delta_report,
      shadow_backtest_audit:                sbcBacktestResult.shadow_backtest_audit,
      shadow_backtest_summary:              sbcBacktestResult.shadow_backtest_summary,
      recommendation_stability_check:       sbcStabilityResult.recommendation_stability_check,
      recommendation_stability_matrix:      sbcStabilityResult.recommendation_stability_matrix,
      recommendation_stability_summary:     sbcStabilityResult.recommendation_stability_summary,
      quality_proof_gate_evidence:          sbcGateP394Result.quality_proof_gate_evidence,
      quality_proof_decision_gate:          sbcGateP394Result.quality_proof_decision_gate,
      quality_proof_operator_actions:       sbcGateP394Result.quality_proof_operator_actions,
      p39_quality_decision_summary:         sbcGateP394Result.p39_quality_decision_summary,
      quality_proof_trend_monitor:          sbcTrendResult.quality_proof_trend_monitor,
      quality_gate_trend_report:            sbcTrendResult.quality_gate_trend_report,
      quality_trend_operator_actions:       sbcTrendResult.quality_trend_operator_actions,
      segment_decision_history_simulation:  sbcSegHistResult.segment_decision_history_simulation,
      segment_decision_history_matrix:      sbcSegHistResult.segment_decision_history_matrix,
      segment_decision_history_summary:     sbcSegHistResult.segment_decision_history_summary,
      beta_simulation_readiness_review:     sbcBetaSimResult.beta_simulation_readiness_review,
      beta_simulation_blocker_matrix:       sbcBetaSimResult.beta_simulation_blocker_matrix,
      beta_simulation_readiness_evidence:   sbcBetaSimResult.beta_simulation_readiness_evidence,
      p39_beta_simulation_summary:          sbcBetaSimResult.p39_beta_simulation_summary,
      beta_simulation_cohort_plan:          sbcP396CohortResult.beta_simulation_cohort_plan,
      synthetic_beta_cohort_members:        sbcP396CohortResult.synthetic_beta_cohort_members,
      beta_cohort_risk_review:              sbcP396CohortResult.beta_cohort_risk_review,
      beta_simulation_cohort_summary:       sbcP396CohortResult.beta_simulation_cohort_summary,
      synthetic_delivery_ux_contract:       sbcP396UxContractResult.synthetic_delivery_ux_contract,
      synthetic_delivery_channel_matrix:    sbcP396UxContractResult.synthetic_delivery_channel_matrix,
      synthetic_ux_artifacts:               sbcP396UxContractResult.synthetic_ux_artifacts,
      synthetic_delivery_ux_summary:        sbcP396UxContractResult.synthetic_delivery_ux_summary,
      quality_proof_review_board:           sbcP396ReviewBoardResult.quality_proof_review_board,
      quality_review_board_votes:           sbcP396ReviewBoardResult.quality_review_board_votes,
      beta_simulation_governance_packet:    sbcP396ReviewBoardResult.beta_simulation_governance_packet,
      p39_beta_simulation_operator_summary: sbcP396ReviewBoardResult.p39_beta_simulation_operator_summary,
      internal_pick_card_contract:          sbcP397PickCardResult.internal_pick_card_contract,
      pick_card_allowed_fields:             sbcP397PickCardResult.pick_card_allowed_fields,
      pick_card_forbidden_fields:           sbcP397PickCardResult.pick_card_forbidden_fields,
      pick_card_safety_validation:          sbcP397PickCardResult.pick_card_safety_validation,
      internal_pick_card_contract_summary:  sbcP397PickCardResult.internal_pick_card_contract_summary,
      synthetic_beta_experience_preview:    sbcP397ExperienceResult.synthetic_beta_experience_preview,
      synthetic_pick_card_examples:         sbcP397ExperienceResult.synthetic_pick_card_examples,
      experience_preview_safety_notes:      sbcP397ExperienceResult.experience_preview_safety_notes,
      synthetic_experience_preview_summary: sbcP397ExperienceResult.synthetic_experience_preview_summary,
      synthetic_feedback_loop:              sbcP397FeedbackResult.synthetic_feedback_loop,
      simulated_feedback_entries:           sbcP397FeedbackResult.simulated_feedback_entries,
      feedback_loop_analysis:               sbcP397FeedbackResult.feedback_loop_analysis,
      feedback_loop_operator_summary:       sbcP397FeedbackResult.feedback_loop_operator_summary,
      p39_experience_preview_summary:       sbcP397FeedbackResult.p39_experience_preview_summary,
      sample_rows:              sampleRows?.results || [],
      ...(confidenceScoreExplain !== null ? { confidence_score_explain: confidenceScoreExplain } : {}),
    }), {
      status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (/no such table/i.test(err?.message || '')) {
      return new Response(JSON.stringify({
        ok: true,
        table_exists: false,
        error: 'shadow_bets table not found — migration may not have run',
        total_rows: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      })
    }
    console.error('[shadowBetsCheck] handler error:', err.message)
    return new Response(JSON.stringify({ ok: false, error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }
}
