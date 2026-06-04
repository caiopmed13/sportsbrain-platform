// ═══════════════════════════════════════════════════════════════════════════
// Premium.jsx — Editorial Sports Almanac v7.2
// Visual redesign: papel cream, terracotta, Anton + Newsreader + DM Mono.
// Lógica de dados preservada; apenas apresentação reformulada.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useRef } from 'react'
import { Copy, Check, RefreshCw } from 'lucide-react'
import './Premium.css'
import './Premium.v8.css'   // ★ design v8 "Aragão" overlay
import { groupVipItems, megaCanPost, getMegaOrphans,
         filterMainMegaGroups, filterSmallMegaGroups, formatVipGroupTitle, getEffectiveRiskProfile, dedupCombos,
         filterByOddRange } from './premiumHelpers.js'
// F2.92: helpers de labels (marketToPT, statLabelWithTeam, selectionTxt) extraídos
import { marketToPT, statLabelWithTeam, selectionTxt } from './premiumLabels.js'
// P3.9 R6K-F2: badges para math_verdict (gold/value/fair/trap), design_verdict
// (long_shot) e risk_tags. Backend anota via premiumVerdict.js / premiumRiskTags.js.
import VerdictBadge from '../components/ui/VerdictBadge.jsx'
import RiskBadges from '../components/ui/RiskBadges.jsx'
// P3.9 R6J-B7 — lazy-load client para os endpoints split adicionados no R6J-B6.
// fetchPremiumTier1 carrega só o payload do topo (12.7KB vs ~3MB legacy);
// fetchPremiumCombos carrega cada section paginada; fetchPremiumLegacy é
// fallback de emergência se /tier1 falhar.
import {
  fetchPremiumTier1,
  fetchPremiumCombos,
  fetchPremiumLegacy,
  extractLegacySectionItems,
  lazyLoadSections,
  ALLOWED_PREMIUM_SECTIONS,
} from '../api/premiumApi.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://sportsbrain-api.sportsbrain-api.workers.dev'

// P3.9 R6J-B7 — sections carregadas em background logo após tier1 chegar.
// Demais sections (results_acca, top_picks_today, bet_builder_mid/plus) ficam
// para lazy on-demand caso a UI precise.
const PREMIUM_BACKGROUND_SECTIONS = Object.freeze([
  'tier2',
  'tier3',
  'tier4',
  'bet_builder_light',
])

const TIER_LABELS = {
  combo:   'FAIXA Combinados',
  jackpot: 'Jackpot',
  mega:    'Mega Jackpot',
}

// ── Date helpers (Brazil UTC-3) ────────────────────────────────────────────
function getBRDate(offsetDays = 0) {
  const now = new Date()
  const brMs = now.getTime() - 3 * 60 * 60 * 1000
  const br = new Date(brMs)
  if (offsetDays) br.setUTCDate(br.getUTCDate() + offsetDays)
  return br.toISOString().slice(0, 10)
}

// Parsea kickoff Bet365 'YYYYMMDDHHMMSS' ou ISO; retorna texto humano
function formatKickoff(k) {
  if (!k) return null
  const s = String(k)
  let t
  if (/^\d{14}$/.test(s)) {
    t = Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10), +s.slice(10,12), +s.slice(12,14))
  } else {
    t = new Date(s).getTime()
  }
  if (isNaN(t)) return null
  const diff = t - Date.now()
  const mins = Math.round(diff / 60000)
  if (mins < -180) return null
  if (mins < 0) return `LIVE ${Math.abs(mins)}min`
  if (mins < 60) return `${mins}min`
  const hrs = (mins / 60)
  if (hrs < 24) return `em ${hrs.toFixed(hrs >= 10 ? 0 : 1)}h`
  return `em ${Math.round(hrs / 24)}d`
}

// F2.92: marketToPT, statLabelWithTeam, selectionTxt extraídos pra ./premiumLabels.js

// ── Quality tag computation v2 — usa campos premiumQualityScore/desajuste_level/valueBetLevel ──
function getPickQuality(pick) {
  // 1. Desajustada: steam/devig com 3 níveis
  if (pick.desajuste_level) {
    if (pick.desajuste_level === 'premium') {
      return { tag: '⚡ Desajustada Premium', cls: 'desajustada', title: 'Steam forte Pinnacle + EV alto — dinheiro profissional confirmado' }
    }
    if (pick.desajuste_level === 'forte') {
      return { tag: '⚡ Desajustada', cls: 'desajustada', title: 'Steam forte Pinnacle — mercado ajustando posição' }
    }
    return { tag: '⚡ Desajuste Leve', cls: 'desajustada', title: 'Steam moderado ou devig Bet365 detectado' }
  }
  // Fallback: fontes legadas de desajuste
  if (pick.source === 'desajuste' || pick._steam_move === true || pick._has_steam === true) {
    return { tag: '⚡ Desajustada', cls: 'desajustada', title: 'Odds em movimento — mercado ajustando' }
  }

  // 2. EV teórico (modo LAB — sinal não validado em produção)
  if (pick.valueBetLevel === 'strong_value') {
    return { tag: '💰 EV teórico alto', cls: 'value', title: `EV teórico +${pick.ev_pct}% — sinal ainda não validado em produção (modo LAB)` }
  }
  if (pick.valueBetLevel === 'value') {
    return { tag: '💰 EV teórico', cls: 'value', title: `EV teórico +${pick.ev_pct}% — comparado com referência de odds, sem validação de lucro` }
  }
  // Fallback legado
  if ((pick.valueBetLevel == null || pick.valueBetLevel === 'none') &&
      pick.ev_pct >= 5 && (pick.bet365 === true || pick.pinnacle === true)) {
    return { tag: '💰 EV teórico', cls: 'value', title: `EV teórico +${pick.ev_pct}% — comparado com referência de odds, sem validação de lucro` }
  }

  // 3. Strong Pick: premiumTierQuality elite ou forte evidência Bayesian
  if (pick.premiumTierQuality === 'elite') {
    const pqs = pick.premiumQualityScore ? ` · PQS ${Math.round(pick.premiumQualityScore)}` : ''
    return { tag: '💪 Strong Pick', cls: 'strong', title: `Pick elite — qualidade máxima do modelo${pqs}` }
  }
  if ((pick._bayesian_lcb != null && pick._bayesian_lcb >= 65) ||
      (pick._pattern_lcb != null && pick._pattern_lcb >= 65) ||
      (pick.consensus_count >= 3) ||
      pick.premiumTierQuality === 'strong') {
    const detail = pick._bayesian_lcb >= 65
      ? `LCB ${Math.round(pick._bayesian_lcb)}%`
      : pick.premiumTierQuality === 'strong'
        ? `PQS ${Math.round(pick.premiumQualityScore || 0)}`
        : `${pick.consensus_count} tipsters`
    return { tag: '💪 Strong Pick', cls: 'strong', title: `Alta confiança estatística — ${detail}` }
  }
  return null
}

// ── Suspicious combo filter ────────────────────────────────────────────────
function isSuspiciousCombo(combo) {
  const hasConsensus = (combo.consensus_count ?? 0) >= 2
  const hasVerifiedLeg = (combo.legs || []).some(l => l._is_direct_b365 || l.bet365 === true)
  return !hasConsensus && !hasVerifiedLeg
}

// ── Date Filter (GE Globo style) ───────────────────────────────────────────
function DateFilter({ selectedDate, onChange }) {
  const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const trackRef = useRef(null)

  const slots = Array.from({ length: 7 }, (_, i) => {
    const dateStr = getBRDate(i)
    const [y, mo, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, mo - 1, d, 12))
    return {
      date: dateStr,
      label: i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : days[dt.getUTCDay()],
      num: d,
      month: months[mo - 1],
    }
  })

  useEffect(() => {
    if (!trackRef.current) return
    const active = trackRef.current.querySelector('.date-filter__btn--active')
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [selectedDate])

  return (
    <div className="date-filter" role="tablist" aria-label="Filtro de datas">
      <div className="date-filter__track" ref={trackRef}>
        {slots.map(s => (
          <button
            key={s.date}
            role="tab"
            aria-selected={selectedDate === s.date}
            className={`date-filter__btn ${selectedDate === s.date ? 'date-filter__btn--active' : ''}`}
            onClick={() => onChange(s.date)}
          >
            <span className="date-filter__label">{s.label}</span>
            <span className="date-filter__day">{s.num}</span>
            <span className="date-filter__month">{s.month}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Skeleton loader ────────────────────────────────────────────────────────
function PickSkeleton() {
  return (
    <div className="pick-skeleton" aria-hidden="true">
      <div className="pick-skeleton__num skel" />
      <div className="pick-skeleton__body">
        <div className="skel skel--match" />
        <div className="skel skel--meta" />
        <div className="skel skel--badges" />
      </div>
      <div className="pick-skeleton__side">
        <div className="skel skel--odd" />
        <div className="skel skel--ev" />
      </div>
    </div>
  )
}

// ── PickCard ───────────────────────────────────────────────────────────────
function PickCard({ pick, copied, setCopied, idx }) {
  const sel = selectionTxt(pick)
  const marketPT = marketToPT(pick.market)
  const kickoff = formatKickoff(pick.kickoff)
  const verified = pick.bet365 === true || pick.pinnacle === true || pick.verified === true
  const oddSource = pick.odd_source || (pick.bet365 ? 'bet365' : pick.pinnacle ? 'pinnacle' : 'model')
  const verifyLabel = oddSource === 'bet365' ? 'Bet365' : oddSource === 'pinnacle' ? 'Pinnacle' : verified ? 'Verificada' : null
  const isFairEV = pick.source === 'bet365_direct' || pick.source === 'bet365_direct_nba' || pick._is_direct_b365
  const quality = getPickQuality(pick)
  // R6K-F2.15-D: disclaimer LAB no clipboard (alinha com can_sell=false)
  const text = `🎯 ${pick.match}\n${pick.market}${sel ? ' — '+sel : ''} @${pick.odd}\nProb ${(pick.prob*100).toFixed(0)}% · EV ${pick.ev_pct >= 0 ? '+' : ''}${pick.ev_pct}%\n\n⚠ MODO LAB · NÃO VALIDADO · Não é recomendação de aposta`
  const onCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(`single_${idx}`)
    setTimeout(() => setCopied(null), 2000)
  }
  const idxNum = typeof idx === 'number' ? idx + 1 : idx

  const [analysis, setAnalysis] = useState(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)

  const loadAnalysis = async () => {
    if (analysis || loadingAnalysis || !pick.fixture_id) return
    setLoadingAnalysis(true)
    try {
      const res = await fetch(`${API_BASE}/v1/analysis/match/${pick.fixture_id}`)
      const data = await res.json()
      setAnalysis(data)
    } catch (_) {
      setAnalysis({ error: 'Falha ao carregar análise' })
    } finally {
      setLoadingAnalysis(false)
    }
  }

  // Phase C: unified style
  const [expanded, setExpanded] = useState(false)
  const evClass = isFairEV ? '' : (pick.ev_pct > 0 ? 'is-positive' : 'is-negative')
  const evText = isFairEV ? 'fair' : `${pick.ev_pct > 0 ? '+' : ''}${pick.ev_pct}%`

  return (
    <div className={`faixa-method-card faixa-method-card--single ${quality ? `faixa-method-card--q-${quality.cls}` : ''} ${expanded ? 'is-expanded' : ''}`}>
      <div className="faixa-method-card__topbar" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0}>
        <span className="faixa-method-card__num">{String(idxNum).padStart(2, '0')}</span>
        {quality && (
          <span className={`faixa-method-card__badge faixa-method-card__badge--q-${quality.cls}`}>{quality.tag}</span>
        )}
        <span className={`faixa-method-card__ev ${evClass}`}>
          EV {evText}
        </span>
        <span className="faixa-method-card__odd">@{pick.odd}</span>
        <span className="faixa-method-card__chev" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>

      <div className="faixa-method-card__match">{pick.match}</div>
      <div className="faixa-method-card__pickline">
        <span className="faixa-method-card__market">{marketPT}</span>
        <span className="faixa-method-card__sel">{sel}</span>
        {kickoff && <span className={`faixa-method-card__kickoff${kickoff.startsWith('LIVE') ? ' is-live' : ''}`}>· {kickoff}</span>}
      </div>

      <div className="faixa-method-card__minibadges">
        <span className="mb mb--ok">✓ Analisado</span>
        {verified ? (
          <span className="mb mb--verified" title={`Odd verificada ${oddSource}`}>✓ {verifyLabel}</span>
        ) : (
          <span className="mb" title="Probabilidade calculada pelo modelo Bayesian">Modelo IA</span>
        )}
        {pick.source === 'tipster' && (
          <span className="mb" title={`Tipster Telegram${pick.channel_name ? ' · ' + pick.channel_name : ''}`}>Tipster</span>
        )}
        {pick.is_focal && <span className="mb mb--focal">Focal</span>}
        {pick.is_faixa && <span className="mb mb--faixa">FAIXA</span>}
        {pick.source === 'ia_pattern' && (
          <span className="mb" title={`Padrão IA: ${pick._pattern_n} amostras · ${pick._pattern_wr}% WR · LCB ${pick._pattern_lcb}%`}>
            🧠 LCB {pick._pattern_lcb}%
          </span>
        )}
        {pick.consensus_count > 0 && <span className="mb">{pick.consensus_count} tipsters</span>}
        {pick.bet_confidence_tier === 'no_bet' && <span className="mb" title="Sem recomendação de stake real">no_bet</span>}
        {pick.bet_confidence_tier === 'lab_only' && <span className="mb">lab_only</span>}
        {pick.bet_confidence_tier === 'micro_test' && <span className="mb">micro_test</span>}
        {pick.math_verdict && pick.math_verdict !== 'unknown' && (
          <VerdictBadge verdict={pick.math_verdict} size="sm" />
        )}
        {pick.design_verdict && (
          <VerdictBadge verdict={pick.design_verdict} size="sm" />
        )}
        {Array.isArray(pick.risk_tags) && pick.risk_tags.length > 0 && (
          <RiskBadges tags={pick.risk_tags} maxVisible={3} size="sm" />
        )}
      </div>

      {expanded && (
        <div className="faixa-method-card__body">
          <div className="faixa-method-card__meta">
            <span>Prob {(pick.prob*100).toFixed(0)}%</span>
            {pick.fixture_id && <span>Fixture #{pick.fixture_id}</span>}
          </div>

          {pick.analysis && pick.analysis.length > 30 && (
            <div className="faixa-method-card__analysis"
                 onClick={(e) => e.stopPropagation()}>
              <details onToggle={e => e.target.open && loadAnalysis()}>
                <summary>Ver análise{pick.is_focal ? ' (canal focal)' : ''}</summary>
                <div className="faixa-method-card__analysis-body">
                  {pick.analysis}
                  {pick.fixture_id && (
                    <div className="analysis-panel">
                      {loadingAnalysis && <span style={{ fontSize: 12, opacity: 0.7 }}>Carregando análise...</span>}
                      {analysis?.context_pt && <p style={{ margin: '4px 0 0' }}>{analysis.context_pt}</p>}
                      {analysis?.home_form && (
                        <div className="form-grid">
                          <span>{pick.home_team}: {analysis.home_form}</span>
                          <span>{pick.away_team}: {analysis.away_form}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}

          {(!pick.analysis || pick.analysis.length <= 30) && pick.fixture_id && (
            <div className="faixa-method-card__analysis"
                 onClick={(e) => e.stopPropagation()}>
              <details onToggle={e => e.target.open && loadAnalysis()}>
                <summary>Ver análise contextual</summary>
                <div className="faixa-method-card__analysis-body">
                  <div className="analysis-panel">
                    {loadingAnalysis && <span style={{ fontSize: 12, opacity: 0.7 }}>Carregando análise...</span>}
                    {analysis?.context_pt && <p style={{ margin: 0 }}>{analysis.context_pt}</p>}
                    {analysis?.home_form && (
                      <div className="form-grid">
                        <span>{pick.home_team}: {analysis.home_form}</span>
                        <span>{pick.away_team}: {analysis.away_form}</span>
                      </div>
                    )}
                  </div>
                </div>
              </details>
            </div>
          )}

          <button
            className={`faixa-method-card__copy ${copied === `single_${idx}` ? 'is-copied' : ''}`}
            onClick={onCopy}
          >
            {copied === `single_${idx}`
              ? <><Check size={12} />Copiado</>
              : <><Copy size={12} />Copiar bilhete LAB</>}
          </button>
        </div>
      )}
    </div>
  )
}

// ── ComboCard — Phase B unified style ─────────────────────────────────────
function ComboCard({ combo, copied, setCopied, idx, tier }) {
  const [expanded, setExpanded] = useState(false)
  const lines = combo.legs.map((l, i) => {
    const sel = selectionTxt(l)
    return `${i+1}️⃣ ${l.match}\n   ${l.market}${sel ? ' — '+sel : ''} @${l.odd}`
  }).join('\n\n')
  const bet365Count = combo.legs.filter(l => l.bet365 === true).length
  // R6K-F2.15-D: disclaimer LAB no clipboard (alinha com can_sell=false)
  const text = `🔥 ${(TIER_LABELS[tier] || 'Combo').toUpperCase()} 🔥\n\n${lines}\n\n💰 Odd combinada: ${combo.combined_odd}\n📊 Prob: ${combo.combined_prob}%\n💎 EV: +${combo.ev_pct}%\n\n⚠ MODO LAB · NÃO VALIDADO · Não é recomendação de aposta`
  const onCopy = (e) => {
    e?.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(`combo_${tier}_${idx}`)
    setTimeout(() => setCopied(null), 2000)
  }
  const evClass = combo.ev_pct > 0 ? 'is-positive' : 'is-negative'
  const matchesPreview = [...new Set(combo.legs.map(l => l.match))].slice(0, 2).join(' + ')

  return (
    <div className={`faixa-method-card faixa-method-card--combo faixa-method-card--${tier} ${expanded ? 'is-expanded' : ''}`}>
      <div className="faixa-method-card__topbar" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0}>
        <span className="faixa-method-card__badge">{TIER_LABELS[tier] || 'COMBO'} · {combo.n_legs}L</span>
        {typeof combo.ev_pct === 'number' && (
          <span className={`faixa-method-card__ev ${evClass}`}>
            EV {combo.ev_pct > 0 ? '+' : ''}{combo.ev_pct}%
          </span>
        )}
        <span className="faixa-method-card__odd">{combo.combined_odd}x</span>
        <span className="faixa-method-card__chev" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>

      <div className="faixa-method-card__match">{matchesPreview}{combo.legs.length > 2 ? ` + ${combo.legs.length - 2} mais` : ''}</div>

      <div className="faixa-method-card__minibadges">
        {combo.method_tag && <span className="mb">{combo.method_tag}</span>}
        {combo.combo_quality_score != null && (
          <span className={`mb mb--cqs-${combo.combo_quality_score >= 60 ? 'elite' : combo.combo_quality_score >= 40 ? 'strong' : 'ok'}`}>
            CQS {Math.round(combo.combo_quality_score)}
          </span>
        )}
        <span className="mb mb--ok">✓ Analisado</span>
        {bet365Count === combo.n_legs ? (
          <span className="mb mb--verified">Bet365 100%</span>
        ) : (
          <span className="mb">{bet365Count}/{combo.n_legs} Bet365</span>
        )}
        {combo.math_verdict && combo.math_verdict !== 'unknown' && (
          <VerdictBadge verdict={combo.math_verdict} size="sm" />
        )}
        {combo.design_verdict && (
          <VerdictBadge verdict={combo.design_verdict} size="sm" />
        )}
        {Array.isArray(combo.risk_tags) && combo.risk_tags.length > 0 && (
          <RiskBadges tags={combo.risk_tags} maxVisible={3} size="sm" />
        )}
      </div>

      {expanded && (
        <div className="faixa-method-card__body">
          <div className="faixa-method-card__meta">
            <span>Prob {combo.combined_prob}%</span>
            <span>{combo.n_legs} pernas</span>
          </div>
          <div className="faixa-vip-leg">
            {combo.legs.map((l, j) => {
              const sel = selectionTxt(l)
              const verified = l.bet365 === true || l.pinnacle === true || l.verified === true
              const marketLabel = marketToPT(l.market)
              return (
                <div key={j} className="faixa-combo-leg">
                  <span className="faixa-combo-leg__num">#{String(j+1).padStart(2, '0')}</span>
                  <div className="faixa-combo-leg__body">
                    <strong className="faixa-combo-leg__match">{l.match}</strong>
                    <div className="faixa-combo-leg__meta">
                      <span>{marketLabel}</span>
                      <span className="faixa-combo-leg__sel">{sel}</span>
                      {verified && <span className="mb mb--verified">✓</span>}
                      {l.source === 'tipster' && <span className="mb">Tipster</span>}
                    </div>
                  </div>
                  <span className="faixa-combo-leg__odd">@{l.odd}</span>
                </div>
              )
            })}
          </div>

          <div className="faixa-method-card__footer">
            <span className="faixa-method-card__stake-note">
              {combo.recommended_stake_pct > 0
                ? `Exposição simulada: ${combo.recommended_stake_pct}% (LAB)`
                : 'Modo LAB · sem recomendação de stake real'}
            </span>
            <button
              className={`faixa-method-card__copy ${copied === `combo_${tier}_${idx}` ? 'is-copied' : ''}`}
              onClick={onCopy}
            >
              {copied === `combo_${tier}_${idx}`
                ? <><Check size={12} />Copiado</>
                : <><Copy size={12} />Copiar bilhete LAB</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// F2.31: Helper compartilhado — formata kickoff_iso pra HH:MM ou "Hoje 14:30".
function _fmtKickoff(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const hhmm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Hoje ${hhmm}`;
    if (isTomorrow) return `Amanhã ${hhmm}`;
    const dd = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `${dd} ${hhmm}`;
  } catch { return null; }
}

// F2.31/F2.32/F2.40/F2.41: Helper — badge curto por método.
function _methodBadge(method) {
  if (method === 'ht_chutes') return 'HT';
  if (method === 'faixa_result_btts') return 'R+BTTS';
  if (method === 'chutes') return 'CHUTES';
  if (method === 'libertadores') return 'LIB';
  if (method === 'resultado') return '1X2';
  if (method === 'mega_quadras') return 'MEGA';
  if (method === 'mega_simples') return 'MEGA1';
  if (method === 'mega_ht_hard') return 'HT★';
  return method?.toUpperCase().slice(0, 6) || '?';
}

// F2.32/F2.33: Helper — header longo p/ copy bilhete.
function _methodCopyHeader(method) {
  if (method === 'ht_chutes') return 'MÉTODO HT-CHUTES';
  if (method === 'faixa_result_btts') return 'MÉTODO FAIXA RESULTADO+BTTS';
  if (method === 'chutes') return 'MÉTODO CHUTES';
  if (method === 'libertadores') return 'MÉTODO FUTEBOL TOP';
  if (method === 'resultado') return 'MÉTODO RESULTADO';
  if (method === 'mega_quadras') return 'MÉTODO MEGA QUADRAS';
  if (method === 'mega_simples') return 'MÉTODO MEGA SIMPLES';
  if (method === 'mega_ht_hard') return 'MÉTODO HT (DIFÍCIL)';
  return 'MÉTODO';
}

// F2.36-2: Componente compartilhado de sort entre todas as tabs.
function SortControl({ value, onChange, label = 'Ordenar:' }) {
  return (
    <div className="faixa-methods-section__sort" style={{ marginBottom: '0.5rem' }}>
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {SORT_OPTIONS.map(o => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// F2.34: Sort comparators reutilizados por todos os métodos.
const SORT_OPTIONS = [
  { key: 'ev_desc',    label: 'EV ↓',     cmp: (a, b) => (b.ev_pct ?? -999) - (a.ev_pct ?? -999) },
  { key: 'odd_asc',    label: 'Odd ↑',    cmp: (a, b) => (a.combined_odd ?? 0) - (b.combined_odd ?? 0) },
  { key: 'odd_desc',   label: 'Odd ↓',    cmp: (a, b) => (b.combined_odd ?? 0) - (a.combined_odd ?? 0) },
  { key: 'kickoff',    label: 'Horário',  cmp: (a, b) => {
      const ta = new Date(a.kickoff_iso || a.cards?.[0]?.kickoff_iso || 0).getTime();
      const tb = new Date(b.kickoff_iso || b.cards?.[0]?.kickoff_iso || 0).getTime();
      return (ta || Infinity) - (tb || Infinity);
    }
  },
];

// MatchCard — Card per-match (FAIXA-Methods MVP).
// F2.31: redesenhado estilo Apostas e Palpites — badge método + EV% + horário + legs compactas.
// F2.32: suporta method 'chutes' (player props).
// F2.33: análise expandível por click no card.
// F2.37: default EXPANDED (FAIXA real mostra tudo aberto pra usuário ver seleções).
function MatchCard({ card }) {
  const [expanded, setExpanded] = useState(true);
  if (!card) return null;
  const handleCopy = (e) => {
    e?.stopPropagation();
    const lines = [
      `🥷 ${_methodCopyHeader(card.method)} — ${card.match}`,
      `📊 Odd combinada: @${card.combined_odd}`,
      `📈 Prob: ${(card.combined_prob * 100).toFixed(2)}%`,
      ``,
      ...card.legs.map(l => `• ${l.stat}: ${l.selection || ''} ${l.line ?? ''} @${l.odd}`.trim()),
      ``,
      `🧪 SportsBrain LAB — modo análise (não há recomendação de stake real)`,
    ];
    navigator.clipboard?.writeText(lines.join('\n'));
  };
  const kickoff = _fmtKickoff(card.kickoff_iso);
  const evClass = card.ev_pct >= 0 ? 'is-positive' : 'is-negative';
  const playerSubtitle = card.method === 'chutes' && card.player_name
    ? `${card.player_name}` : null;
  return (
    <div className={`faixa-method-card ${expanded ? 'is-expanded' : ''}`}>
      <div className="faixa-method-card__topbar" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0}>
        <span className="faixa-method-card__badge">{_methodBadge(card.method)}</span>
        {typeof card.ev_pct === 'number' && (
          <span className={`faixa-method-card__ev ${evClass}`}>
            EV {card.ev_pct >= 0 ? '+' : ''}{card.ev_pct.toFixed(1)}%
          </span>
        )}
        <span className="faixa-method-card__odd">{card.combined_odd}x</span>
        <span className="faixa-method-card__chev" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>
      <div className="faixa-method-card__match">{card.match}</div>
      {playerSubtitle && <div className="faixa-method-card__player">👤 {playerSubtitle}</div>}
      {kickoff && <div className="faixa-method-card__kickoff">{kickoff}</div>}
      {expanded && (
        <>
          <ul className="faixa-method-card__legs">
            {card.legs.map((l, i) => (
              <li key={i} className="faixa-method-card__leg">
                <span className="faixa-method-card__leg-stat">{l.stat}</span>
                {(l.selection || l.line != null) && (
                  <span className="faixa-method-card__leg-sel">
                    {' '}{l.selection || ''} {l.line ?? ''}
                  </span>
                )}
                <span className="faixa-method-card__leg-odd"> @{l.odd}</span>
                {typeof l.prob === 'number' && (
                  <span className="faixa-method-card__leg-prob"> · {(l.prob*100).toFixed(0)}%</span>
                )}
              </li>
            ))}
          </ul>
          <div className="faixa-method-card__meta">
            <span>Prob {(card.combined_prob*100).toFixed(2)}%</span>
            <span>{card.n_legs} {card.n_legs === 1 ? 'perna' : 'pernas'}</span>
          </div>
          <button className="faixa-method-card__copy" onClick={handleCopy}>
            Copiar bilhete LAB
          </button>
        </>
      )}
    </div>
  );
}

// DuplaCard — combo de 2 cards (FAIXA style).
// F2.37: default EXPANDED.
function DuplaCard({ dupla, methodLabel }) {
  const [expanded, setExpanded] = useState(true);
  if (!dupla) return null;
  const handleCopy = (e) => {
    e?.stopPropagation();
    const lines = [
      `🥷 DUPLA — ${methodLabel}`,
      `📊 Odd combinada: @${dupla.combined_odd}`,
      `📈 Prob: ${(dupla.combined_prob * 100).toFixed(4)}%`,
      ``,
    ];
    dupla.cards.forEach((c, i) => {
      lines.push(`Card ${i + 1}: ${c.match} (@${c.combined_odd}x)`);
      c.legs.forEach(l => {
        lines.push(`  • ${l.stat}: ${l.selection || ''} ${l.line ?? ''} @${l.odd}`.trim());
      });
      lines.push(``);
    });
    lines.push(`🧪 SportsBrain LAB — modo análise (não há recomendação de stake real)`);
    navigator.clipboard?.writeText(lines.join('\n'));
  };
  const evClass = (dupla.ev_pct || 0) >= 0 ? 'is-positive' : 'is-negative';
  return (
    <div className={`faixa-method-group faixa-method-group--dupla ${expanded ? 'is-expanded' : ''}`}>
      <div className="faixa-method-group__topbar" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0}>
        <span className="faixa-method-group__badge">DUPLA · {methodLabel}</span>
        {typeof dupla.ev_pct === 'number' && (
          <span className={`faixa-method-card__ev ${evClass}`}>
            EV {dupla.ev_pct >= 0 ? '+' : ''}{dupla.ev_pct.toFixed(1)}%
          </span>
        )}
        <span className="faixa-method-group__odd">{dupla.combined_odd}x</span>
        <span className="faixa-method-card__chev" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>
      <ul className="faixa-method-group__cards">
        {dupla.cards.map((c, i) => (
          <li key={i} className="faixa-method-group__card-summary">
            <span className="faixa-method-group__card-match">
              {c.match}
              <span className="faixa-method-group__card-sel">
                {' '}
                {(c.legs || []).map(l => l.selection || '').filter(Boolean).join(' + ')}
              </span>
            </span>
            <span className="faixa-method-group__card-odd">{c.combined_odd}x</span>
          </li>
        ))}
      </ul>
      {expanded && (
        <>
          <div className="faixa-method-group__expanded">
            {dupla.cards.map((c, i) => (
              <div key={i} className="faixa-method-group__leg-block">
                <div className="faixa-method-group__leg-match">{c.match}</div>
                <ul>
                  {c.legs.map((l, j) => (
                    <li key={j}>
                      {l.stat} · {l.selection || ''} {l.line ?? ''} @{l.odd}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="faixa-method-card__meta">
            <span>Prob {(dupla.combined_prob*100).toFixed(2)}%</span>
            <span>{dupla.cards.length} cards · {dupla.n_legs} pernas</span>
          </div>
          <button className="faixa-method-group__copy" onClick={handleCopy}>
            Copiar Dupla LAB
          </button>
        </>
      )}
    </div>
  );
}

// QuadraCard — combo de 4 cards (FAIXA style).
// F2.31: badge + EV% + cobertura mãe hint.
// F2.33: legs detalhadas só em modo expandido.
// F2.73: helper — uma "célula" de quadra pode ser um card simples (tem .match/.legs)
// ou um combo (tem .cards aninhado, ex: dupla/tripla em MEGA QUADRAS). Sempre retorna
// um array de cards atômicos pra render.
function _flattenCell(cell) {
  if (!cell) return [];
  if (Array.isArray(cell.cards) && cell.cards.length > 0) return cell.cards;
  return [cell];
}
function QuadraCard({ quadra, methodLabel, kindLabel = 'QUADRA' }) {
  const [expanded, setExpanded] = useState(true);
  if (!quadra) return null;
  const handleCopy = (e) => {
    e?.stopPropagation();
    const lines = [
      `🔥 ${kindLabel} — ${methodLabel}`,
      `📊 Odd combinada: @${quadra.combined_odd}`,
      `📈 Prob: ${(quadra.combined_prob * 100).toFixed(6)}%`,
      ``,
    ];
    quadra.cards.forEach((c, i) => {
      const atoms = _flattenCell(c);
      lines.push(`Célula ${i + 1}: ${atoms.map(a=>a.match).filter(Boolean).join(' + ')} (@${c.combined_odd}x)`);
      atoms.forEach(a => {
        (a.legs || []).forEach(l => {
          lines.push(`  • ${l.stat}: ${l.selection || ''} ${l.line ?? ''} @${l.odd}`.trim());
        });
      });
      lines.push(``);
    });
    lines.push(`💡 Cobertura mãe: considere copiar Duplas associadas também`);
    lines.push(`🧪 SportsBrain LAB — modo análise (não há recomendação de stake real)`);
    navigator.clipboard?.writeText(lines.join('\n'));
  };
  const evClass = (quadra.ev_pct || 0) >= 0 ? 'is-positive' : 'is-negative';
  return (
    <div className={`faixa-method-group faixa-method-group--quadra ${expanded ? 'is-expanded' : ''}`}>
      <div className="faixa-method-group__topbar" onClick={() => setExpanded(v => !v)} role="button" tabIndex={0}>
        <span className="faixa-method-group__badge">{kindLabel} · {methodLabel}</span>
        {typeof quadra.ev_pct === 'number' && (
          <span className={`faixa-method-card__ev ${evClass}`}>
            EV {quadra.ev_pct >= 0 ? '+' : ''}{quadra.ev_pct.toFixed(1)}%
          </span>
        )}
        <span className="faixa-method-group__odd">{quadra.combined_odd}x</span>
        <span className="faixa-method-card__chev" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>
      {/* F2.67: lista compacta só quando colapsado — quando expandido o detalhe abaixo já mostra tudo */}
      {!expanded && (
        <ul className="faixa-method-group__cards">
          {quadra.cards.map((c, i) => {
            const atoms = _flattenCell(c);
            const matchTxt = atoms.map(a => a.match).filter(Boolean).join(' + ') || c.match || '';
            const selTxt = atoms.flatMap(a => (a.legs || []).map(l => l.selection || '')).filter(Boolean).join(' + ');
            return (
              <li key={i} className="faixa-method-group__card-summary">
                <span className="faixa-method-group__card-match">
                  {matchTxt}
                  <span className="faixa-method-group__card-sel">{selTxt ? ` ${selTxt}` : ''}</span>
                </span>
                <span className="faixa-method-group__card-odd">{c.combined_odd}x</span>
              </li>
            );
          })}
        </ul>
      )}
      {expanded && (
        <>
          <div className="faixa-method-group__expanded">
            {quadra.cards.map((c, i) => {
              const atoms = _flattenCell(c);
              return (
                <div key={i} className="faixa-method-group__leg-block">
                  <div className="faixa-method-group__leg-match">
                    Célula {i + 1} · {c.combined_odd}x
                    <span className="faixa-method-group__card-odd" style={{marginLeft:'auto', opacity:0.7, fontSize:'0.85em'}}>
                      {atoms.length} {atoms.length === 1 ? 'jogo' : 'jogos'}
                    </span>
                  </div>
                  {/* F2.74: cada sub-match agrupa suas legs (não mistura) */}
                  {atoms.map((a, ai) => (
                    <div key={ai} style={{paddingLeft:'0.5em', marginTop:'0.4em'}}>
                      <div style={{fontSize:'0.92em', opacity:0.85, marginBottom:'0.2em'}}>
                        {a.match || '?'}
                        {a.combined_odd ? <span style={{marginLeft:'0.5em', opacity:0.7}}>· {a.combined_odd}x</span> : null}
                      </div>
                      <ul style={{margin:0, paddingLeft:'1em'}}>
                        {(a.legs || []).map((l, j) => (
                          <li key={j} style={{marginBottom: l._analysis ? '0.3em' : 0}}>
                            <div>
                              {statLabelWithTeam(l, a.match)} · {l.selection || ''}{(l.line != null && !String(l.selection || '').includes(String(l.line))) ? ` ${l.line}` : ''} @{l.odd}
                              {typeof l.prob === 'number' && l.prob > 0 && l.prob < 1 && (
                                <span style={{marginLeft:'0.4em', opacity:0.6, fontSize:'0.85em'}}>
                                  · P {(l.prob*100).toFixed(0)}%
                                </span>
                              )}
                            </div>
                            {l._analysis && (
                              <div style={{fontSize:'0.78em', opacity:0.55, paddingLeft:'1em', marginTop:'0.1em'}}>
                                {l._analysis}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      {a.analysis && (
                        <div style={{fontSize:'0.78em', opacity:0.6, fontStyle:'italic', marginTop:'0.3em', paddingLeft:'1em'}}>
                          📊 {a.analysis}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="faixa-method-card__meta">
            <span>Prob {(quadra.combined_prob*100).toFixed(4)}%</span>
            <span>{quadra.cards.length} cards · {quadra.n_legs} pernas</span>
          </div>

          {/* F2.63: Cobertura Mãe — 6 sub-duplas que compõem esta quadra */}
          {Array.isArray(quadra.derived_duplas) && quadra.derived_duplas.length > 0 && (
            <DerivedDuplasSection duplas={quadra.derived_duplas} parentCards={quadra.cards} />
          )}

          <button className="faixa-method-group__copy" onClick={handleCopy}>
            Copiar {kindLabel} LAB
          </button>
        </>
      )}
    </div>
  );
}

// F2.63: Cobertura Mãe — renderiza as N sub-duplas que compõem uma quadra.
// Cada sub-dupla pode ser copiada individualmente.
function DerivedDuplasSection({ duplas, parentCards }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!Array.isArray(duplas) || duplas.length === 0) return null;
  // Map card_id → match (rápido lookup pra renderizar nomes)
  const cardLookup = new Map();
  for (const c of (parentCards || [])) cardLookup.set(c.card_id, c);

  const copyDupla = (dupla, idx) => (e) => {
    e?.stopPropagation();
    const [a, b] = dupla.card_ids.map(id => cardLookup.get(id) || {});
    const lines = [
      `🥷 DUPLA (Cobertura mãe ${idx + 1})`,
      `📊 Odd: @${dupla.combined_odd}`,
      `📈 Prob: ${(dupla.combined_prob * 100).toFixed(2)}%`,
      ``,
      `1️⃣ ${a.match || dupla.matches?.[0] || '?'} @${a.combined_odd ?? '?'}x`,
      `2️⃣ ${b.match || dupla.matches?.[1] || '?'} @${b.combined_odd ?? '?'}x`,
      ``,
      `🧪 SportsBrain LAB — modo análise`,
    ];
    navigator.clipboard?.writeText(lines.join('\n'));
  };

  return (
    <div className="faixa-cobertura-mae">
      <div
        className="faixa-cobertura-mae__header"
        onClick={() => setCollapsed(v => !v)}
        role="button"
        tabIndex={0}
      >
        <span className="faixa-cobertura-mae__icon">💡</span>
        <span className="faixa-cobertura-mae__title">
          Cobertura Mãe · <strong>{duplas.length} duplas</strong>
        </span>
        <span className="faixa-cobertura-mae__hint">
          {collapsed ? 'mostrar' : 'ocultar'}
        </span>
        <span className="faixa-method-card__chev" aria-hidden>{collapsed ? '▼' : '▲'}</span>
      </div>
      {!collapsed && (
        <ul className="faixa-cobertura-mae__list">
          {duplas.map((d, i) => {
            const [a, b] = (d.card_ids || []).map(id => cardLookup.get(id) || {});
            const m1 = a.match || d.matches?.[0] || '?';
            const m2 = b.match || d.matches?.[1] || '?';
            return (
              <li key={i} className="faixa-cobertura-mae__item">
                <span className="faixa-cobertura-mae__pair">
                  <span className="faixa-cobertura-mae__num">{i + 1}.</span>
                  <span className="faixa-cobertura-mae__match">{m1}</span>
                  <span className="faixa-cobertura-mae__plus">+</span>
                  <span className="faixa-cobertura-mae__match">{m2}</span>
                </span>
                <span className="faixa-cobertura-mae__meta">
                  <span className="faixa-cobertura-mae__odd">@{(d.combined_odd ?? 0).toFixed(2)}</span>
                  <span className="faixa-cobertura-mae__prob">{((d.combined_prob ?? 0) * 100).toFixed(1)}%</span>
                  <button
                    className="faixa-cobertura-mae__copy"
                    onClick={copyDupla(d, i)}
                    title="Copiar esta dupla"
                  >
                    Copiar
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// FaixaMethodsSection — agrupador por método.
// F2.30: range vem como prop (não state). Tab define o range:
//   FAIXA  → range='cards'        (combined_odd <100x)
//   JACKPOT → range='conservador' (100-9999x)
//   MEGA   → range='agressivo'    (10000x+)
// Mesma section reusada nas 3 tabs com filtro diferente.
function FaixaMethodsSection({ faixaMethods, range = 'cards', title = null }) {
  const [sortKey, setSortKey] = useState('ev_desc');  // F2.34
  const [comboFilter, setComboFilter] = useState('all');  // F2.88 — filter por nível
  if (!faixaMethods) return null;

  // F2.32: CHUTES. F2.40: LIBERTADORES. F2.41: RESULTADO (1X2 only) + HT-CHUTES fix.
  const methods = [
    // F2.74: MEGA QUADRAS separado por método (sem mistura cross-method).
    // Cada método ganha sua própria seção MEGA com quadras/quintas internas.
    // F2.79: MEGA QUADRAS per-método (puro, sem mistura). Cada método só usa
    // suas próprias cards como células — HT-CHUTES só HT, RESULT+BTTS só FT, etc.
    ...(['libertadores','resultado','ht_chutes','faixa_result_btts','chutes']
      .filter(k => faixaMethods.mega_quadras?.[k]?.quadras?.length || faixaMethods.mega_quadras?.[k]?.quintas?.length)
      .map(k => ({
        key: `mega_${k}`,
        label: `MEGA · ${k === 'libertadores' ? 'FUTEBOL TOP' : k === 'faixa_result_btts' ? 'RESULT+BTTS' : k === 'ht_chutes' ? 'HT-CHUTES' : k === 'resultado' ? 'RESULTADO' : 'CHUTES'}`,
        data: { ...faixaMethods.mega_quadras[k], cards: [], duplas: [], triplas: [] },
      }))),
    { key: 'mega_ht_hard',         label: 'HT-CHUTES AGRESSIVO ★', data: faixaMethods.mega_ht_hard },
    { key: 'mega_ht_medium',       label: 'HT-CHUTES MÉDIO',       data: faixaMethods.mega_ht_medium },
    { key: 'mega_ht_conservative', label: 'HT-CHUTES CONSERVADOR', data: faixaMethods.mega_ht_conservative },
    { key: 'libertadores',      label: 'FUTEBOL TOP', data: faixaMethods.libertadores },
    { key: 'resultado',         label: 'RESULTADO',         data: faixaMethods.resultado },
    { key: 'ht_chutes',         label: 'HT-CHUTES',         data: faixaMethods.ht_chutes },
    { key: 'faixa_result_btts', label: 'FAIXA RESULT+BTTS', data: faixaMethods.faixa_result_btts },
    { key: 'chutes',            label: 'CHUTES',            data: faixaMethods.chutes },
  ];

  const cmp = (SORT_OPTIONS.find(o => o.key === sortKey) || SORT_OPTIONS[0]).cmp;

  // Pre-compute: se nenhum método tem item no range, não renderiza nada
  // F2.66: removido .filter(c => +c.combined_odd > 10) — era F2.28 legado
  // que escondia 100% dos cards. Backend já classifica por tier via
  // _classifyTier (cards<100, conservador 100-9999, agressivo>=10000)
  // e filterByOddRange faz o split correto por tab.
  const methodsWithItems = methods.map(method => {
    // F2.82b: simples (cells) NÃO são sortadas — mantém ordem natural do backend.
    // Sort aplica apenas a COMBOS (duplas/triplas/quadras/etc — o "combo completo").
    const cards   = filterByOddRange(method.data?.cards   || [], range).slice();
    const duplas  = filterByOddRange(method.data?.duplas  || [], range).slice().sort(cmp);
    const triplas = filterByOddRange(method.data?.triplas || [], range).slice().sort(cmp);
    const quadras = filterByOddRange(method.data?.quadras || [], range).slice().sort(cmp);
    const quintas = filterByOddRange(method.data?.quintas || [], range).slice().sort(cmp);
    // F2.66c: sextas/setimas/oitavas — alimentam principalmente MEGA tab
    const sextas  = filterByOddRange(method.data?.sextas  || [], range).slice().sort(cmp);
    const setimas = filterByOddRange(method.data?.setimas || [], range).slice().sort(cmp);
    const oitavas = filterByOddRange(method.data?.oitavas || [], range).slice().sort(cmp);
    return { ...method, cards, duplas, triplas, quadras, quintas, sextas, setimas, oitavas,
      total: cards.length + duplas.length + triplas.length + quadras.length
           + quintas.length + sextas.length + setimas.length + oitavas.length };
  }).filter(m => m.total > 0);

  if (methodsWithItems.length === 0) return null;

  return (
    <section className="faixa-methods-section">
      <div className="faixa-methods-section__header">
        {title && <span className="faixa-methods-section__title">{title}</span>}
        <div className="faixa-methods-section__sort">
          {/* F2.88: filter por nível de combo */}
          <label>Mostrar:</label>
          <select value={comboFilter} onChange={e => setComboFilter(e.target.value)}>
            <option value="all">Todos</option>
            <option value="cards">Simples</option>
            <option value="duplas">Duplas</option>
            <option value="triplas">Triplas</option>
            <option value="quadras">Quadras</option>
            <option value="quintas">Quintas</option>
            <option value="sextas">Sextas</option>
            <option value="setimas">Sétimas</option>
            <option value="oitavas">Oitavas</option>
          </select>
          <label style={{marginLeft:'0.8em'}}>Ordenar:</label>
          <select value={sortKey} onChange={e => setSortKey(e.target.value)}>
            {SORT_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {methodsWithItems.map(method => {
        const { cards, duplas, triplas, quadras, quintas, sextas, setimas, oitavas } = method;
        // F2.88: filter por nível — só mostra grupos selecionados
        const show = (level) => comboFilter === 'all' || comboFilter === level;
        return (
          <div key={method.key} className="faixa-methods-method">
            {show('cards') && cards.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Simples</h4>
                <div className="faixa-methods-method__cards-grid">
                  {cards.map((c, i) => <MatchCard key={c.card_id || i} card={c} />)}
                </div>
              </div>
            )}

            {show('duplas') && duplas.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Duplas</h4>
                {duplas.map((d, i) => (
                  <DuplaCard key={i} dupla={d} methodLabel={method.label} />
                ))}
              </div>
            )}

            {show('triplas') && triplas.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Triplas</h4>
                {triplas.map((t, i) => (
                  <QuadraCard key={i} quadra={t} methodLabel={method.label} kindLabel="TRIPLA" />
                ))}
              </div>
            )}

            {show('quadras') && quadras.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Quadras</h4>
                {quadras.map((q, i) => (
                  <QuadraCard
                    key={i}
                    quadra={q}
                    methodLabel={method.label}
                    kindLabel={q._profile ? `QUADRA ${q._profile}` : 'QUADRA'}
                  />
                ))}
              </div>
            )}

            {show('quintas') && quintas && quintas.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Quintas</h4>
                {quintas.map((q, i) => (
                  <QuadraCard key={i} quadra={q} methodLabel={method.label} kindLabel="QUINTA" />
                ))}
              </div>
            )}

            {show('sextas') && sextas && sextas.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Sextas</h4>
                {sextas.map((q, i) => (
                  <QuadraCard key={i} quadra={q} methodLabel={method.label} kindLabel="SEXTA" />
                ))}
              </div>
            )}

            {show('setimas') && setimas && setimas.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Sétimas</h4>
                {setimas.map((q, i) => (
                  <QuadraCard key={i} quadra={q} methodLabel={method.label} kindLabel="SÉTIMA" />
                ))}
              </div>
            )}

            {show('oitavas') && oitavas && oitavas.length > 0 && (
              <div className="faixa-methods-method__group">
                <h4>Oitavas</h4>
                {oitavas.map((q, i) => (
                  <QuadraCard key={i} quadra={q} methodLabel={method.label} kindLabel="OITAVA" />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ── ResultPickRow — exibe picks do pick_history (gerados pela IA do Premium) ──
function ResultPickRow({ pick }) {
  const result = (pick.result || '').toUpperCase()
  const resultClass = result === 'W' ? 'result-row--win'
    : result === 'L' ? 'result-row--loss'
    : result === 'P' ? 'result-row--push'
    : result === 'V' ? 'result-row--void'
    : 'result-row--pending'
  const resultLabel = result === 'W' ? '✅ Green'
    : result === 'L' ? '❌ Red'
    : result === 'P' ? '↩ Push'
    : result === 'V' ? '⚪ Void'
    : '⏳ Pendente'

  // pick_history campos: stat, conf, odd, tier, direction, line, selection
  // Limpa stat duplicado: "X Mais de 1.5 X Mais de 1.5" → pega só parte única
  const rawStat = (pick.stat || pick.market || '').toString()
  // Se o stat tem repetição de 15+ chars (texto duplicado), pega só a primeira metade
  const cleanStat = (() => {
    if (rawStat.length < 20) return rawStat
    const half = Math.floor(rawStat.length / 2)
    if (rawStat.slice(0, half).trim() === rawStat.slice(half).trim()) return rawStat.slice(0, half).trim()
    return rawStat
  })()
  const statLabel = marketToPT(cleanStat).slice(0, 40)
  const dirNorm   = (pick.direction || '').toLowerCase()
  let selTxt = pick.selection || ''
  if (!selTxt && dirNorm) {
    if (dirNorm === 'over')  selTxt = pick.line != null ? `Mais de ${pick.line}` : 'Over'
    else if (dirNorm === 'under') selTxt = pick.line != null ? `Menos de ${pick.line}` : 'Under'
    else if (dirNorm === 'home')  selTxt = 'Casa Vence'
    else if (dirNorm === 'away')  selTxt = 'Fora Vence'
    else if (dirNorm === 'draw')  selTxt = 'Empate'
    else if (dirNorm === 'yes')   selTxt = 'Sim'
    else if (dirNorm === 'no')    selTxt = 'Não'
    else selTxt = dirNorm
  }
  const confPct = pick.conf != null ? `${Math.round(pick.conf * 100)}%` : null
  const tierLabel = pick.tier === 'tier1' ? 'SINGLE'
    : pick.tier === 'tier2' ? 'FAIXA'
    : pick.tier === 'tier3' ? 'JACKPOT'
    : pick.tier === 'tier4' ? 'MEGA'
    : null

  // Phase C: unified style for ResultPickRow
  const resultBadgeClass = result === 'W' ? 'is-win'
    : result === 'L' ? 'is-loss'
    : result === 'P' ? 'is-push'
    : result === 'V' ? 'is-void'
    : 'is-pending'

  return (
    <div className={`faixa-result-row ${resultClass}`}>
      <span className={`faixa-result-row__badge ${resultBadgeClass}`}>{resultLabel}</span>
      <div className="faixa-result-row__body">
        {statLabel && <span className="faixa-result-row__market">{statLabel}</span>}
        {selTxt && <span className="faixa-result-row__sel">{selTxt}</span>}
        {pick.odd  && <span className="faixa-result-row__odd">@{Number(pick.odd).toFixed(2)}</span>}
        {confPct   && <span className="faixa-result-row__conf">{confPct}</span>}
        {tierLabel && <span className="mb">{tierLabel}</span>}
      </div>
    </div>
  )
}

// ── VIP Group Card ─────────────────────────────────────────────────────────
// local constant for JSX display note — mirrors DISPLAY_LIMITS.singles from vipDecomposition.js
const DISPLAY_LIMITS_SINGLES = 6

function VipGroupCard({ group, showPostButton = false, defaultExpanded = false }) {
  const { singles, doubles, triples, fullMega } = group
  const mega = fullMega || doubles[0] || singles[0]
  if (!mega) return null

  const methodTag  = formatVipGroupTitle(group)
  const riskLabel  = getEffectiveRiskProfile(mega) === 'aggressive' ? 'AGRESSIVO' : 'CONSERVADOR'
  const isDrawBtts = mega.method_family === 'draw_btts_jackpot' ||
                     (mega.source || '').includes('draw_btts')

  // Mega display fields (from fullMega; fall back to group representative)
  const blockCount  = fullMega?.game_block_count || mega.game_block_count || singles.length
  const totalLegs   = fullMega?.n_legs || mega.n_legs || null
  const sizeTier    = fullMega?.mega_size_tier || null
  const displayOdd  = fullMega?.display_odd || null
  const rawOdd      = fullMega?.combined_odd || mega.combined_odd
  const oddLabel    = displayOdd ?? (rawOdd != null ? rawOdd.toFixed(0) + 'x' : '?x')
  const stakeUnit   = fullMega?.recommended_stake_unit || mega.recommended_stake_unit
  const probLabel   = fullMega?.probability_label || null

  // megaCanPost handles fullMega === null → false; isHighRisk needs explicit null guards
  const canPost    = showPostButton && megaCanPost(fullMega)
  const isHighRisk = showPostButton && fullMega != null &&
                     fullMega.ev_pct != null && fullMega.ev_pct < 0

  const [expanded, setExpanded] = useState(defaultExpanded)

  // Group fullMega legs by match for per-game line display
  const megaGameLines = (() => {
    if (!fullMega?.legs?.length) return []
    const byMatch = new Map()
    for (const leg of fullMega.legs) {
      const match = leg.match || '—'
      if (!byMatch.has(match)) byMatch.set(match, [])
      byMatch.get(match).push(leg)
    }
    return Array.from(byMatch.entries()).map(([match, legs]) => ({ match, legs }))
  })()

  const _evDisplay = (item) => {
    if (!item) return null
    if (item.ev_reliable === false) return <span className="vip-ev-na">EV indisponível</span>
    if (item.ev_pct == null) return null
    const cls = item.ev_pct >= 0 ? 'vip-ev-pos' : 'vip-ev-neg'
    return <span className={cls}>{item.ev_pct >= 0 ? '+' : ''}{item.ev_pct.toFixed(1)}%</span>
  }

  const sizeBadgeClass = sizeTier === 'ultra'    ? 'vip-badge vip-badge-size-ultra'
                       : sizeTier === 'large'    ? 'vip-badge vip-badge-size-large'
                       : sizeTier === 'standard' ? 'vip-badge vip-badge-size-standard'
                       : null

  const sizeLabel = sizeTier === 'ultra'    ? 'ULTRA'
                  : sizeTier === 'large'    ? 'GRANDE'
                  : sizeTier === 'standard' ? 'MÉDIO'
                  : null

  // Phase A: unified style — VipGroupCard agora usa .faixa-method-card pattern.
  const evPct = typeof fullMega?.ev_pct === 'number' ? fullMega.ev_pct : null;
  const evClass = evPct == null ? '' : (evPct >= 0 ? 'is-positive' : 'is-negative');

  return (
    <div
      className={`faixa-method-card faixa-method-card--vip ${expanded ? 'is-expanded' : ''}`}
      data-risk={mega.risk_profile}
      data-size={sizeTier}
    >
      <div className="faixa-method-card__topbar" onClick={() => setExpanded(e => !e)} role="button" tabIndex={0}>
        <span className="faixa-method-card__badge">{riskLabel === 'AGRESSIVO' ? 'AGR' : 'CONS'} · {methodTag}</span>
        {evPct != null && (
          <span className={`faixa-method-card__ev ${evClass}`}>
            EV {evPct >= 0 ? '+' : ''}{evPct.toFixed(1)}%
          </span>
        )}
        {evPct == null && fullMega?.ev_reliable === false && (
          <span className="faixa-method-card__ev">EV n/d</span>
        )}
        <span className="faixa-method-card__odd">{oddLabel}</span>
        <span className="faixa-method-card__chev" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>

      <div className="faixa-method-card__match">
        Mega com {blockCount} jogo{blockCount !== 1 ? 's' : ''}
        {totalLegs != null && <> · {totalLegs} pernas</>}
      </div>

      {/* Mini-badges row */}
      <div className="faixa-method-card__minibadges">
        {fullMega && <span className="mb mb--mae">★ APOSTA-MÃE</span>}
        {sizeLabel && <span className={`mb mb--size mb--size-${sizeTier}`}>{sizeLabel}</span>}
        {isDrawBtts && <span className="mb mb--draw">DRAW+BTTS</span>}
        {mega.risk_profile === 'aggressive' && <span className="mb mb--risk">AGRESSIVO</span>}
        {mega.math_verdict && mega.math_verdict !== 'unknown' && (
          <VerdictBadge verdict={mega.math_verdict} size="sm" />
        )}
        {mega.design_verdict && (
          <VerdictBadge verdict={mega.design_verdict} size="sm" />
        )}
        {Array.isArray(mega.risk_tags) && mega.risk_tags.length > 0 && (
          <RiskBadges tags={mega.risk_tags} maxVisible={3} size="sm" />
        )}
      </div>

      {expanded && (
        <div className="faixa-method-card__body">
          {fullMega && (
            <div className="faixa-method-card__meta">
              <span>{blockCount} jogos completos</span>
              {totalLegs != null && <span>{totalLegs} pernas</span>}
              {probLabel  && <span>{probLabel}</span>}
              {stakeUnit > 0 && <span>{stakeUnit}u (LAB)</span>}
            </div>
          )}

          {singles.length > 0 && (
            <div className="faixa-methods-method__group">
              <h4>Simples <span className="faixa-methods-method__count">({singles.length})</span></h4>
              {singles.map((s, i) => (
                <div key={i} className="faixa-vip-leg">
                  <div className="faixa-vip-leg__match">{s.match}</div>
                  {s.legs?.length > 0 && (
                    <div className="faixa-vip-leg__legs">
                      {s.legs.map((leg, j) => (
                        <span key={j} className="faixa-vip-leg__pill">
                          {marketToPT(leg.market)} {selectionTxt(leg)} <em>{leg.odd?.toFixed(2)}x</em>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="faixa-vip-leg__foot">
                    <span className="faixa-vip-leg__odd">{s.combined_odd?.toFixed(2)}x</span>
                    {_evDisplay(s)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {doubles.length > 0 && (
            <div className="faixa-methods-method__group">
              <h4>Duplas <span className="faixa-methods-method__count">({doubles.length})</span></h4>
              {doubles.map((d, i) => {
                const uniqueMatches = [...new Set((d.legs || []).map(l => l.match).filter(Boolean))]
                const legsByMatch = {}
                for (const leg of (d.legs || [])) {
                  const m = leg.match || '—'
                  if (!legsByMatch[m]) legsByMatch[m] = []
                  legsByMatch[m].push(leg)
                }
                return (
                  <div key={i} className="faixa-vip-leg">
                    <div className="faixa-vip-leg__match">{uniqueMatches.join(' + ')}</div>
                    {Object.entries(legsByMatch).map(([match, legs], mi) => (
                      <div key={mi} className="faixa-vip-leg__sub">
                        <span className="faixa-vip-leg__submatch">{match}</span>
                        <div className="faixa-vip-leg__legs">
                          {legs.map((leg, j) => (
                            <span key={j} className="faixa-vip-leg__pill">
                              {marketToPT(leg.market)} {selectionTxt(leg)} <em>{leg.odd?.toFixed(2)}x</em>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="faixa-vip-leg__foot">
                      <span className="faixa-vip-leg__odd">{d.combined_odd?.toFixed(2)}x</span>
                      {_evDisplay(d)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {triples.length > 0 && (
            <div className="faixa-methods-method__group">
              <h4>Triplas/Quadras <span className="faixa-methods-method__count">({triples.length})</span></h4>
              {triples.map((t, i) => (
                <div key={i} className="faixa-vip-leg faixa-vip-leg--triple">
                  <div className="faixa-vip-leg__match">{t.game_block_count} jogos</div>
                  <div className="faixa-vip-leg__foot">
                    <span className="faixa-vip-leg__odd">{t.combined_odd?.toFixed(2)}x</span>
                    {_evDisplay(t)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {fullMega && (
            <div className="faixa-methods-method__group">
              <h4>
                Mega Completa ★ <span className="faixa-methods-method__count">({blockCount} jogos · {oddLabel})</span>
                {stakeUnit > 0 && <span className="faixa-methods-method__count"> · {stakeUnit}u (LAB)</span>}
              </h4>

              {megaGameLines.length > 0 && megaGameLines.map((game, i) => (
                <div key={i} className="faixa-vip-leg faixa-vip-leg--mega">
                  <div className="faixa-vip-leg__match">{game.match}</div>
                  <div className="faixa-vip-leg__legs">
                    {game.legs.map((leg, j) => (
                      <span key={j} className="faixa-vip-leg__pill">
                        {marketToPT(leg.market)} {selectionTxt(leg)} <em>{leg.odd?.toFixed(2)}x</em>
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {megaGameLines.length === 0 && (
                <div className="faixa-vip-leg faixa-vip-leg--mega">
                  <div className="faixa-vip-leg__match">{blockCount} jogos completos · {totalLegs ?? '?'} pernas</div>
                </div>
              )}

              {showPostButton && (
                <div className="faixa-method-card__footer">
                  {isHighRisk && (
                    <span className="mb mb--risk">⚠ EV negativo</span>
                  )}
                  {canPost ? (
                    <button
                      className="faixa-method-card__copy"
                      onClick={(e) => {
                        e.stopPropagation();
                        const text = `🔥 MEGA VIP · ${methodTag}\n${blockCount} jogos · ${oddLabel}\n\n⚠ MODO LAB · NÃO VALIDADO · Não é recomendação de aposta`
                        navigator.clipboard.writeText(text)
                      }}
                    >
                      <Copy size={12} /> Copiar bilhete LAB
                    </button>
                  ) : (
                    <span className="faixa-method-card__blocked">Não recomendado para postar</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── P3.9 R6K-F3 — Performance IA Section ─────────────────────────────────
// Renderiza Performance IA dentro da aba Ontem. Read-only: chama
// GET /v1/premium/performance-ia. Banner de convergência, KPIs gerais,
// tabelas por method/tier/odd_bucket/math_verdict + verdict_calibration
// (status insufficient_sample sinalizado visualmente sem ser bloqueador).
function PerformanceIASection({ data, loading, error }) {
  if (loading) return <div className="loading">Carregando Performance IA…</div>
  if (error) return <div className="empty empty--warn">{error}</div>
  if (!data) return null

  const fmtPct = (v, fix = 1) => (v == null || isNaN(v)) ? '—' : `${(v * 100).toFixed(fix)}%`
  const fmtNum = (v) => (v == null || isNaN(v)) ? '—' : Math.round(v)
  const fmtSigned = (v, fix = 1) => {
    if (v == null || isNaN(v)) return '—'
    const x = (v * 100).toFixed(fix)
    return v >= 0 ? `+${x}%` : `${x}%`
  }
  const conv = data.convergence || {}
  const overall = data.overall || {}
  const target = conv.target || {}

  // Banner state
  const sampleTarget = target.min_sample_total || 300
  const sample = overall.settled || 0
  const banner = conv.ready
    ? { cls: 'ready', label: 'CONVERGÊNCIA: READY', desc: 'Sample, ROI e WR-por-bucket atingem os alvos. (não ativa comercial automaticamente)' }
    : sample >= sampleTarget * 0.7
      ? { cls: 'quase', label: 'CONVERGÊNCIA: QUASE', desc: `Sample ${sample}/${sampleTarget} · faltam ajustes para auto-sustentável.` }
      : { cls: 'insuf', label: 'CONVERGÊNCIA: AMOSTRA INSUFICIENTE', desc: `Sample ${sample}/${sampleTarget} — aguardando histórico.` }

  const bannerStyle = banner.cls === 'ready'
    ? { background: 'rgba(34,212,160,.08)', borderColor: 'rgba(34,212,160,.4)', color: 'var(--green)' }
    : banner.cls === 'quase'
      ? { background: 'rgba(245,166,35,.08)', borderColor: 'rgba(245,166,35,.4)', color: 'var(--amber)' }
      : { background: 'rgba(255,255,255,.04)', borderColor: 'rgba(255,255,255,.15)', color: 'var(--t3)' }

  return (
    <section className="ontem__perfia" style={{
      marginTop: 24, padding: 16, borderRadius: 8,
      border: '1px solid rgba(255,255,255,.08)',
      background: 'rgba(255,255,255,.02)',
    }}>
      <header style={{ marginBottom: 12 }}>
        <h3 style={{ fontFamily: "'Anton', sans-serif", letterSpacing: '.6px', margin: 0, fontSize: 20 }}>
          Performance da IA — LAB
        </h3>
        <div style={{ color: 'var(--t3)', fontSize: 12, marginTop: 4 }}>
          Histórico para auto-avaliação. Não é convite a apostar. Janela: {data.window_days || 30}d.
        </div>
      </header>

      {/* Banner Convergência */}
      <div style={{
        padding: '10px 14px', borderRadius: 6, marginBottom: 14,
        border: `1px solid ${bannerStyle.borderColor}`,
        background: bannerStyle.background, color: bannerStyle.color,
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{ fontWeight: 700, letterSpacing: '.5px' }}>{banner.label}</div>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{banner.desc}</div>
        {Array.isArray(conv.blockers) && conv.blockers.length > 0 && (
          <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: 11, opacity: 0.8 }}>
            {conv.blockers.slice(0, 5).map((b, i) => (
              <li key={i}>{b.message}</li>
            ))}
          </ul>
        )}
      </div>

      {/* KPIs gerais */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 18,
      }}>
        {[
          { lbl: 'Amostra', val: fmtNum(overall.settled), sub: `${fmtNum(overall.pending)} pendentes` },
          { lbl: 'Win Rate', val: fmtPct(overall.wr), sub: `${fmtNum(overall.wins)}W · ${fmtNum(overall.losses)}L` },
          { lbl: 'ROI', val: fmtSigned(overall.roi_pct), sub: `${fmtNum(overall.profit_unit)}u líquido` },
          { lbl: 'Streak (W)', val: fmtNum(overall.streak?.current), sub: `máx ${fmtNum(overall.streak?.max)}` },
        ].map((k, i) => (
          <div key={i} style={{
            padding: '10px 12px', borderRadius: 6,
            border: '1px solid rgba(255,255,255,.08)',
            background: 'rgba(255,255,255,.02)',
          }}>
            <div style={{ fontSize: 10, color: 'var(--t3)', letterSpacing: '.4px' }}>{k.lbl}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700 }}>{k.val}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* by_odd_bucket */}
      <PerfTable
        title="Por faixa de odd (margem vs breakeven)"
        rows={Object.entries(data.by_odd_bucket || {})
          .filter(([_, b]) => b?.n > 0)
          .map(([id, b]) => ({
            key: id,
            n: b.settled, wr: b.wr, roi: b.roi,
            extra: `breakeven ${(b.breakeven * 100).toFixed(0)}%${b.margin_vs_breakeven != null ? ` · margem ${b.margin_vs_breakeven >= 0 ? '+' : ''}${(b.margin_vs_breakeven * 100).toFixed(1)}pp` : ''}`,
          }))}
      />

      {/* by_math_verdict */}
      <PerfTable
        title="Por verdict matemático"
        rows={['gold', 'value', 'fair', 'trap', 'unknown']
          .filter(v => data.by_math_verdict?.[v])
          .map(v => {
            const grp = data.by_math_verdict[v]
            const cal = data.verdict_calibration?.[v]
            const calLabel = cal?.status === 'insufficient_sample' ? ' · amostra insuficiente'
              : cal?.status === 'miscalibrated' ? ' · MAL CALIBRADO'
              : cal?.status === 'calibrated' ? ' · calibrado' : ''
            const dim = cal?.status === 'insufficient_sample'
            return {
              key: v.toUpperCase(),
              n: grp.settled, wr: grp.wr, roi: grp.roi,
              extra: calLabel,
              dim,
            }
          })}
      />

      {/* by_method */}
      <PerfTable
        title="Por método"
        rows={Object.entries(data.by_method || {})
          .map(([k, v]) => ({ key: k, n: v.settled, wr: v.wr, roi: v.roi }))}
      />

      <footer style={{ marginTop: 16, fontSize: 11, color: 'var(--t3)' }}>
        <em>{data.disclaimer || 'LAB_ONLY_PERFORMANCE_NOT_BETTING_ADVICE'}</em>
        {data.lab_mode && (
          <span> · lab_mode=true · can_beta={String(data.can_beta)} · can_sell={String(data.can_sell)}</span>
        )}
      </footer>
    </section>
  )
}

function PerfTable({ title, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const fmtPct = (v) => (v == null || isNaN(v)) ? '—' : `${(v * 100).toFixed(1)}%`
  const fmtSigned = (v) => {
    if (v == null || isNaN(v)) return '—'
    return v >= 0 ? `+${(v * 100).toFixed(1)}%` : `${(v * 100).toFixed(1)}%`
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{
        fontSize: 12, letterSpacing: '.6px', color: 'var(--t3)',
        margin: '0 0 6px', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace",
      }}>{title}</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--t3)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <th style={{ textAlign: 'left',  padding: '4px 8px', fontWeight: 600 }}>Grupo</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>N</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>WR</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>ROI</th>
            <th style={{ textAlign: 'left',  padding: '4px 8px', fontWeight: 600 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{
              borderBottom: '1px solid rgba(255,255,255,.04)',
              opacity: r.dim ? 0.55 : 1,
            }}>
              <td style={{ padding: '4px 8px', fontFamily: "'JetBrains Mono', monospace" }}>{r.key}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{r.n ?? 0}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>{fmtPct(r.wr)}</td>
              <td style={{
                padding: '4px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace",
                color: r.roi == null ? 'var(--t3)' : r.roi >= 0 ? 'var(--green)' : 'var(--red)',
              }}>{fmtSigned(r.roi)}</td>
              <td style={{ padding: '4px 8px', fontSize: 11, color: 'var(--t3)' }}>{r.extra || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Premium() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sport, setSport] = useState('football')
  const [selectedDate, setSelectedDate] = useState(() => getBRDate(0))
  const [copied, setCopied] = useState(null)
  const [activeTier, setActiveTier] = useState('tier1')
  // F2.36-2 — global sort key compartilhado entre todas as tabs.
  const [globalSortKey, setGlobalSortKey] = useState('ev_desc')
  const globalCmp = (SORT_OPTIONS.find(o => o.key === globalSortKey) || SORT_OPTIONS[0]).cmp
  // wrapper para PickCard que usa pick.ev_pct/odd como combo
  const pickCmp = (a, b) => {
    if (globalSortKey === 'kickoff') return globalCmp(a, b)
    if (globalSortKey === 'odd_asc')  return (a.odd || 0) - (b.odd || 0)
    if (globalSortKey === 'odd_desc') return (b.odd || 0) - (a.odd || 0)
    return (b.ev_pct ?? -999) - (a.ev_pct ?? -999)
  }
  const [bet365Only, setBet365Only] = useState(false)
  const [hideCombos, setHideCombos] = useState(false)
  const [ontemData, setOntemData] = useState(null)
  const [loadingOntem, setLoadingOntem] = useState(false)
  const [ontemError, setOntemError] = useState(null)
  // F2.36-3: filtro de status na aba Ontem (Tudo/W/L/Pendente/Void)
  const [ontemFilter, setOntemFilter] = useState('all')
  // P3.9 R6K-F3 — Performance IA (Performance Tracking + Convergência)
  const [performanceData, setPerformanceData] = useState(null)
  const [loadingPerformance, setLoadingPerformance] = useState(false)
  const [performanceError, setPerformanceError] = useState(null)
  const [secondsToRefresh, setSecondsToRefresh] = useState(300)
  const [refreshTick, setRefreshTick] = useState(0)

  // P3.9 R6J-B7 — estado por section (loading/error/data). tier1 já vem em
  // `data` via /tier1; sections preenchem `data.tier2.combos` etc. à medida
  // que /combos resolve. UI lê data como antes; o estado abaixo é só pra
  // mostrar skeleton/erro por seção.
  //
  //   sectionsState[section] = {
  //     loading: boolean,
  //     error: string | null,
  //     loaded: boolean,        // true após primeira resposta (sucesso ou falha)
  //     page: number,           // página atual (suporte future a "carregar mais")
  //     has_next: boolean,
  //     total_count: number | null,
  //   }
  const [sectionsState, setSectionsState] = useState(() => {
    const init = {}
    for (const s of ALLOWED_PREMIUM_SECTIONS) {
      init[s] = {
        loading: false,
        error: null,
        loaded: false,
        page: 1,
        has_next: false,
        total_count: null,
      }
    }
    return init
  })
  // Erro do fetch principal /tier1 (não-aborted). Mostra banner ao usuário.
  const [tier1Error, setTier1Error] = useState(null)
  // Usado quando /tier1 falha e fallback legacy foi acionado com sucesso.
  // Mostra aviso discreto pro usuário entender o estado degradado.
  const [usingLegacyFallback, setUsingLegacyFallback] = useState(false)

  const loadOntem = async () => {
    if (ontemData || loadingOntem) return
    setLoadingOntem(true)
    setOntemError(null)
    try {
      const res = await fetch(`${API_BASE}/v1/premium/results?sport=${sport}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = await res.json()

      // Apenas picks gerados pela IA do Premium (pick_history) — ignora telegram_tips
      // API retorna: { ok, days, sport, picks:[], tips:[] }
      // F2-ONTEM-FIX: backend retorna 3 dias (hoje + ontem + anteontem). Aba é "Ontem"
      // — então filtramos para pick_date === ontem. Counter "Pendente" antes incluía
      // 54 picks de hoje que nem podiam ter resultado (jogo ainda não aconteceu).
      const allItems = (raw.picks || [])

      // Yesterday date in BR timezone (UTC-3)
      const brMs = Date.now() - 3 * 3600_000
      const yesterday = new Date(brMs - 86_400_000).toISOString().slice(0, 10)

      // Filtra estritamente para picks de ONTEM (não inclui hoje nem anteontem)
      const yesterdayItems = allItems.filter(r => r.date === yesterday)

      const wins    = yesterdayItems.filter(r => r.result === 'W').length
      const losses  = yesterdayItems.filter(r => r.result === 'L').length
      const pushes  = yesterdayItems.filter(r => r.result === 'P').length
      const voids   = yesterdayItems.filter(r => r.result === 'V').length
      const pending = yesterdayItems.filter(r => !r.result).length

      // Group by match name for display (já filtrado para ontem)
      const matchMap = {}
      for (const item of yesterdayItems) {
        const key = item.match || '—'
        if (!matchMap[key]) matchMap[key] = { match: key, picks: [] }
        matchMap[key].picks.push(item)
      }

      setOntemData({
        date: raw.date || yesterday,
        summary: {
          wins,
          losses,
          pushes,
          voids,
          pending,
          total: yesterdayItems.length,
          // Win rate sobre resolvidos (W+L), ignora void/pending
          win_rate: (wins + losses) > 0 ? +((wins / (wins + losses)) * 100).toFixed(1) : null,
        },
        matches: Object.values(matchMap),
      })
    } catch (e) {
      setOntemError('Falha ao carregar resultados de ontem')
    } finally {
      setLoadingOntem(false)
    }
  }

  // P3.9 R6K-F3 — fetch Performance IA do endpoint read-only
  const loadPerformance = async () => {
    if (performanceData || loadingPerformance) return
    setLoadingPerformance(true)
    setPerformanceError(null)
    try {
      const res = await fetch(`${API_BASE}/v1/premium/performance-ia?window_days=30&sport=${sport}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setPerformanceData(data)
    } catch (e) {
      setPerformanceError('Falha ao carregar Performance IA (LAB)')
    } finally {
      setLoadingPerformance(false)
    }
  }

  const TIER_TABS = [
    { id: 'tier1', label: 'Daily Singles' },
    { id: 'tier2', label: 'FAIXA' },
    { id: 'tier3', label: 'Jackpot' },
    { id: 'tier4', label: 'Mega' },
    { id: 'ontem', label: 'Ontem' },
  ]

  const handleDateChange = (d) => {
    if (d === selectedDate) return
    setSelectedDate(d)
    setData(null)
    setSecondsToRefresh(300)
  }

  const handleSportChange = (s) => {
    setSport(s)
    setOntemData(null)
    setData(null)
  }

  // P3.9 R6J-B7 — carregamento em fases:
  //   Fase 1: fetch /v1/picks/premium/tier1 (~12.7KB) → render imediato do topo
  //   Fase 2: lazy-load /v1/picks/premium/combos para tier2/3/4 +
  //           bet_builder_light em background com concorrência=2
  //   Fase 3 (não nesta fase): on-demand para results_acca/top_picks_today/
  //           bet_builder_mid/plus quando UI exigir
  //   Fallback: se /tier1 falhar, tenta legacy /v1/picks/premium e extrai
  //           sections manualmente (cobre cenários de erro do wrapper R6J-B6)
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true)
    setTier1Error(null)
    setUsingLegacyFallback(false)

    // Reset sections state ao mudar sport/date — evita itens stale
    setSectionsState(prev => {
      const reset = {}
      for (const s of ALLOWED_PREMIUM_SECTIONS) {
        reset[s] = {
          loading: false,
          error: null,
          loaded: false,
          page: 1,
          has_next: false,
          total_count: null,
        }
      }
      return reset
    })

    // Inicializa `data` com shape compatível com renderers (tier2/3/4/bet_builder
    // como arrays vazios) ANTES do tier1 resolver. Garante que filterCombos
    // etc. não quebrem mesmo se tier1 estiver carregando.
    function emptyShape() {
      return {
        // tier1 será sobrescrito pelo response real
        tier1: { count: 0, picks: [] },
        tier2: { count: 0, combos: [] },
        tier3: { count: 0, combos: [] },
        tier4: { count: 0, combos: [] },
        bet_builder: {
          light: { combos: [] },
          mid: { combos: [] },
          plus: { combos: [] },
        },
        results_acca: { combos: [] },
        top_picks_today: { picks: [] },
        // metadata flags — preserva lab_mode true como default (banner aparece)
        lab_mode: true,
        ok: true,
        sport,
      }
    }

    async function loadTier1() {
      const result = await fetchPremiumTier1({ sport, date: selectedDate, signal: ctrl.signal })
      if (cancelled) return null
      if (!result.ok) {
        if (result.error === 'aborted') return null
        // Fallback ao legacy se /tier1 falhar de verdade
        console.warn('[premium R6J-B7] /tier1 failed:', result.error, result.status)
        const legacy = await fetchPremiumLegacy({ sport, date: selectedDate, signal: ctrl.signal })
        if (cancelled) return null
        if (legacy.ok && legacy.body) {
          setUsingLegacyFallback(true)
          // Legacy body já tem todos os fields — usa direto como `data`.
          // Popula sectionsState marcando loaded=true pra evitar lazy duplicado.
          setData(legacy.body)
          setLoading(false)
          setSecondsToRefresh(300)
          // Marca todas as background sections como loaded a partir do legacy
          setSectionsState(prev => {
            const out = { ...prev }
            for (const s of PREMIUM_BACKGROUND_SECTIONS) {
              const items = extractLegacySectionItems(legacy.body, s)
              out[s] = {
                ...prev[s],
                loading: false,
                error: null,
                loaded: true,
                page: 1,
                has_next: false,
                total_count: items.length,
              }
            }
            return out
          })
          return 'legacy'  // sinaliza que o fluxo de combos não deve disparar
        }
        // Ambos falharam — mostra erro
        setTier1Error(result.error || 'tier1_fetch_failed')
        setData({ ...emptyShape(), ok: false, error: 'tier1_failed', message: result.error })
        setLoading(false)
        return null
      }
      // /tier1 OK → setData com tier1 + shells de sections
      const tier1Body = result.body
      setData({
        ...emptyShape(),
        ...tier1Body,
        // garantir shells mesmo após spread (tier1Body só tem .tier1)
        tier2: { count: 0, combos: [] },
        tier3: { count: 0, combos: [] },
        tier4: { count: 0, combos: [] },
        bet_builder: {
          light: { combos: [] },
          mid: { combos: [] },
          plus: { combos: [] },
        },
        results_acca: { combos: [] },
        top_picks_today: { picks: [] },
      })
      setLoading(false)
      setSecondsToRefresh(300)
      return 'tier1'  // sinaliza para disparar lazy-load de combos
    }

    async function loadBackgroundSections() {
      // Marca todas as background sections como loading=true antes do orquestrador
      setSectionsState(prev => {
        const out = { ...prev }
        for (const s of PREMIUM_BACKGROUND_SECTIONS) {
          out[s] = { ...prev[s], loading: true, error: null }
        }
        return out
      })

      await lazyLoadSections({
        sections: PREMIUM_BACKGROUND_SECTIONS,
        concurrency: 2,
        fetcher: (section) => fetchPremiumCombos({
          sport,
          date: selectedDate,
          section,
          page: 1,
          pageSize: 25,
          signal: ctrl.signal,
        }),
        onSection: ({ section, ok, body, error }) => {
          if (cancelled) return
          if (error === 'aborted') return
          // Merge no shape de `data` para os renderers existentes
          setData(prev => {
            if (!prev) return prev
            const items = (ok && Array.isArray(body?.items)) ? body.items : []
            if (section === 'tier2') return { ...prev, tier2: { ...prev.tier2, count: body?.total_count ?? items.length, combos: items } }
            if (section === 'tier3') return { ...prev, tier3: { ...prev.tier3, count: body?.total_count ?? items.length, combos: items } }
            if (section === 'tier4') return { ...prev, tier4: { ...prev.tier4, count: body?.total_count ?? items.length, combos: items } }
            if (section === 'bet_builder_light') return {
              ...prev,
              bet_builder: { ...(prev.bet_builder || {}), light: { combos: items } },
            }
            if (section === 'bet_builder_mid') return {
              ...prev,
              bet_builder: { ...(prev.bet_builder || {}), mid: { combos: items } },
            }
            if (section === 'bet_builder_plus') return {
              ...prev,
              bet_builder: { ...(prev.bet_builder || {}), plus: { combos: items } },
            }
            if (section === 'results_acca') return { ...prev, results_acca: { ...prev.results_acca, combos: items } }
            if (section === 'top_picks_today') return { ...prev, top_picks_today: { ...prev.top_picks_today, picks: items } }
            return prev
          })
          setSectionsState(prev => ({
            ...prev,
            [section]: {
              ...prev[section],
              loading: false,
              error: ok ? null : (error || 'section_failed'),
              loaded: true,
              page: body?.page ?? 1,
              has_next: body?.has_next ?? false,
              total_count: body?.total_count ?? null,
            },
          }))
        },
      })
    }

    async function run() {
      const t1Outcome = await loadTier1()
      if (cancelled) return
      if (t1Outcome === 'tier1') {
        // Dispara combos em background — não awaita pra não bloquear poll timer
        loadBackgroundSections().catch(e => console.warn('[premium R6J-B7] background load error:', e))
      }
      // se 'legacy', sections já foram populadas a partir do legacy body
      // se null (erro duplo), nada a fazer
    }

    run()
    const pollTimer = setInterval(() => {
      // Re-run apenas se não estiver cancelado
      if (!cancelled) run().catch(e => console.warn('[premium R6J-B7] poll error:', e))
    }, 5 * 60 * 1000)
    const countTimer = setInterval(() => {
      setSecondsToRefresh(s => s > 0 ? s - 1 : 0)
    }, 1000)
    return () => {
      cancelled = true
      ctrl.abort()
      clearInterval(pollTimer)
      clearInterval(countTimer)
    }
  }, [sport, selectedDate, refreshTick])

  const [seenOnboarding, setSeenOnboarding] = useState(() => {
    try { return localStorage.getItem('sb_onboarding_seen') === '1' } catch { return true }
  })
  function dismissOnboarding() {
    try { localStorage.setItem('sb_onboarding_seen', '1') } catch {}
    setSeenOnboarding(true)
  }

  const today = new Date()
  const dd = String(today.getDate()).padStart(2, '0')
  const monthsPT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ']
  const mm = monthsPT[today.getMonth()]
  const yy = today.getFullYear()
  const startOfYear = new Date(today.getFullYear(), 0, 0)
  const editionNo = String(Math.floor((today - startOfYear) / 86400000)).padStart(3, '0')

  const isToday = selectedDate === getBRDate(0)
  const isFutureDate = selectedDate > getBRDate(0)

  const filterPicks  = (picks)  => bet365Only ? (picks || []).filter(p => p.bet365 === true) : (picks || [])
  const filterCombos = (combos) => {
    let list = combos || []
    if (bet365Only) list = list.filter(c => c.legs.every(l => l.bet365 === true))
    if (hideCombos) list = list.filter(c => !isSuspiciousCombo(c))
    return list
  }

  const tier1List = data?.tier1?.picks || []
  const noBasketballPicks = !loading && data && !data.error && sport === 'basketball' &&
    activeTier === 'tier1' && tier1List.length === 0

  return (
    <div className="almanac">
      <div className="almanac__wrap">

        {/* Onboarding */}
        {!seenOnboarding && (
          <div className="onboard">
            <button className="onboard__close" onClick={dismissOnboarding} aria-label="Fechar">×</button>
            <h3 className="onboard__head">Bem-vindo ao <em>Premium</em></h3>
            <ul className="onboard__list">
              <li><strong>Daily Singles</strong> — picks individuais com Wilson LCB Bayesian (sinal teórico, ainda em validação)</li>
              <li><strong>"Só odds verificadas"</strong> — filtra apenas picks com odd Bet365/Pinnacle confirmada</li>
              <li><strong>Esconder suspeitos</strong> — combos sem odds verificadas ou consenso entre tipsters</li>
              <li><strong>Modo LAB</strong>: dados em validação. Sem recomendação de stake real, sem promessa de lucro.</li>
            </ul>
            <button className="btn btn--share" onClick={dismissOnboarding} style={{ marginTop: 12 }}>Entendi</button>
          </div>
        )}

        {/* R6J-A — Lab disclaimer (server marca lab_mode=true enquanto
            can_beta/can_sell/micro_test_active=false). Sempre visível no topo. */}
        {(data?.lab_mode !== false) && (
          <div
            role="note"
            aria-label="Aviso de modo laboratório"
            style={{
              background: 'rgba(255, 196, 0, 0.08)',
              border: '1px solid rgba(255, 196, 0, 0.45)',
              borderRadius: 8,
              padding: '12px 16px',
              margin: '0 0 16px 0',
              color: 'var(--ink, inherit)',
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            <strong style={{ letterSpacing: 0.4 }}>⚠ MODO LAB · NÃO VALIDADO EM PRODUÇÃO</strong>
            <div style={{ marginTop: 4, opacity: 0.85 }}>
              Estes dados são observações internas para avaliação do modelo. Não são
              recomendações de aposta, não usam dinheiro real e não prometem lucro.
            </div>
          </div>
        )}

        {/* P3.9 R6J-B7 — banner discreto quando fallback legacy foi acionado */}
        {usingLegacyFallback && (
          <div
            role="status"
            aria-label="Modo compatibilidade"
            style={{
              background: 'rgba(128, 128, 128, 0.06)',
              border: '1px solid rgba(128, 128, 128, 0.25)',
              borderRadius: 6,
              padding: '8px 12px',
              margin: '0 0 12px 0',
              fontSize: 12,
              lineHeight: 1.4,
              opacity: 0.85,
            }}
          >
            Modo compatibilidade: usando endpoint legacy. Performance pode ser
            menor que o normal.
          </div>
        )}

        {/* P3.9 R6J-B7 — erro de fetch /tier1 (não-fallback) */}
        {tier1Error && !usingLegacyFallback && (
          <div
            role="alert"
            style={{
              background: 'rgba(220, 80, 80, 0.08)',
              border: '1px solid rgba(220, 80, 80, 0.35)',
              borderRadius: 8,
              padding: '12px 16px',
              margin: '0 0 16px 0',
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            <strong>Falha ao carregar Premium</strong>
            <div style={{ marginTop: 4, opacity: 0.85 }}>
              {tier1Error}. Tente atualizar a página.
            </div>
          </div>
        )}

        {/* Masthead */}
        <header className="almanac__masthead">
          <div className="almanac__edition">
            <span>Boletim Nº {editionNo}</span>
            <span>{dd}.{mm}.{yy}</span>
            <span>SportsBrain · v7.2</span>
          </div>
          <h1 className="almanac__title">
            Premium <em>· laboratório</em>
          </h1>
          <p className="almanac__subtitle">
            Picks observados por Wilson LCB Bayesian sobre {data?.tipster_tips_used ?? '—'} tips Telegram resolvidas.
            Resultados internos em validação — sem recomendação de banca real.
          </p>
          <div className="almanac__stats">
            {data?.odds_age_min != null && (
              <span className={`almanac__stat ${data.odds_freshness === 'fresh' ? 'almanac__stat--fresh' : data.odds_freshness === 'stale' ? 'almanac__stat--stale' : ''}`}>
                Odds Bet365 · <strong>{data.odds_age_min}min</strong> · {data.odds_freshness}
              </span>
            )}
            {data?.bet365_picks > 0 && (
              <span className="almanac__stat">Cobertura · <strong>{data.bet365_picks}/{data.total_pool}</strong> Bet365</span>
            )}
            {data?.tipster_picks_for_combos > 0 && (
              <span className="almanac__stat">Tipster · <strong>{data.tipster_picks_for_combos}</strong> tips ativas</span>
            )}
            {!loading && (
              <span className="almanac__stat almanac__stat--refresh">
                <span>Atualiza em <strong>{Math.floor(secondsToRefresh/60)}:{String(secondsToRefresh%60).padStart(2,'0')}</strong></span>
                <button
                  className="btn-refresh"
                  onClick={() => setRefreshTick(t => t+1)}
                  title="Atualizar agora"
                  aria-label="Atualizar picks agora"
                >
                  <RefreshCw size={11} />
                </button>
              </span>
            )}
          </div>
        </header>

        {/* Date filter — GE Globo style */}
        <DateFilter selectedDate={selectedDate} onChange={handleDateChange} />

        {/* Controls */}
        <div className="almanac__controls">
          <div className="almanac__sportswitch" role="tablist" aria-label="Esporte">
            {[{id:'football',l:'Futebol'},{id:'basketball',l:'Basquete'}].map(s => (
              <button
                key={s.id}
                onClick={() => handleSportChange(s.id)}
                className={`almanac__sportbtn ${sport === s.id ? 'almanac__sportbtn--active' : ''}`}
                role="tab"
                aria-selected={sport === s.id}
              >{s.l}</button>
            ))}
          </div>
          <label className={`almanac__filter ${bet365Only ? 'almanac__filter--on' : ''}`}>
            <input type="checkbox" checked={bet365Only} onChange={(e) => setBet365Only(e.target.checked)} />
            Só odds verificadas
          </label>
          <label className={`almanac__filter ${hideCombos ? 'almanac__filter--on' : ''}`}>
            <input type="checkbox" checked={hideCombos} onChange={(e) => setHideCombos(e.target.checked)} />
            Esconder combos suspeitos
          </label>
        </div>

        {/* Tier tabs */}
        {data && !data.error && (
          <nav className="almanac__tiers" role="tablist" aria-label="Tiers Premium">
            {TIER_TABS.map(t => {
              const tierData = data[t.id]
              // F2.38.3: counters refletem dedup em todos os tiers (UX consistente)
              // F2.66c: counters incluem faixa_methods (cards+combos até oitavas)
              // distribuídos pelo tier_class (cards <100, conservador 100-9999, agressivo >=10000)
              const _fm = data?.faixa_methods || {}
              const _countFmInRange = (predicate) => {
                let n = 0
                const TYPES = ['cards','duplas','triplas','quadras','quintas','sextas','setimas','oitavas']
                const countOn = (obj) => {
                  if (!obj) return
                  for (const type of TYPES) {
                    for (const it of (obj[type] || [])) {
                      const odd = +it.combined_odd || 0
                      if (predicate(odd)) n++
                    }
                  }
                }
                for (const [k, v] of Object.entries(_fm)) {
                  if (!v) continue
                  // F2.74: mega_quadras agora é nested {libertadores:{...},ht_chutes:{...},...}
                  if (k === 'mega_quadras') {
                    for (const subMod of Object.values(v)) countOn(subMod)
                    continue
                  }
                  countOn(v)
                }
                return n
              }
              const count = t.id === 'ontem'
                ? (ontemData?.summary?.total ?? null)
                : t.id === 'tier4'
                  ? filterMainMegaGroups(data?.tier4?.combos).size + _countFmInRange(o => o >= 10000)
                  : t.id === 'tier3'
                    ? dedupCombos(data?.tier3?.combos || []).length + filterSmallMegaGroups(data?.tier4?.combos).size + _countFmInRange(o => o >= 100 && o < 10000)
                    : t.id === 'tier2'
                      ? dedupCombos(data?.tier2?.combos || []).length + _countFmInRange(o => o < 100)
                      : (tierData?.count ?? 0)
              const isActive = activeTier === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTier(t.id)
                    if (t.id === 'ontem') {
                      loadOntem()
                      loadPerformance()  // R6K-F3: carrega Performance IA junto
                    }
                  }}
                  className={`almanac__tierbtn almanac__tierbtn--${t.id} ${isActive ? 'almanac__tierbtn--active' : ''}`}
                  role="tab"
                  aria-selected={isActive}
                >
                  {t.label}
                  {count !== null && <span className="almanac__tiercount">{count}</span>}
                </button>
              )
            })}
          </nav>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="almanac__skeleton">
            {[1,2,3].map(i => <PickSkeleton key={i} />)}
          </div>
        )}

        {data?.error && (
          <div className="empty empty--warn">
            <strong>Pipeline aguardando dados.</strong> {data.message || data.error}
          </div>
        )}

        {/* Basketball empty state */}
        {noBasketballPicks && (
          <div className="empty empty--sport">
            <div className="empty__icon">🏀</div>
            <strong>Sem picks NBA {isToday ? 'hoje' : `para ${selectedDate}`}</strong>
            <p>Picks de basquete são gerados a partir de mercados NBA na Bet365 (TOTAL_POINTS, NBA_GAME_LINES, etc.). Se não há jogos NBA com mercados abertos, a aba fica vazia.</p>
            <p>
              <button className="btn-link" onClick={() => handleSportChange('football')}>
                Ver picks de futebol
              </button>
              {' · '}ou aguarde mercados NBA abrirem.
            </p>
          </div>
        )}

        {/* Tiers content */}
        {!loading && data && !data.error && (
          <>
            {/* TIER 1 — Daily Singles */}
            {data.tier1 && activeTier === 'tier1' && (() => {
              const list = filterPicks(data.tier1.picks).slice().sort(pickCmp)
              return (
                <section>
                  <div className="almanac__sectionhead">
                    <span className="almanac__sectionheadtxt">Daily Singles</span>
                  </div>
                  <p className="almanac__sectiondesc">
                    {data.tier1.description}{bet365Only && <> · filtro Bet365 ativo ({list.length}/{data.tier1.picks?.length || 0})</>}
                  </p>
                  <SortControl value={globalSortKey} onChange={setGlobalSortKey} />
                  {list.map((p, i) => <PickCard key={i} pick={p} copied={copied} setCopied={setCopied} idx={i} />)}
                  {list.length === 0 && !noBasketballPicks && (
                    <div className="empty">
                      {bet365Only
                        ? 'Nenhum pick com odd Bet365 verificada. Desligue o filtro pra ver picks com odd estimada.'
                        : isFutureDate
                          ? `Sem picks para esta data ainda. Mercados para ${selectedDate} podem não estar abertos.`
                          : 'Sem picks Daily Singles hoje.'
                      }
                    </div>
                  )}
                </section>
              )
            })()}

            {/* TIER 2 — FAIXA */}
            {data.tier2 && activeTier === 'tier2' && (() => {
              const list = dedupCombos(filterCombos(data.tier2.combos))   // F2.38.3 dedup
              const tier2Sec = sectionsState.tier2
              const isSectionLoading = tier2Sec?.loading && list.length === 0
              const sectionErr = tier2Sec?.error
              return (
                <section>
                  {/* F2.30: FAIXA tab mostra apenas Simples (<100x). Duplas vão pro JACKPOT, Quadras pro MEGA. */}
                  <FaixaMethodsSection
                    faixaMethods={data?.faixa_methods}
                    range="cards"
                    title="Métodos FAIXA · Simples"
                  />
                  <div className="almanac__sectionhead">
                    <span className="almanac__sectionheadtxt">COMBINADOS TIPSTER · FAIXA</span>
                  </div>
                  <p className="almanac__sectiondesc">
                    Pipeline tipsters · combinados <strong>3-30x</strong> Resultado+BTTS. Complementar aos Métodos FAIXA acima. <em>Modo LAB.</em>
                  </p>
                  <SortControl value={globalSortKey} onChange={setGlobalSortKey} />
                  {/* P3.9 R6J-B7 — section loading/error */}
                  {isSectionLoading && (
                    <div className="empty" style={{ opacity: 0.7 }}>Carregando combinados…</div>
                  )}
                  {sectionErr && list.length === 0 && (
                    <div className="empty empty--warn">
                      Falha ao carregar combinados: {sectionErr}
                    </div>
                  )}
                  {/* VIP Groups — metodológicos por method_group_id */}
                  {(() => {
                    const vipGroups = groupVipItems(data.tier2.combos)
                    if (vipGroups.size === 0) return null
                    const arr = Array.from(vipGroups.values()).sort((a, b) => globalCmp(a.fullMega || a.doubles[0] || a.singles[0] || {}, b.fullMega || b.doubles[0] || b.singles[0] || {}))
                    return arr.map((group, idx) => (
                      <VipGroupCard key={idx} group={group} />
                    ))
                  })()}
                  {list.slice().sort(globalCmp).map((c, i) => <ComboCard key={i} combo={c} copied={copied} setCopied={setCopied} idx={i} tier="combo" />)}
                  {list.length === 0 && (
                    <div className="empty">
                      {bet365Only ? 'Nenhuma dupla com TODAS odds verificadas Bet365 hoje.' : 'Sem duplas FAIXA hoje.'}
                    </div>
                  )}
                </section>
              )
            })()}

            {/* TIER 3 — Jackpot (inclui Jackpot VIP e Outros vindos do tier4) */}
            {data.tier3 && activeTier === 'tier3' && (() => {
              const tier3Sec = sectionsState.tier3
              const tier4Sec = sectionsState.tier4
              const isSectionLoading = (tier3Sec?.loading || tier4Sec?.loading)
              const sectionErr = tier3Sec?.error || tier4Sec?.error
              const list            = dedupCombos(filterCombos(data.tier3.combos))   // F2.38.3 dedup
              // Small megas and orphans from tier4 live here, NOT in the Mega tab
              // bet365Only NOT applied to VIP groups: groups contain mixed decomposition levels
              // (fullMega + singles + doubles) — filterCombos predicate would reject valid groups.
              // filter DOES apply to orphans (flat combos without a group) below.
              const smallMegaGroups = filterSmallMegaGroups(data?.tier4?.combos)
              const megaOrphans     = filterCombos(getMegaOrphans(data?.tier4?.combos))
              return (
                <section>
                  {/* F2.30: JACKPOT tab mostra Duplas (100-9999x) dos métodos FAIXA. */}
                  <FaixaMethodsSection
                    faixaMethods={data?.faixa_methods}
                    range="conservador"
                    title="Métodos FAIXA · Duplas"
                  />
                  <div className="almanac__sectionhead">
                    <span className="almanac__sectionheadtxt">Jackpot</span>
                  </div>
                  <p className="almanac__sectiondesc">
                    3-4 legs · odd combinada 30-999. <em>Modo LAB · sem recomendação de stake real.</em>
                  </p>
                  <SortControl value={globalSortKey} onChange={setGlobalSortKey} />
                  {/* P3.9 R6J-B7 — section loading/error */}
                  {isSectionLoading && list.length === 0 && (
                    <div className="empty" style={{ opacity: 0.7 }}>Carregando jackpots…</div>
                  )}
                  {sectionErr && list.length === 0 && (
                    <div className="empty empty--warn">
                      Falha ao carregar jackpots: {sectionErr}
                    </div>
                  )}
                  {/* VIP Groups from tier3 — metodológicos por method_group_id */}
                  {(() => {
                    const vipGroups = groupVipItems(data.tier3.combos)
                    if (vipGroups.size === 0) return null
                    const arr = Array.from(vipGroups.entries()).sort((a, b) => globalCmp(a[1].fullMega || a[1].doubles[0] || a[1].singles[0] || {}, b[1].fullMega || b[1].doubles[0] || b[1].singles[0] || {}))
                    return arr.map(([gid, group]) => (
                      <VipGroupCard key={gid} group={group} />
                    ))
                  })()}
                  {list.slice().sort(globalCmp).map((c, i) => <ComboCard key={i} combo={c} copied={copied} setCopied={setCopied} idx={i} tier="jackpot" />)}
                  {list.length === 0 && (
                    <div className="empty empty--warn">
                      <strong>Pool insuficiente hoje.</strong><br/>
                      Preferimos não forçar jackpots reciclando os mesmos 5 jogos. Volte amanhã, ou aproveite Daily Singles e Duplas FAIXA.
                    </div>
                  )}

                  {/* ── Jackpot VIP — fullMegas pequenos (<5 blocos) do tier4 ─────── */}
                  {smallMegaGroups.size > 0 && (
                    <>
                      <div className="almanac__sectionhead" style={{ marginTop: 28 }}>
                        <span className="almanac__sectionheadtxt" style={{ fontSize: '0.9rem' }}>Jackpot VIP</span>
                      </div>
                      <p className="almanac__sectiondesc" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                        Apostas-mãe menores · alto risco · sem botão de post automático
                      </p>
                      {Array.from(smallMegaGroups.entries()).map(([gid, group]) => (
                        <VipGroupCard key={gid} group={group} />
                      ))}
                    </>
                  )}

                  {/* ── Outros — combos de odd alta sem mega-pool, colapsado ────── */}
                  {megaOrphans.length > 0 && (
                    <details className="mega-orphans-details" style={{ marginTop: 20 }}>
                      <summary className="mega-orphans-summary">
                        Outros · odd alta sem mega-pool ({megaOrphans.length})
                      </summary>
                      <p className="mega-orphans-warning">
                        Odds altas fora da estrutura Mega VIP. Não recomendadas para postagem automática.
                      </p>
                      {megaOrphans.map((c, i) => <ComboCard key={i} combo={c} copied={copied} setCopied={setCopied} idx={i} tier="jackpot" />)}
                    </details>
                  )}
                </section>
              )
            })()}

            {/* TIER 4 — Mega Jackpot (principal: ≥4 game_blocks, no upper limit) */}
            {data.tier4 && activeTier === 'tier4' && (() => {
              // Only main megas shown here (game_block_count ≥ 5 or mega_size_tier standard/large/ultra).
              // Small megas and orphans live in the Jackpot tab (tier3).
              // bet365Only not applied to VIP groups — see tier3 for explanation.
              const tier4Sec = sectionsState.tier4
              const mainMegaGroups = filterMainMegaGroups(data.tier4.combos)
              const isSectionLoading = tier4Sec?.loading && mainMegaGroups.size === 0
              const sectionErr = tier4Sec?.error
              return (
                <section>
                  {/* F2.30: MEGA tab mostra Quadras (10000x+) dos métodos FAIXA. */}
                  <FaixaMethodsSection
                    faixaMethods={data?.faixa_methods}
                    range="agressivo"
                    title="Métodos FAIXA · Quadras"
                  />
                  <div className="almanac__sectionhead">
                    <span className="almanac__sectionheadtxt">Mega Jackpot</span>
                  </div>
                  <p className="almanac__sectiondesc">
                    Apostas-mãe com 4+ jogos confirmados · odd alta · variância extrema por design. <em>Modo LAB · sem recomendação de stake real.</em>
                  </p>
                  <SortControl value={globalSortKey} onChange={setGlobalSortKey} />

                  {/* P3.9 R6J-B7 — section loading/error */}
                  {isSectionLoading && (
                    <div className="empty" style={{ opacity: 0.7 }}>Carregando megas…</div>
                  )}
                  {sectionErr && mainMegaGroups.size === 0 && (
                    <div className="empty empty--warn">
                      Falha ao carregar megas: {sectionErr}
                    </div>
                  )}

                  {/* Main Mega groups: F2.27 sort canPost+EV é default. Quando user escolhe
                      outro sortKey (Odd/Horário), aplica preferência do user. */}
                  {mainMegaGroups.size > 0 && Array.from(mainMegaGroups.entries())
                    .sort(([, a], [, b]) => {
                      if (globalSortKey !== 'ev_desc') {
                        return globalCmp(a.fullMega || {}, b.fullMega || {})
                      }
                      const aCan = megaCanPost(a.fullMega) ? 1 : 0
                      const bCan = megaCanPost(b.fullMega) ? 1 : 0
                      if (aCan !== bCan) return bCan - aCan
                      return (b.fullMega?.ev_pct || 0) - (a.fullMega?.ev_pct || 0)
                    })
                    .map(([gid, group]) => (
                      <VipGroupCard key={gid} group={group} showPostButton defaultExpanded />
                    ))}

                  {mainMegaGroups.size === 0 && (
                    <div className="empty">
                      Nenhuma Mega principal com 4+ jogos confirmados hoje.
                      {filterSmallMegaGroups(data.tier4.combos).size > 0 && (
                        <span style={{ display: 'block', fontSize: '0.8rem', marginTop: 6, opacity: 0.75 }}>
                          Há Jackpot VIP na aba Jackpot.
                        </span>
                      )}
                    </div>
                  )}
                </section>
              )
            })()}
          </>
        )}

        {/* ONTEM — resultados do dia anterior */}
        {activeTier === 'ontem' && (
          <section>
            <div className="almanac__sectionhead">
              <span className="almanac__sectionheadtxt">Ontem</span>
            </div>
            <p className="almanac__sectiondesc">
              Tips enviadas ontem · resultado W (green) / L (red). Picks sem resultado ainda pendentes.
            </p>
            {loadingOntem && <div className="loading">Carregando resultados…</div>}
            {ontemError && <div className="empty empty--warn">{ontemError}</div>}
            {ontemData && !loadingOntem && (
              <>
                <div className="ontem__scoreboard">
                  <div className="ontem__stat ontem__stat--date">{ontemData.date}</div>
                  <div className="ontem__stat ontem__stat--win">
                    <span className="ontem__statval">{ontemData.summary.wins}</span>
                    <span className="ontem__statlbl">Greens</span>
                  </div>
                  <div className="ontem__stat ontem__stat--loss">
                    <span className="ontem__statval">{ontemData.summary.losses}</span>
                    <span className="ontem__statlbl">Reds</span>
                  </div>
                  {ontemData.summary.pushes > 0 && (
                    <div className="ontem__stat ontem__stat--push">
                      <span className="ontem__statval">{ontemData.summary.pushes}</span>
                      <span className="ontem__statlbl">Push</span>
                    </div>
                  )}
                  {ontemData.summary.voids > 0 && (
                    <div className="ontem__stat ontem__stat--void">
                      <span className="ontem__statval">{ontemData.summary.voids}</span>
                      <span className="ontem__statlbl">Void</span>
                    </div>
                  )}
                  {ontemData.summary.pending > 0 && (
                    <div className="ontem__stat ontem__stat--pending">
                      <span className="ontem__statval">{ontemData.summary.pending}</span>
                      <span className="ontem__statlbl">Pendente</span>
                    </div>
                  )}
                  {ontemData.summary.win_rate !== null && (
                    <div className="ontem__stat ontem__stat--wr">
                      <span className="ontem__statval">{ontemData.summary.win_rate}%</span>
                      <span className="ontem__statlbl">WR</span>
                    </div>
                  )}
                </div>

                {/* F2.36-3: filtro status */}
                <div className="faixa-methods-section__sort" style={{ marginBottom: '0.5rem' }}>
                  <label>Mostrar:</label>
                  <select value={ontemFilter} onChange={e => setOntemFilter(e.target.value)}>
                    <option value="all">Tudo</option>
                    <option value="W">Greens (W)</option>
                    <option value="L">Reds (L)</option>
                    <option value="pending">Pendentes</option>
                    <option value="V">Void</option>
                  </select>
                </div>

                {ontemData.matches.length === 0 && (
                  <div className="empty">Nenhuma tip registrada ontem com times identificados.</div>
                )}

                {ontemData.matches.map((match, mi) => {
                  const filteredPicks = ontemFilter === 'all'
                    ? match.picks
                    : ontemFilter === 'pending'
                      ? match.picks.filter(p => !p.result || p.result === '' || p.result === 'pending')
                      : match.picks.filter(p => (p.result || '').toUpperCase() === ontemFilter)
                  if (filteredPicks.length === 0) return null
                  return (
                    <div key={mi} className="ontem__matchblock">
                      <div className="ontem__matchname">{match.match}</div>
                      {filteredPicks.map((pick, pi) => (
                        <ResultPickRow key={pi} pick={pick} />
                      ))}
                    </div>
                  )
                })}
              </>
            )}
            {!ontemData && !loadingOntem && !ontemError && (
              <div className="empty">Clique na aba para carregar resultados de ontem.</div>
            )}
            {/* P3.9 R6K-F3 — Performance IA inside Ontem tab */}
            <PerformanceIASection
              data={performanceData}
              loading={loadingPerformance}
              error={performanceError}
            />
          </section>
        )}

        {/* Methodology footer */}
        <footer className="almanac__methodology">
          <div className="almanac__methodology-grid">
            <div>
              <h4 className="almanac__method-head">Como funciona</h4>
              <p>Picks gerados por Wilson LCB Bayesian sobre tipsters Telegram reais. Odds devigged da Bet365 em tempo real. Sem picks genéricos de ML sem evidência histórica.</p>
            </div>
            <div>
              <h4 className="almanac__method-head">Modo LAB</h4>
              <p>Sistema em validação interna. Não há recomendação de stake real, nem promessa de lucro. Métricas de exposição exibidas são teóricas e estão zeradas no payload público enquanto o produto não é liberado para uso real.</p>
            </div>
            <div>
              <h4 className="almanac__method-head">Jogo responsável</h4>
              <p>SportsBrain é ferramenta analítica em desenvolvimento — não garante lucro e não substitui decisão pessoal. +18. Ajuda: <strong>jogadoresanonimos.org.br</strong></p>
            </div>
          </div>
        </footer>

      </div>
    </div>
  )
}
