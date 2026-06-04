// ═══════════════════════════════════════════════════════════════════════════
// VerdictBadge — P3.9 R6K-F2
// ═══════════════════════════════════════════════════════════════════════════
//
// Badge unificado que renderiza o math_verdict (gold/value/fair/trap) ou
// design_verdict (long_shot) anotado pelo backend em premiumPicks.js.
//
// Thresholds espelham boostBuilder.js (Aumentadas).
//
// Props:
//   verdict: 'gold' | 'value' | 'fair' | 'trap' | 'long_shot' | 'unknown' | null
//   size:    'sm' | 'md'  (default 'md')
//
// Render:
//   unknown / null → null (não renderiza nada)
//   demais         → span estilizado com ícone + label
// ═══════════════════════════════════════════════════════════════════════════

const VERDICT_META = Object.freeze({
  gold: {
    label: 'GOLD',
    icon: '🥇',
    color: '#caa028',
    bg: 'linear-gradient(90deg,rgba(202,160,40,.22),rgba(255,184,48,.10))',
    border: 'rgba(202,160,40,.55)',
    title: 'EV ≥ 8% — edge forte',
  },
  value: {
    label: 'VALUE',
    icon: '✅',
    color: 'var(--green)',
    bg: 'rgba(34,212,160,.14)',
    border: 'rgba(34,212,160,.4)',
    title: 'EV ≥ 3% — edge positiva',
  },
  fair: {
    label: 'FAIR',
    icon: '⚖',
    color: 'var(--amber)',
    bg: 'rgba(245,166,35,.10)',
    border: 'rgba(245,166,35,.30)',
    title: 'EV entre -2% e 3% — neutro',
  },
  trap: {
    label: 'TRAP',
    icon: '🪤',
    color: 'var(--red)',
    bg: 'rgba(240,64,96,.10)',
    border: 'rgba(240,64,96,.35)',
    title: 'EV < -2% — desfavorável',
  },
  long_shot: {
    label: 'LONG-SHOT',
    icon: '✨',
    color: '#a875e0',
    bg: 'rgba(168,117,224,.10)',
    border: 'rgba(168,117,224,.35)',
    title: 'Combo de odd combinada ≥ 500x — alta variância',
  },
});

export default function VerdictBadge({ verdict, size = 'md', title }) {
  if (!verdict || verdict === 'unknown') return null;
  const meta = VERDICT_META[verdict];
  if (!meta) return null;

  const fontSize = size === 'sm' ? 10 : 11;
  const padding  = size === 'sm' ? '1px 6px' : '2px 7px';

  return (
    <span
      data-testid={`verdict-badge-${verdict}`}
      title={title || meta.title}
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize,
        fontWeight: 700,
        padding,
        borderRadius: 4,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        color: meta.color,
        letterSpacing: '.4px',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
    </span>
  );
}

// Exporta meta para tests/storybook
export { VERDICT_META };
