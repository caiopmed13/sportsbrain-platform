import { useEffect, useState, useCallback, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'

// ─── Ligas ────────────────────────────────────────────────────────────────────
const LEAGUE_GROUPS = [
  {
    group: '🌍 Europa — Grandes Ligas',
    leagues: [
      { slug: 'eng.1',          label: 'Premier League',      flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
      { slug: 'esp.1',          label: 'La Liga',             flag: '🇪🇸' },
      { slug: 'ger.1',          label: 'Bundesliga',          flag: '🇩🇪' },
      { slug: 'ita.1',          label: 'Serie A',             flag: '🇮🇹' },
      { slug: 'fra.1',          label: 'Ligue 1',             flag: '🇫🇷' },
      { slug: 'por.1',          label: 'Primeira Liga',       flag: '🇵🇹' },
      { slug: 'ned.1',          label: 'Eredivisie',          flag: '🇳🇱' },
      { slug: 'tur.1',          label: 'Süper Lig',           flag: '🇹🇷' },
    ],
  },
  {
    group: '🌍 Europa — Outras',
    leagues: [
      { slug: 'sco.1',          label: 'Scottish Prem.',      flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
      { slug: 'bel.1',          label: 'Pro League',          flag: '🇧🇪' },
      { slug: 'gre.1',          label: 'Super League',        flag: '🇬🇷' },
      { slug: 'aut.1',          label: 'Bundesliga',          flag: '🇦🇹' },
      { slug: 'ukr.1',          label: 'Premier League',      flag: '🇺🇦' },
    ],
  },
  {
    group: '🏆 Competições UEFA',
    leagues: [
      { slug: 'uefa.champions', label: 'Champions League',    flag: '⭐' },
      { slug: 'uefa.europa',    label: 'Europa League',       flag: '🔵' },
    ],
  },
  {
    group: '🌎 América do Sul',
    leagues: [
      { slug: 'conmebol.libertadores', label: 'Copa Libertadores',   flag: '🏆' },
      { slug: 'conmebol.sudamericana', label: 'Copa Sudamericana',  flag: '🥈' },
      { slug: 'bra.1',          label: 'Brasileirão Série A', flag: '🇧🇷' },
      { slug: 'bra.2',          label: 'Brasileirão Série B', flag: '🇧🇷' },
      { slug: 'arg.1',          label: 'Liga Profesional',    flag: '🇦🇷' },
      { slug: 'col.1',          label: 'Liga BetPlay',        flag: '🇨🇴' },
      { slug: 'chi.1',          label: 'Primera División',    flag: '🇨🇱' },
      { slug: 'uru.1',          label: 'Primera División',    flag: '🇺🇾' },
    ],
  },
  {
    group: '🌎 América do Norte',
    leagues: [
      { slug: 'usa.1',          label: 'MLS',                 flag: '🇺🇸' },
      { slug: 'mex.1',          label: 'Liga MX',             flag: '🇲🇽' },
    ],
  },
]

const ALL_LEAGUES = LEAGUE_GROUPS.flatMap(g => g.leagues)

// ─── Storage: snapshots por rodada ────────────────────────────────────────────
// Salva 2 snapshots: "prev" (rodada N-1) e "curr" (rodada N).
// Quando GP médio aumenta → nova rodada detectada → curr vira prev, novo curr salvo.
const SK_PREV = slug => `sb_st_prev_${slug}`
const SK_CURR = slug => `sb_st_curr_${slug}`

function loadSnap(key)     { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }
function saveSnap(key, obj){ try { localStorage.setItem(key, JSON.stringify(obj)) } catch {} }

function buildSnap(rows) {
  const snap = { ts: Date.now(), avgGP: 0, teams: {} }
  rows.forEach(r => { snap.teams[r.name] = { pos: r.pos, pts: r.pts, gp: r.gp, gd: r.gd, w: r.w } })
  const vals = Object.values(snap.teams)
  snap.avgGP = vals.length ? vals.reduce((a, t) => a + t.gp, 0) / vals.length : 0
  return snap
}

// Compara current rows com snapshot anterior e injeta deltas
function applyDeltas(rows, slug) {
  const curr = loadSnap(SK_CURR(slug))
  const prev = loadSnap(SK_PREV(slug))
  const newSnap = buildSnap(rows)

  if (!curr) {
    // Primeira carga: salva snapshot. dPos vem da ESPN se disponível.
    saveSnap(SK_CURR(slug), newSnap)
    return rows.map(r => ({ ...r, dPos: r.espnDeltaPos ?? null, dPts: null, dGD: null, lastResult: null }))
  }

  // Nova rodada detectada: qualquer time jogou jogo a mais que o snapshot
  const newRound = rows.some(r => {
    const old = curr.teams?.[r.name]
    return old && r.gp > old.gp
  })

  if (newRound) {
    // curr → prev, novo curr salvo
    saveSnap(SK_PREV(slug), curr)
    saveSnap(SK_CURR(slug), newSnap)
  }

  // Usa prev para calcular deltas (o que mudou desde rodada anterior)
  const baseline = prev || curr
  return rows.map(r => {
    const old = baseline?.teams?.[r.name]

    // dPos: prefere dado nativo da ESPN, cai no snapshot se não disponível
    const dPos = r.espnDeltaPos !== null
      ? r.espnDeltaPos
      : old ? (old.pos - r.pos) : null

    if (!old) return { ...r, dPos, dPts: null, dGD: null, lastResult: null }

    const dPts = r.pts - old.pts
    const dGD  = r.gd  - old.gd
    const lastResult = dPts === 3 ? 'W' : dPts === 1 ? 'D' : dPts === 0 && r.gp > old.gp ? 'L' : null
    return { ...r, dPos, dPts, dGD, lastResult }
  })
}

// Força snapshot manual (botão "Salvar snapshot desta rodada")
function forceSnapshot(rows, slug) {
  const curr = loadSnap(SK_CURR(slug))
  if (curr) saveSnap(SK_PREV(slug), curr)
  saveSnap(SK_CURR(slug), buildSnap(rows))
}

// ─── Parser ESPN ──────────────────────────────────────────────────────────────
function parseESPN(data) {
  const entries = data?.children?.[0]?.standings?.entries || data?.standings?.entries || []
  if (!entries.length) return []
  return entries.map((entry, idx) => {
    const stats = {}
    const statObjs = entry.stats || []
    statObjs.forEach(s => { stats[s.abbreviation || s.name] = s.value })

    const formRaw = statObjs.find(s => ['streak','form'].includes(s.abbreviation || s.name))?.displayValue || ''
    const form = (formRaw || '').split('').filter(c => ['W','D','L'].includes(c)).slice(0,5)

    const currentPos = idx + 1
    // ESPN retorna previousStanding em vários formatos dependendo da liga
    const prevPosVal = stats.previousStanding ?? stats.prevStanding ?? stats.LRANK
      ?? stats.PREV ?? stats.PreviousStanding ?? stats.rankChange ?? stats.RANK_CHANGE
      // varredura direta nos objetos para pegar qualquer variante
      ?? statObjs.find(s => /prev|lrank|rank_?change/i.test(s.abbreviation || s.name || ''))?.value
      ?? null
    // positivo = subiu posições (estava mais abaixo, agora está mais acima)
    const espnDeltaPos = prevPosVal != null ? (+prevPosVal - currentPos) : null

    return {
      pos:  currentPos,
      name: entry.team?.displayName || entry.team?.name || '—',
      abbr: entry.team?.abbreviation || '',
      logo: entry.team?.logos?.[0]?.href || null,
      gp:   +(stats.GP ?? stats.gamesPlayed ?? 0),
      w:    +(stats.W  ?? stats.wins   ?? 0),
      d:    +(stats.D  ?? stats.draws  ?? 0),
      l:    +(stats.L  ?? stats.losses ?? 0),
      gf:   +(stats.F  ?? stats.GF ?? stats.pointsFor     ?? 0),
      ga:   +(stats.A  ?? stats.GA ?? stats.pointsAgainst ?? 0),
      gd:   +(stats.GD ?? stats.pointDifferential ?? 0),
      pts:  +(stats.P  ?? stats.PTS ?? stats.points ?? 0),
      form,
      espnDeltaPos,
    }
  })
}

// ─── Zonas por liga ───────────────────────────────────────────────────────────
// Cada entrada recebe `n` (total de times) e retorna array de zonas { from, to, color, shadow, label }
const LEAGUE_ZONE_FN = {
  'bra.1': n => [
    { from:1,   to:6,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Libertadores' },
    { from:7,   to:8,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Sudamericana' },
    { from:n-3, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'bra.2': n => [
    { from:1,   to:4,   color:'#00E5A0', shadow:'rgba(0,229,160,.55)',   label:'Acesso Série A' },
    { from:5,   to:8,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Acesso playoff' },
    { from:n-3, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'eng.1': n => [
    { from:1,   to:4,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:5,   to:5,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:6,   to:6,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'esp.1': n => [
    { from:1,   to:4,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:5,   to:6,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:7,   to:7,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'ger.1': n => [
    { from:1,   to:4,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:5,   to:5,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:6,   to:6,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n-2, color:'#FFB030', shadow:'rgba(255,176,48,.45)',  label:'Playoff' },
    { from:n-1, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'ita.1': n => [
    { from:1,   to:4,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:5,   to:6,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:7,   to:7,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'fra.1': n => [
    { from:1,   to:2,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:3,   to:3,   color:'#9b6bff', shadow:'rgba(155,107,255,.45)', label:'Champions Prel.' },
    { from:4,   to:4,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:5,   to:5,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n-2, color:'#FFB030', shadow:'rgba(255,176,48,.45)',  label:'Playoff' },
    { from:n-1, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'por.1': n => [
    { from:1,   to:3,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:4,   to:5,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:6,   to:6,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n-2, color:'#FFB030', shadow:'rgba(255,176,48,.45)',  label:'Playoff' },
    { from:n-1, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'ned.1': n => [
    { from:1,   to:1,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:2,   to:3,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:4,   to:5,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'tur.1': n => [
    { from:1,   to:4,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:5,   to:6,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:7,   to:7,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-2, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'sco.1': n => [
    { from:1,   to:1,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Champions' },
    { from:2,   to:3,   color:'#00E5A0', shadow:'rgba(0,229,160,.45)',   label:'Europa' },
    { from:4,   to:4,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Conference' },
    { from:n-1, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'arg.1': n => [
    { from:1,   to:4,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Libertadores' },
    { from:5,   to:6,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Sudamericana' },
  ],
  'col.1': n => [
    { from:1,   to:4,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Libertadores' },
    { from:5,   to:6,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Sudamericana' },
  ],
  'chi.1': n => [
    { from:1,   to:2,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Libertadores' },
    { from:3,   to:4,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Sudamericana' },
    { from:n-1, to:n,   color:'#FF3D5A', shadow:'rgba(255,61,90,.45)',   label:'Rebaixamento' },
  ],
  'uru.1': n => [
    { from:1,   to:2,   color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'Libertadores' },
    { from:3,   to:4,   color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Sudamericana' },
  ],
  'conmebol.libertadores': () => [
    { from:1, to:2, color:'#4D8FF5', shadow:'rgba(77,143,245,.55)', label:'Oitavas' },
    { from:3, to:3, color:'#FFB030', shadow:'rgba(255,176,48,.45)', label:'Repescagem' },
  ],
  'conmebol.sudamericana': () => [
    { from:1, to:2, color:'#4D8FF5', shadow:'rgba(77,143,245,.55)', label:'16 avos' },
    { from:3, to:3, color:'#FFB030', shadow:'rgba(255,176,48,.45)', label:'Repescagem' },
  ],
  'uefa.champions': () => [
    { from:1,  to:8,  color:'#4D8FF5', shadow:'rgba(77,143,245,.55)',  label:'16 avos direto' },
    { from:9,  to:24, color:'#00c8b4', shadow:'rgba(0,200,180,.45)',   label:'Playoff' },
  ],
  'uefa.europa': () => [
    { from:1,  to:8,  color:'#00E5A0', shadow:'rgba(0,229,160,.45)',  label:'16 avos direto' },
    { from:9,  to:24, color:'#00c8b4', shadow:'rgba(0,200,180,.45)',  label:'Playoff' },
  ],
}

function getZones(slug, total) {
  const fn = LEAGUE_ZONE_FN[slug]
  if (fn) return fn(total)
  // fallback genérico
  return [
    { from:1, to:4,      color:'#4D8FF5', shadow:'rgba(77,143,245,.55)', label:'Classificação' },
    { from:5, to:6,      color:'#FFB030', shadow:'rgba(255,176,48,.45)', label:'Pré-classificação' },
    { from:total-2, to:total, color:'#FF3D5A', shadow:'rgba(255,61,90,.45)', label:'Rebaixamento' },
  ]
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function FormBadge({ result }) {
  const map = {
    W: { bg:'rgba(0,229,160,.18)',  color:'var(--green)', label:'V' },
    D: { bg:'rgba(255,176,32,.18)', color:'var(--amber)', label:'E' },
    L: { bg:'rgba(255,61,90,.18)',  color:'var(--red)',   label:'D' },
  }
  const s = map[result] || map.L
  return (
    <span style={{
      display:'inline-flex',alignItems:'center',justifyContent:'center',
      width:17,height:17,borderRadius:4,background:s.bg,color:s.color,
      fontSize:10,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",
    }}>
      {s.label}
    </span>
  )
}

function ZoneBar({ pos, zones }) {
  const zone = (zones || []).find(z => pos >= z.from && pos <= z.to)
  if (!zone) return null
  return <div style={{ position:'absolute',left:0,top:2,bottom:2,width:3,borderRadius:2,background:zone.color, boxShadow:`0 0 6px ${zone.shadow}` }} />
}

// Delta de posição com seta
function DeltaPos({ d }) {
  if (d === null || d === undefined) return <span style={{ color:'var(--t3)',fontSize:11,fontFamily:"'JetBrains Mono',monospace" }}>—</span>
  if (d === 0) return <span style={{ color:'var(--t3)',fontSize:11,fontFamily:"'JetBrains Mono',monospace" }}>·</span>
  const up = d > 0
  return (
    <span style={{
      display:'inline-flex',alignItems:'center',gap:1,
      fontSize:10,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",
      color: up ? 'var(--green)' : 'var(--red)',
    }}>
      <span style={{fontSize:8}}>{up?'▲':'▼'}</span>{Math.abs(d)}
    </span>
  )
}

// Delta de pontos da rodada — badge compacto
function DeltaPts({ d, lastResult }) {
  if (d === null || d === undefined) return null
  if (d === 0 && lastResult === null) return null

  const map = {
    W: { bg:'rgba(0,229,160,.15)',  border:'rgba(0,229,160,.35)',  color:'var(--green)', label:'+3' },
    D: { bg:'rgba(255,176,32,.12)', border:'rgba(255,176,32,.35)', color:'var(--amber)', label:'+1' },
    L: { bg:'rgba(255,61,90,.12)',  border:'rgba(255,61,90,.3)',   color:'var(--red)',   label:'+0' },
  }
  const s = lastResult ? map[lastResult] : { bg:'rgba(255,255,255,.05)', border:'rgba(255,255,255,.1)', color:'var(--t3)', label: d > 0 ? `+${d}` : String(d) }

  return (
    <span style={{
      display:'inline-flex',alignItems:'center',justifyContent:'center',
      minWidth:26,padding:'1px 5px',borderRadius:4,
      background:s.bg,border:`1px solid ${s.border}`,
      color:s.color,fontSize:10,fontWeight:800,
      fontFamily:"'JetBrains Mono',monospace",
    }}>
      {s.label}
    </span>
  )
}

// Delta de saldo de gols — compacto
function DeltaGD({ d }) {
  if (d === null || d === undefined || d === 0) return <span style={{color:'var(--t3)',fontSize:11}}>—</span>
  return (
    <span style={{
      fontSize:11,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",
      color: d > 0 ? 'var(--green)' : 'var(--red)',
    }}>
      {d > 0 ? `+${d}` : d}
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr>
      <td colSpan={13} style={{padding:'10px 14px'}}>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <div className="skeleton" style={{width:24,height:11,borderRadius:3}}/>
          <div className="skeleton" style={{width:140,height:11,borderRadius:3}}/>
          <div className="skeleton" style={{flex:1,height:11,borderRadius:3}}/>
        </div>
      </td>
    </tr>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
export default function Standings() {
  const [active,    setActive]    = useState('bra.1')
  const [standings, setStandings] = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [cache,     setCache]     = useState({})
  const [rawCache,  setRawCache]  = useState({})   // rows sem delta, para snapshot manual
  const [snapped,   setSnapped]   = useState(false) // feedback do botão snapshot

  const load = useCallback(async (slug, force = false) => {
    if (cache[slug] && !force) { setStandings(cache[slug]); return }
    setLoading(true); setError(null); setStandings([])
    try {
      const url = `https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data   = await res.json()
      const parsed = parseESPN(data)
      if (!parsed.length) throw new Error('Sem dados')
      const withD  = applyDeltas(parsed, slug)
      setRawCache(c => ({ ...c, [slug]: parsed }))
      setCache(c    => ({ ...c, [slug]: withD  }))
      setStandings(withD)
    } catch {
      setError('Não foi possível carregar esta liga.')
    }
    setLoading(false)
  }, [cache])

  useEffect(() => { load(active) }, [active])

  // Snapshot manual: salva rodada atual como baseline para próxima comparação
  function handleSnapshot() {
    const raw = rawCache[active]
    if (!raw) return
    forceSnapshot(raw, active)
    const withD = applyDeltas(raw, active)
    setCache(c => ({ ...c, [active]: withD }))
    setStandings(withD)
    setSnapped(true)
    setTimeout(() => setSnapped(false), 2000)
  }

  const league = ALL_LEAGUES.find(l => l.slug === active)
  const total  = standings.length
  const zones  = useMemo(() => getZones(active, total), [active, total])

  // Verifica se tem algum delta calculado para exibir o bloco de mudanças
  const hasDelta = standings.some(r => r.dPos !== null)
  const roundChanges = useMemo(() => {
    if (!hasDelta) return []
    return standings
      .filter(r => r.dPos !== null && (r.dPos !== 0 || r.dPts > 0))
      .sort((a, b) => Math.abs(b.dPos) - Math.abs(a.dPos) || b.dPts - a.dPts)
      .slice(0, 6)
  }, [standings, hasDelta])

  return (
    <div className="page">
      <PageHeader
        icon="🏆"
        title="Tabelas de Classificação"
        subtitle="ESPN · mudanças por rodada detectadas automaticamente"
        actions={
          <div style={{display:'flex',gap:6}}>
            <button
              onClick={handleSnapshot}
              className="btn"
              style={{padding:'5px 12px',fontSize:12,display:'flex',alignItems:'center',gap:5,
                ...(snapped ? {color:'var(--green)',borderColor:'rgba(0,229,160,.4)',background:'rgba(0,229,160,.08)'} : {})
              }}
              title="Salva a classificação atual como referência da última rodada"
            >
              {snapped ? '✓ Salvo' : '📸 Capturar Rodada'}
            </button>
            <button onClick={() => load(active, true)} className="btn"
              style={{padding:'5px 12px',fontSize:12,display:'flex',alignItems:'center',gap:5}}>
              ↺ Atualizar
            </button>
          </div>
        }
      />

      {/* ── Seletor de ligas ── */}
      <div style={{marginBottom:16,display:'flex',flexDirection:'column',gap:8}}>
        {LEAGUE_GROUPS.map(group => (
          <div key={group.group}>
            <div style={{
              fontSize:10,fontWeight:700,color:'var(--t3)',letterSpacing:'.10em',
              textTransform:'uppercase',fontFamily:"'JetBrains Mono',monospace",
              marginBottom:5,paddingLeft:2,
            }}>
              {group.group}
            </div>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
              {group.leagues.map(lg => (
                <button key={lg.slug} onClick={() => setActive(lg.slug)} style={{
                  display:'inline-flex',alignItems:'center',gap:5,
                  padding:'5px 11px',borderRadius:'var(--r-pill)',
                  border:`1px solid ${active===lg.slug?'rgba(77,143,245,.4)':'var(--border)'}`,
                  background:active===lg.slug?'rgba(77,143,245,.12)':'transparent',
                  color:active===lg.slug?'var(--blue-hi)':'var(--t3)',
                  fontSize:12,fontWeight:active===lg.slug?700:500,
                  fontFamily:"'Inter',sans-serif",cursor:'pointer',
                  transition:'all var(--transition-fast)',whiteSpace:'nowrap',
                  boxShadow:active===lg.slug?'0 0 10px rgba(77,143,245,.15)':'none',
                }}>
                  <span style={{fontSize:13}}>{lg.flag}</span>
                  {lg.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Bloco de mudanças da última rodada ── */}
      {!loading && hasDelta && roundChanges.length > 0 && (
        <div style={{
          background:'var(--ink2)',border:'1px solid var(--border)',borderRadius:'var(--r2)',
          padding:'12px 14px',marginBottom:14,
        }}>
          <div style={{
            display:'flex',alignItems:'center',gap:8,marginBottom:10,
            paddingBottom:8,borderBottom:'1px solid var(--border-sub)',
          }}>
            <span style={{
              fontSize:10,fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',
              color:'var(--t3)',fontFamily:"'JetBrains Mono',monospace",
            }}>
              Mudanças da Última Rodada
            </span>
            <span style={{
              fontSize:10,color:'var(--mute)',fontFamily:"'JetBrains Mono',monospace",
              background:'rgba(255,255,255,.05)',padding:'1px 6px',borderRadius:'var(--r-pill)',
            }}>
              vs snapshot anterior
            </span>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:6}}>
            {roundChanges.map((r, i) => (
              <div key={i} style={{
                display:'flex',alignItems:'center',gap:8,
                background:'rgba(255,255,255,.025)',border:'1px solid var(--border-sub)',
                borderRadius:8,padding:'7px 10px',
              }}>
                {/* Logo */}
                {r.logo && (
                  <img src={r.logo} alt="" width={20} height={20}
                    style={{objectFit:'contain',flexShrink:0,filter:'drop-shadow(0 1px 3px rgba(0,0,0,.5))'}}
                  />
                )}

                {/* Nome + posição */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{
                    fontSize:12,fontWeight:600,color:'var(--t1)',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                  }}>
                    {r.name}
                  </div>
                  <div style={{
                    fontSize:11,color:'var(--t3)',fontFamily:"'JetBrains Mono',monospace",
                    marginTop:1,
                  }}>
                    {r.pos}º lugar
                  </div>
                </div>

                {/* Indicadores de mudança */}
                <div style={{display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
                  {/* Resultado da rodada */}
                  {r.lastResult && <FormBadge result={r.lastResult} />}

                  {/* Pontos ganhos */}
                  <DeltaPts d={r.dPts} lastResult={r.lastResult} />

                  {/* Posição */}
                  {r.dPos !== 0 && r.dPos !== null && (
                    <span style={{
                      display:'inline-flex',alignItems:'center',gap:2,
                      fontSize:10,fontWeight:800,
                      fontFamily:"'JetBrains Mono',monospace",
                      color: r.dPos > 0 ? 'var(--green)' : 'var(--red)',
                      background: r.dPos > 0 ? 'rgba(0,229,160,.1)' : 'rgba(255,61,90,.1)',
                      border:`1px solid ${r.dPos>0?'rgba(0,229,160,.25)':'rgba(255,61,90,.25)'}`,
                      padding:'1px 5px',borderRadius:4,
                    }}>
                      <span style={{fontSize:8}}>{r.dPos>0?'▲':'▼'}</span>
                      {Math.abs(r.dPos)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <tbody>{Array.from({length:10},(_,i)=><SkeletonRow key={i}/>)}</tbody>
          </table>
        </div>
      )}

      {/* ── Erro ── */}
      {error && !loading && (
        <EmptyState icon="📡" title="Liga indisponível" subtitle={error}
          action={<button onClick={()=>load(active,true)} className="btn btn-primary" style={{marginTop:8}}>↺ Tentar novamente</button>}
        />
      )}

      {/* ── Tabela principal ── */}
      {!loading && !error && standings.length > 0 && (
        <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',overflow:'hidden'}}>

          {/* Cabeçalho */}
          <div style={{
            padding:'9px 16px',borderBottom:'1px solid var(--line)',
            display:'flex',justifyContent:'space-between',alignItems:'center',
            background:'rgba(0,0,0,.2)',
          }}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:18}}>{league?.flag}</span>
              <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:14,fontWeight:700,color:'var(--t1)',letterSpacing:'-.02em'}}>
                {league?.label}
              </span>
              <span style={{
                fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--t3)',
                padding:'1px 7px',background:'rgba(255,255,255,.04)',borderRadius:'var(--r-pill)',
              }}>
                {total} clubes
              </span>
            </div>
            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
              {zones.map(z => (
                <span key={z.label} style={{display:'flex',alignItems:'center',gap:4,fontSize:11,color:z.color,fontFamily:"'Inter',sans-serif",fontWeight:500}}>
                  <span style={{width:8,height:8,borderRadius:2,background:z.color,display:'inline-block',boxShadow:`0 0 5px ${z.color}60`}}/>
                  {z.label}
                </span>
              ))}
            </div>
          </div>

          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:660}}>
              <thead>
                <tr style={{background:'rgba(0,0,0,.18)'}}>
                  {/* Pos */}
                  <th style={thS({w:38})}>Pos</th>
                  {/* Delta posição */}
                  <th style={thS({w:32})} title="Variação de posição desde última rodada">Δ</th>
                  {/* Time */}
                  <th style={{...thS({w:160}),textAlign:'left',paddingLeft:8}}>Time</th>
                  {/* Stats */}
                  {['J','V','E','D','GP','GC','SG'].map(h=>(
                    <th key={h} style={thS({w:32})} title={tipOf(h)}>{h}</th>
                  ))}
                  {/* Pontos */}
                  <th style={thS({w:44})} title="Pontos totais">PTS</th>
                  {/* Delta pontos rodada */}
                  <th style={thS({w:36})} title="Resultado e pontos ganhos na última rodada">Rnd</th>
                  {/* Delta saldo */}
                  <th style={thS({w:36})} title="Variação de saldo de gols na última rodada">ΔSG</th>
                  {/* Forma */}
                  <th style={{...thS({w:100}),textAlign:'left',paddingLeft:8}} title="Últimos 5 jogos">Forma</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, i) => {
                  const zone   = zones.find(z => row.pos >= z.from && row.pos <= z.to)
                  const isTop4 = zone?.color === '#4D8FF5'
                  const isRel  = zone?.color === '#FF3D5A'
                  const moved  = row.dPos !== null && row.dPos !== 0
                  const rowBg  = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)'
                  // Highlight sutil se mudou de posição nessa rodada
                  const highlightBg = moved
                    ? row.dPos > 0 ? 'rgba(0,229,160,.035)' : 'rgba(255,61,90,.035)'
                    : rowBg

                  return (
                    <tr key={i}
                      style={{background:highlightBg,transition:'background var(--transition-fast)',position:'relative'}}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.03)'}
                      onMouseLeave={e=>e.currentTarget.style.background=highlightBg}
                    >
                      {/* Posição */}
                      <td style={{padding:'9px 8px',textAlign:'center',position:'relative'}}>
                        <ZoneBar pos={row.pos} zones={zones}/>
                        <span style={{
                          fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,paddingLeft:6,
                          color:isTop4?'var(--blue-hi)':isRel?'var(--red)':'var(--t3)',
                        }}>
                          {row.pos}
                        </span>
                      </td>

                      {/* Delta posição */}
                      <td style={{padding:'9px 4px',textAlign:'center'}}>
                        <DeltaPos d={row.dPos}/>
                      </td>

                      {/* Time */}
                      <td style={{padding:'9px 8px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          {row.logo && (
                            <img src={row.logo} alt="" width={20} height={20}
                              style={{objectFit:'contain',flexShrink:0,filter:'drop-shadow(0 1px 3px rgba(0,0,0,.5))'}}
                            />
                          )}
                          <span style={{
                            fontSize:13,fontWeight:600,color:'var(--t1)',
                            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:130,
                          }}>
                            {row.name}
                          </span>
                        </div>
                      </td>

                      {/* J V E D GP GC */}
                      {[row.gp,row.w,row.d,row.l,row.gf,row.ga].map((v,j)=>(
                        <td key={j} style={{
                          padding:'9px 8px',textAlign:'center',
                          fontFamily:"'JetBrains Mono',monospace",fontSize:12,
                          color:j===1?'var(--green)':j===3?'var(--red)':'var(--soft)',
                          fontWeight:j===1?600:400,
                        }}>
                          {v}
                        </td>
                      ))}

                      {/* SG */}
                      <td style={{padding:'9px 8px',textAlign:'center',fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:600,
                        color:row.gd>0?'var(--green)':row.gd<0?'var(--red)':'var(--t3)'}}>
                        {row.gd>0?`+${row.gd}`:row.gd}
                      </td>

                      {/* PTS */}
                      <td style={{padding:'9px 8px',textAlign:'center'}}>
                        <span style={{
                          fontFamily:"'Space Grotesk','JetBrains Mono',monospace",
                          fontSize:15,fontWeight:800,
                          color:isTop4?'var(--blue-hi)':isRel?'var(--red)':'var(--t1)',
                        }}>
                          {row.pts}
                        </span>
                      </td>

                      {/* Resultado + pts da rodada */}
                      <td style={{padding:'9px 6px',textAlign:'center'}}>
                        <DeltaPts d={row.dPts} lastResult={row.lastResult}/>
                      </td>

                      {/* Delta SG */}
                      <td style={{padding:'9px 6px',textAlign:'center'}}>
                        <DeltaGD d={row.dGD}/>
                      </td>

                      {/* Forma */}
                      <td style={{padding:'9px 8px'}}>
                        <div style={{display:'flex',gap:3,alignItems:'center'}}>
                          {row.form.length>0
                            ? row.form.map((r,k)=><FormBadge key={k} result={r}/>)
                            : <span style={{fontSize:11,color:'var(--t3)'}}>—</span>
                          }
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Rodapé */}
          <div style={{
            padding:'8px 14px',borderTop:'1px solid var(--border-sub)',
            display:'flex',justifyContent:'space-between',alignItems:'center',
            background:'rgba(0,0,0,.15)',flexWrap:'wrap',gap:8,
          }}>
            <span style={{fontSize:11,color:'var(--t3)',fontFamily:"'JetBrains Mono',monospace"}}>
              Fonte: ESPN API · Δ = vs última rodada capturada · Rnd = resultado + pts da rodada
            </span>
            <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
              {zones.map(z=>(
                <span key={z.label} style={{display:'flex',alignItems:'center',gap:4,fontSize:10,color:'var(--t3)',fontFamily:"'JetBrains Mono',monospace"}}>
                  <span style={{width:6,height:6,borderRadius:1,background:z.color,display:'inline-block'}}/>
                  {z.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers de estilo ────────────────────────────────────────────────────────
function thS({ w }) {
  return {
    padding:'7px 8px',fontSize:10,fontWeight:700,letterSpacing:'.10em',
    textTransform:'uppercase',color:'var(--t3)',
    fontFamily:"'JetBrains Mono',monospace",textAlign:'center',
    borderBottom:'1px solid var(--border)',whiteSpace:'nowrap',
    cursor:'help',minWidth:w,
  }
}

function tipOf(h) {
  const m = {J:'Jogos',V:'Vitórias',E:'Empates',D:'Derrotas',GP:'Gols marcados',GC:'Gols sofridos',SG:'Saldo de gols'}
  return m[h]||h
}
