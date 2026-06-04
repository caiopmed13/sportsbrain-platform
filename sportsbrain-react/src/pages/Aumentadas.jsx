// ═══════════════════════════════════════════════════════════════════════════
// Aumentadas — Dashboard dedicado das Apostas Aumentadas Bet365
// ═══════════════════════════════════════════════════════════════════════════
// Pega os boosts capturados via bookmarklet/MCP/paste, classifica por esporte
// e liga, ranqueia por EV, mostra verdict (OURO/VALUE/FAIR/TRAP) com filtros.
// Persiste em localStorage. Atualizável a qualquer hora.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { parseBoostText, analyzeBoost, suggestSimilarCombos, inferSportFromCompetition } from '../utils/boostBuilder'

const STORAGE_KEY = 'sb_aumentadas_v1'
const WORKER_URL = 'https://sportsbrain-api.sportsbrain-api.workers.dev/v1/aumentadas/latest'
const TRIGGER_URL = 'https://sportsbrain-api.sportsbrain-api.workers.dev/v1/aumentadas/trigger'

function load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} } }
function save(d) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch {} }

// Converte boosts estruturados (do worker) em texto formatado pro parser.
// Insere [SPORT:competition] como tag pro parser preservar sport/competition.
// Sempre formata odds com 2 decimais — o regex do parser exige `\d+[.,]\d+`,
// senão odds inteiras (ex: 11, 10) seriam ignoradas e o boost ficaria sem
// boostedOdd → verdict='unknown'.
function fmtOdd(n) {
  if (n == null) return null
  const num = typeof n === 'number' ? n : parseFloat(String(n).replace(',', '.'))
  if (!Number.isFinite(num)) return null
  return num.toFixed(2)
}
function boostsToText(boosts) {
  return boosts.map(b => {
    const lines = []
    if (b.competition) lines.push(`[SPORT:${b.competition}]`)
    if (b.home && b.away) lines.push(`${b.home} v ${b.away}`)
    else lines.push('? v ?')
    for (const l of (b.legs || [])) {
      const txt = typeof l === 'string' ? l : (l.text || l)
      lines.push(`- ${txt}`)
    }
    const orig = fmtOdd(b.origOdd)
    const boost = fmtOdd(b.boostOdd)
    if (orig && boost) lines.push(`${orig} >> ${boost}`)
    else if (boost)   lines.push(`${boost}`)
    return lines.join('\n')
  }).join('\n\n')
}

// Categorização por esporte. Prioridade:
//   1) boost.sport (vindo do parser via tag [SPORT:...])
//   2) boost.competition mapeado por inferSportFromCompetition
//   3) Fallback heurístico baseado em times/keywords (compatibilidade c/ texto antigo)
function inferSport(boost) {
  // 1) Sport canônico já decidido pelo parser
  if (boost.sport) return boost.sport
  if (boost.match?.sport) return boost.match.sport
  // 2) Competition raw da Bet365
  const compSport = inferSportFromCompetition(boost.competition || boost.match?.competition)
  if (compSport) return compSport
  // 3) Fallback heurístico (boosts antigos sem competition).
  // Ordem importa: esportes mais específicos primeiro pra evitar falsos positivos
  // (ex: "Santos Laguna" não pode matchar "santos" do Brasileirão).
  const home = (boost.match?.home || '').toLowerCase()
  const away = (boost.match?.away || '').toLowerCase()
  const txt = `${home} ${away} ${boost.legs.map(l => l.text || l).join(' ')}`.toLowerCase()
  // Basquete (jargão exclusivo)
  if (/\b(pontos|rebotes|cestas?\s*de\s*3)\b|assist[eêi]ncias?/i.test(txt)) {
    if (/\b(nbb|f[óo]rmula|franca|paulistano|pinheiros|mogi|minas\s*tênis|caxias\s*basquete|brasília\s*basquete)\b/i.test(txt)) return 'NBB'
    return 'NBA'
  }
  // Players/Teams NBA conhecidos (para boosts sem keywords de stat)
  if (/\b(cunningham|jokic|edwards|brunson|tatum|durant|curry|james\s+harden|lebron|giannis|antetokounmpo|nuggets|knicks|pistons|thunder|suns|celtics|warriors|lakers|bucks|76ers|heat|nets|raptors|grizzlies|wizards|mavericks|hawks|hornets|cavaliers|magic|trail\s*blazers|timberwolves|kings|spurs|jazz|rockets|clippers|pelicans|orl\s+magic|det\s+pistons|min\s+timberwolves|atl\s+hawks|bos\s+celtics|tor\s+raptors|por\s+trail|okc\s+thunder|hou\s+rockets|la\s+lakers|sa\s+spurs|bkn\s+nets|cle\s+cavaliers)\b/.test(txt)) return 'NBA'
  // Tênis
  if (/\b(t[êe]nis|tennis|atp|wta|paolini|sabalenka|moutet|shapovalov|medvedev|alcaraz|sinner|djokovic)\b/i.test(txt)) return 'Tênis'
  // MMA
  if (/\b(mma|ufc|round|nocaute|sterling|zalal|dumont|grant|buchecha|chimaev)\b/i.test(txt)) return 'MMA/UFC'
  // eSports
  if (/\b(esports?|karmine|shifters|bnk|fearx|gen\.g|nongshim|fnatic|natus|dignitas|t1)\b|map\s*\d|hltv/i.test(txt)) return 'eSports'
  // Liga MX / MLS / Sul-Americano (excluir antes do Brasileirão)
  if (/\b(monterrey|santos\s+laguna|club\s+am[ée]rica|tigres|cruz\s+azul|chivas|guadalajara|pachuca|toluca|necaxa|mazatl[áa]n|ju[áa]rez|querétaro|atlas|le[óo]n|puebla|atlante|pumas)\b/i.test(txt)) return 'Outros'
  if (/\b(la\s+galaxy|real\s+salt\s+lake|inter\s+miami|nashville|minnesota\s+united|seattle\s+sounders|cf\s+montréal|portland\s+timbers|chicago\s+fire|new\s+york\s+(?:city|red)|columbus|atlanta\s+united|san\s+jose\s+earthquakes|colorado\s+rapids|orlando\s+city|charlotte\s+fc|austin\s+fc|vancouver\s+whitecaps|fc\s+dallas|st\.?\s*louis\s+city|dc\s+united)\b/i.test(txt)) return 'Outros'
  if (/\b(belgrano|newell|atl[ée]tico\s+tucum[áa]n|river\s+plate|boca\s+juniors|racing\s+club|independiente|estudiantes|talleres|huracán|defensa\s+y\s+justicia|godoy\s+cruz|lan[úu]s)\b/i.test(txt)) return 'Outros'
  // Brasileirão (clubes BR — usa boundary pra "santos" não pegar Santos Laguna)
  if (/\b(bahia|santos|botafogo|internacional|cruzeiro|remo|s[ãa]o\s+paulo|mirassol|corinthians|vasco|gr[êe]mio|coritiba|athletico|vit[óo]ria|bragantino|palmeiras|atl[ée]tico\s+mineiro|flamengo|fluminense|chapecoense|sport\s+recife|novorizontino|juventude|londrina|cear[áa]|fortaleza|atl[ée]tico\s+go|crici[úu]ma|ava[íi]|crb|oper[áa]rio|botafogo\s+sp|cuiab[áa]|athletic\s+club\s+mg|n[áa]utico)\b/i.test(txt)) return 'Brasileirão'
  // Futebol Europa
  if (/\b(bologna|roma|man\s+city|southampton|arsenal|newcastle|hamburgo|hoffenheim|val[êe]ncia|girona|angers|psg|benfica|moreirense|verona|lecce|atl[ée]tico\s+de\s+madrid|athletic\s+bilbao|toulouse|monaco|liverpool|crystal\s+palace|west\s+ham|everton|wolverhampton|tottenham|getafe|barcelona|bayern|napoli|inter\s+de\s+mil|juventus|chelsea|leeds|stuttgart|bremen|dortmund|freiburg|paris|lille|galatasaray|fenerbah|estrela|porto|sporting|marselha|nice|villarreal|celta|sevilha|osasuna|cagliari|lazio|espanhol)\b/i.test(txt)) return 'Futebol Europa'
  return 'Outros'
}

const SPORT_COLORS = {
  'Brasileirão':       'var(--green)',
  'Futebol Europa':    '#5ecbff',
  'NBA':               '#ff7a1a',
  'NBB':               '#ffb830',
  'Tênis':             '#a855f7',
  'MMA/UFC':           'var(--red)',
  'eSports':           '#c084fc',
  'Outros':            'var(--mute)',
}

function verdictColor(v) {
  if (v === 'gold')  return 'var(--green)'
  if (v === 'value') return '#5ecbff'
  if (v === 'fair')  return 'var(--amber)'
  if (v === 'trap')  return 'var(--red)'
  return 'var(--mute)'
}
function verdictTag(v) {
  if (v === 'gold')  return '🏆 OURO'
  if (v === 'value') return '💎 VALUE'
  if (v === 'fair')  return '➖ FAIR'
  if (v === 'trap')  return '🪤 TRAP'
  return '?'
}

// 49 boosts capturados em 2026-04-25 via Bet365 home (amostra inicial)
const SEED_TEXT = `Bologna v Roma
- Resultado Final: Roma
- Donyell Malen: 2+ Chutes ao Gol
- Matias Soule: 2+ Chutes ao Gol
9.50 >> 11.00

Atlético de Madrid v Athletic Bilbao
- Alexander Sorloth: 2+ Chutes ao Gol
- Julian Alvarez: 2+ Chutes ao Gol
- Resultado Final: Atlético de Madrid
10.00 >> 11.00

Bologna v Roma
- Resultado Final: Roma
- Maior Número de Escanteios: Roma
- Maior Número de Chutes ao Gol: Roma
- Maior Número de Cartões: Bologna
17.00 >> 19.00

Arsenal v Newcastle
- Mais de 1 Escanteios no 1º Tempo para Newcastle
- Mais de 1 Escanteios no 1º Tempo para Arsenal
- Mais de 1 Escanteios no 2º Tempo para Arsenal
- Mais de 1 Escanteios no 2º Tempo para Newcastle
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Arsenal
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Arsenal
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Newcastle
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Newcastle
36.00 >> 41.00

Angers v PSG
- Resultado Final: PSG
- Ousmane Dembele: 2+ Chutes ao Gol
- Desire Doue: 2+ Chutes ao Gol
4.00 >> 4.25

Atlético de Madrid v Athletic Bilbao
- Para Ambos os Times Marcarem
- Alexander Sorloth: 2+ Chutes ao Gol
- Inaki Williams: 2+ Chutes ao Gol
9.00 >> 10.00

Bahia v Santos
- Bahia - Mais de 2.5 Chutes ao Gol
- Santos - Mais de 2.5 Chutes ao Gol
- Para Ambos os Times Marcarem
2.40 >> 3.50

Sport Recife v Novorizontino
- Chrystian Barletta: 2+ Chutes ao Gol
- Pedro Perotti: 2+ Chutes ao Gol
- Resultado Final: Sport Recife
21.00 >> 23.00

Juventude v Londrina
- Alan Kardec: 2+ Chutes ao Gol
- Bruno Santos de Oliveira: 2+ Chutes ao Gol
- Para Ambos os Times Marcarem
12.00 >> 13.00

Sport Recife v Novorizontino
- Resultado Final: Sport Recife
- Maior Número de Cartões: Novorizontino
- Maior Número de Escanteios: Sport Recife
- Maior Número de Chutes ao Gol: Sport Recife
- Maior Número de Chutes: Sport Recife
13.00 >> 15.00

Juventude v Londrina
- Bruno Santos de Oliveira: 1+ Chutes ao Gol
- Cantanhede Thalis: 1+ Chutes ao Gol
- Resultado Final: Londrina
11.00 >> 12.00

Sport Recife v Novorizontino
- Mais de 1 Escanteios no 1º Tempo para Sport Recife
- Mais de 1 Escanteios no 2º Tempo para Sport Recife
- Mais de 1 Escanteios no 1º Tempo para Novorizontino
- Mais de 1 Escanteios no 2º Tempo para Novorizontino
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Sport Recife
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Sport Recife
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Novorizontino
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Novorizontino
17.00 >> 19.00

Juventude v Londrina
- Mais de 1 Escanteios no 1º Tempo para Juventude
- Mais de 1 Escanteios no 2º Tempo para Juventude
- Mais de 1 Escanteios no 1º Tempo para Londrina
- Mais de 1 Escanteios no 2º Tempo para Londrina
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Juventude
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Juventude
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Londrina
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Londrina
21.00 >> 23.00

Bahia v Santos
- Mais de 1 Escanteios no 1º Tempo para Bahia
- Mais de 1 Escanteios no 2º Tempo para Bahia
- Mais de 1 Escanteios no 1º Tempo para Santos
- Mais de 1 Escanteios no 2º Tempo para Santos
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Bahia
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Bahia
- Mais de 1.5 Chutes ao Gol no 1º Tempo para Santos
- Mais de 1.5 Chutes ao Gol no 2º Tempo para Santos
19.00 >> 21.00`

const EXTRACTOR_JS = `(() => {
  const all = Array.from(document.querySelectorAll('div'));
  const cands = [];
  for (const el of all) {
    const t = (el.innerText || '').trim();
    if (!t || t.length < 50 || t.length > 800) continue;
    const lines = t.split('\\n').map(l => l.trim()).filter(Boolean);
    let pairs = 0, pairAt = -1;
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\\d{1,3}[.,]\\d{2}$/.test(lines[i]) && /^\\d{1,3}[.,]\\d{2}$/.test(lines[i+1])) {
        const oa = parseFloat(lines[i].replace(',', '.'));
        const ob = parseFloat(lines[i+1].replace(',', '.'));
        if (ob > oa && ob/oa < 2.5) { pairs++; pairAt = i; }
      }
    }
    if (pairs !== 1) continue;
    const matchRx = /^([A-Z\\u00C0-\\u00DA][\\w\\s\\u00E1\\u00E9\\u00ED\\u00F3\\u00FA\\u00E2\\u00EA\\u00F4\\u00E3\\u00F5\\u00E7.'\\-]{1,40}?)\\s+v\\s+([A-Z\\u00C0-\\u00DA][\\w\\s\\u00E1\\u00E9\\u00ED\\u00F3\\u00FA\\u00E2\\u00EA\\u00F4\\u00E3\\u00F5\\u00E7.'\\-]{1,40}?)$/;
    let home = null, away = null, headerIdx = -1;
    for (let i = 0; i < pairAt; i++) {
      const m = lines[i].match(matchRx);
      if (m) { home = m[1].trim(); away = m[2].trim(); headerIdx = i; }
    }
    const legs = lines.slice(headerIdx >= 0 ? headerIdx + 1 : 0, pairAt).filter(l =>
      l.length > 5 && l.length < 150 &&
      !/^\\d+([.,]\\d+)?\\s*(mil|k)?$/i.test(l) &&
      !/Pagamento Antecipado|R\\$\\s*\\d|^Ver mais|^[+\\-]\\d|ACUMULADORES|^Acumuladores|AUMENTAD[OA]S?$/i.test(l)
    );
    if (legs.length < 1) continue;
    cands.push({ home, away, legs, origOdd: lines[pairAt], boostOdd: lines[pairAt+1], area: el.getBoundingClientRect().width * el.getBoundingClientRect().height });
  }
  const map = {};
  for (const c of cands) {
    const k = (c.home || '?') + '|' + (c.away || '?') + '|' + c.boostOdd + '|' + (c.legs[0] || '').slice(0, 40);
    if (!map[k] || c.area < map[k].area) map[k] = c;
  }
  const out = Object.values(map);
  const formatted = out.map(c => {
    const lines = [];
    if (c.home && c.away) lines.push(c.home + ' v ' + c.away);
    else lines.push('? v ?');
    for (const l of c.legs) lines.push('- ' + l);
    lines.push(c.origOdd + ' >> ' + c.boostOdd);
    return lines.join('\\n');
  }).join('\\n\\n');
  navigator.clipboard.writeText(formatted).then(() => {
    alert('✓ ' + out.length + ' boosts copiados!\\n\\nVai pro SportsBrain → /aumentadas → "Colar do Clipboard".');
  }).catch(() => {
    const w = window.open('', '_blank', 'width=600,height=500');
    if (w) w.document.write('<pre style="font-family:monospace;font-size:12px;padding:20px;white-space:pre-wrap;">' + formatted.replace(/</g, '&lt;') + '</pre>');
  });
})();`

// Ícone por tipo de leg
function legIcon(code) {
  // NBA player props
  if (code && code.startsWith('PTS')) return '🏀'
  if (code && code.startsWith('REB')) return '🔃'
  if (code && code.startsWith('AST')) return '🤝'
  if (code && code.startsWith('TPM')) return '3️⃣'
  if (code === 'PRA' || code === 'NTPTS' || code === 'NTPT') return '📊'
  if (code === 'NRH' || code === 'NRA') return '🏆'
  if (code === 'NFB') return '⏱'
  // Futebol resultado
  if (code === 'RH' || code === 'RA' || code === 'RD') return '🎯'
  if (code === 'BY' || code === 'BN') return '⚽'
  if (code === 'O15' || code === 'O25' || code === 'O35' || code === 'TO15' || code === 'TO25') return '📈'
  if (code === 'PS' || code === 'P2G') return '⚽'
  if (code === 'PH') return '🎩'
  if (code === 'PA') return '🅰'
  if (code === 'PSH3' || code === 'PSH2' || code === 'PSH1' || code === 'PSH15' || code === 'PSH05' || code === 'PSO') return '🎯'
  if (code === 'TS25' || code === 'TS15' || code === 'TSHT15' || code === 'ST' || code === 'STT') return '🎯'
  if (code === 'CHT1' || code === 'CT' || code === 'TCHT1') return '🚩'
  if (code === 'KT') return '🟨'
  return '•'
}

// Card individual estilo SGP — header + legs detalhadas + análise
function BoostCard({ analyzed, sport }) {
  const [expanded, setExpanded] = useState(false)
  const suggestions = expanded ? suggestSimilarCombos(analyzed) : []
  const v = analyzed.verdict
  const accent = verdictColor(v)
  const isGold = v === 'gold'
  const bg = isGold
    ? 'linear-gradient(135deg, rgba(0,214,143,.10), rgba(0,214,143,.02))'
    : v === 'value'
      ? 'linear-gradient(135deg, rgba(94,203,255,.08), rgba(94,203,255,.02))'
      : v === 'trap'
        ? 'linear-gradient(135deg, rgba(255,79,106,.06), rgba(255,79,106,.01))'
        : 'rgba(255,255,255,.02)'
  const boostBoost = analyzed.originalOdd && analyzed.boostedOdd
    ? +((analyzed.boostedOdd / analyzed.originalOdd - 1) * 100).toFixed(1) : null

  return (
    <div className="pick-card" style={{
      padding: '12px 14px',
      background: bg,
      borderColor: `${accent}40`,
      borderLeft: `3px solid ${accent}`,
      position: 'relative',
    }}>
      {/* Header: tipo + EV */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10, gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4, flexWrap:'wrap' }}>
            <span style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:800,
              letterSpacing:'.08em', color:accent, background:`${accent}18`,
              padding:'2px 7px', borderRadius:3, border:`1px solid ${accent}30`,
            }}>
              {verdictTag(v)}
            </span>
            <span style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
              color: SPORT_COLORS[sport] || 'var(--mute)',
              padding:'2px 6px', borderRadius:3,
              background:`${SPORT_COLORS[sport] || '#888'}10`,
              border:`1px solid ${SPORT_COLORS[sport] || '#888'}25`,
            }}>{sport}</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)' }}>
              {analyzed.legs.length} legs
            </span>
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--white)' }}>
            🚀 Aposta Aumentada · {analyzed.legs.length}-leg
          </div>
          <div style={{ fontSize:10, color:'var(--mute)', marginTop:1, fontFamily:"'JetBrains Mono',monospace" }}>
            prob conjunta: {analyzed.jointPct}% · fair odd: {analyzed.fairOdd}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
          <div style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:18, fontWeight:900,
            color: accent, lineHeight: 1,
          }}>
            {analyzed.ev > 0 ? '+' : ''}{analyzed.ev}%
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'var(--mute)' }}>
            EV%
          </div>
        </div>
      </div>

      {/* Legs box (estilo SGP) */}
      <div style={{
        display:'flex', flexDirection:'column', gap:5, marginBottom:8,
        padding:'8px 10px', background:'rgba(0,0,0,.25)', borderRadius:6,
      }}>
        {analyzed.legs.map((leg, i) => {
          const probColor = leg.prob >= 0.6 ? 'var(--green)' : leg.prob >= 0.4 ? 'var(--amber)' : 'var(--red)'
          return (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:8, fontSize:11.5, flexWrap:'wrap',
            }}>
              <span style={{ fontSize:14 }}>{legIcon(leg.code)}</span>
              <span style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:800,
                color: probColor, minWidth:38, textAlign:'right',
              }}>
                {leg.probPct}%
              </span>
              <span style={{ color:'var(--soft)', flex:1, minWidth:0,
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {leg.text}
              </span>
              <span style={{
                fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:700,
                color: probColor, background:`${probColor}15`,
                padding:'1px 5px', borderRadius:3, border:`1px solid ${probColor}30`,
              }}>
                {leg.code}
              </span>
            </div>
          )
        })}
      </div>

      {/* Odd info — boost original vs boostada */}
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'6px 10px',
        background:'rgba(0,0,0,.15)', borderRadius:5, marginBottom:8,
        fontFamily:"'JetBrains Mono',monospace", fontSize:11, flexWrap:'wrap',
      }}>
        <span style={{ color:'var(--mute)' }}>odd:</span>
        {analyzed.originalOdd && (
          <span style={{ color:'var(--mute)', textDecoration:'line-through' }}>
            {analyzed.originalOdd}
          </span>
        )}
        <span style={{ color:'var(--green)', fontWeight:800, fontSize:13 }}>
          {analyzed.boostedOdd}
        </span>
        {boostBoost != null && (
          <span style={{ color:'#ffd166', fontSize:10 }}>
            (+{boostBoost}% boost do book)
          </span>
        )}
        <span style={{ color:'var(--mute)', marginLeft:'auto' }}>
          implied {analyzed.impliedPct}% · edge {analyzed.edge > 0 ? '+' : ''}{analyzed.edge}pp
        </span>
      </div>

      {/* Vibes/insights badges */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom: expanded ? 8 : 0 }}>
        {isGold && (
          <span style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--green)', background:'rgba(0,214,143,.15)',
            padding:'2px 7px', borderRadius:3, border:'1px solid rgba(0,214,143,.3)',
          }}>
            🏆 OURO — vale apostar
          </span>
        )}
        {v === 'value' && (
          <span style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'#5ecbff', background:'rgba(94,203,255,.15)',
            padding:'2px 7px', borderRadius:3, border:'1px solid rgba(94,203,255,.3)',
          }}>
            💎 EV positivo
          </span>
        )}
        {v === 'trap' && analyzed.legs.length >= 6 && (
          <span style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--red)', background:'rgba(255,79,106,.12)',
            padding:'2px 7px', borderRadius:3, border:'1px solid rgba(255,79,106,.3)',
          }}>
            🪤 TRAP — {analyzed.legs.length} legs multiplicam ruído
          </span>
        )}
        {v === 'trap' && analyzed.legs.length < 6 && (
          <span style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--red)', background:'rgba(255,79,106,.12)',
            padding:'2px 7px', borderRadius:3, border:'1px solid rgba(255,79,106,.3)',
          }}>
            🪤 odd boostada não cobre o vig
          </span>
        )}
        {analyzed.legs.some(l => l.code === 'PH') && (
          <span style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--amber)', background:'rgba(255,184,48,.12)',
            padding:'2px 7px', borderRadius:3,
          }}>
            ⚠ leg cabeça (~8% só)
          </span>
        )}
        {analyzed.legs.length >= 7 && (
          <span style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:10, fontWeight:700,
            color:'var(--amber)', background:'rgba(255,184,48,.12)',
            padding:'2px 7px', borderRadius:3,
          }}>
            ⚠ {analyzed.legs.length} legs muito agressivo
          </span>
        )}

        <button onClick={() => setExpanded(e => !e)} style={{
          marginLeft:'auto', fontFamily:"'JetBrains Mono',monospace", fontSize:10,
          background:'none', border:'1px solid var(--line)', color:'var(--mute)',
          padding:'2px 8px', borderRadius:3, cursor:'pointer',
        }}>
          {expanded ? '▼ esconder análise' : '▶ ver sugestões'}
        </button>
      </div>

      {/* Análise expandida — sugestões de combos similares */}
      {expanded && suggestions.length > 0 && (
        <div style={{
          paddingTop: 8, borderTop:'1px dashed var(--line)',
        }}>
          <div style={{
            fontSize: 10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace",
            marginBottom: 6, letterSpacing:'.04em', textTransform:'uppercase',
          }}>
            💡 Combos similares com mais chance de bater
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {suggestions.slice(0, 3).map((s, i) => (
              <div key={i} style={{
                fontSize: 10, padding:'6px 8px', borderRadius:4,
                background: s.ev > analyzed.ev ? 'rgba(0,214,143,.06)' : 'rgba(255,255,255,.02)',
                border: `1px solid ${s.ev > analyzed.ev ? 'rgba(0,214,143,.2)' : 'var(--line)'}`,
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:6, marginBottom:2 }}>
                  <span style={{ color:'var(--white)', fontWeight:700 }}>{s.label}</span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace",
                    color: s.ev > analyzed.ev ? 'var(--green)' : 'var(--mute)', fontWeight: 800 }}>
                    {s.jointPct}% · {s.ev > 0 ? '+' : ''}{s.ev}% EV
                  </span>
                </div>
                <div style={{ fontSize: 9, color:'var(--mute)' }}>{s.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Header colapsável de um jogo (estilo BkProps SGP)
function MatchSection({ matchKey, matchInfo, boosts, isOpen, onToggle }) {
  const goldCount  = boosts.filter(b => b.verdict === 'gold').length
  const valueCount = boosts.filter(b => b.verdict === 'value').length
  const trapCount  = boosts.filter(b => b.verdict === 'trap').length
  const bestEV = boosts.length ? Math.max(...boosts.map(b => b.ev)) : null

  return (
    <div className="pick-card" style={{ marginBottom:12, padding:0, overflow:'hidden' }}>
      <div onClick={onToggle} style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', cursor:'pointer',
        background: bestEV >= 8 ? 'rgba(0,214,143,.08)'
                  : bestEV >= 3 ? 'rgba(94,203,255,.06)'
                  : 'rgba(255,255,255,.03)',
        borderBottom: isOpen ? '1px solid var(--border)' : 'none',
      }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:14, color:'var(--white)',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {matchInfo.title}
          </div>
          <div style={{ fontSize:11, color:'var(--mute)', marginTop:2,
            display:'flex', gap:8, flexWrap:'wrap', fontFamily:"'JetBrains Mono',monospace" }}>
            <span style={{ color: SPORT_COLORS[matchInfo.sport] || 'var(--mute)' }}>
              {matchInfo.sport}
            </span>
            {bestEV != null && (
              <span style={{ color: bestEV > 3 ? 'var(--green)' : bestEV < -3 ? 'var(--red)' : 'var(--amber)', fontWeight:700 }}>
                · best {bestEV > 0 ? '+' : ''}{bestEV}% EV
              </span>
            )}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          {goldCount > 0 && (
            <span style={{ fontSize:9, fontFamily:"'JetBrains Mono',monospace", fontWeight:800,
              color:'var(--green)', background:'rgba(0,214,143,.15)',
              padding:'3px 7px', borderRadius:3 }}>🏆 {goldCount}</span>
          )}
          {valueCount > 0 && (
            <span style={{ fontSize:9, fontFamily:"'JetBrains Mono',monospace", fontWeight:800,
              color:'#5ecbff', background:'rgba(94,203,255,.15)',
              padding:'3px 7px', borderRadius:3 }}>💎 {valueCount}</span>
          )}
          {trapCount > 0 && (
            <span style={{ fontSize:9, fontFamily:"'JetBrains Mono',monospace", fontWeight:800,
              color:'var(--red)', background:'rgba(255,79,106,.12)',
              padding:'3px 7px', borderRadius:3 }}>🪤 {trapCount}</span>
          )}
          <span style={{ fontSize:11, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace" }}>
            {boosts.length} aumentadas
          </span>
          <span style={{ color:'var(--mute)', fontSize:13 }}>{isOpen ? '▲' : '▼'}</span>
        </div>
      </div>
      {isOpen && (
        <div style={{
          padding:'12px 14px',
          display:'grid',
          gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))',
          gap:10,
        }}>
          {boosts.map((b, i) => <BoostCard key={i} analyzed={b} sport={b._sport}/>)}
        </div>
      )}
    </div>
  )
}

export default function Aumentadas() {
  const [data, setData] = useState(load)
  const [verdictFilt, setVerdictFilt] = useState('all')
  const [sportFilt, setSportFilt] = useState('all')
  const [sortBy, setSortBy] = useState('ev')
  const [showHelp, setShowHelp] = useState(false)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [triggerStatus, setTriggerStatus] = useState(null)  // { phase, etaSec, capturedAtBefore }
  const [serverStatus, setServerStatus] = useState(null)
  const [openMatches, setOpenMatches] = useState({})

  useEffect(() => { save(data) }, [data])

  // Tenta puxar do worker no boot. Se vier vazio (cron ainda não rodou), seed local.
  useEffect(() => {
    let cancelled = false
    async function fetchFromWorker() {
      try {
        const res = await fetch(WORKER_URL, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = await res.json()
        if (cancelled) return
        if (json.boosts && json.boosts.length > 0) {
          setData({
            text: boostsToText(json.boosts),
            lastUpdate: json.capturedAt || Date.now(),
            source: 'worker',
            seeded: true,
            count: json.count || json.boosts.length,
          })
          setServerStatus({ ok: true, count: json.boosts.length, capturedAt: json.capturedAt })
        } else {
          setServerStatus({ ok: true, count: 0, message: json.message })
          if (!data.text && !data.seeded) {
            setData({ text: SEED_TEXT, seeded: true, lastUpdate: Date.now(), source: 'seed' })
          }
        }
      } catch (e) {
        setServerStatus({ ok: false, error: e.message })
        if (!data.text && !data.seeded) {
          setData({ text: SEED_TEXT, seeded: true, lastUpdate: Date.now(), source: 'seed' })
        }
      }
    }
    fetchFromWorker()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshFromWorker() {
    setRefreshing(true)
    try {
      const res = await fetch(WORKER_URL, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
      const json = await res.json()
      if (json.boosts && json.boosts.length > 0) {
        setData({
          text: boostsToText(json.boosts),
          lastUpdate: json.capturedAt || Date.now(),
          source: 'worker',
          seeded: true,
        })
        setServerStatus({ ok: true, count: json.boosts.length, capturedAt: json.capturedAt })
      } else {
        alert('Worker não tem boosts ainda. Cron 2am BR roda automaticamente, ou ative manualmente no GitHub Actions.')
      }
    } catch (e) {
      alert(`Erro ao buscar do worker: ${e.message}`)
    }
    setRefreshing(false)
  }

  // Dispara GitHub Actions workflow_dispatch via worker e faz polling
  async function triggerCronNow() {
    if (triggering) return
    setTriggering(true)
    const before = data.lastUpdate || 0
    setTriggerStatus({ phase: 'dispatching', etaSec: null })
    try {
      const res = await fetch(TRIGGER_URL, { method: 'POST' })
      const json = await res.json()
      if (!json.ok) {
        const msg = json.error === 'NOT_CONFIGURED'
          ? 'Cron não configurado. Adiciona GH_PAT e GH_REPO via wrangler secret no worker.'
          : `Erro: ${json.error || res.status} ${json.detail || ''}`
        alert(msg)
        setTriggerStatus(null)
        setTriggering(false)
        return
      }
      // Polling até detectar capturedAt > before.
      // Novo scraper API: ~270s scrape + ~90s setup GH runner = ~6min total.
      // Force minimum 10min independente do que o worker retorna (worker antigo
      // retornava 300s, novo scraper precisa ~600s). Math.max garante o piso.
      const startedAt = Date.now()
      const initialEtaSec = Math.max(json.maxWaitSec || 0, 600)
      const maxMs = initialEtaSec * 1000
      const intMs = (json.pollIntervalSec || 15) * 1000
      setTriggerStatus({ phase: 'running', etaSec: initialEtaSec, started: startedAt })
      const poll = async () => {
        const elapsed = Date.now() - startedAt
        if (elapsed >= maxMs) {
          setTriggerStatus({ phase: 'timeout', message: 'Workflow demorou. Verifica em https://github.com/' + (json.repo || '') + '/actions' })
          setTriggering(false)
          return
        }
        try {
          const r = await fetch(WORKER_URL + '?t=' + Date.now(), { cache: 'no-store' })
          const j = await r.json()
          if (j.boosts && j.capturedAt && j.capturedAt > before) {
            // Atualizou!
            setData({
              text: boostsToText(j.boosts),
              lastUpdate: j.capturedAt,
              source: 'worker',
              seeded: true,
            })
            setServerStatus({ ok: true, count: j.boosts.length, capturedAt: j.capturedAt })
            setTriggerStatus({ phase: 'done', count: j.boosts.length })
            setTriggering(false)
            return
          }
        } catch {}
        setTriggerStatus(s => ({ ...s, etaSec: Math.max(0, initialEtaSec - Math.floor(elapsed/1000)) }))
        setTimeout(poll, intMs)
      }
      setTimeout(poll, intMs)
    } catch (e) {
      alert('Erro ao disparar: ' + e.message)
      setTriggerStatus(null)
      setTriggering(false)
    }
  }

  function openBet365WithExtractor() {
    navigator.clipboard.writeText(EXTRACTOR_JS).then(() => {
      window.open('https://www.bet365.bet.br/#/HO/', '_blank')
      setTimeout(() => {
        alert('✓ Abri Bet365 em nova aba\n\n📋 Extrator JS já está no seu clipboard.\n\nNa Bet365 nova aba:\n1. Aperta F12 → Console\n2. Cola (Ctrl+V) e Enter\n3. Alert vai dizer quantos boosts copiou\n4. Volta aqui e clica "📋 Colar do Clipboard"')
      }, 600)
    }).catch(() => {
      window.open('https://www.bet365.bet.br/#/HO/', '_blank')
    })
  }

  const analyzed = useMemo(() => {
    if (!data.text) return []
    const boosts = parseBoostText(data.text)
    return boosts.map(b => {
      const a = analyzeBoost(b)
      if (!a) return null
      return { ...a, _sport: inferSport(b) }
    }).filter(Boolean).sort((a, b) => b.ev - a.ev)
  }, [data.text])

  const filtered = useMemo(() => {
    let list = analyzed
    if (verdictFilt !== 'all') list = list.filter(a => a.verdict === verdictFilt)
    if (sportFilt !== 'all')   list = list.filter(a => a._sport === sportFilt)
    if (sortBy === 'ev')   list = [...list].sort((a, b) => b.ev - a.ev)
    if (sortBy === 'prob') list = [...list].sort((a, b) => b.jointProb - a.jointProb)
    if (sortBy === 'odd')  list = [...list].sort((a, b) => b.boostedOdd - a.boostedOdd)
    return list
  }, [analyzed, verdictFilt, sportFilt, sortBy])

  // Agrupa por jogo (estilo Bet365)
  const groupedByMatch = useMemo(() => {
    const groups = {}
    for (const b of filtered) {
      let key, title
      if (b.match?.home && b.match?.away) {
        key = `${b.match.home}|${b.match.away}`.toLowerCase()
        title = `${b.match.home} × ${b.match.away}`
      } else {
        // Sem header de jogo: agrupa por esporte como categoria genérica
        key = `_${b._sport}`
        title = `${b._sport} · Acumuladores e Avulsos`
      }
      if (!groups[key]) groups[key] = { key, title, sport: b._sport, boosts: [] }
      groups[key].boosts.push(b)
    }
    // Ordena: jogos com pelo menos 1 GOLD primeiro, depois por melhor EV
    return Object.values(groups).sort((a, b) => {
      const aBest = Math.max(...a.boosts.map(x => x.ev))
      const bBest = Math.max(...b.boosts.map(x => x.ev))
      const aHasGold = a.boosts.some(x => x.verdict === 'gold')
      const bHasGold = b.boosts.some(x => x.verdict === 'gold')
      if (aHasGold !== bHasGold) return bHasGold ? 1 : -1
      return bBest - aBest
    })
  }, [filtered])

  const counts = analyzed.reduce((acc, a) => {
    acc.byVerdict[a.verdict] = (acc.byVerdict[a.verdict] || 0) + 1
    acc.bySport[a._sport]    = (acc.bySport[a._sport] || 0) + 1
    return acc
  }, { byVerdict: {}, bySport: {} })

  const bestEV = analyzed.length ? Math.max(...analyzed.map(a => a.ev)) : null
  const sports = Object.keys(counts.bySport).sort()

  function copyExtractor() {
    navigator.clipboard.writeText(EXTRACTOR_JS).then(() => {
      alert('✓ Extrator copiado!\n\n1. Abre Bet365 (bet365.bet.br/#/HO/)\n2. F12 → Console\n3. Cola o código (Ctrl+V) e Enter\n4. Alert vai dizer quantos boosts copiou\n5. Volta aqui → "📋 Colar do Clipboard"')
    })
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text || text.length < 30) {
        alert('Clipboard vazio ou texto muito curto.')
        return
      }
      setData({ text, lastUpdate: Date.now(), seeded: true })
    } catch {
      setShowPaste(true)
    }
  }
  function applyPaste() {
    if (!pasteText.trim()) return
    setData({ text: pasteText.trim(), lastUpdate: Date.now(), seeded: true })
    setPasteText('')
    setShowPaste(false)
  }

  function exportCSV() {
    if (!analyzed.length) return
    const head = ['esporte','jogo','legs','odd_orig','odd_boost','prob_pct','fair_odd','ev_pct','verdict']
    const rows = analyzed.map(a => [
      a._sport,
      `${a.match?.home || '?'} × ${a.match?.away || '?'}`,
      a.legs.map(l => l.text).join(' + '),
      a.originalOdd || '',
      a.boostedOdd,
      a.jointPct,
      a.fairOdd,
      a.ev,
      a.verdict,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [head.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `aumentadas-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <PageHeader icon="🚀" title="Aumentadas Bet365"
        subtitle={data.lastUpdate
          ? `${analyzed.length} boosts · atualizado ${new Date(data.lastUpdate).toLocaleString('pt-BR')}`
          : 'Carrega os boosts e analisa EV automaticamente'}
        actions={
          <div style={{ display:'flex', gap: 6, flexWrap:'wrap' }}>
            <button onClick={triggerCronNow} disabled={triggering}
              className="btn btn-primary"
              style={{padding:'5px 12px',fontSize:11,
                background: triggering ? 'rgba(255,184,48,.15)' : 'rgba(0,214,143,.18)',
                color: triggering ? 'var(--amber)' : 'var(--green)',
                border:'1px solid currentColor', fontWeight: 700,
              }}>
              {triggering
                ? `⏳ ${triggerStatus?.phase === 'dispatching' ? 'Disparando...' : `Rodando... (${triggerStatus?.etaSec ?? '~3min'}s)`}`
                : '🚀 Rodar cron agora'}
            </button>
            <button onClick={refreshFromWorker} disabled={refreshing}
              className="btn" style={{padding:'5px 12px',fontSize:11}}>
              {refreshing ? '⏳' : '🔄'} Sincronizar
            </button>
            {/* Botão manual só aparece quando worker não tem dados (fallback) */}
            {data.source !== 'worker' && (
              <button onClick={openBet365WithExtractor} className="btn"
                style={{padding:'5px 12px',fontSize:11}}>
                🌐 Manual (Bet365)
              </button>
            )}
            <button onClick={() => setShowHelp(s => !s)} className="btn"
              style={{padding:'5px 12px',fontSize:11}}>ℹ Ajuda</button>
          </div>
        }
      />

      {/* Trigger progress banner */}
      {triggerStatus && triggerStatus.phase !== 'done' && (
        <div style={{
          background: triggerStatus.phase === 'timeout' ? 'rgba(255,79,106,.08)' : 'rgba(255,184,48,.08)',
          border:`1px solid ${triggerStatus.phase === 'timeout' ? 'var(--red)' : 'var(--amber)'}40`,
          borderRadius:'var(--r2)', padding:'10px 14px', marginBottom: 10,
          display:'flex', alignItems:'center', gap:10, fontSize: 11,
        }}>
          <span style={{ fontSize: 16 }}>
            {triggerStatus.phase === 'timeout' ? '⚠' : triggerStatus.phase === 'dispatching' ? '📡' : '⚙'}
          </span>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight: 700, color:'var(--white)' }}>
              {triggerStatus.phase === 'dispatching' && 'Disparando workflow no GitHub Actions...'}
              {triggerStatus.phase === 'running' && `GitHub Actions executando · Playwright + scrape Bet365 · ETA ${triggerStatus.etaSec}s`}
              {triggerStatus.phase === 'timeout' && (triggerStatus.message || 'Timeout — verifica em GitHub Actions')}
            </div>
            <div style={{ fontSize: 10, color:'var(--mute)', marginTop: 2 }}>
              {triggerStatus.phase === 'running' && 'Polling do worker a cada 15s. Quando capturado, atualiza automaticamente.'}
            </div>
          </div>
        </div>
      )}
      {triggerStatus?.phase === 'done' && (
        <div style={{
          background:'rgba(0,214,143,.08)',
          border:'1px solid rgba(0,214,143,.3)',
          borderRadius:'var(--r2)', padding:'10px 14px', marginBottom: 10,
          display:'flex', alignItems:'center', gap:10, fontSize: 11,
        }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <div style={{ flex:1, color:'var(--green)', fontWeight:700 }}>
            Cron rodou! {triggerStatus.count} boosts atualizados.
          </div>
          <button onClick={() => setTriggerStatus(null)} style={{
            background:'none', border:'none', color:'var(--mute)', cursor:'pointer', fontSize: 13,
          }}>×</button>
        </div>
      )}

      {/* Status server / source */}
      <div style={{
        display:'flex', gap: 6, alignItems:'center', flexWrap:'wrap',
        padding:'6px 12px', marginBottom: 10, fontSize: 10,
        fontFamily:"'JetBrains Mono',monospace",
        background:'rgba(255,255,255,.02)', borderRadius: 4,
        border: '1px solid var(--line)',
      }}>
        <span style={{ color:'var(--mute)' }}>fonte:</span>
        <span style={{ color: data.source === 'worker' ? 'var(--green)' : '#5ecbff', fontWeight: 700 }}>
          {data.source === 'worker' ? '🤖 cron 2am (worker)' : data.source === 'seed' ? '🌱 amostra inicial' : '✍ paste manual'}
        </span>
        {serverStatus && (
          <>
            <span style={{ color:'var(--mute)' }}>· server:</span>
            <span style={{ color: serverStatus.ok ? 'var(--green)' : 'var(--red)' }}>
              {serverStatus.ok
                ? `✓ ${serverStatus.count} boosts disponíveis`
                : `× ${serverStatus.error || 'offline'}`}
            </span>
          </>
        )}
        {data.lastUpdate && (
          <>
            <span style={{ color:'var(--mute)' }}>· atualizado:</span>
            <span style={{ color:'var(--soft)' }}>
              {new Date(data.lastUpdate).toLocaleString('pt-BR')}
            </span>
          </>
        )}
      </div>

      {/* Help expandível */}
      {showHelp && (
        <div style={{
          background:'linear-gradient(135deg,rgba(0,214,143,.08),rgba(94,203,255,.04))',
          border:'1px solid rgba(0,214,143,.25)', borderRadius:'var(--r2)',
          padding:'12px 14px', marginBottom: 14, fontSize: 11, color:'var(--soft)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color:'var(--white)', marginBottom: 6 }}>
            ⚡ Como atualizar boosts da Bet365 (sem login, sem pagar)
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 14 }}>
            <div style={{ background:'rgba(0,214,143,.08)', padding:'8px 10px', borderRadius: 4 }}>
              <b style={{color:'var(--green)'}}>🤖 AUTOMÁTICO 2am BR</b>
              <div style={{ fontSize: 10, color:'var(--soft)', marginTop: 4, lineHeight: 1.5 }}>
                GitHub Actions roda Playwright headless todo dia 2h da manhã (cron <code>0 5 * * *</code> UTC).
                Scrapeia Bet365 → POST pro worker → KV salva.<br/><br/>
                <b>Setup 1× só:</b> add 2 secrets em GitHub repo Settings:
                <ul style={{marginLeft:14}}>
                  <li><code>SB_INGEST_URL_BOOSTS</code></li>
                  <li><code>SB_INGEST_SECRET</code></li>
                </ul>
                Frontend lê de <code>/v1/aumentadas/latest</code>.
              </div>
            </div>
            <div>
              <b style={{color:'var(--white)'}}>🅰 Manual via Console</b>
              <ol style={{ marginLeft: 18, marginTop: 4, lineHeight: 1.6, fontSize: 10 }}>
                <li>Click <b>"🌐 Abrir Bet365 + extrator"</b></li>
                <li>Nova aba abre, JS já no clipboard</li>
                <li>F12 → Console → Ctrl+V → Enter</li>
                <li>Volta aqui → <b>"📋 Colar Clipboard"</b></li>
              </ol>
            </div>
            <div>
              <b style={{color:'var(--white)'}}>🅱 Bookmarklet</b>
              <ol style={{ marginLeft: 18, marginTop: 4, lineHeight: 1.6, fontSize: 10 }}>
                <li>Setup: favorito Chrome com URL do bookmarklet</li>
                <li>Diariamente: abre Bet365 → clica no favorito</li>
                <li>Volta aqui → "Colar Clipboard"</li>
                <li>Em: <code>/bet365-boost-bookmarklet.txt</code></li>
              </ol>
            </div>
          </div>
          <div style={{ marginTop: 10, display:'flex', gap: 8 }}>
            <button onClick={copyExtractor} className="btn"
              style={{padding:'5px 10px',fontSize:11,color:'var(--green)'}}>
              ⬇ Copiar Extrator JS
            </button>
            <button onClick={() => setShowPaste(true)} className="btn"
              style={{padding:'5px 10px',fontSize:11}}>
              ✍ Colar manualmente
            </button>
          </div>
        </div>
      )}

      {/* Paste manual */}
      {showPaste && (
        <div style={{
          background:'var(--card-bg)', border:'1px solid var(--line)',
          borderRadius:'var(--r2)', padding:'12px 14px', marginBottom: 14,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color:'var(--white)', marginBottom: 6 }}>
            ✍ Colar texto manualmente
          </div>
          <textarea
            value={pasteText} onChange={e => setPasteText(e.target.value)}
            rows={8}
            placeholder="Time A v Time B&#10;- Leg 1&#10;- Leg 2&#10;10.00 >> 12.00&#10;&#10;..."
            style={{
              width:'100%', fontFamily:"'JetBrains Mono',monospace", fontSize: 11,
              padding:'8px 10px', borderRadius: 4, border:'1px solid var(--line)',
              background:'var(--ink2)', color:'var(--white)', outline:'none', marginBottom: 8,
            }}
          />
          <div style={{ display:'flex', gap: 6 }}>
            <button onClick={applyPaste} className="btn btn-primary" style={{padding:'5px 12px',fontSize:11}}>
              ⚡ Processar
            </button>
            <button onClick={() => { setPasteText(''); setShowPaste(false) }}
              className="btn" style={{padding:'5px 12px',fontSize:11}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <KpiRow>
        <Kpi value={analyzed.length} label="Total" color="var(--soft)"/>
        <Kpi value={counts.byVerdict.gold || 0}  label="🏆 OURO (≥+8% EV)" color="var(--green)"/>
        <Kpi value={counts.byVerdict.value || 0} label="💎 VALUE (≥+3%)" color="#5ecbff"/>
        <Kpi value={counts.byVerdict.fair || 0}  label="➖ FAIR" color="var(--amber)"/>
        <Kpi value={counts.byVerdict.trap || 0}  label="🪤 TRAP" color="var(--red)"/>
        <Kpi value={bestEV != null ? `${bestEV>0?'+':''}${bestEV}%` : '—'} label="Melhor EV"
          color={bestEV > 0 ? 'var(--green)' : 'var(--mute)'}/>
      </KpiRow>

      {/* Filtros */}
      {analyzed.length > 0 && (
        <div style={{ display:'flex', gap: 6, marginTop: 14, marginBottom: 14, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize: 10, color:'var(--mute)', fontFamily:"'JetBrains Mono',monospace",
            textTransform:'uppercase', marginRight: 4 }}>Filtros:</span>
          {/* Verdict */}
          {[
            { id:'all', l:'Todos' },
            { id:'gold', l:'🏆 Ouro' },
            { id:'value', l:'💎 Value' },
            { id:'fair', l:'➖ Fair' },
            { id:'trap', l:'🪤 Trap' },
          ].map(o => (
            <button key={o.id} onClick={() => setVerdictFilt(o.id)} style={{
              padding:'4px 10px', fontSize: 10, fontFamily:"'JetBrains Mono',monospace", fontWeight:700,
              borderRadius: 3, cursor:'pointer',
              border: `1px solid ${verdictFilt === o.id ? verdictColor(o.id) : 'var(--line)'}`,
              background: verdictFilt === o.id ? `${verdictColor(o.id)}20` : 'var(--ink2)',
              color: verdictFilt === o.id ? verdictColor(o.id) : 'var(--mute)',
            }}>{o.l}</button>
          ))}
          {/* Sport */}
          {sports.length > 1 && (
            <select value={sportFilt} onChange={e => setSportFilt(e.target.value)} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize: 10, padding:'4px 8px',
              borderRadius: 3, border:'1px solid var(--line)',
              background:'var(--ink2)', color:'var(--white)', outline:'none', marginLeft: 8,
            }}>
              <option value="all">🏆 Todos esportes</option>
              {sports.map(s => <option key={s} value={s}>{s} ({counts.bySport[s]})</option>)}
            </select>
          )}
          {/* Sort */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize: 10, padding:'4px 8px',
            borderRadius: 3, border:'1px solid var(--line)',
            background:'var(--ink2)', color:'var(--white)', outline:'none',
          }}>
            <option value="ev">📊 EV</option>
            <option value="prob">🎯 Prob</option>
            <option value="odd">💰 Odd</option>
          </select>
          <button onClick={exportCSV} className="btn"
            style={{padding:'4px 10px',fontSize:10,marginLeft:'auto'}}>
            ⬇ CSV
          </button>
        </div>
      )}

      {/* Listagem agrupada por jogo (estilo Bet365) */}
      {analyzed.length === 0 ? (
        <EmptyState icon="🚀" title="Nenhum boost ainda"
          subtitle='Clica "ℹ Ajuda" pra ver as opções'/>
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="Nada com esses filtros" subtitle="Tenta filtros menos restritivos"/>
      ) : (
        <div>
          {groupedByMatch.map(group => (
            <MatchSection
              key={group.key}
              matchKey={group.key}
              matchInfo={{ title: group.title, sport: group.sport }}
              boosts={group.boosts}
              isOpen={!!openMatches[group.key]}
              onToggle={() => setOpenMatches(c => ({ ...c, [group.key]: !c[group.key] }))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
