// ─── Partidas em Destaque — ordem automática ─────────────────────────────────
// Prioridade: 0=Bet365 live (API) → 1=Brasil principal (Brasileirão/Copa/Libertadores/Sulamericana/Série B) → 2=resto → 3=juvenil/feminino
// Jogos juvenis/femininos ficam no final independente da liga

const WORKER_BASE = 'https://sportsbrain-api.sportsbrain-api.workers.dev'
const SESSION_KEY = 'sb_featured_v2'
const SESSION_TTL = 30 * 60 * 1000

// ── Busca partidas Bet365 (cache 30 min) ──────────────────────────────────────
export async function fetchFeaturedMatches() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      if (c?.ts && Date.now() - c.ts < SESSION_TTL) return c.matches || []
    }
  } catch {}
  try {
    const res  = await fetch(`${WORKER_BASE}/v1/featured`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return []
    const data = await res.json()
    const matches = data.matches || []
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ matches, ts: Date.now() })) } catch {}
    return matches
  } catch { return [] }
}

// ── Detecta jogos juvenis / femininos ─────────────────────────────────────────
// Checa o nome ORIGINAL (antes de normalizar) para pegar padrões como "U20", "Women"
function isYouthOrWomen(league) {
  const l = (league || '').toLowerCase()
  return /\bu\d{2}\b|sub[-\s]?\d{2}|women|feminino|feminina|\bw\b|frauen|juvenil|youth|sub20|sub17|sub21|sub23/.test(l)
}

// ── Normalização ──────────────────────────────────────────────────────────────
function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[éèêë]/g,'e').replace(/[íìî]/g,'i')
    .replace(/[óòôõö]/g,'o').replace(/[úùûü]/g,'u').replace(/[ñ]/g,'n')
    .replace(/[ç]/g,'c').replace(/[^a-z0-9]/g,'')
}

function teamMatch(a, b) {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const s = Math.min(na.length, nb.length, 8)
  return s >= 5 && na.substring(0, s) === nb.substring(0, s)
}

// ── Checa se jogo está na lista Bet365 ────────────────────────────────────────
export function isMatchFeatured(home, away, featuredList) {
  if (!featuredList?.length) return false
  return featuredList.some(f => teamMatch(home, f.home_team) && teamMatch(away, f.away_team))
}

// ── Ligas europeias top (aparecem na seção de destaque da Bet365) ─────────────
const TOP_EURO = [
  'premier league', 'la liga', 'bundesliga', 'ligue 1',
  'champions league', 'europa league', 'conference league',
  // serie a só da Itália — evita cruzamento com brasileirao serie a
]

function isTopEuroLeague(league) {
  if (isYouthOrWomen(league)) return false
  const lg = norm(league)
  // "serie a" só se não for brasileiro
  if (lg.includes(norm('serie a')) && !lg.includes('brasil') && !lg.includes('bra')) return true
  return TOP_EURO.some(el => lg.includes(norm(el)))
}

// ── Brasil PRINCIPAL — Série A, B, Copa do Brasil, Libertadores, Sul/Sudamericana ─
// Usa match exato de início para não capturar "Brasileiro U20 A" com "brasileiro"
// Nomes ESPN: "Brasileirão A", "Brasileirão B", "Copa Libertadores", "Copa Sudamericana"
// Nomes API-Football: "Copa do Brasil", "Brasileirao Serie A", etc.
const BRAZIL_MAIN_PATTERNS = [
  /^brasileirao/,       // "Brasileirão A/B" (ESPN) e "Brasileirao Serie A" (API-F)
  /^campeonato\s*brasileiro(?!\s*(u\d+|sub|fem|women))/,
  /^brasileiro\s*serie\s*[ab]/,
  /^serie\s*[ab]\s*(brasil|bra)/,
  /^copa\s*do\s*brasil/,                // "Copa do Brasil" (API-Football)
  /^brazil\s*copa/,                     // "Brazil Copa Do Brasil" (TheOddsAPI)
  /^copa\s*libertadores/,               // "Copa Libertadores" (ESPN)
  /^copa\s*su[dl]americana/,            // "Copa Sulamericana" OU "Copa Sudamericana" (ESPN)
  /^conmebol\s*libertadores/,           // variante com prefixo CONMEBOL
  /^conmebol\s*su[dl]amer/,             // "CONMEBOL Sudamericana/Sulamericana"
  /^brasileirao\s*serie\s*[ab]/,
]

function isBrazilMainLeague(league) {
  if (isYouthOrWomen(league)) return false
  const lg = norm(league)
  return BRAZIL_MAIN_PATTERNS.some(re => re.test(lg))
}

// Série B sozinha (sem sufixo brasil) — para quando o nome é só "Série B"
function isSerieB(league) {
  if (isYouthOrWomen(league)) return false
  const l = (league || '').toLowerCase()
  return /\bs[eé]rie\s*b\b/.test(l) && !l.match(/u\d{2}|sub|fem|women/)
}

// ── Prioridade: 0=Bet365 live, 1=Brasil principal, 2=outros, 3=juvenil ─────────
export function matchPriority(home, away, league, featuredList) {
  // Bet365 live data (se disponível via API)
  if (featuredList?.length && isMatchFeatured(home, away, featuredList)) return 0
  // Juvenil/feminino sempre no fundo
  if (isYouthOrWomen(league)) return 3
  // Brasil principal: Brasileirão, Copa do Brasil, Libertadores, Sulamericana, Série B
  if (isBrazilMainLeague(league) || isSerieB(league)) return 1
  // Resto das ligas (europeias, MLS, etc.)
  return 2
}

// Exports de compatibilidade
export function isFeaturedLeague(league) {
  return isTopEuroLeague(league) || isBrazilMainLeague(league) || isSerieB(league)
}
export function isBrazilLeague(league) { return isBrazilMainLeague(league) || isSerieB(league) }
