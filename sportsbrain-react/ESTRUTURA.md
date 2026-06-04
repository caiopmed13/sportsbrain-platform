# SportsBrain React — Estrutura do Projeto

## Stack
- **Vite 5** — build tool (dev server + produção)
- **React 18** — UI framework
- **Zustand 4** — estado global (substitui variáveis globais do vanilla)
- **React Router 6** — roteamento SPA
- **Chart.js 4** — gráficos
- **Tesseract.js 5** — OCR (Print Analyzer)

## Estrutura de pastas

```
src/
├── main.jsx              # Entry point React
├── App.jsx               # Layout + roteamento + health check
├── styles/
│   ├── tokens.css        # CSS Variables — dual theme dark/light
│   └── global.css        # Estilos base (layout, cards, botões, badges)
├── store/
│   └── index.js          # Todos os Zustand stores
├── api/
│   └── client.js         # Todas as chamadas fetch (Worker + local fallback)
├── components/
│   └── Layout/
│       ├── Sidebar.jsx   # Menu lateral com 15 itens em 4 grupos
│       └── TopBar.jsx    # Barra superior (search, tema, status API)
└── pages/
    ├── Hoje.jsx          # Jogos de Hoje ← CORE (Sessão 2)
    ├── Hub.jsx           # Central de Picks (Sessão 2)
    ├── Live.jsx          # Ao Vivo (Sessão 2)
    ├── BkProps.jsx       # NBA Props (Sessão 2)
    ├── FtProps.jsx       # Futebol Props (Sessão 2)
    ├── Dashboard.jsx     # Dashboard (Sessão 3)
    ├── Performance.jsx   # Performance & Banca (Sessão 3)
    ├── Stats.jsx         # Estatísticas (Sessão 3)
    ├── Learn.jsx         # Aprendizado IA (Sessão 3)
    ├── Prints.jsx        # Print Analyzer / OCR (Sessão 3)
    ├── Alerts.jsx        # Alertas (Sessão 3)
    ├── Radar.jsx         # Player Radar (Sessão 3)
    ├── Standings.jsx     # Liga & Tabela (Sessão 3)
    ├── Backup.jsx        # Backup & Dados (Sessão 3)
    └── Log.jsx           # Log API (Sessão 3)
```

## Stores Zustand

| Store           | Responsabilidade                        |
|-----------------|-----------------------------------------|
| `useUIStore`    | Tema, sidebar, página atual, API status |
| `useHojeStore`  | Dados do dia, match cache, hero tips    |
| `useBkPropsStore` | NBA Props, filtros conferência/busca   |
| `useFtPropsStore` | Futebol Props, filtros país/busca      |
| `usePerfStore`  | Banca, picks salvos, ROI                |
| `useLearnStore` | Feedback IA, market health              |
| `useAlertsStore`| Alertas ativos, configs                 |

## API Client

`src/api/client.js` — fetch wrapper centralizado:
- Detecta automaticamente Worker (Cloudflare) vs backend local
- Health check a cada 60s no App.jsx
- Todas as funções retornam JSON ou jogam erro

## Deploy

```bash
# Dev local
npm run dev

# Build + deploy Cloudflare Pages
npm run deploy
```

O `npm run deploy` faz `vite build` e depois `wrangler pages deploy dist --project-name=sportsbrain`.

## Convenções para novos devs

- **1 componente = 1 arquivo** — sem arquivos com múltiplas responsabilidades
- **Estado global → Zustand** — sem variáveis globais `window.X`
- **Chamadas API → `src/api/client.js`** — nunca `fetch()` direto nos componentes
- **CSS → CSS Variables** — nunca hardcode de cores, usar tokens de `tokens.css`
- **Lazy import** obrigatório em todas as páginas novas (já configurado em `App.jsx`)
