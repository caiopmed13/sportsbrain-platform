// Sport filter tabs — estilo Bet365 mobile: scroll horizontal, pill style
const SPORTS = [
  { id: 'all',               label: 'Todos',    icon: '🏟' },
  { id: 'football',          label: 'Futebol',  icon: '⚽' },
  { id: 'basketball',        label: 'Basquete', icon: '🏀' },
  { id: 'american_football', label: 'NFL',      icon: '🏈' },
  { id: 'baseball',          label: 'Baseball', icon: '⚾' },
  { id: 'hockey',            label: 'Hockey',   icon: '🏒' },
  { id: 'tennis',            label: 'Tênis',    icon: '🎾' },
  { id: 'mma',               label: 'MMA',      icon: '🥊' },
  { id: 'esports',           label: 'eSports',  icon: '🎮' },
]

export default function SportTabs({ value, onChange, available = null }) {
  const tabs = available
    ? SPORTS.filter(s => s.id === 'all' || available.includes(s.id))
    : SPORTS

  return (
    <div style={{
      display: 'flex',
      gap: 6,
      marginBottom: 12,
      overflowX: 'auto',
      scrollbarWidth: 'none',
      WebkitOverflowScrolling: 'touch',
      msOverflowStyle: 'none',
      paddingBottom: 2,
    }}>
      {tabs.map(s => {
        const active = value === s.id
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              fontWeight: 500,
              padding: '0 14px',
              height: 36,
              borderRadius: 4,
              border: `1.5px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
              background: active ? 'var(--t1)' : 'transparent',
              color: active ? '#f4ebe0' : 'var(--t3)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all .15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
            }}
          >
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}
