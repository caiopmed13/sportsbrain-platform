import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

/* Stat — KPI block (label + value + optional delta)
 * Tipografia display, tabular nums.
 */
export function Stat({
  label,
  value,
  delta = null,             /* number, ex: +12.5 or -3.2 */
  deltaLabel = null,        /* string customizada, ex: "vs ontem" */
  variant = 'display',      /* display | mono */
  size = 'md',              /* sm | md | lg */
  className = '',
}) {
  const valCls = variant === 'mono' ? 'stat__value stat__value--mono' : 'stat__value'
  const deltaSign = delta == null ? 0 : delta > 0 ? 1 : delta < 0 ? -1 : 0
  const deltaCls =
    deltaSign > 0 ? 'stat__delta stat__delta--positive' :
    deltaSign < 0 ? 'stat__delta stat__delta--negative' :
    'stat__delta stat__delta--neutral'

  const sizeStyle = size === 'sm'
    ? { fontSize: 'var(--fs-display-sm)' }
    : size === 'lg'
    ? { fontSize: 'var(--fs-display-md)' }
    : null

  return (
    <div className={`stat ${className}`}>
      <div className="stat__label">{label}</div>
      <div className={valCls} style={sizeStyle}>{value}</div>
      {delta != null && (
        <div className={deltaCls}>
          {deltaSign > 0 ? <ArrowUpRight size={12} strokeWidth={2} /> :
           deltaSign < 0 ? <ArrowDownRight size={12} strokeWidth={2} /> :
           <Minus size={12} strokeWidth={2} />}
          {deltaSign > 0 ? '+' : ''}{delta}%
          {deltaLabel && <span style={{ color: 'var(--text-3)', fontWeight: 500, marginLeft: 4 }}>{deltaLabel}</span>}
        </div>
      )}
    </div>
  )
}

export default Stat
