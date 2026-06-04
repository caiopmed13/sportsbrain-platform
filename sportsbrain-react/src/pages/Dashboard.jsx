import { useEffect, useState, useCallback, useMemo } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { KpiRow, Kpi } from '../components/ui/KpiRow'
import EmptyState from '../components/ui/EmptyState'
import { fetchMatches, checkHealth } from '../api/client'
import { useHojeStore } from '../store'

// ── Premium Widget usando classes CSS do global.css ──
function Widget({ title, children, action }) {
  return (
    <div className="widget">
      <div className="widget-header">
        <span className="widget-title">{title}</span>
        {action && <div>{action}</div>}
      </div>
      <div className="widget-body">{children}</div>
    </div>
  )
}

function StatusRow({ label, status, detail }) {
  const ok = status === 'ok'
  const loading = status === 'loading'
  const dotColor = ok ? 'var(--green)' : loading ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,.04)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: dotColor, display: 'inline-block', flexShrink: 0,
        boxShadow: ok ? '0 0 6px rgba(0,214,143,.4)' : 'none',
        animation: loading ? 'pulse 1.2s infinite' : 'none',
      }} />
      <span style={{ flex: 1, fontSize: 11, color: 'var(--soft)' }}>{label}</span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11, fontWeight: 700,
        color: ok ? 'var(--green)' : loading ? 'var(--amber)' : 'var(--red)',
      }}>
        {loading ? '...' : ok ? 'OK' : 'ERRO'}
      </span>
      {detail && (
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--dim)' }}>
          {detail}
        </span>
      )}
    </div>
  )
}

function MiniMatchList({ matches }) {
  if (!matches.length) return (
    <EmptyState compact icon="📡" title="Nenhuma partida ao vivo" subtitle="Confira mais tarde" />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {matches.slice(0, 6).map((m, i) => {
        const home = m.teams?.home?.name || m.home_team || m.home || 'Casa'
        const away = m.teams?.away?.name || m.away_team || m.away || 'Fora'
        const sh = m.score?.home ?? m.goals?.home ?? null
        const sa = m.score?.away ?? m.goals?.away ?? null
        const min = m.minute || m.elapsed || null
        const status = normStatus(m.status || m.state)
        const isHT = status === 'HT'
        return (
          <div key={i}
          onClick={() => window.dispatchEvent(new CustomEvent('sb-navigate', { detail: 'hoje' }))}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.04)',
            cursor: 'pointer', borderRadius: 4,
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.03)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
            {/* Minute / HT badge */}
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
              color: isHT ? 'var(--amber)' : 'var(--red)', minWidth: 28, flexShrink: 0,
            }}>
              {isHT ? 'HT' : min ? `${min}'` : '●'}
            </span>
            {/* Match name */}
            <span style={{
              fontSize: 12, color: 'var(--t2)', flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {home} — {away}
            </span>
            {/* Score */}
            {sh !== null && sa !== null && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13, fontWeight: 800, color: 'var(--red)', flexShrink: 0,
                letterSpacing: '-0.02em',
              }}>
                {sh} – {sa}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const normStatus = s => {
  const u = (s || '').toUpperCase()
  if (['LIVE', '1H', '2H', 'IN_PLAY', 'ACTIVE', 'IN_PROGRESS', 'RUNNING'].includes(u)) return 'LIVE'
  if (['HT', 'HALFTIME', 'PAUSED', 'BREAK'].includes(u)) return 'HT'
  if (['FT', 'FINISHED', 'COMPLETE', 'COMPLETED', 'FULL_TIME'].includes(u)) return 'FT'
  return 'NS'
}

export default function Dashboard() {
  const hojeData = useHojeStore(s => s.data)
  const hojeLoaded = useHojeStore(s => s.loaded)
  const [systemStatus, setSystemStatus] = useState({ worker: 'loading', espn: 'loading', oddsApi: 'loading' })
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)

  // Derive stats and live games from shared HojeStore — no duplicate fetch
  const allMatches = useMemo(() => Object.values(hojeData).flat(), [hojeData])
  const statuses = useMemo(() => allMatches.map(m => normStatus(m.status || m.state)), [allMatches])
  const stats = useMemo(() => ({
    today:  allMatches.length,
    live:   statuses.filter(s => s === 'LIVE').length,
    ht:     statuses.filter(s => s === 'HT').length,
    ns:     statuses.filter(s => s === 'NS').length,
    ft:     statuses.filter(s => s === 'FT').length,
    sports: new Set(allMatches.map(m => m.sport || 'football')).size,
  }), [allMatches, statuses])
  const liveGames = useMemo(
    () => allMatches.filter(m => ['LIVE', 'HT'].includes(normStatus(m.status || m.state))).slice(0, 6),
    [allMatches]
  )

  const load = useCallback(async () => {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    try {
      const [matchRes, health] = await Promise.allSettled([
        fetchMatches({ date: today }),
        checkHealth(),
      ])
      const hv = health.status === 'fulfilled' && health.value
      setSystemStatus({
        worker:  hv && hv.ok ? 'ok' : 'err',
        espn:    matchRes.status === 'fulfilled' ? 'ok' : 'err',
        oddsApi: 'ok',
      })
    } catch (e) { console.warn('[Dashboard]', e.message) }
    setLastUpdate(new Date().toLocaleTimeString('pt-BR'))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const savedPicks = (() => { try { return JSON.parse(localStorage.getItem('sb_v10') || '[]') } catch { return [] } })()
  const winPicks = savedPicks.filter(p => p.result === 'W').length
  const resolvedPicks = savedPicks.filter(p => p.result && p.result !== 'P' && p.result !== 'V')
  const wr = resolvedPicks.length ? (winPicks / resolvedPicks.length * 100).toFixed(1) : null
  const roi = savedPicks.length ? ((winPicks / savedPicks.length - 0.5) * 100).toFixed(1) : null

  const refreshBtn = (
    <button
      onClick={load}
      className="btn"
      style={{ padding: '5px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
    >
      ↺ Atualizar
    </button>
  )

  return (
    <div className="page">
      <PageHeader
        icon="📊"
        title="Painel do Dia"
        subtitle={lastUpdate ? `Atualizado às ${lastUpdate}` : 'Carregando dados...'}
        actions={refreshBtn}
      />

      {/* KPI strip */}
      <KpiRow>
        <Kpi value={hojeLoaded ? stats.today : '..'}  label="Jogos Hoje"  color="var(--blue)"  sub="total do dia" />
        <Kpi value={hojeLoaded ? stats.live + stats.ht : '..'} label="🔴 Ao Vivo" color="var(--red)" pulse={(stats.live + stats.ht) > 0} sub={(stats.live + stats.ht) > 0 ? 'em andamento' : 'nenhum agora'} />
        <Kpi value={hojeLoaded ? stats.ns : '..'}   label="Agendados"  color="var(--amber)" sub="ainda por jogar" />
        <Kpi value={hojeLoaded ? stats.ft : '..'}   label="Encerrados" color="var(--t3)"    sub="finalizados" />
      </KpiRow>

      {/* Widgets grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>

        {/* Ao Vivo */}
        <Widget title={liveGames.length > 0 ? `JOGOS AO VIVO · ${liveGames.length}` : 'JOGOS AO VIVO'}>
          <MiniMatchList matches={liveGames} />
        </Widget>

        {/* Status do sistema */}
        <Widget title="STATUS DO SISTEMA">
          <StatusRow label="Cloudflare Worker" status={systemStatus.worker} />
          <StatusRow label="ESPN Data Feed"    status={systemStatus.espn} />
          <StatusRow label="The Odds API"      status={systemStatus.oddsApi} />
        </Widget>

        {/* Performance da sessão */}
        <Widget title="PERFORMANCE DA SESSÃO">
          {savedPicks.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>
                    {winPicks}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--dim)' }}>Wins</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 800, color: wr && Number(wr) >= 55 ? 'var(--green)' : 'var(--amber)' }}>
                    {wr ? `${wr}%` : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--dim)' }}>Win Rate</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 800, color: Number(roi) > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {roi ? `${Number(roi) > 0 ? '+' : ''}${roi}%` : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--dim)' }}>ROI Est.</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--mute)', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" }}>
                {savedPicks.length} picks registrados
              </div>
            </div>
          ) : (
            <EmptyState
              compact
              icon="📈"
              title="Sem picks registrados"
              subtitle="Registre picks pela Central para acompanhar seu desempenho."
            />
          )}
        </Widget>

        {/* Atalhos rápidos */}
        <Widget title="ATALHOS">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Jogos do Dia',        icon: '📅', page: 'hoje' },
              { label: 'Picks de Hoje',       icon: '⚡', page: 'hub' },
              { label: 'NBA Props',           icon: '🏀', page: 'bkprops' },
              { label: 'Futebol Props',       icon: '⚽', page: 'ftprops' },
              { label: 'Value Scanner',       icon: '🔭', page: 'value' },
              { label: 'Performance & Banca', icon: '📈', page: 'perf' },
            ].map(a => (
              <button
                key={a.page}
                className="btn"
                style={{ padding: '7px 10px', fontSize: 12, justifyContent: 'flex-start', gap: 7 }}
                onClick={() => window.dispatchEvent(new CustomEvent('sb-navigate', { detail: a.page }))}
              >
                <span>{a.icon}</span>{a.label}
              </button>
            ))}
          </div>
        </Widget>
      </div>
    </div>
  )
}
