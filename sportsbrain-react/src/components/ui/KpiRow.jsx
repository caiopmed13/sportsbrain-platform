/* KPI Row — redesign v6.0 */
export function KpiRow({ children, cols = 'auto', style = {} }) {
  const templateCols = cols === 'auto'
    ? 'repeat(auto-fill, minmax(130px, 1fr))'
    : `repeat(${cols}, 1fr)`
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: templateCols,
      gap: 8,
      marginBottom: 16,
      ...style,
    }}>
      {children}
    </div>
  )
}

/**
 * KPI card — design terminal/data.
 * Número grande + label pequeno + barra de cor na base.
 */
export function Kpi({ value, label, color = 'var(--blue)', pulse = false, delta = null, trend = null, sub = null }) {
  const trendColor = trend === 'up' ? 'var(--green)' : trend === 'down' ? 'var(--red)' : 'var(--dim)'
  const trendArrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : trend === 'flat' ? '—' : null

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--card-border)',
      borderRadius: 'var(--r2)',
      padding: '12px 14px 10px',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      /* Hover lift */
      transition: 'border-color var(--transition-fast), transform var(--transition-fast)',
      cursor: 'default',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hi)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--card-border)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Glow background sutil baseado na cor */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
        background: `radial-gradient(ellipse at bottom, ${color}09 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Barra de cor na base */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
        background: color, opacity: 0.6,
      }} />

      {/* Label no topo — pequeno e discreto */}
      <div style={{
        fontSize: 10,
        color: 'var(--mute)',
        fontFamily: "'DM Mono', monospace",
        fontWeight: 700,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
      }}>
        {label}
      </div>

      {/* Número principal */}
      <div style={{
        fontFamily: "'Anton', sans-serif",
        fontSize: 28,
        fontWeight: 400,
        color,
        lineHeight: 1.05,
        letterSpacing: '.01em',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginTop: 2,
      }}>
        {pulse && (
          <span style={{
            display: 'inline-block',
            width: 6, height: 6, borderRadius: '50%',
            background: color,
            animation: 'pulse 1.2s ease infinite',
            flexShrink: 0,
            boxShadow: `0 0 8px ${color}`,
          }} />
        )}
        {value ?? '—'}
      </div>

      {/* Delta / trend */}
      {(delta !== null || trendArrow) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 3,
          fontSize: 11, fontFamily: "'DM Mono', monospace",
          fontWeight: 700, color: trendColor, marginTop: 1,
        }}>
          {trendArrow && <span style={{ fontSize: 11 }}>{trendArrow}</span>}
          {delta !== null && <span>{delta > 0 ? '+' : ''}{delta}</span>}
        </div>
      )}

      {/* Sub */}
      {sub && (
        <div style={{
          fontSize: 11, color: 'var(--t3)',
          fontFamily: "'DM Mono', monospace",
          marginTop: 1, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
        }}>
          {sub}
        </div>
      )}
    </div>
  )
}
