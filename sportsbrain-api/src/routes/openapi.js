// ════════════════════════════════════════════════════════════════════
// OpenAPI 3.1 spec + interactive docs (Scalar UI via CDN)
// ════════════════════════════════════════════════════════════════════
// GET /openapi.json   → machine-readable spec
// GET /docs           → interactive Scalar UI (HTML)
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from './health.js';

const SERVERS = [
  { url: 'https://sportsbrain-api.sportsbrain-api.workers.dev', description: 'Production (Cloudflare Workers)' },
];

function buildSpec(env) {
  const version = env?.SB_API_VERSION || '4.5.0';
  return {
    openapi: '3.1.0',
    info: {
      title: 'SportsBrain API',
      version,
      description: [
        'API proprietária de odds intelligence — multi-book scrapers próprios (Pinnacle, Betfair Ex, Smarkets,',
        'Bet365, DraftKings, FanDuel, Betano, Superbet, KTO, Bovada, Stake etc.) + analytics de value bets,',
        'arbitragem, middles, steam moves, CLV tracker e WebSocket realtime.',
        '',
        '**Autenticação:** header `X-SB-Key: sb_...` ou query `?key=sb_...`. Sem chave → tier `free`.',
        '',
        '**Tiers:**',
        '- `free` — 15min delay, top 3 edges, sem WS, sem CLV',
        '- `starter` — 5min delay, top 20 edges',
        '- `pro` — real-time, top 50 edges, arb + middles',
        '- `sharp` — real-time, top 100 edges, WS push, CLV tracker, backtesting',
        '- `enterprise` — sem limites práticos, API white-label',
      ].join('\n'),
      contact: { name: 'SportsBrain', url: 'https://sportsbrain.app' },
      license: { name: 'Proprietary' },
    },
    servers: SERVERS,
    security: [{ apiKeyHeader: [] }, { apiKeyQuery: [] }, {}],
    components: {
      securitySchemes: {
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-SB-Key' },
        apiKeyQuery:  { type: 'apiKey', in: 'query',  name: 'key' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            ok:      { type: 'boolean', example: false },
            error:   { type: 'string', example: 'UNAUTHORIZED' },
            message: { type: 'string' },
          },
        },
        ValueBet: {
          type: 'object',
          properties: {
            event_id:   { type: 'string' },
            market:     { type: 'string', example: 'h2h' },
            outcome:    { type: 'string', example: 'Arsenal' },
            book:       { type: 'string', example: 'bet365' },
            price:      { type: 'number', example: 1.95 },
            fair_price: { type: 'number', example: 1.85 },
            edge_pct:   { type: 'number', example: 5.2 },
            sharp_books:{ type: 'array', items: { type: 'string' }, example: ['pinnacle', 'betfair_ex'] },
            n_sharp:    { type: 'integer', example: 2 },
          },
        },
        Arbitrage: {
          type: 'object',
          properties: {
            event_id: { type: 'string' },
            market:   { type: 'string' },
            total_implied: { type: 'number', example: 0.987 },
            roi_pct:  { type: 'number', example: 1.3 },
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  outcome: { type: 'string' },
                  book:    { type: 'string' },
                  price:   { type: 'number' },
                  stake_pct: { type: 'number' },
                },
              },
            },
          },
        },
        BookStatus: {
          type: 'object',
          properties: {
            book:          { type: 'string' },
            status:        { type: 'string', enum: ['OK', 'WARN', 'STALE'] },
            snapshots_24h: { type: 'integer' },
            last_tick_iso: { type: 'string', format: 'date-time', nullable: true },
            stale_minutes: { type: 'integer', nullable: true },
          },
        },
      },
    },
    tags: [
      { name: 'odds',       description: 'Odds engine proprietário (multi-book)' },
      { name: 'analytics',  description: 'Value, arbitrage, middles, steam, CLV' },
      { name: 'realtime',   description: 'WebSocket push de updates' },
      { name: 'admin',      description: 'Health monitoring + alertas (X-Admin-Key)' },
      { name: 'meta',       description: 'Health, status, docs' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['meta'],
          summary: 'Liveness check',
          security: [],
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/v1/status': {
        get: { tags: ['meta'], summary: 'API status + version', security: [], responses: { '200': { description: 'OK' } } },
      },
      '/v1/odds/all': {
        get: {
          tags: ['odds'],
          summary: 'Lista eventos + consensus multi-book',
          parameters: [
            { name: 'sport', in: 'query', schema: { type: 'string', enum: ['soccer', 'basketball'] } },
            { name: 'hours', in: 'query', schema: { type: 'integer', default: 72 } },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/v1/odds/books': {
        get: { tags: ['odds'], summary: 'Status dos scrapers por book', responses: { '200': { description: 'OK' } } },
      },
      '/v1/odds/value': {
        get: {
          tags: ['analytics'],
          summary: 'Value bets (edge vs fair price no-vig)',
          description: 'Fair price = weighted median de ≥2 sharp books (Pinnacle, Betfair Ex, Smarkets, Polymarket, Kalshi). Free tier = 15min delay + top 3.',
          parameters: [
            { name: 'sport',    in: 'query', schema: { type: 'string' } },
            { name: 'min_edge', in: 'query', schema: { type: 'number', default: 1.5 }, description: 'Edge mínimo em %' },
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok:              { type: 'boolean' },
                      count:           { type: 'integer' },
                      total_available: { type: 'integer' },
                      bets:            { type: 'array', items: { $ref: '#/components/schemas/ValueBet' } },
                      tier:            { type: 'string' },
                      delay_ms:        { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/odds/arbitrage': {
        get: {
          tags: ['analytics'],
          summary: 'Oportunidades de arbitragem cross-book',
          parameters: [{ name: 'sport', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { arbs: { type: 'array', items: { $ref: '#/components/schemas/Arbitrage' } } } } } } } },
        },
      },
      '/v1/odds/middles': {
        get: { tags: ['analytics'], summary: 'Middles (spreads/totals com gap entre books)', responses: { '200': { description: 'OK' } } },
      },
      '/v1/odds/hold': {
        get: { tags: ['analytics'], summary: 'Hold (margem) por book', responses: { '200': { description: 'OK' } } },
      },
      '/v1/odds/no_vig': {
        get: { tags: ['analytics'], summary: 'No-vig fair probabilities', responses: { '200': { description: 'OK' } } },
      },
      '/v1/odds/widest': {
        get: { tags: ['analytics'], summary: 'Linhas mais abertas entre books (best price discovery)', responses: { '200': { description: 'OK' } } },
      },
      '/v1/odds/event/{id}': {
        get: {
          tags: ['odds'],
          summary: 'Odds completas de 1 evento',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/v1/odds/movement/{id}': {
        get: {
          tags: ['analytics'],
          summary: 'Série temporal de movimento de linha',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/v1/odds/steam/{id}': {
        get: {
          tags: ['analytics'],
          summary: 'Detecta steam moves (movimento coordenado ≥3 books)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/v1/odds/opening/{id}': {
        get: {
          tags: ['analytics'],
          summary: 'Opening lines (preços de abertura por book)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/v1/realtime/odds': {
        get: {
          tags: ['realtime'],
          summary: 'WebSocket push de updates de odds (Sharp+ only)',
          description: 'Upgrade pra WS. Client envia `{subscribe: [event_id, ...]}`. Servidor push `{event_id, book, market, outcome, price, ts}`.',
          responses: {
            '101': { description: 'WebSocket upgrade' },
            '402': { description: 'Tier insuficiente (precisa Sharp+)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/admin/health': {
        get: {
          tags: ['admin'],
          summary: 'Health status por book (X-Admin-Key)',
          security: [{ adminKey: [] }],
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { type: 'object', properties: { books: { type: 'array', items: { $ref: '#/components/schemas/BookStatus' } } } } } },
            },
            '401': { description: 'Missing admin key' },
          },
        },
      },
      '/admin/alerts': {
        get: { tags: ['admin'], summary: 'Últimos 100 alertas (X-Admin-Key)', responses: { '200': { description: 'OK' } } },
      },
    },
  };
}

export function handleOpenApiSpec(env) {
  const spec = buildSpec(env);
  return new Response(JSON.stringify(spec, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export function handleDocsHtml() {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>SportsBrain API — Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
</head>
<body>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script>
    var configuration = {
      theme: 'purple',
      darkMode: true,
      metaData: { title: 'SportsBrain API' },
    };
    document.getElementById('api-reference').dataset.configuration = JSON.stringify(configuration);
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
