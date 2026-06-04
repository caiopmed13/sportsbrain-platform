/* Card — v8 primitive
 * Slots: header / body (default) / footer
 * variants: default | elevated | ghost | accent
 */
export function Card({ variant = 'default', className = '', children, ...rest }) {
  const cls = [
    'card',
    variant !== 'default' && `card--${variant}`,
    className,
  ].filter(Boolean).join(' ')
  return <div className={cls} {...rest}>{children}</div>
}

export function CardHeader({ children, className = '', ...rest }) {
  return <div className={`card__header ${className}`} {...rest}>{children}</div>
}

export function CardBody({ children, className = '', ...rest }) {
  return <div className={`card__body ${className}`} {...rest}>{children}</div>
}

export function CardFooter({ children, className = '', ...rest }) {
  return <div className={`card__footer ${className}`} {...rest}>{children}</div>
}

export default Card
