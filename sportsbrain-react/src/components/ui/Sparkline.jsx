// Mini sparkline SVG — pra trajectory de odds em tabelas
// Props: data = [{ts, odd}], width=80, height=20
export default function Sparkline({ data, width = 80, height = 20, color = '#5ecbff' }) {
  if (!data || data.length < 2) {
    return (
      <span style={{ color: 'var(--mute)', fontSize: 9, fontStyle: 'italic' }}>
        {data?.length === 1 ? `${data[0].odd?.toFixed(2)}` : '—'}
      </span>
    )
  }
  const odds = data.map(d => d.odd).filter(o => o != null && o > 0)
  if (odds.length < 2) return <span style={{ color: 'var(--mute)', fontSize: 9 }}>—</span>
  const min = Math.min(...odds)
  const max = Math.max(...odds)
  const range = max - min || 1
  const step = width / (data.length - 1)
  const points = data.map((d, i) => {
    const x = i * step
    const y = height - ((d.odd - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  // Trend: comparing last vs first
  const first = data[0].odd, last = data[data.length - 1].odd
  const trendUp = last > first
  const trendColor = trendUp ? 'var(--green)' : last < first ? 'var(--red)' : color
  const pct = first > 0 ? ((last - first) / first * 100).toFixed(1) : '0'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <polyline
          fill="none"
          stroke={trendColor}
          strokeWidth="1.5"
          points={points}
        />
        <circle cx={(data.length - 1) * step} cy={height - ((last - min) / range) * height} r="2" fill={trendColor} />
      </svg>
      <span style={{ fontSize: 9, color: trendColor, fontFamily: 'monospace', minWidth: 32 }}>
        {pct > 0 ? '+' : ''}{pct}%
      </span>
    </span>
  )
}
