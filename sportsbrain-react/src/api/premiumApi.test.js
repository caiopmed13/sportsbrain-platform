// premiumApi.test.js — P3.9 R6J-B7 frontend client tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  ALLOWED_PREMIUM_SECTIONS,
  fetchPremiumTier1,
  fetchPremiumCombos,
  fetchPremiumLegacy,
  extractLegacySectionItems,
  lazyLoadSections,
} from './premiumApi.js'

// ── helpers ──────────────────────────────────────────────────────────────
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ═════════════════════════════════════════════════════════════════════════
describe('ALLOWED_PREMIUM_SECTIONS', () => {
  it('contém exatamente as 8 sections suportadas pelo backend R6J-B6', () => {
    expect(ALLOWED_PREMIUM_SECTIONS).toEqual([
      'tier2',
      'tier3',
      'tier4',
      'results_acca',
      'top_picks_today',
      'bet_builder_light',
      'bet_builder_mid',
      'bet_builder_plus',
    ])
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('fetchPremiumTier1', () => {
  it('retorna {ok:true, body} em sucesso', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      lab_mode: true,
      tier1: { count: 3, picks: [] },
    }))
    const r = await fetchPremiumTier1({ sport: 'football', date: '2026-05-25' })
    expect(r.ok).toBe(true)
    expect(r.body.tier1.count).toBe(3)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('/v1/picks/premium/tier1?')
    expect(url).toContain('sport=football')
    expect(url).toContain('date=2026-05-25')
  })

  it('retorna {ok:false} em HTTP 503', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'temp' }, 503))
    const r = await fetchPremiumTier1({ sport: 'football' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(503)
    expect(r.error).toBe('HTTP 503')
  })

  it('retorna {ok:false} quando body.ok=false', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'invalid' }))
    const r = await fetchPremiumTier1({ sport: 'football' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid')
  })

  it('retorna error=aborted ao receber AbortError', async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    fetch.mockRejectedValueOnce(err)
    const r = await fetchPremiumTier1({ sport: 'football' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('aborted')
  })

  it('retorna error=network em throw genérico', async () => {
    fetch.mockRejectedValueOnce(new Error('network down'))
    const r = await fetchPremiumTier1({ sport: 'football' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('network')
  })

  it('omite query params quando inputs ausentes', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, lab_mode: true }))
    await fetchPremiumTier1({})
    const [url] = fetch.mock.calls[0]
    expect(url).toBe('https://sportsbrain-api.sportsbrain-api.workers.dev/v1/picks/premium/tier1')
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('fetchPremiumCombos', () => {
  it('section ausente retorna erro sem fazer fetch', async () => {
    const r = await fetchPremiumCombos({ sport: 'football' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('missing_section')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('section inválida retorna erro sem fazer fetch', async () => {
    const r = await fetchPremiumCombos({ sport: 'football', section: 'tier99' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid_section')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('success retorna body com items + paginação', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      lab_mode: true,
      section: 'tier2',
      page: 1,
      page_size: 25,
      total_count: 50,
      has_next: true,
      items: [{ id: 'c1' }, { id: 'c2' }],
    }))
    const r = await fetchPremiumCombos({ sport: 'football', section: 'tier2', page: 1, pageSize: 25 })
    expect(r.ok).toBe(true)
    expect(r.body.section).toBe('tier2')
    expect(r.body.items).toHaveLength(2)
    expect(r.body.has_next).toBe(true)
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('section=tier2')
    expect(url).toContain('page=1')
    expect(url).toContain('page_size=25')
  })

  it('400 invalid_section do servidor é propagado', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'invalid_section', allowed_sections: [] }, 400))
    const r = await fetchPremiumCombos({ sport: 'football', section: 'tier2' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid_section')
    expect(r.status).toBe(400)
  })

  it('usa defaults page=1 e page_size=25 quando omitidos', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true, lab_mode: true, items: [] }))
    await fetchPremiumCombos({ sport: 'football', section: 'tier2' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('page=1')
    expect(url).toContain('page_size=25')
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('fetchPremiumLegacy', () => {
  it('retorna body legacy mesmo sem ok=true (fallback é tolerante)', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      lab_mode: true,
      tier1: { picks: [] },
      tier2: { combos: [] },
    }))
    const r = await fetchPremiumLegacy({ sport: 'football' })
    expect(r.ok).toBe(true)
    expect(r.body.tier1).toBeDefined()
    expect(r.body.tier2).toBeDefined()
  })

  it('5xx retorna ok=false', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}, 503))
    const r = await fetchPremiumLegacy({ sport: 'football' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(503)
  })

  it('chama path legacy correto', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}))
    await fetchPremiumLegacy({ sport: 'football', date: '2026-05-25' })
    const [url] = fetch.mock.calls[0]
    expect(url).toContain('/v1/picks/premium?')
    expect(url).not.toContain('/tier1')
    expect(url).not.toContain('/combos')
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('extractLegacySectionItems', () => {
  const legacy = {
    tier2: { combos: [{ id: 't2_1' }, { id: 't2_2' }] },
    tier3: { combos: [{ id: 't3_1' }] },
    tier4: { combos: [] },
    bet_builder: {
      light: { combos: [{ id: 'bbl_1' }] },
      mid:   { combos: [{ id: 'bbm_1' }, { id: 'bbm_2' }] },
      plus:  { combos: [] },
    },
    results_acca: { combos: [{ id: 'ra_1' }] },
    top_picks_today: { picks: [{ id: 'tpt_1' }] },
  }

  it('extrai tier2/3/4 corretamente', () => {
    expect(extractLegacySectionItems(legacy, 'tier2')).toHaveLength(2)
    expect(extractLegacySectionItems(legacy, 'tier3')).toHaveLength(1)
    expect(extractLegacySectionItems(legacy, 'tier4')).toHaveLength(0)
  })

  it('extrai bet_builder_*', () => {
    expect(extractLegacySectionItems(legacy, 'bet_builder_light')).toHaveLength(1)
    expect(extractLegacySectionItems(legacy, 'bet_builder_mid')).toHaveLength(2)
    expect(extractLegacySectionItems(legacy, 'bet_builder_plus')).toHaveLength(0)
  })

  it('extrai results_acca e top_picks_today', () => {
    expect(extractLegacySectionItems(legacy, 'results_acca')).toHaveLength(1)
    expect(extractLegacySectionItems(legacy, 'top_picks_today')).toHaveLength(1)
  })

  it('section desconhecida retorna []', () => {
    expect(extractLegacySectionItems(legacy, 'tier99')).toEqual([])
  })

  it('body null retorna []', () => {
    expect(extractLegacySectionItems(null, 'tier2')).toEqual([])
  })

  it('top_picks_today aceita Array direto também', () => {
    const body = { top_picks_today: [{ id: 'a' }, { id: 'b' }] }
    expect(extractLegacySectionItems(body, 'top_picks_today')).toHaveLength(2)
  })
})

// ═════════════════════════════════════════════════════════════════════════
describe('lazyLoadSections', () => {
  it('chama onSection para cada section com result do fetcher', async () => {
    const onSection = vi.fn()
    const fetcher = vi.fn(async (section) => ({
      ok: true,
      body: { items: [section] },
      error: null,
    }))
    await lazyLoadSections({
      sections: ['tier2', 'tier3', 'tier4'],
      fetcher,
      onSection,
      concurrency: 2,
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(onSection).toHaveBeenCalledTimes(3)
    const sectionsCalled = onSection.mock.calls.map(c => c[0].section).sort()
    expect(sectionsCalled).toEqual(['tier2', 'tier3', 'tier4'])
  })

  it('respeita concurrency máxima', async () => {
    let inFlight = 0
    let peakInFlight = 0
    const fetcher = vi.fn(async (section) => {
      inFlight++
      if (inFlight > peakInFlight) peakInFlight = inFlight
      await new Promise(r => setTimeout(r, 10))
      inFlight--
      return { ok: true, body: {}, error: null }
    })
    await lazyLoadSections({
      sections: ['tier2', 'tier3', 'tier4', 'results_acca', 'top_picks_today'],
      fetcher,
      onSection: () => {},
      concurrency: 2,
    })
    expect(peakInFlight).toBeLessThanOrEqual(2)
  })

  it('propaga erros do fetcher via onSection', async () => {
    const onSection = vi.fn()
    const fetcher = vi.fn(async () => { throw new Error('boom') })
    await lazyLoadSections({
      sections: ['tier2'],
      fetcher,
      onSection,
    })
    expect(onSection).toHaveBeenCalledWith(expect.objectContaining({
      section: 'tier2',
      ok: false,
      error: expect.stringContaining('boom'),
    }))
  })

  it('aceita lista vazia sem erros', async () => {
    const fetcher = vi.fn()
    const onSection = vi.fn()
    await lazyLoadSections({ sections: [], fetcher, onSection })
    expect(fetcher).not.toHaveBeenCalled()
    expect(onSection).not.toHaveBeenCalled()
  })
})
