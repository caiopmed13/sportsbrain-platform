// ═══════════════════════════════════════════════════════════════════════════
// Boletim — aba dedicada para montar e compartilhar palpites estilo Bet365
// ═══════════════════════════════════════════════════════════════════════════
// Reusa BoletimView + buildResultadoMatches + ftpTeamProps de FtProps,
// mas roda um load() próprio enxuto só com o necessário p/ picks 1X2.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import { usePerfStore } from '../store'
import { fetchMatches, fetchTeamStats } from '../api/client'
import { ftpTeamProps, BoletimView, buildResultadoMatches } from './FtProps'
import { buildFormContext } from '../utils/teamForm'
import { fetchAllOdds, matchOddsForGame, enrichPickWithOdds } from '../utils/oddsEdge'
import {
  rebuildCalibrationCache, loadCalibrationCache,
  fetchServerCalibration, mergeCalibrationMaps
} from '../utils/pickCalibration'

function today() { return new Date().toISOString().split('T')[0] }

export default function Boletim() {
  const [props,   setProps]   = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded,  setLoaded]  = useState(false)
  const { banca } = usePerfStore()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchMatches({ date: today(), sport: 'football', per_page: 1000 })
      const raw = res.matches || res.data || []

      const shouldSkip = (g) => {
        if (g.status_meta?.isFin || g.status_meta?.isLive || g.status_meta?.isHT || g.status_meta?.isActive) return true
        const s = (g.status || g.state || g.fixture?.status?.short || '').toLowerCase()
        const skip = ['ft','finished','complete','completed','full_time','fim','ended','post','closed',
                      'live','1h','2h','ht','in_play','active','in_progress','running','in','halftime','paused','break']
        return skip.some(d => s === d || s.startsWith(d))
      }

      const normLeague = (g) => {
        const l = (typeof g.league === 'string' ? g.league : g.league?.name)
               || g.competition?.name || g.league_name || ''
        return (l && l.length > 1 && l.toLowerCase() !== 'sem liga') ? l : null
      }
      const normCountry = (g) => {
        const c = g.league_country || g.country || (typeof g.league === 'object' ? g.league?.country : null) || ''
        return (c && c.length > 1 && c !== 'World') ? c : null
      }

      const games = (Array.isArray(raw) ? raw : [])
        .filter(g => !shouldSkip(g))
        .map(g => ({
          home: g.home_team || g.home_team_name || g.teams?.home?.name || g.home || 'Casa',
          away: g.away_team || g.away_team_name || g.teams?.away?.name || g.away || 'Fora',
          league:  normLeague(g)  || 'Sem Liga',
          country: normCountry(g) || '',
        }))
        .filter(g => !(g.home === 'Casa' && g.away === 'Fora'))

      // Stats de times em paralelo
      const teamNames = [...new Set(games.flatMap(g => [g.home, g.away]))]
      const statsMap = {}
      await Promise.allSettled(
        teamNames.map(async n => {
          const s = await fetchTeamStats(n, 'football', 'all')
          if (s) statsMap[n] = s
        })
      )

      // Calibração + odds
      const localCalib  = rebuildCalibrationCache(30) || loadCalibrationCache()
      const serverCalib = await fetchServerCalibration('football', 30).catch(() => null)
      const calibMap    = mergeCalibrationMaps(serverCalib, localCalib)
      const allOdds     = await fetchAllOdds().catch(() => [])

      // Forma + H2H (limita a 20 jogos para não estourar ESPN)
      const gamesForForm = games.slice(0, 20)
      const formMap = new Map()
      await Promise.allSettled(
        gamesForForm.map(async g => {
          const ctx = await buildFormContext(g.home, g.away, g.league).catch(() => null)
          if (ctx) formMap.set(`${g.home}|${g.away}`, ctx)
        })
      )

      const all = []
      games.forEach(({ home, away, league, country }) => {
        const match      = `${home} vs ${away}`
        const homeStats  = statsMap[home] || null
        const awayStats  = statsMap[away] || null
        const formCtx    = formMap.get(`${home}|${away}`) || null
        const matchProps = ftpTeamProps(home, away, league, country, match, homeStats, awayStats, { formCtx, calibMap })
        const gameOdds   = matchOddsForGame(allOdds, home, away)
        const enriched   = matchProps.map(p => {
          if (!['Casa Win', 'Empate', 'Fora Win'].includes(p.stat)) return p
          return enrichPickWithOdds(p, gameOdds, banca || 100)
        })
        all.push(...enriched)
      })

      setProps(all)
      setLoaded(true)
    } catch (e) {
      console.warn('[Boletim]', e.message)
      setLoaded(true)
    }
    setLoading(false)
  }, [banca])

  useEffect(() => { load() }, [load])

  const matches = buildResultadoMatches(props)

  const avgOdd = matches.length
    ? (matches.reduce((a, m) => a + (m.best.real_odd || (1 / (m.best.conf / 100)) * 1.07), 0) / matches.length).toFixed(2)
    : '—'
  const avgConf = matches.length
    ? Math.round(matches.reduce((a, m) => a + m.best.conf, 0) / matches.length)
    : 0

  return (
    <>
      <PageHeader
        icon="📋"
        title="Boletim do Dia"
        subtitle={`${matches.length} palpites ≥75% · odd média ${avgOdd} · conf média ${avgConf}%`}
        actions={
          <button onClick={load} disabled={loading} style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:700,
            padding:'6px 12px', borderRadius:6, border:'1px solid var(--line)',
            background:'var(--ink2)', color:'var(--white)', cursor:loading?'wait':'pointer',
          }}>
            {loading ? '⏳ Carregando…' : '↻ Atualizar'}
          </button>
        }
      />

      {loading && !loaded && (
        <div className="loading-center"><div className="spinner"/><span>Carregando palpites...</span></div>
      )}

      {loaded && matches.length === 0 && (
        <EmptyState
          icon="📋"
          title="Nenhum palpite disponível"
          subtitle="Aguarde os jogos do dia ou atualize os dados"
        />
      )}

      {matches.length > 0 && <BoletimView matches={matches} banca={banca || 100}/>}
    </>
  )
}
