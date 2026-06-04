/* PageHero — page header pattern (editorial)
 * Slots: eyebrow / title / subtitle / stats / actions
 */
export function PageHero({
  eyebrow = null,
  title,
  subtitle = null,
  stats = null,        /* slot pra <Stat> array */
  actions = null,      /* slot pra botões */
  className = '',
}) {
  return (
    <section className={`page-hero ${className}`}>
      <div className="container">
        {eyebrow && <div className="page-hero__eyebrow">{eyebrow}</div>}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-6)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="page-hero__title">{title}</h1>
            {subtitle && <p className="page-hero__subtitle">{subtitle}</p>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 'var(--sp-2)', flexShrink: 0 }}>{actions}</div>}
        </div>
        {stats && <div className="page-hero__stats">{stats}</div>}
      </div>
    </section>
  )
}

export default PageHero
