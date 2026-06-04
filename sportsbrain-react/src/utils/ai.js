// ─── Utilitários de IA — compartilhado entre FtProps e Analise365 ─────────────

// ── Chave Claude (localStorage compartilhado) ─────────────────────────────────
const CLAUDE_KEY_SK = 'sb_claude_key_365'
export function getClaudeKey()    { try { return localStorage.getItem(CLAUDE_KEY_SK)   || '' } catch { return '' } }
export function saveClaudeKey(k)  { try { localStorage.setItem(CLAUDE_KEY_SK, (k||'').trim()) } catch {} }

// ── callClaude — chama Claude Haiku via Anthropic API ────────────────────────
export async function callClaude(key, prompt, maxTokens = 2000) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(90000),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error?.message || `HTTP ${resp.status}`)
  return data.content?.[0]?.text || ''
}

// ── mdToHtml — markdown simples → HTML ───────────────────────────────────────
export function mdToHtml(text) {
  return (text || '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h4 style="color:var(--green);margin:10px 0 4px;font-size:12px">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 style="color:var(--blue);margin:13px 0 5px;font-size:13px">$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2 style="color:var(--white);margin:15px 0 7px;font-size:14px">$1</h2>')
    .replace(/^> (.+)$/gm,   '<blockquote style="border-left:2px solid var(--amber);padding-left:8px;color:var(--soft);margin:4px 0">$1</blockquote>')
    .replace(/^(\d+)\. (.+)$/gm, '<div style="margin:5px 0;color:var(--soft)"><strong style="color:var(--blue)">$1.</strong> $2</div>')
    .replace(/^[-•] (.+)$/gm, '<div style="margin:4px 0 4px 12px;color:var(--soft)">• $1</div>')
    .replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>')
}
