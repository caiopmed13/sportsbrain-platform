// ═══════════════════════════════════════════════════════════════════════════
// OnboardingLeigo — Tour passo-a-passo pra novos usuários
// ═══════════════════════════════════════════════════════════════════════════
// P3.9 R6J-D: reescrito para tom de laboratório / observação interna,
// sem promessas de lucro nem chamadas para aposta real.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'

const KEY = 'sb_onboard_leigo_v1'

const STEPS = [
  {
    icon: '🧪',
    title: 'Bem-vindo ao SportsBrain',
    body: (
      <>
        <p style={{ color: 'var(--amber)', fontSize: 12, padding: 8, background: 'rgba(255,196,0,.08)', borderRadius: 4, border: '1px solid rgba(255,196,0,.35)' }}>
          ⚠ <strong>MODO LAB · NÃO VALIDADO EM PRODUÇÃO.</strong> Dados internos para
          avaliação do modelo. Não são recomendação de aposta, não usam dinheiro
          real e não prometem lucro.
        </p>
        <p style={{ marginTop: 12 }}>Plataforma de análise quantitativa com a <strong style={{ color: 'var(--green)' }}>IA processando os dados</strong>.</p>
        <p style={{ color: 'var(--soft)', fontSize: 13 }}>Você acompanha as observações diárias. As métricas exibidas são teóricas e estão em validação.</p>
      </>
    ),
  },
  {
    icon: '💰',
    title: 'Passo 1 — Configure o saldo de simulação',
    body: (
      <>
        <p>Na aba <strong>Banca</strong>, registre um saldo de referência para os cálculos de exposição simulada.</p>
        <p style={{ color: 'var(--soft)', fontSize: 13 }}>Ex: R$ 500. A IA calcula exposição teórica por pick (métrica interna do modelo).</p>
        <p style={{ color: 'var(--amber)', fontSize: 12, marginTop: 8 }}>⚠ Saldo aqui é referência para a simulação — não há recomendação de aposta real enquanto o produto está em modo LAB.</p>
      </>
    ),
  },
  {
    icon: '🎯',
    title: 'Passo 2 — Veja o Plano Hoje',
    body: (
      <>
        <p>Toda vez que abrir o app, vai cair direto em <strong>Plano Hoje</strong>.</p>
        <p style={{ color: 'var(--soft)', fontSize: 13 }}>A IA mostra picks com EV teórico positivo (sinal ainda em validação), com:</p>
        <ul style={{ color: 'var(--soft)', fontSize: 13, marginTop: 4, paddingLeft: 18 }}>
          <li>O time/mercado observado</li>
          <li>Exposição simulada (LAB)</li>
          <li>Por que (EV teórico, fair odd)</li>
        </ul>
      </>
    ),
  },
  {
    icon: '🔍',
    title: 'Passo 3 — Confira a referência no Bet365',
    body: (
      <>
        <p>Use cada observação para comparar com odds reais na Bet365 — sem CTA de apostar.</p>
        <p style={{ color: 'var(--soft)', fontSize: 13 }}>O app mostra um sinal teórico; <strong>qualquer decisão é sua e sob seu risco</strong>.</p>
        <p style={{ color: 'var(--amber)', fontSize: 12, marginTop: 8 }}>💡 Em modo LAB não há recomendação de stake real — diversifique e use apenas como ferramenta de estudo.</p>
      </>
    ),
  },
  {
    icon: '✅',
    title: 'Passo 4 — Marque W/L (IA aprende)',
    body: (
      <>
        <p>Depois do jogo, volte no app e marque <strong style={{ color: 'var(--green)' }}>W (ganhou)</strong> ou <strong style={{ color: 'var(--red)' }}>L (perdeu)</strong>.</p>
        <p style={{ color: 'var(--soft)', fontSize: 13 }}>A IA usa o histórico para <strong>calibrar o modelo</strong> e ajustar a confiança teórica das próximas observações.</p>
        <p style={{ color: 'var(--green)', fontSize: 12, marginTop: 8 }}>📈 Quanto mais resultados você marca, mais útil o modelo fica para validação interna.</p>
      </>
    ),
  },
  {
    icon: '🏆',
    title: 'Pronto pra começar!',
    body: (
      <>
        <p>Foque em <strong>Banca</strong> (saldo de simulação) e <strong>Plano Hoje</strong> — é tudo que você precisa no dia-a-dia.</p>
        <p style={{ color: 'var(--soft)', fontSize: 13 }}>O resto (Markets, Análise Avançada, Stats) é opcional pra quem quiser cavar mais.</p>
        <p style={{ color: 'var(--amber)', fontSize: 11, marginTop: 12, padding: 8, background: 'rgba(255,184,48,.08)', borderRadius: 4 }}>
          ⚠ Ferramenta analítica em desenvolvimento. Não há promessa de lucro. Apostas esportivas têm risco; decisão é sempre pessoal e sob responsabilidade própria.
        </p>
      </>
    ),
  },
]

export default function OnboardingLeigo() {
  const [step, setStep] = useState(0)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(KEY)) {
      // Pequeno delay pra app carregar antes
      setTimeout(() => setShow(true), 800)
    }
  }, [])

  function dismiss() {
    localStorage.setItem(KEY, '1')
    setShow(false)
  }

  if (!show) return null
  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--line)',
        borderRadius: 12, padding: 28, maxWidth: 480, width: '100%',
        boxShadow: '0 20px 40px rgba(0,0,0,.5)',
      }}>
        <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>{s.icon}</div>
        <h2 style={{ margin: 0, marginBottom: 12, textAlign: 'center', fontSize: 18, color: 'var(--white)' }}>
          {s.title}
        </h2>
        <div style={{ fontSize: 14, color: 'var(--white)', lineHeight: 1.5, marginBottom: 20 }}>
          {s.body}
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 16 : 6, height: 6,
              background: i === step ? 'var(--green)' : 'var(--line)',
              borderRadius: 3, transition: 'all .2s',
            }} />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button onClick={dismiss} style={{
            padding: '10px 16px', background: 'transparent',
            border: '1px solid var(--line)', color: 'var(--mute)',
            borderRadius: 6, cursor: 'pointer', fontSize: 12,
          }}>
            Pular tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} style={{
                padding: '10px 16px', background: 'transparent',
                border: '1px solid var(--line)', color: 'var(--soft)',
                borderRadius: 6, cursor: 'pointer', fontSize: 12,
              }}>
                ← Voltar
              </button>
            )}
            {!isLast ? (
              <button onClick={() => setStep(s => s + 1)} style={{
                padding: '10px 20px', background: 'var(--green)',
                border: 'none', color: 'var(--bg)',
                borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>
                Próximo →
              </button>
            ) : (
              <button onClick={dismiss} style={{
                padding: '10px 24px', background: 'var(--green)',
                border: 'none', color: 'var(--bg)',
                borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700,
              }}>
                Começar 🚀
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
