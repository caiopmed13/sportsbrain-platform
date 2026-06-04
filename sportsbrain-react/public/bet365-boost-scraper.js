// ═══════════════════════════════════════════════════════════════════════════
// Bet365 Boost Scraper — Bookmarklet
// ═══════════════════════════════════════════════════════════════════════════
// Como instalar:
//   1. Cria um novo bookmark no Chrome (clica estrela → barra de favoritos)
//   2. Edita o bookmark, no campo URL cola TODO o conteúdo do arquivo
//      bet365-boost-scraper-bookmarklet.txt
//   3. Renomeia pra "📋 Bet365 Boosts"
//   4. Abre Bet365 → menu Apostas Aumentadas / Partidas em Destaque
//   5. Clica no bookmark → texto formatado vai pro clipboard
//   6. Cola no Boost Scanner (modo Mega Paste)
//
// Esta versão é a fonte de leitura humana — pra gerar o bookmarklet
// minificado, rode `node minify.js` ou converta manualmente em
// `javascript:(function(){ ...código... })()` em uma linha só.
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  'use strict'

  // ── Helpers ─────────────────────────────────────────────────────────────
  function $$(sel, root = document) { return Array.from((root || document).querySelectorAll(sel)) }
  function txt(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim() }
  function visible(el) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  // Bet365 não usa data-attributes estáveis — todo seletor é por classe
  // CSS-Module-like (gerada). Heurística: procura blocos com texto contendo
  // marcadores reconhecíveis ("APOSTA AUMENTADA", "Resultado Final:", etc.)

  function findBoostCards() {
    // Procura todos os elementos que tenham descendente com texto "APOSTA AUMENTADA"
    // ou "SUPER AUMENTADA" e que sejam um card containerizado
    const allEls = $$('div, section, article')
    const cards = []
    for (const el of allEls) {
      if (!visible(el)) continue
      const t = txt(el)
      if (t.length > 1500 || t.length < 30) continue   // exclui muito grande/pequeno
      const hasMarker = /APOSTA\s*AUMENTADA|SUPER\s*AUMENTADA|ACUMULADAS?\s*AUMENTAD/i.test(t)
      const hasOddBoost = /\d+[.,]\d+\s*[»>]+\s*\d+[.,]\d+/.test(t)
      if (hasMarker && hasOddBoost) {
        // Sobe pra encontrar o container do card (próximo div maior)
        let container = el
        let depth = 0
        while (container && depth < 4 && container.parentElement) {
          const pt = txt(container.parentElement)
          if (pt.length > t.length * 1.5 && pt.length < 2000) {
            container = container.parentElement
            depth++
          } else break
        }
        if (!cards.includes(container)) cards.push(container)
      }
    }
    return cards
  }

  // Heurística pra extrair: nome jogo / legs / odd original / odd boost
  function parseCard(card) {
    const lines = txt(card).split(/\s*(?:•|◦|○|–|-)\s*/).map(l => l.trim()).filter(Boolean)
    const fullText = txt(card)

    // Match: detecta "Time A v Time B" ou "Time A x Time B"
    const matchRx = /([A-ZÀ-Ú][\w\sáéíóúâêôãõç.'-]+?)\s+(?:v|x|×|vs)\s+([A-ZÀ-Ú][\w\sáéíóúâêôãõç.'-]+?)(?:\s*\d|\s*[•◦○–-]|$)/
    const matchM = fullText.match(matchRx)
    let home = null, away = null
    if (matchM) {
      home = matchM[1].trim()
      away = matchM[2].trim()
    }

    // Odds: "11.00 >> 12.00" ou "11,00 → 12,00"
    const oddRx = /(\d+[.,]\d+)\s*(?:>>|→|»)\s*(\d+[.,]\d+)/
    const oddM = fullText.match(oddRx)
    const originalOdd = oddM ? oddM[1].replace(',', '.') : null
    const boostedOdd  = oddM ? oddM[2].replace(',', '.') : null

    // Legs: linhas entre o nome do jogo (se houver) e a odd
    // Heurística: procura por linhas com palavras-chave de mercado conhecido
    const legKeywords = /(resultado\s*final|ambas?\s*os?\s*times|para\s*ambos.*marca|ambos\s*marcam|mais\s*de\s*\d|chutes\s*ao\s*gol|para\s*marcar|marcar\s*de\s*cabe|para\s*dar\s*assist|2\+\s*chutes|escanteios?|cart[oõ]es|maior\s*n[uú]mero)/i
    const legs = lines.filter(l => legKeywords.test(l) && l.length < 120 && l.length > 5)

    return { home, away, legs, originalOdd, boostedOdd, raw: fullText.slice(0, 500) }
  }

  // ── Run ─────────────────────────────────────────────────────────────────
  const cards = findBoostCards()
  if (cards.length === 0) {
    alert('❌ Nenhum boost encontrado nesta página.\n\nDicas:\n• Abre o painel "Apostas Aumentadas" ou "Partidas em Destaque"\n• Espera os cards carregarem completamente\n• Roda o bookmarklet de novo')
    return
  }

  const parsed = cards.map(parseCard).filter(p => p.legs.length >= 2 || p.boostedOdd)
  if (parsed.length === 0) {
    alert('⚠ Encontrei ' + cards.length + ' cards mas não consegui extrair legs estruturadas.\nVerifique se está na página certa.')
    return
  }

  // ── Formata pra parser do Boost Scanner ─────────────────────────────────
  const blocks = []
  for (const p of parsed) {
    const lines = []
    if (p.home && p.away) lines.push(`${p.home} v ${p.away}`)
    else lines.push('Jogo Não Identificado v ?')
    for (const l of p.legs) lines.push(`- ${l}`)
    if (p.originalOdd && p.boostedOdd) {
      lines.push(`${p.originalOdd} >> ${p.boostedOdd}`)
    } else if (p.boostedOdd) {
      lines.push(`${p.boostedOdd}`)
    }
    blocks.push(lines.join('\n'))
  }

  const output = blocks.join('\n\n')

  // Copia pro clipboard
  navigator.clipboard.writeText(output).then(() => {
    alert(`✓ ${parsed.length} boost${parsed.length>1?'s':''} copiado${parsed.length>1?'s':''} pro clipboard!\n\nAgora vai pro Boost Scanner do SportsBrain → Mega Paste → Ctrl+V.`)
  }).catch(() => {
    // Fallback: abre janela com texto pra copiar manual
    const w = window.open('', '_blank', 'width=600,height=400')
    if (w) {
      w.document.write(`<pre style="font-family:monospace;font-size:12px;padding:20px;white-space:pre-wrap;">${output.replace(/</g,'&lt;')}</pre>`)
      w.document.title = `${parsed.length} boosts Bet365`
    }
  })

  console.log('[Bet365 Scraper] parsed:', parsed)
})()
