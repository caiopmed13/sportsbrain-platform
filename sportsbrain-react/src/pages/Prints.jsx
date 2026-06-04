import { useState, useRef, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { PickTierBadge } from '../components/ui/PickBadges'

const HIST_KEY = 'sb_prints_v2'
function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY)||'[]') } catch { return [] } }
function saveHistory(h) { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0,100))) }

function ResultBadge({ verdict }) {
  const map = { WIN:{c:'var(--green)',bg:'var(--g3)',e:'✅'}, LOSS:{c:'var(--red)',bg:'var(--r3)',e:'❌'}, VOID:{c:'var(--amber)',bg:'var(--a3)',e:'♻'}, HALF_WIN:{c:'var(--blue)',bg:'var(--b3)',e:'½'}, HALF_LOSS:{c:'var(--mute)',bg:'rgba(255,255,255,.06)',e:'½'} }
  const s = map[verdict]||map.VOID
  return <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,fontWeight:700,color:s.c,background:s.bg,padding:'2px 7px',borderRadius:3}}>{s.e} {verdict}</span>
}

export default function Prints() {
  const [history, setHistory] = useState(loadHistory)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const fileRef = useRef()

  function handleFile(f) {
    if (!f || !f.type.startsWith('image/')) return
    setFile(f)
    setResult(null); setError(null)
    const url = URL.createObjectURL(f)
    setPreview(url)
  }

  async function analyze() {
    if (!file) return
    setProcessing(true); setProgress(0); setError(null)
    try {
      if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js não carregado')
      setProgress(10)
      const { data: { text } } = await Tesseract.recognize(file, 'por+eng', {
        logger: m => { if (m.status==='recognizing text') setProgress(Math.round((m.progress||0)*80)+10) }
      })
      setProgress(95)
      // Parse básico do texto OCR
      const lines = text.split('\n').map(l=>l.trim()).filter(l=>l.length>2)
      const verdicts = []
      lines.forEach(l => {
        const lu = l.toUpperCase()
        if (lu.includes('GREEN')||lu.includes('WIN')||lu.includes('GANHO')) verdicts.push('WIN')
        if (lu.includes('CASH')||lu.includes('WON')) verdicts.push('WIN')
        if (lu.includes('RED')||lu.includes('LOSS')||lu.includes('PERDA')) verdicts.push('LOSS')
        if (lu.includes('VOID')||lu.includes('ANULAD')) verdicts.push('VOID')
        if (lu.includes('HALF WIN')||lu.includes('MEIO WIN')) verdicts.push('HALF_WIN')
      })
      // Tenta extrair odds e valores
      const oddMatch = text.match(/\b([1-9]\d?\.\d{1,2})\b/)
      const stakeMatch = text.match(/R\$\s*([\d.,]+)|\b(\d+[.,]\d{2})\b/)
      const verdict = verdicts[0]||'WIN'
      const odds = oddMatch ? parseFloat(oddMatch[1]) : null
      const stake = stakeMatch ? parseFloat((stakeMatch[1]||stakeMatch[2]).replace(',','.')) : null
      const returnVal = stake && odds ? (verdict==='WIN' ? stake*odds : -stake) : null

      const r = { verdict, text:text.slice(0,400), odds, stake, returnVal, ts:new Date().toISOString(), fileName:file.name }
      setResult(r)
      const updated = [r,...history]
      setHistory(updated); saveHistory(updated)
      setProgress(100)
    } catch(e) {
      setError(e.message||'Erro ao processar imagem')
    }
    setProcessing(false)
  }

  return (
    <div className="page">
      <PageHeader icon="📸" title="Print Analyzer"
        subtitle={`Análise OCR de comprovantes de apostas · ${history.length} prints processados`}
      />

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:14,marginBottom:20}}>
        {/* Upload */}
        <div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:8}}>1. Enviar Print</div>
          <div
            onClick={()=>fileRef.current?.click()}
            onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])}}
            onDragOver={e=>e.preventDefault()}
            style={{
              border:'2px dashed var(--line)',
              borderRadius:'var(--r2)',
              padding:'24px',
              textAlign:'center',
              cursor:'pointer',
              background:preview?'transparent':'rgba(255,255,255,.02)',
              transition:'all .2s ease',
              minHeight:160,
              display:'flex',
              flexDirection:'column',
              alignItems:'center',
              justifyContent:'center',
              gap:8,
              overflow:'hidden',
            }}
          >
            {preview ? (
              <img src={preview} style={{maxWidth:'100%',maxHeight:200,borderRadius:'var(--r)',objectFit:'contain'}} alt="preview"/>
            ) : (
              <>
                <div style={{fontSize:36}}>📸</div>
                <div style={{fontSize:12,color:'var(--soft)'}}>Clique ou arraste um print</div>
                <div style={{fontSize:10,color:'var(--mute)'}}>PNG, JPG, WebP</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleFile(e.target.files?.[0])}/>

          {file && !processing && (
            <button onClick={analyze} className="btn btn-primary" style={{width:'100%',marginTop:8,padding:'9px',fontSize:13,justifyContent:'center',fontFamily:"'JetBrains Mono', monospace",fontWeight:700}}>
              🔍 Analisar com OCR
            </button>
          )}

          {processing && (
            <div style={{marginTop:8}}>
              <div style={{height:4,borderRadius:2,background:'var(--line)',overflow:'hidden',marginBottom:6}}>
                <div style={{width:`${progress}%`,height:'100%',background:'var(--blue)',borderRadius:2,transition:'width .3s ease'}}/>
              </div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--dim)',textAlign:'center'}}>{progress}% · Reconhecendo texto...</div>
            </div>
          )}

          {error && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:'var(--red)',marginTop:8,padding:'8px',background:'var(--r3)',borderRadius:'var(--r)',border:'1px solid rgba(255,79,106,.2)'}}>{error}</div>}
        </div>

        {/* Resultado */}
        <div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:8}}>2. Resultado da Análise</div>
          {result ? (
            <div style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r2)',padding:'14px'}}>
              <div style={{marginBottom:10}}><ResultBadge verdict={result.verdict}/></div>
              {result.odds && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--soft)',marginBottom:4}}>Odd detectada: <b style={{color:'var(--blue)'}}>@{result.odds}</b></div>}
              {result.stake && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--soft)',marginBottom:4}}>Stake: <b style={{color:'var(--white)'}}>R$ {result.stake}</b></div>}
              {result.returnVal!==null && <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:result.returnVal>0?'var(--green)':'var(--red)',marginBottom:8}}>
                {result.returnVal>0?'+':`-`}R$ {Math.abs(result.returnVal).toFixed(2)}
              </div>}
              {result.text && (
                <details style={{marginTop:8}}>
                  <summary style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',cursor:'pointer'}}>Ver texto extraído</summary>
                  <pre style={{marginTop:6,fontSize: 11,color:'var(--dim)',background:'var(--ink1)',padding:8,borderRadius:'var(--r)',overflow:'auto',maxHeight:120,whiteSpace:'pre-wrap'}}>{result.text}</pre>
                </details>
              )}
            </div>
          ) : (
            <div style={{background:'var(--ink2)',border:'1px solid var(--line)',borderRadius:'var(--r2)',padding:'30px',textAlign:'center',color:'var(--mute)',fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>
              Aguardando análise...
            </div>
          )}
        </div>
      </div>

      {/* Histórico */}
      {history.length>0 && (
        <>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:10}}>
            Histórico ({history.length} prints)
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {history.slice(0,10).map((h,i)=>(
              <div key={i} style={{background:'var(--card-bg)',border:'1px solid var(--card-border)',borderRadius:'var(--r)',padding:'8px 12px',display:'flex',alignItems:'center',gap:10}}>
                <ResultBadge verdict={h.verdict}/>
                {h.odds && <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--blue)'}}>@{h.odds}</span>}
                {h.returnVal!==null && <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,fontWeight:700,color:h.returnVal>0?'var(--green)':'var(--red)'}}>{h.returnVal>0?'+':''}R${Math.abs(h.returnVal).toFixed(2)}</span>}
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize: 11,color:'var(--mute)',marginLeft:'auto'}}>{h.ts?new Date(h.ts).toLocaleDateString('pt-BR'):''}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
