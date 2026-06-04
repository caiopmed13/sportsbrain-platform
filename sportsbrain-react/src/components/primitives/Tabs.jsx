/* Tabs — minimal underline (v8)
 * <Tabs value={x} onChange={fn} items={[{id,label,count}]} />
 */
export function Tabs({ value, onChange, items = [], className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {items.map((it) => {
        const isActive = it.id === value
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? ' is-active' : ''}`}
            onClick={() => onChange?.(it.id)}
          >
            {it.label}
            {it.count != null && <span className="tab__count">{it.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* Segmented — pill toggle (v8) */
export function Segmented({ value, onChange, items = [], className = '' }) {
  return (
    <div className={`segmented ${className}`}>
      {items.map((it) => (
        <button
          key={it.id}
          className={`segmented__item${it.id === value ? ' is-active' : ''}`}
          onClick={() => onChange?.(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export default Tabs
