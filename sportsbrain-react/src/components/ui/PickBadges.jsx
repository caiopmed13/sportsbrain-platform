// Badges de tier, confiança, EV, stake e Kelly

export function PickTierBadge({ conf, ev }) {
  const e = isFinite(ev) ? (ev || 0) : 0
  let icon, label, bg, border, color

  if (conf >= 80 && e >= 6) {
    icon = '🔥'; label = 'ELITE'
    bg = 'linear-gradient(90deg,rgba(255,100,0,.22),rgba(255,184,48,.15))'
    border = 'rgba(255,140,0,.5)'; color = 'var(--amber)'
  } else if (conf >= 70 && e >= 4) {
    icon = '⚡'; label = 'FORTE'
    bg = 'rgba(34,212,160,.14)'; border = 'rgba(34,212,160,.4)'; color = 'var(--green)'
  } else if (conf >= 60 && e >= 2) {
    icon = '✓'; label = 'VÁLIDA'
    bg = 'rgba(79,142,247,.12)'; border = 'rgba(79,142,247,.35)'; color = 'var(--blue)'
  } else if (e > 0 || conf >= 50) {
    icon = '⚠'; label = 'CONDICIONAL'
    bg = 'rgba(245,166,35,.10)'; border = 'rgba(245,166,35,.3)'; color = 'var(--amber)'
  } else {
    return null
  }

  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      fontWeight: 700,
      padding: '2px 7px',
      borderRadius: 4,
      border: `1px solid ${border}`,
      background: bg,
      color,
      letterSpacing: '.4px',
      whiteSpace: 'nowrap',
    }}>
      {icon} {label}
    </span>
  )
}

export function ConfBar({ conf, showStars = false }) {
  const color = conf >= 75 ? 'var(--green)' : conf >= 60 ? 'var(--amber)' : 'var(--red)'
  const stars = conf >= 80 ? 5 : conf >= 68 ? 4 : conf >= 55 ? 3 : conf >= 40 ? 2 : 1
  const glow = conf >= 75 ? 'rgba(34,212,160,.25)' : conf >= 60 ? 'rgba(245,166,35,.2)' : 'rgba(240,64,96,.2)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{
        flex: 1, height: 5, borderRadius: 4,
        background: 'var(--line)', overflow: 'hidden',
      }}>
        <div style={{
          width: `${conf}%`, height: '100%',
          background: `linear-gradient(90deg, ${color}, ${color}cc)`,
          borderRadius: 4,
          transition: 'width .35s ease',
          boxShadow: conf >= 60 ? `0 0 6px ${glow}` : 'none',
        }} />
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color, fontWeight: 700, minWidth: 34 }}>
        {conf}%
      </span>
      {showStars && (
        <span style={{ fontSize: 11, letterSpacing: '-1px' }}>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} style={{ color: i < stars ? 'var(--amber)' : 'var(--border-hi)' }}>★</span>
          ))}
        </span>
      )}
    </div>
  )
}

export function EdgeBadge({ ev }) {
  if (!isFinite(ev) || ev === 0) return null
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      fontWeight: 700,
      color: ev > 0 ? 'var(--green)' : 'var(--red)',
      background: ev > 0 ? 'var(--g3)' : 'var(--r3)',
      padding: '2px 7px',
      borderRadius: 4,
    }}>
      {ev > 0 ? '+' : ''}{ev.toFixed(1)}% EV
    </span>
  )
}

export function StakeBadge({ conf, ev }) {
  if (!isFinite(conf)) return null
  let label, color, bg
  if (conf >= 72 && ev > 3) { label = '3-5u'; color = 'var(--green)'; bg = 'var(--g3)' }
  else if (conf >= 60 && ev > 0) { label = '1-2u'; color = 'var(--amber)'; bg = 'var(--a3)' }
  else { label = '0.5u'; color = 'var(--t3)'; bg = 'rgba(255,255,255,.05)' }

  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, fontWeight: 700,
      color, background: bg,
      padding: '2px 7px', borderRadius: 4,
    }}>
      💎 {label}
    </span>
  )
}

export function ValLabel({ conf }) {
  const label = conf >= 80 ? 'PREMIUM' : conf >= 68 ? 'STRONG' : conf >= 55 ? 'SOLID' : conf >= 40 ? 'MODERATE' : 'SPECULATIVE'
  const color = conf >= 68 ? 'var(--green)' : conf >= 50 ? 'var(--amber)' : 'var(--t3)'
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, fontWeight: 700,
      color, letterSpacing: '.4px',
    }}>
      {label}
    </span>
  )
}

// ─── Kelly Criterion ─────────────────────────────────────────────────────────
// Calcula a fração ideal de banca a apostar (Quarter Kelly)
// f* = (p·b - q) / b   onde b = odd-1, p = conf/100, q = 1-p
// Retorna fração 0..1 (Quarter Kelly = f*/4)
export function kellyFraction(conf, odd) {
  if (!odd || odd <= 1 || !conf || conf <= 0) return 0
  const p = conf / 100
  const b = odd - 1
  const q = 1 - p
  const full = (p * b - q) / b
  return Math.max(0, full / 4)
}

export function KellyBadge({ conf, odd, banca }) {
  const frac = kellyFraction(conf, odd)
  if (frac <= 0 || !banca || banca <= 0) return null

  const stake   = frac * banca
  const units   = frac * 100  // 1u = 1% da banca
  const color   = units >= 4 ? 'var(--green)' : units >= 2 ? 'var(--amber)' : 'var(--t3)'
  const bg      = units >= 4 ? 'var(--g3)' : units >= 2 ? 'var(--a3)' : 'rgba(255,255,255,.05)'
  const border  = units >= 4 ? 'rgba(34,212,160,.3)' : units >= 2 ? 'rgba(245,166,35,.25)' : 'rgba(255,255,255,.08)'

  const fmt = (v) => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)

  return (
    <span title={`Kelly: ${(frac * 100).toFixed(1)}% da banca · @${odd}`} style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, fontWeight: 700,
      color, background: bg, border: `1px solid ${border}`,
      padding: '2px 7px', borderRadius: 4,
      cursor: 'default', whiteSpace: 'nowrap',
    }}>
      💰 {units.toFixed(1)}u · R${fmt(stake)}
    </span>
  )
}

export function SportIcon({ sport }) {
  const map = {
    football: '⚽', basketball: '🏀', american_football: '🏈',
    baseball: '⚾', hockey: '🏒', tennis: '🎾', mma: '🥊', esports: '🎮',
  }
  return <span>{map[sport] || '🏟'}</span>
}

export function StatusPill({ status }) {
  const map = {
    LIVE: { label: 'AO VIVO', color: 'var(--red)',   bg: 'var(--r3)' },
    HT:   { label: 'INTERVALO', color: 'var(--amber)', bg: 'var(--a3)' },
    FT:   { label: 'ENCERRADO', color: 'var(--t3)',    bg: 'rgba(255,255,255,.06)' },
    NS:   { label: 'AGENDADO',  color: 'var(--blue)',  bg: 'var(--b3)' },
  }
  const s = map[status] || map.NS
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11, fontWeight: 700,
      color: s.color, background: s.bg,
      padding: '2px 8px', borderRadius: 20,
      letterSpacing: '.4px',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {status === 'LIVE' && (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', animation: 'pulse 1s infinite', flexShrink: 0 }} />
      )}
      {s.label}
    </span>
  )
}
