// ─── SportsBrain Push Notifications ──────────────────────────────────────────
// Envia notificações nativas do browser quando novos picks aparecem

const NOTIF_KEY   = 'sb_notified_picks'  // IDs já notificados
const NOTIF_CFG   = 'sb_notif_cfg'       // { enabled, minConf, maxHoursToKickoff }
const MAX_STORED  = 200

// ─── Config ───────────────────────────────────────────────────────────────────
export function loadNotifCfg() {
  try {
    return {
      enabled: false, minConf: 85, maxHoursToKickoff: 2,
      ...JSON.parse(localStorage.getItem(NOTIF_CFG) || '{}'),
    }
  } catch { return { enabled: false, minConf: 85, maxHoursToKickoff: 2 } }
}

export function saveNotifCfg(cfg) {
  try { localStorage.setItem(NOTIF_CFG, JSON.stringify(cfg)) } catch {}
}

// ─── Permissão ────────────────────────────────────────────────────────────────
export function notifSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notifPermission() {
  if (!notifSupported()) return 'unsupported'
  return Notification.permission  // 'default' | 'granted' | 'denied'
}

export async function requestNotifPermission() {
  if (!notifSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  const result = await Notification.requestPermission()
  return result
}

// ─── Histórico de notificados ─────────────────────────────────────────────────
function loadNotified() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]')) }
  catch { return new Set() }
}

function saveNotified(set) {
  try {
    const arr = Array.from(set).slice(-MAX_STORED)
    localStorage.setItem(NOTIF_KEY, JSON.stringify(arr))
  } catch {}
}

// ─── Envio ────────────────────────────────────────────────────────────────────
export function sendPickNotif(pick) {
  if (!notifSupported() || Notification.permission !== 'granted') return false

  const conf    = pick.conf ?? pick.confidence ?? 0
  const ev      = pick.ev  ?? pick.ev_pct ?? null
  const match   = pick.match || pick.matchLabel || '—'
  const stat    = pick.stat || pick.market || '—'
  const league  = pick.league || ''

  const icon  = '/logo192.png'
  const badge = '/logo192.png'

  const title = `🔒 ${conf}% · ${stat}`
  const body  = [
    match,
    league,
    ev != null ? `EV: +${typeof ev === 'number' ? ev.toFixed(1) : ev}%` : null,
  ].filter(Boolean).join('\n')

  try {
    const n = new Notification(title, {
      body,
      icon,
      badge,
      tag:    `sb_pick_${pick.id || stat + match}`,
      silent: false,
    })
    n.onclick = () => {
      window.focus()
      n.close()
    }
    return true
  } catch(e) {
    console.warn('[Notifications] send error:', e)
    return false
  }
}

// ─── Verificação em lote ──────────────────────────────────────────────────────
// picks = array de picks do Garantido
// kickoffMap = { pickId: ISO timestamp } — quando começa o jogo
export function checkAndNotifyPicks(picks, kickoffMap = {}) {
  const cfg = loadNotifCfg()
  if (!cfg.enabled) return 0
  if (Notification.permission !== 'granted') return 0

  const notified = loadNotified()
  const now      = Date.now()
  let count = 0

  for (const pick of picks) {
    const conf = pick.conf ?? pick.confidence ?? 0
    if (conf < cfg.minConf) continue

    // gera ID único para esse pick
    const pickId = pick.id || `${pick.match}|${pick.stat}|${pick.line ?? ''}`
    if (notified.has(pickId)) continue

    // verifica janela de tempo (só notifica se jogo começa em < X horas)
    const kickoff = kickoffMap[pickId] || pick.kickoff || pick.game_date
    if (kickoff) {
      const ms = new Date(kickoff).getTime() - now
      const hoursUntil = ms / 3600000
      if (hoursUntil < 0 || hoursUntil > cfg.maxHoursToKickoff) continue
    }

    if (sendPickNotif(pick)) {
      notified.add(pickId)
      count++
    }
  }

  if (count > 0) saveNotified(notified)
  return count
}

// ─── Alerta de Acumulador (A5) ────────────────────────────────────────────────
// Verifica se o acumulador em construção merece notificação
export function checkAccumulatorAlert(picks) {
  if (!notifSupported() || Notification.permission !== 'granted') return false
  if (!picks || picks.size < 2) return false

  // Ler config de alertas
  let alertCfg = {}
  try { alertCfg = JSON.parse(localStorage.getItem('sb_alerts_cfg') || '{}') } catch {}

  const entries = Array.from(picks.values())
  const allHaveOdds = entries.every(e => e.realOdds?.odds)

  // EV combinado
  let combEV = null
  if (allHaveOdds) {
    const combOdd  = entries.reduce((a, e) => a * e.realOdds.odds, 1)
    const combProb = entries.reduce((a, e) => a * (1 / e.realOdds.odds), 1)
    combEV = +((combProb * combOdd - 1) * 100).toFixed(1)
  }

  // Odd combinada
  const combOdd = allHaveOdds ? entries.reduce((a, e) => a * e.realOdds.odds, 1) : null

  // Verifica threshold do alerta acum_ev
  const acumEvCfg = alertCfg.acum_ev
  if (acumEvCfg?.enabled && combEV != null && combEV >= (acumEvCfg.threshold ?? 10)) {
    try {
      new Notification(`🎰 Acumulador EV +${combEV}%`, {
        body: `${picks.size} picks · Odd combinada: ${combOdd?.toFixed(2)} · EV: +${combEV}%`,
        icon: '/icon-192.png', tag: 'sb_acum_ev',
      })
    } catch {}
    return true
  }

  // Verifica threshold do alerta acum_odd
  const acumOddCfg = alertCfg.acum_odd
  if (acumOddCfg?.enabled && combOdd != null && combOdd >= (acumOddCfg.threshold ?? 300) / 100) {
    try {
      new Notification(`📦 Acumulador @${combOdd.toFixed(2)}`, {
        body: `${picks.size} picks com odd combinada ${combOdd.toFixed(2)}`,
        icon: '/icon-192.png', tag: 'sb_acum_odd',
      })
    } catch {}
    return true
  }

  return false
}

// ─── Notificação de teste ─────────────────────────────────────────────────────
export function sendTestNotif() {
  if (Notification.permission !== 'granted') return false
  try {
    new Notification('🔒 SportsBrain PRO', {
      body: 'Notificações ativas! Você receberá alertas de picks com ≥85% conf.',
      icon: '/logo192.png',
      tag:  'sb_test',
    })
    return true
  } catch { return false }
}
