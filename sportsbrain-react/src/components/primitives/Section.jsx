/* Section — page section with optional header
 * Slots: eyebrow / title / subtitle / actions / children
 */
export function Section({
  eyebrow = null,
  title = null,
  subtitle = null,
  actions = null,
  children,
  className = '',
  containerClassName = 'container',
}) {
  const hasHeader = eyebrow || title || subtitle || actions
  return (
    <section className={`section ${className}`}>
      <div className={containerClassName}>
        {hasHeader && (
          <header className="section__header">
            <div style={{ flex: 1, minWidth: 0 }}>
              {eyebrow && <div className="section__eyebrow">{eyebrow}</div>}
              {title && <h2 className="section__title">{title}</h2>}
              {subtitle && <p className="section__subtitle">{subtitle}</p>}
            </div>
            {actions && <div style={{ display: 'flex', gap: 'var(--sp-2)', flexShrink: 0 }}>{actions}</div>}
          </header>
        )}
        {children}
      </div>
    </section>
  )
}

export default Section
