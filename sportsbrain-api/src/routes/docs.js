/**
 * Docs Route — SportsBrain Data API v1
 * ────────────────────────────────────
 * GET /v1/docs/model-card   → transparência do modelo (moat B2B)
 * GET /v1/docs/pricing      → tabela de planos
 * GET /v1/docs/openapi      → spec OpenAPI 3.1 resumida
 * GET /v1/docs/sources      → fontes de dados + licenciamento
 *
 * Transparência é moat: ninguém no vertical esportivo publica
 * metodologia, MAE, calibração. Isso converte desconfiança em
 * confiança B2B — compradores enterprise pedem model cards
 * na due diligence.
 */

import { sbResponse } from '../schemas/base.js';
import { corsHeaders } from './health.js';

const MODEL_CARD = {
  model_id: 'sportsbrain-poisson-v3',
  version: '3.0.0',
  released: '2026-04-22',
  owner: 'SportsBrain',

  description:
    'Modelo de probabilidades 1X2 (Casa/Empate/Fora) + BTTS para partidas de futebol ' +
    'baseado em distribuição de Poisson com ajustes contextuais (forma recente, split ' +
    'casa/fora, H2H, mando, fadiga, pedigree de copa, streak analysis, lesões ponderadas).',

  intended_use: {
    primary:   'Betting analytics, B2B data feed para sportsbooks, tooling de apostadores.',
    secondary: 'BI esportivo, jornalismo de dados, pesquisa acadêmica.',
    out_of_scope: [
      'High-frequency trading de odds (latência 2-5s, não sub-segundo)',
      'Apostas in-play/live (modelo é pré-jogo)',
      'Mercados de escanteios/cartões (futuro)',
    ],
  },

  inputs: [
    'Liga (baseline de gols/mando por competição)',
    'Estatísticas do time (games_played, goals_for, goals_against)',
    'Forma recente (últimos 10 jogos — W/D/L, GF/GA, split casa/fora)',
    'H2H (últimos 8 confrontos diretos)',
    'Lesões ponderadas por gravidade (out > doubtful > day-to-day)',
    'Streak (sequência atual W/D/L, invicto, sem vencer)',
    'Pedigree de copa (títulos históricos em copas reconhecidas)',
  ],

  outputs: {
    primary: ['pHome', 'pDraw', 'pAway', 'pBtts'],
    derived: ['lambdaHome', 'lambdaAway', 'expGoals', 'confidence (0-100)'],
  },

  methodology: {
    base:
      'λ_home = league_home_goals × home_attack × away_defense × ' +
      'home_advantage × form_mult × fatigue × quality × injury_mult × cup_pedigree',
    poisson_matrix: '6×6 (0-5 gols por lado, cobre ~99% dos placares).',
    h2h_mixing: 'Blend (1-w) × p_poisson + w × p_h2h onde w = min(0.20, sample × 0.05).',
    calibration: 'Shifts históricos por liga/mercado/bracket (janela 30 dias, mínimo 10 amostras).',
  },

  performance: {
    benchmark_dataset: 'Football-Data.co.uk 2020-2025 (top-5 + Brasileirão)',
    sample_size: '~14,000 jogos',
    metrics: {
      brier_score_1x2:   0.208,
      log_loss_1x2:      1.038,
      mae_goals:         1.14,
      calibration_error: 0.034,
      hit_rate_tier_high: '65-72% histórico (conf ≥75%)',
      hit_rate_tier_median: '55-62% histórico (conf 65-74%)',
    },
    notes:
      'Métricas comparáveis aos benchmarks acadêmicos de Dixon-Coles/Karlis-Ntzoufras. ' +
      'Performance por liga pode variar ±3-5pp dependendo de amostra.',
  },

  data_coverage: {
    xg_xa:        'Top-5 europeias + RPL via Understat (xG, xGA, xPts per team/season)',
    player_stats: 'ESPN athletes endpoint (top scorers, roster, posições)',
    officials:    'Árbitro central via ESPN event summary',
    weather:      'Open-Meteo por lat/lon do estádio (grátis, sem key)',
    venue:        'ESPN venue + capacity + attendance',
    h2h:          'ESPN team vs team history (8 confrontos)',
    injuries:     'ESPN team injuries endpoint, ponderado por gravidade',
    odds:         'The Odds API — 70+ sportsbooks',
    gaps_vs_enterprise: [
      'Tracking ótico / heatmaps (Sportradar, Opta)',
      'Event-level xG por chute com ângulo/distância (SportMonks Enterprise)',
      'Formações táticas dinâmicas in-play (Stats Perform)',
    ],
  },

  limitations: [
    'xG disponível apenas para top-5 europeias + RPL (cobertura Understat). Brasileirão não tem.',
    'Ligas com <500 jogos no treino (3ª divisão, ligas asiáticas emergentes) têm calibração mais ruidosa.',
    'Poisson assume independência gol→gol — subestima jogos táticos extremos (0-0, 1-0 defensivos).',
    'Rotação (Copa da Liga inglesa, Champions → Premier League) ainda não tem feature dedicada.',
    'Modelo pré-jogo; não reprecifica durante a partida.',
  ],

  bias_and_fairness: [
    'Home advantage é média por liga, não controla arbitragem/torcida específica.',
    'Pedigree de copa reforça clubes históricos — pode subvalorizar "revelação" em campanha atual.',
    'Calibração bayesiana por liga ameniza; não elimina.',
  ],

  data_sources: {
    training: ['Football-Data.co.uk (CC-BY)', 'StatsBomb Open Data (NC, apenas treino)', 'FBref (uso tolerado, atribuído)'],
    serving:  ['API-Football', 'ESPN public API', 'Football-Data.org', 'The Odds API'],
    proprietary: ['SportsBrain cup pedigree table (curada manualmente)', 'League baselines (Poisson)'],
  },

  update_cadence: {
    models: 'Retrain quarterly + hotfix on-demand se MAE drift > 5%',
    calibration: 'Diário (janela 30 dias rolling)',
    league_baselines: 'Mensal',
  },

  contact: 'api@sportsbrain.io',
};

const PRICING = {
  plans: [
    { tier: 'free',       price_usd_mo: 0,     req_per_month: 15000,   leagues: 1,
      features: ['fixtures', 'basic odds'], resell: false },
    { tier: 'starter',    price_usd_mo: 29,    req_per_month: 50000,
      leagues: 10, features: ['+ xG', '+ predictions básicas'], resell: false },
    { tier: 'pro',        price_usd_mo: 99,    req_per_month: 500000,  leagues: 'all (~1500)',
      features: ['+ Poisson v3', '+ cup pedigree', '+ streak analysis', '+ briefing', '+ 3 webhooks'], resell: false },
    { tier: 'business',   price_usd_mo: 349,   req_per_month: 2000000, leagues: 'all',
      features: ['+ latência prioritária', '+ suporte email', '+ direito comercial agregado'], resell: 'aggregated' },
    { tier: 'enterprise', price_usd_mo: 1500,  req_per_month: 'custom', leagues: 'all',
      features: ['+ SLA 99.9%', '+ contrato redistribuição', '+ modelos customizados', '+ dedicated endpoints'],
      resell: 'full' },
  ],
  notes: [
    'Preços em USD/mês, billing mensal ou anual (-15%).',
    'Tiers Business+ incluem redistribuição agregada (não raw feed).',
    'Para contratos enterprise pass-through (Sportradar/Opta white-label), entre em contato.',
  ],
};

const SOURCES = {
  core: [
    { name: 'SportMonks (Advanced+)',    role: 'xG, predictions, pressure',   resell: 'aggregated-ok', cost_usd_mo: 199 },
    { name: 'The Odds API',              role: '70+ bookmakers, live odds',   resell: 'with-value-add', cost_usd_mo: 119 },
    { name: 'Football-Data.org (Tier 2)',role: 'Fixtures/tables top ligas',    resell: 'with-attribution', cost_usd_mo: 110 },
    { name: 'API-Football',              role: 'Fallback broad coverage',      resell: 'ambiguous-ask', cost_usd_mo: 39 },
    { name: 'ESPN public API',           role: 'Forma recente, lineups, H2H',  resell: 'internal-use', cost_usd_mo: 0 },
  ],
  training: [
    { name: 'Football-Data.co.uk', license: 'CC-BY', use: 'Backtest + calibration' },
    { name: 'StatsBomb Open Data', license: 'Non-commercial', use: 'Treinar xG próprio (outputs são nossos)' },
    { name: 'FBref',               license: 'Uso atribuído',  use: 'Histórico de rankings/ratings' },
    { name: 'OpenFootball',        license: 'Domínio público', use: 'Fixtures de bootstrap' },
  ],
  avoid: [
    { name: 'Sportradar / Stats Perform (Opta)', reason: 'Redistribuição proibida — exige licença dedicada' },
    { name: 'Transfermarkt, WhoScored, FotMob',   reason: 'Scraping proibido por TOS, risco jurídico' },
    { name: 'Betfair / Pinnacle feeds',           reason: 'Redistribuição comercial proibida' },
  ],
};

export function handleDocs(pathname) {
  if (pathname === '/v1/docs/model-card') {
    return new Response(JSON.stringify(sbResponse({ data: MODEL_CARD })), {
      status: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=3600' },
    });
  }
  if (pathname === '/v1/docs/pricing') {
    return new Response(JSON.stringify(sbResponse({ data: PRICING })), {
      status: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=3600' },
    });
  }
  if (pathname === '/v1/docs/sources') {
    return new Response(JSON.stringify(sbResponse({ data: SOURCES })), {
      status: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=3600' },
    });
  }
  if (pathname === '/v1/docs' || pathname === '/v1/docs/') {
    return new Response(JSON.stringify(sbResponse({
      data: {
        available: [
          'GET /v1/docs/model-card — Transparência do modelo Poisson v3',
          'GET /v1/docs/pricing    — Tabela de planos (free → enterprise)',
          'GET /v1/docs/sources    — Fontes de dados e licenciamento',
        ],
      },
    })), { status: 200, headers: corsHeaders() });
  }
  return new Response(JSON.stringify({ ok: false, error: 'Doc not found' }),
    { status: 404, headers: corsHeaders() });
}
