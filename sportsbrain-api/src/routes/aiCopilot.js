// ══════════════════════════════════════════════════════════════════════════
// AI Copilot — BYO-key (user provides own Claude/OpenAI key)
// ══════════════════════════════════════════════════════════════════════════
// POST /v1/ai/copilot
// Body: { provider: 'anthropic'|'openai', api_key: 'sk-...', event_id?: string,
//         question: string, context?: {...} }
// A key do user NUNCA é armazenada, só proxied.
// Server enriquece com contexto (odds, consensus, analytics) e retorna resposta.
// ══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';
import { getLatestOdds } from '../odds/storage.js';
import { findValueBets, findArbitrage } from '../odds/analytics.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function buildSystemPrompt() {
  return `You are SportsBrain Copilot — an expert sports betting analyst integrated with a proprietary multi-book odds engine.

Your role:
- Analyze odds data across 15+ sportsbooks (sharp: Pinnacle, Betfair, Smarkets; soft: DraftKings, FanDuel, Bovada, Kambi, 1xBet, etc.)
- Identify +EV opportunities using Pinnacle no-vig as fair price anchor
- Explain line movement, steam moves, RLM signals in plain language
- Recommend Kelly-sized stakes
- Never invent numbers — only use data from the CONTEXT block

Response style: direct, quantitative, cite specific books/prices. Portuguese by default.
Always flag risk: injury risk, weather, rest, model uncertainty.
Never recommend betting without an edge ≥2% after vig.`;
}

async function callAnthropic(apiKey, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: buildSystemPrompt(),
      messages,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAI(apiKey, messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: buildSystemPrompt() }, ...messages],
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`openai ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function buildContext(env, eventId) {
  if (!eventId || !env.SB_DB) return null;
  const odds = await getLatestOdds(env, { event_id: eventId, maxAge: 60 * 60 * 1000 });
  if (!odds.length) return null;

  const { results: evRows } = await env.SB_DB.prepare(
    `SELECT * FROM odds_events WHERE id = ?`
  ).bind(eventId).all();
  const event = evRows?.[0];

  const values = findValueBets(odds, 1.0);
  const arbs   = findArbitrage(odds);

  return { event, n_snapshots: odds.length, top_values: values.slice(0, 5), arbs: arbs.slice(0, 3) };
}

export async function handleAiCopilot(request, env) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST required' }, 405);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  const { provider, api_key, question, event_id, context: userCtx } = body || {};
  if (!provider || !api_key || !question) {
    return json({ ok: false, error: 'provider, api_key, question required' }, 400);
  }
  if (!['anthropic', 'openai'].includes(provider)) {
    return json({ ok: false, error: 'provider must be anthropic|openai' }, 400);
  }

  // Build context from D1 if event_id provided
  const serverCtx = event_id ? await buildContext(env, event_id) : null;
  const contextBlock = JSON.stringify({ server: serverCtx, user: userCtx }, null, 2);

  const messages = [{
    role: 'user',
    content: `CONTEXT:\n${contextBlock}\n\nQUESTION: ${question}`,
  }];

  try {
    const text = provider === 'anthropic'
      ? await callAnthropic(api_key, messages)
      : await callOpenAI(api_key, messages);

    return json({
      ok: true,
      answer: text,
      provider,
      context_size: contextBlock.length,
      has_server_context: !!serverCtx,
    });
  } catch (e) {
    return json({ ok: false, error: e.message }, 502);
  }
}
