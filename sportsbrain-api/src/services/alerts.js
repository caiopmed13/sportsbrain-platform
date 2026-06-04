// ════════════════════════════════════════════════════════════════════
// Alerts Dispatcher — Telegram + generic webhook + D1 log
// ════════════════════════════════════════════════════════════════════
// Envs (todas opcionais; sem elas os sinks correspondentes ficam off):
//   TELEGRAM_BOT_TOKEN   → token do bot (@BotFather)
//   TELEGRAM_CHAT_ID     → chat_id destino (pode ser grupo/canal; use -100... pra supergroups)
//   SB_ALERT_WEBHOOK     → URL genérica (Slack/Discord compat — POST JSON {text})
//
// Uso:
//   import { sendAlert } from '../services/alerts.js';
//   await sendAlert(env, {
//     kind: 'value_bet',
//     severity: 'info' | 'warning' | 'critical',
//     title: 'Value 5.2% em Arsenal ML',
//     detail: 'Pinnacle+Betfair fair=1.85, Bet365=1.95, edge 5.2%',
//     meta: { event_id, market, outcome, edge_pct, book },
//   });
//
// Dedup: (kind|title) idêntico dentro de env.ALERT_DEDUP_MIN (default 15min) é suprimido.
// ════════════════════════════════════════════════════════════════════

const DEFAULT_DEDUP_MIN = 15;

export async function sendAlert(env, {
  kind,
  severity = 'info',
  title,
  detail = '',
  meta = {},
  dedup = true,
}) {
  if (!kind || !title) return { ok: false, error: 'missing_kind_or_title' };

  const dedupMin = parseInt(env.ALERT_DEDUP_MIN || DEFAULT_DEDUP_MIN, 10);

  // Dedup via D1 odds_alerts
  if (dedup && env.SB_DB) {
    try {
      const recent = await env.SB_DB.prepare(`
        SELECT id FROM odds_alerts
        WHERE kind = ? AND detail LIKE ?
          AND created_at > datetime('now', ?)
        LIMIT 1
      `).bind(kind, `%${title}%`, `-${dedupMin} minutes`).first();
      if (recent) return { ok: true, deduped: true };
    } catch (_) { /* tabela pode não existir */ }
  }

  // Log em D1
  if (env.SB_DB) {
    try {
      await env.SB_DB.prepare(`
        INSERT INTO odds_alerts (event_id, market, outcome, line, kind, severity, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        meta.event_id || 'system',
        meta.market   || null,
        meta.outcome  || null,
        meta.line     ?? null,
        kind,
        severity,
        `${title}${detail ? ' — ' + detail : ''}`,
      ).run();
    } catch (e) {
      console.warn('[alerts] D1 insert failed:', e.message);
    }
  }

  const results = { telegram: null, webhook: null };

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    results.telegram = await sendTelegram(env, { severity, title, detail, meta });
  }

  // Webhook genérico (Slack/Discord-compat: {text})
  if (env.SB_ALERT_WEBHOOK) {
    results.webhook = await sendWebhook(env.SB_ALERT_WEBHOOK, { severity, title, detail, kind });
  }

  return { ok: true, sinks: results };
}

// ── Telegram sink ───────────────────────────────────────────────────
async function sendTelegram(env, { severity, title, detail, meta }) {
  const emoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : '📣';
  const lines = [
    `${emoji} *${escapeMd(title)}*`,
    detail ? escapeMd(detail) : '',
  ];
  if (meta.edge_pct != null) lines.push(`Edge: *${Number(meta.edge_pct).toFixed(2)}%*`);
  if (meta.book)             lines.push(`Book: \`${escapeMd(meta.book)}\``);
  if (meta.price != null)    lines.push(`Price: \`${meta.price}\``);
  if (meta.event_id && meta.event_id !== 'system') lines.push(`Event: \`${escapeMd(String(meta.event_id))}\``);

  const text = lines.filter(Boolean).join('\n');
  const url  = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, status: r.status, body: body.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Escape pra Telegram MarkdownV2
function escapeMd(str) {
  return String(str).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// ── Webhook genérico ────────────────────────────────────────────────
async function sendWebhook(url, { severity, title, detail, kind }) {
  try {
    const emoji = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : '📣';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${emoji} [${kind}] ${title}${detail ? ' — ' + detail : ''}`,
        severity,
        kind,
        title,
        detail,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Scan de value bets pra disparar alertas (usado via cron) ────────
// Pega último snapshot, roda findValueBets, dispara push pra top edges
export async function runValueAlertScan(env, { minEdge = 5.0, maxAlerts = 10 } = {}) {
  if (!env.SB_DB) return { ok: false, error: 'no_db' };

  try {
    const { loadSnapshotsForSport } = await import('../routes/oddsEngine.js')
      .catch(async () => {
        const { listUpcomingEvents, getLatestOdds } = await import('../odds/storage.js');
        return {
          loadSnapshotsForSport: async (env) => {
            const events = await listUpcomingEvents(env, { hours: 24 });
            const snapshots = [];
            for (const ev of events) {
              const odds = await getLatestOdds(env, { event_id: ev.id, maxAge: 60 * 60 * 1000 });
              for (const o of odds) snapshots.push({ ...o, event_id: ev.id, home: ev.home, away: ev.away });
            }
            return { snapshots };
          },
        };
      });

    const { findValueBets } = await import('../odds/analytics.js');
    const { snapshots } = await loadSnapshotsForSport(env, null);
    const values = findValueBets(snapshots, minEdge);

    let fired = 0;
    for (const v of values.slice(0, maxAlerts)) {
      const title = `Value ${v.edge_pct.toFixed(2)}% — ${v.outcome} @ ${v.book}`;
      const detail = `Fair ${v.fair_price?.toFixed(2)} vs oferta ${v.price?.toFixed(2)} (${v.market}) · ${v.n_sharp || 0} sharp books`;
      const res = await sendAlert(env, {
        kind: 'value_bet',
        severity: v.edge_pct >= 10 ? 'critical' : v.edge_pct >= 7 ? 'warning' : 'info',
        title,
        detail,
        meta: {
          event_id: v.event_id,
          market:   v.market,
          outcome:  v.outcome,
          edge_pct: v.edge_pct,
          book:     v.book,
          price:    v.price,
        },
      });
      if (res.ok && !res.deduped) fired++;
    }

    return { ok: true, scanned: values.length, fired };
  } catch (e) {
    console.warn('[runValueAlertScan]', e.message);
    return { ok: false, error: e.message };
  }
}
