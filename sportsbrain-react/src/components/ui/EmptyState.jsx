// Empty state premium — icon box, breathing room
export default function EmptyState({ icon = '📭', title, subtitle, action, compact = false }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center',
      padding: compact ? '28px 20px' : '56px 20px',
      gap: 10, textAlign: 'center',
    }}>
      {icon && (
        <div style={{
          width: 52, height: 52,
          borderRadius: 14,
          background: 'var(--ink2)',
          border: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, marginBottom: 4,
          boxShadow: 'var(--shadow-inset)',
        }}>
          {icon}
        </div>
      )}
      {title && (
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 15, fontWeight: 700,
          color: 'var(--soft)',
          letterSpacing: '-0.01em',
        }}>
          {title}
        </div>
      )}
      {subtitle && (
        <div style={{
          fontSize: 12, color: 'var(--mute)',
          maxWidth: 280, lineHeight: 1.55,
        }}>
          {subtitle}
        </div>
      )}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  )
}
