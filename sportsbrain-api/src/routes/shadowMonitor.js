// src/routes/shadowMonitor.js
// GET /v1/admin/shadow-monitor — shadow bet accumulation + calibration monitor
// Auth: X-Admin-Key = SB_MASTER_KEY (or no auth in dev when SB_MASTER_KEY unset)

import { corsHeaders } from './health.js'
import { buildShadowMonitorReport, generateDailyReport } from '../services/shadowMonitor.js'

export async function handleShadowMonitor(request, env) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const ingestSecret = request.headers.get('X-Ingest-Secret') || ''
  const adminKey     = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('admin_key') || ''
  const hasMaster    = env.SB_MASTER_KEY && (
    adminKey === env.SB_MASTER_KEY ||
    ingestSecret === env.SB_MASTER_KEY
  )
  if (!hasMaster && env.SB_MASTER_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }

  // ── Params ────────────────────────────────────────────────────────────────
  const url  = new URL(request.url)
  const rawDays = parseInt(url.searchParams.get('days') || '7', 10)
  const days = Math.min(90, Math.max(1, Number.isNaN(rawDays) ? 7 : rawDays))
  const fmt  = url.searchParams.get('format') || 'json'  // 'json' | 'text'

  try {
    const report = await buildShadowMonitorReport(env, days)

    if (fmt === 'text') {
      const text = generateDailyReport(report)
      return new Response(text, {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    return new Response(JSON.stringify(report), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    })
  } catch (err) {
    console.error('[shadowMonitor] handler error:', err.message)
    return new Response(JSON.stringify({ ok: false, error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    })
  }
}
