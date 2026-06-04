// Cabeçalho de página — estilo Sports Almanac (masthead editorial)
export default function PageHeader({ icon, title, subtitle, actions, children, meta }) {
  return (
    <div className="page-header-wrap">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
          {icon && <span style={{ fontSize: 22, lineHeight: 1, opacity: .85 }}>{icon}</span>}
          <h1 className="page-title">{title}</h1>
        </div>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
        {meta && (
          <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap',
            fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: '.06em',
            color: 'var(--t3)', textTransform: 'uppercase' }}>
            {meta}
          </div>
        )}
      </div>
      {(actions || children) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, paddingTop: 4 }}>
          {actions}
          {children}
        </div>
      )}
    </div>
  )
}
