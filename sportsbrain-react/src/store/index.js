import { create } from 'zustand'

// ── Store de UI / Navegação ──────────────────────────────────────────────────
export const useUIStore = create((set) => ({
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth > 768 : true,
  sidebarCollapsed: false, // icon-only mode no desktop
  theme: localStorage.getItem('sb_theme') || 'dark',
  currentPage: 'banca365',  // Banca + Plano Hoje = página principal pro user seguir
  pageTitle: 'Banca365 — Plano Hoje',
  searchQuery: '',
  apiLabel: 'Conectando...',
  apiStatus: 'loading', // 'ok' | 'err' | 'loading'

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleSidebarCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('sb_theme', next)
      document.documentElement.setAttribute('data-theme', next === 'light' ? 'light' : '')
      return { theme: next }
    }),

  setPage: (page, title) => set({ currentPage: page, pageTitle: title }),
  setSearch: (q) => set({ searchQuery: q }),
  setApiStatus: (status, label) => set({ apiStatus: status, apiLabel: label }),
}))

// ── Store de Dados — Jogos de Hoje ───────────────────────────────────────────
export const useHojeStore = create((set) => ({
  data: {},           // { sport: [events] }
  loaded: false,
  loading: false,
  matchCache: {},     // { mid: { info, sport, ev, _ts } }
  heroTips: [],       // top picks (conf≥75, ev≥2)
  sport: 'football',
  minConf: 60,
  showConf: 70,

  setData: (data) => set({ data, loaded: true, loading: false }),
  setLoading: (v) => set({ loading: v }),
  setMatchCache: (mid, val) =>
    set((s) => ({ matchCache: { ...s.matchCache, [mid]: val } })),
  setHeroTips: (tips) => set({ heroTips: tips }),
  setSport: (sport) => set({ sport }),
  setMinConf: (v) => set({ minConf: v }),
  reset: () => set({ data: {}, loaded: false, loading: false }),
}))

// ── Store de NBA Props ───────────────────────────────────────────────────────
export const useBkPropsStore = create((set) => ({
  props: [],
  loading: false,
  conference: 'all',  // 'all' | 'East' | 'West'
  search: '',
  calibration: {},    // { market_key: factor }

  setProps: (props) => set({ props, loading: false }),
  setLoading: (v) => set({ loading: v }),
  setConference: (c) => set({ conference: c }),
  setSearch: (s) => set({ search: s }),
  setCalibration: (cf) => set({ calibration: cf }),
}))

// ── Store de Futebol Props ───────────────────────────────────────────────────
export const useFtPropsStore = create((set) => ({
  props: [],
  loading: false,
  country: 'all',
  search: '',

  setProps: (props) => set({ props, loading: false }),
  setLoading: (v) => set({ loading: v }),
  setCountry: (c) => set({ country: c }),
  setSearch: (s) => set({ search: s }),
}))

// ── Store de Performance / Banca ─────────────────────────────────────────────
export const usePerfStore = create((set) => ({
  banca: parseFloat(localStorage.getItem('sb_banca') || '1000'),
  picks: JSON.parse(localStorage.getItem('sb_picks') || '[]'),
  roi: 0,
  winRate: 0,

  setBanca: (v) => {
    localStorage.setItem('sb_banca', String(v))
    set({ banca: v })
  },
  addPick: (pick) =>
    set((s) => {
      const picks = [...s.picks, pick]
      localStorage.setItem('sb_picks', JSON.stringify(picks))
      return { picks }
    }),
  setMetrics: (roi, winRate) => set({ roi, winRate }),
}))

// ── Store de Aprendizado IA ──────────────────────────────────────────────────
export const useLearnStore = create((set) => ({
  feedback: {},     // { market_key: { adj, reason, wr, n } }
  printFeedback: {}, // { market_label: { verdicts, adj } }
  mktHealth: {},    // { mktGroup: { status, wr, t, brier, calibErr } }

  setFeedback: (fb) => set({ feedback: fb }),
  setPrintFeedback: (pf) => set({ printFeedback: pf }),
  setMktHealth: (mh) => set({ mktHealth: mh }),
}))

// ── Store de Alertas ─────────────────────────────────────────────────────────
export const useAlertsStore = create((set) => ({
  alerts: [],
  count: 0,
  configs: JSON.parse(localStorage.getItem('sb_alerts_cfg') || '{}'),

  setAlerts: (alerts) => set({ alerts, count: alerts.length }),
  setConfigs: (cfg) => {
    localStorage.setItem('sb_alerts_cfg', JSON.stringify(cfg))
    set({ configs: cfg })
  },
}))
