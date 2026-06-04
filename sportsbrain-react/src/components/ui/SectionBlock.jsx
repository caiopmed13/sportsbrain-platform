// SectionBlock — wrapper de seção premium reutilizável
// Uso: <SectionBlock title="STATUS" titleRight={<button>...</button>}>conteúdo</SectionBlock>
export default function SectionBlock({
  title,
  titleRight,
  children,
  style = {},
  bodyStyle = {},
  noPad = false,
  accent,   // 'blue' | 'green' | 'amber' | 'red'
}) {
  const accentBorder = {
    blue:  'border-left: 3px solid var(--blue)',
    green: 'border-left: 3px solid var(--green)',
    amber: 'border-left: 3px solid var(--amber)',
    red:   'border-left: 3px solid var(--red)',
  }[accent] || ''

  const accentStyle = accent
    ? { borderLeft: `3px solid var(--${accent === 'blue' ? 'blue' : accent === 'green' ? 'green' : accent === 'amber' ? 'amber' : 'red'})` }
    : {}

  return (
    <div className="section-block" style={{ ...accentStyle, ...style }}>
      {title && (
        <div className="section-block-header">
          <span className="section-block-title">{title}</span>
          {titleRight && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {titleRight}
            </div>
          )}
        </div>
      )}
      <div
        className={noPad ? '' : 'section-block-body'}
        style={bodyStyle}
      >
        {children}
      </div>
    </div>
  )
}
