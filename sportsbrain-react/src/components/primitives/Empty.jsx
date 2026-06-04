import { Inbox } from 'lucide-react'

/* Empty — opinionated empty state */
export function Empty({
  icon = <Inbox size={36} strokeWidth={1.25} />,
  title = 'Nada por aqui',
  hint = null,
  action = null,
  className = '',
}) {
  return (
    <div className={`empty ${className}`}>
      <div className="empty__icon">{icon}</div>
      <div className="empty__title t-heading-sm">{title}</div>
      {hint && <div className="empty__hint">{hint}</div>}
      {action && <div style={{ marginTop: 'var(--sp-3)' }}>{action}</div>}
    </div>
  )
}

export default Empty
