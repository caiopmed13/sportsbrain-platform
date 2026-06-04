/* ═══════════════════════════════════════════════════════════════════════════
   humanize-strip — remove emojis decorativos de headings e tabs.
   ─────────────────────────────────────────────────────────────────────
   Roda 1x no mount + MutationObserver. Strip emoji glyphs no INÍCIO de:
     h1, h2, h3, .almanac__title, .page-title, [role="tab"],
     .nav-item__label, .nav-section-label
   Preserva texto não-emoji (números, letras, palavras).
   ═══════════════════════════════════════════════════════════════════════════ */

// Range Unicode de emojis + variation selectors + ZWJ
// Cobre: U+1F300-1FAFF, U+2600-27BF, U+FE0F (variation selector-16),
// U+200D (ZWJ), além de emojis modificadores.
const EMOJI_RX = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\s·]+/u;

const TARGETS = [
  'h1', 'h2', 'h3', 'h4',
  '.almanac__title',
  '.page-title', '.page-header h1',
  '.section__title',
  '[role="tab"]',
  '.nav-item__label',
  '.nav-section-label',
  '.faixa-methods-section__title',
  '.faixa-methods-method__title',
  '.kpi-card__label',
  '.metric-card__label',
  '.stat__label',
  '.tab',
  '.section-tab',
];

const ATTR_SEEN = 'data-emoji-stripped';

function stripFromNode(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.hasAttribute(ATTR_SEEN)) return;
  if (node.closest('[data-keep-emoji]')) return;  // opt-out per element

  // Get firstChild that's a text node
  let textNode = null;
  for (const child of node.childNodes) {
    if (child.nodeType === 3 && child.nodeValue.trim()) {
      textNode = child;
      break;
    }
    // If first child is an <em> or similar inline, also count first text inside
    if (child.nodeType === 1 && (child.tagName === 'EM' || child.tagName === 'SPAN' || child.tagName === 'STRONG')) {
      const inner = child.childNodes[0];
      if (inner?.nodeType === 3 && inner.nodeValue.trim()) {
        textNode = inner;
        break;
      }
    }
  }
  if (!textNode) {
    node.setAttribute(ATTR_SEEN, '1');
    return;
  }

  const before = textNode.nodeValue;
  const after = before.replace(EMOJI_RX, '').trimStart();
  if (after !== before && after.length > 0) {
    textNode.nodeValue = after;
  }
  node.setAttribute(ATTR_SEEN, '1');
}

function sweep(root = document) {
  const selector = TARGETS.join(', ');
  root.querySelectorAll?.(selector).forEach(stripFromNode);
}

function init() {
  // Initial sweep
  sweep();

  // Observer pra novos elementos
  const observer = new MutationObserver((muts) => {
    for (const mut of muts) {
      if (mut.type === 'childList') {
        mut.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          // Re-sweep within the new subtree
          if (n.matches?.(TARGETS.join(', '))) stripFromNode(n);
          sweep(n);
        });
      }
      if (mut.type === 'characterData') {
        const parent = mut.target.parentElement;
        if (parent && TARGETS.some(s => parent.matches?.(s))) {
          parent.removeAttribute(ATTR_SEEN);
          stripFromNode(parent);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export {};
