/* Badge — square pill, semantic */
export function Badge({ variant = 'default', solid = false, children, className = '', ...rest }) {
  const cls = [
    'badge',
    variant !== 'default' && (solid ? `badge--solid-${variant}` : `badge--${variant}`),
    className,
  ].filter(Boolean).join(' ')
  return <span className={cls} {...rest}>{children}</span>
}

/* Pill — rounded tag */
export function Pill({ variant = 'default', active = false, children, className = '', ...rest }) {
  const cls = [
    'pill',
    variant !== 'default' && `pill--${variant}`,
    active && 'pill--active',
    className,
  ].filter(Boolean).join(' ')
  return <span className={cls} {...rest}>{children}</span>
}

export default Badge
