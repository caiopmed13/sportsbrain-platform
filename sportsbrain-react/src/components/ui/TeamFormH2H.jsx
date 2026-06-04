import { useState, useEffect } from 'react'
import { fetchTeamForm, fetchH2H } from '../../utils/espn'

// ─── B1: Team Form Badges ─────────────────────────────────────────────────────
const RESULT_STYLE = {
  W: { bg: 'rgba(34,212,160,.25)',  border: 'rgba(34,212,160,.5)',  color: 'var(--green)', label: 'V' },
  D: { bg: 'rgba(255,184,48,.2)',   border: 'rgba(255,184,48,.4)',  color: 'var(--amber)', label: 'E' },
  L: { bg: 'rgba(255,61,90,.2)',    border: 'rgba(255,61,90,.4)',   color: 'var(--red)',   label: 'D' },
}

function FormBadge({ result, opponent, score, isHome }) {
  const s = RESULT_STYLE[result] || RESULT_STYLE.D
  return (
    <span
      title={`${isHome ? 'Casa' : 'Fora'} vs ${opponent}: ${score}`}
      style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 10, fontWeight: 800,
        width: 18, height: 18,
        borderRadius: 4,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'default',
        boxSizing: 'border-box',
      }}
    >{s.label}</span>
  )
}

export function TeamForm({ teamName, league, style = {} }) {
  const [form, setForm]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed]   = useState(false)

  useEffect(() => {
    if (!teamName) return
    setLoading(true)
    fetchTeamForm(teamName, league, 5)
      .then(data => {
        setForm(data)
        setFailed(!data || data.length === 0)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [teamName, league])

  if (failed || (!loading && !form)) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...style }}>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: 'var(--dim)', marginRight: 2 }}>
        FORMA
      </span>
      {loading ? (
        <span style={{ fontSize: 9, color: 'var(--dim)' }}>…</span>
      ) : (
        (form || []).map((f, i) => (
          <FormBadge key={i} result={f.result} opponent={f.opponent} score={f.score} isHome={f.isHome} />
        ))
      )}
    </div>
  )
}

// ─── B5: H2H Panel ────────────────────────────────────────────────────────────
export function H2HPanel({ homeTeam, awayTeam, league }) {
  const [h2h,     setH2H]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [failed,  setFailed]  = useState(false)
  const [open,    setOpen]    = useState(false)

  function load() {
    if (h2h || loading) return
    setLoading(true)
    fetchH2H(homeTeam, awayTeam, league)
      .then(data => {
        setH2H(data)
        setFailed(!data || data.length === 0)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }

  function toggle() {
    setOpen(v => !v)
    if (!open) load()
  }

  if (!homeTeam || !awayTeam) return null

  // Calculate H2H record
  let homeWins = 0, draws = 0, awayWins = 0
  if (h2h) {
    const hShort = homeTeam.split(' ').slice(-1)[0]
    const aShort = awayTeam.split(' ').slice(-1)[0]
    h2h.forEach(g => {
      if (g.winner === 'Empate') draws++
      else if ((g.winner || '').toLowerCase().includes(hShort.toLowerCase())) homeWins++
      else awayWins++
    })
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button
        onClick={toggle}
        style={{
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 10, fontWeight: 700,
          background: open ? 'rgba(184,125,255,.12)' : 'rgba(255,255,255,.04)',
          border: `1px solid ${open ? 'rgba(184,125,255,.3)' : 'rgba(255,255,255,.1)'}`,
          color: open ? 'var(--purple)' : 'var(--dim)',
          padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
          transition: 'all .15s',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
      >
        ⚔ H2H {h2h && !failed ? `· ${homeWins}V ${draws}E ${awayWins}D` : ''} {open ? '▲' : '▼'}
      </button>

      {open && (
        <div style={{
          marginTop: 6,
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.08)',
          borderRadius: 8, padding: '10px 12px',
        }}>
          {loading && <div style={{ fontSize: 11, color: 'var(--dim)', textAlign: 'center' }}>Buscando H2H…</div>}
          {failed && <div style={{ fontSize: 11, color: 'var(--mute)' }}>H2H não disponível para este confronto.</div>}
          {h2h && h2h.length > 0 && (
            <>
              {/* Summary bar */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                <div style={{ flex: homeWins || 1, height: 6, background: 'rgba(34,212,160,.5)', borderRadius: 3 }} />
                {draws > 0 && <div style={{ flex: draws, height: 6, background: 'rgba(255,184,48,.4)', borderRadius: 3 }} />}
                <div style={{ flex: awayWins || 1, height: 6, background: 'rgba(255,61,90,.4)', borderRadius: 3 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11 }}>
                <span style={{ color: 'var(--green)', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                  {homeTeam.split(' ').slice(-1)[0]}: {homeWins}V
                </span>
                {draws > 0 && <span style={{ color: 'var(--amber)', fontFamily: "'JetBrains Mono',monospace" }}>{draws}E</span>}
                <span style={{ color: 'var(--red)', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                  {awayTeam.split(' ').slice(-1)[0]}: {awayWins}D
                </span>
              </div>

              {/* Game list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {h2h.map((g, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
                    padding: '3px 0', borderBottom: i < h2h.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none',
                  }}>
                    <span style={{ color: 'var(--dim)', minWidth: 55 }}>{g.date.slice(5)}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--white)', minWidth: 32, textAlign: 'center' }}>
                      {g.score}
                    </span>
                    <span style={{
                      color: g.winner === 'Empate' ? 'var(--amber)' :
                        g.winner?.toLowerCase().includes(homeTeam.split(' ').slice(-1)[0].toLowerCase()) ? 'var(--green)' : 'var(--red)',
                    }}>
                      {g.winner}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
