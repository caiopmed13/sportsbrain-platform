// ═══════════════════════════════════════════════════════════════════════════
// RiskBadges — P3.9 R6K-F2
// ═══════════════════════════════════════════════════════════════════════════
//
// Conjunto de badges informativas anotadas pelo backend em premiumRiskTags.js.
// "Annotate, don't filter" — picks ruins/loucos aparecem com badge.
//
// Props:
//   tags:      string[]   — array de tags vindo do payload (item.risk_tags)
//   maxVisible: number    — default 4 (mais relevantes; restantes em tooltip)
//   showLab:   boolean    — default false (LAB já está visível em outra UI;
//                            evita repetição)
//   size:      'sm'|'md'  — default 'sm'
//
// Render:
//   tags vazio/null → null
//   ordem segue TAG_ORDER do backend (mais crítica primeiro).
// ═══════════════════════════════════════════════════════════════════════════

// Espelha TAG_ORDER de src/services/premiumRiskTags.js (backend).
const TAG_ORDER = Object.freeze([
  'MEGA_ILUSORIO',
  'WATCH',
  'ALTA_VARIANCIA',
  'EV_AGREGADO_NEGATIVO',
  'MEGA',
  'JACKPOT',
  'FAIXA',
  'EV_NEGATIVO',
  'EV_NEUTRO',
  'EV_POSITIVO',
  'CORRECT_SCORE',
  'HT_FT',
  'DRAW_NO_BET',
  'TELEGRAM_STYLE',
  'HISTORICO_FORTE',
  'LAB',
]);

const TAG_META = Object.freeze({
  MEGA_ILUSORIO:        { label: 'MEGA ILUSÓRIO', color: 'var(--red)',    bg: 'rgba(240,64,96,.10)',  border: 'rgba(240,64,96,.4)',  title: 'Combo de odd alta com EV agregado negativo. Apostar é apostar contra a matemática.' },
  WATCH:                { label: 'WATCH',         color: 'var(--amber)',  bg: 'rgba(245,166,35,.10)', border: 'rgba(245,166,35,.4)', title: 'Atenção: alta variância ou EV agregado negativo.' },
  ALTA_VARIANCIA:       { label: 'ALTA VARIÂNCIA',color: 'var(--amber)',  bg: 'rgba(245,166,35,.10)', border: 'rgba(245,166,35,.3)', title: 'Mercado com alta dispersão de resultados.' },
  EV_AGREGADO_NEGATIVO: { label: 'EV AGREG. NEG', color: 'var(--red)',    bg: 'rgba(240,64,96,.08)',  border: 'rgba(240,64,96,.3)',  title: 'EV agregado do combo é negativo.' },
  MEGA:                 { label: 'MEGA',          color: '#caa028',       bg: 'rgba(202,160,40,.10)', border: 'rgba(202,160,40,.35)',title: 'MEGA Jackpot — 5+ legs.' },
  JACKPOT:              { label: 'JACKPOT',       color: '#caa028',       bg: 'rgba(202,160,40,.08)', border: 'rgba(202,160,40,.3)', title: 'Jackpot — 3-5 legs.' },
  FAIXA:                { label: 'FAIXA',         color: 'var(--blue)',   bg: 'rgba(79,142,247,.10)', border: 'rgba(79,142,247,.35)',title: 'Origem FAIXA VIP (tipster validado).' },
  EV_NEGATIVO:          { label: 'EV-',           color: 'var(--red)',    bg: 'rgba(240,64,96,.08)',  border: 'rgba(240,64,96,.3)',  title: 'EV negativo na seleção.' },
  EV_NEUTRO:            { label: 'EV~',           color: 'var(--t3)',     bg: 'rgba(255,255,255,.05)',border: 'rgba(255,255,255,.15)',title: 'EV neutro (≈ devigged).' },
  EV_POSITIVO:          { label: 'EV+',           color: 'var(--green)',  bg: 'rgba(34,212,160,.10)', border: 'rgba(34,212,160,.35)',title: 'EV positivo.' },
  CORRECT_SCORE:        { label: 'CS',            color: 'var(--amber)',  bg: 'rgba(245,166,35,.08)', border: 'rgba(245,166,35,.25)',title: 'Mercado Placar Exato.' },
  HT_FT:                { label: 'HT/FT',         color: 'var(--amber)',  bg: 'rgba(245,166,35,.08)', border: 'rgba(245,166,35,.25)',title: 'Intervalo/Final.' },
  DRAW_NO_BET:          { label: 'DNB',           color: 'var(--t3)',     bg: 'rgba(255,255,255,.05)',border: 'rgba(255,255,255,.15)',title: 'Draw No Bet.' },
  TELEGRAM_STYLE:       { label: 'TIPSTER',       color: 'var(--blue)',   bg: 'rgba(79,142,247,.10)', border: 'rgba(79,142,247,.30)',title: 'Origem tipster Telegram.' },
  HISTORICO_FORTE:      { label: 'HIST. FORTE',   color: 'var(--green)',  bg: 'rgba(34,212,160,.10)', border: 'rgba(34,212,160,.30)',title: 'Histórico de WR forte (R6K-F3).' },
  LAB:                  { label: 'LAB',           color: 'var(--t3)',     bg: 'rgba(255,255,255,.05)',border: 'rgba(255,255,255,.15)',title: 'Modo LAB — sem recomendação de stake real.' },
});

export function sortByPriority(tags) {
  if (!Array.isArray(tags)) return [];
  const order = new Map(TAG_ORDER.map((t, i) => [t, i]));
  const FALLBACK = TAG_ORDER.length;
  return [...tags].sort((a, b) => (order.get(a) ?? FALLBACK) - (order.get(b) ?? FALLBACK));
}

export default function RiskBadges({ tags, maxVisible = 4, showLab = false, size = 'sm' }) {
  if (!Array.isArray(tags) || tags.length === 0) return null;

  const filtered = showLab ? tags : tags.filter(t => t !== 'LAB');
  if (filtered.length === 0) return null;

  const sorted   = sortByPriority(filtered);
  const visible  = sorted.slice(0, maxVisible);
  const hidden   = sorted.slice(maxVisible);
  const hiddenTip = hidden.length ? `+ ${hidden.length}: ${hidden.join(', ')}` : null;

  const fontSize = size === 'sm' ? 10 : 11;
  const padding  = size === 'sm' ? '1px 5px' : '2px 6px';

  return (
    <span
      data-testid="risk-badges"
      style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}
    >
      {visible.map((tag) => {
        const meta = TAG_META[tag] || { label: tag, color: 'var(--t3)', bg: 'rgba(255,255,255,.05)', border: 'rgba(255,255,255,.15)', title: tag };
        return (
          <span
            key={tag}
            data-testid={`risk-badge-${tag}`}
            title={meta.title}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize,
              fontWeight: 700,
              padding,
              borderRadius: 4,
              border: `1px solid ${meta.border}`,
              background: meta.bg,
              color: meta.color,
              letterSpacing: '.3px',
              whiteSpace: 'nowrap',
            }}
          >
            {meta.label}
          </span>
        );
      })}
      {hidden.length > 0 && (
        <span
          title={hiddenTip}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize,
            fontWeight: 600,
            padding,
            borderRadius: 4,
            color: 'var(--t3)',
            border: '1px dashed rgba(255,255,255,.15)',
            background: 'transparent',
            cursor: 'default',
          }}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
}

export { TAG_ORDER, TAG_META };
