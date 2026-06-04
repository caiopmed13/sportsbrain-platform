// ══════════════════════════════════════════════════════════════════════════
// Realtime odds push via Cloudflare Durable Objects (WebSocket)
// ══════════════════════════════════════════════════════════════════════════
//   GET /v1/realtime/odds?sport=soccer  (Upgrade: websocket)
//     → cliente recebe JSON a cada novo snapshot salvo
//
// ARQUITETURA:
//   • Durable Object OddsRoom mantém set de WebSocket clients.
//   • Quando o ingest (/internal/ingest-odds ou cron) salva snapshot,
//     dispara DO.fetch('/broadcast', {events, snapshots}) → DO envia pra todos.
//   • Se CF plan free: DOs indisponíveis. Fallback: SSE polling /v1/realtime/sse.
//
// NOTA: Para ativar, adicione ao wrangler.toml:
//   [[durable_objects.bindings]]
//   name = "ODDS_ROOM"
//   class_name = "OddsRoom"
//   [[migrations]]
//   tag = "v1"
//   new_classes = ["OddsRoom"]
// ══════════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';

export class OddsRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.sockets.add(server);
      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('message', () => {}); // ignore client msgs
      return new Response(null, { status: 101, webSocket: client });
    }

    // Broadcast (called from ingest)
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.text();
      for (const ws of this.sockets) {
        try { ws.send(payload); } catch { this.sockets.delete(ws); }
      }
      return new Response(JSON.stringify({ delivered: this.sockets.size }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }
}

export async function handleRealtimeWS(request, env) {
  if (!env.ODDS_ROOM) {
    // Durable Object not bound — return informational error
    return new Response(JSON.stringify({
      ok: false,
      error: 'WEBSOCKET_UNAVAILABLE',
      note: 'Add [[durable_objects.bindings]] to wrangler.toml (requires Workers Paid plan).',
    }), { status: 501, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
  }

  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Upgrade: websocket required', { status: 426 });
  }

  const id = env.ODDS_ROOM.idFromName('global');
  const stub = env.ODDS_ROOM.get(id);
  return stub.fetch(new Request('https://room/ws', request));
}
