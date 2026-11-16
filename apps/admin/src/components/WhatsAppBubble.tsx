import type { ReactNode } from 'react'

/**
 * Mostra a mensagem como o WhatsApp vai mostrar: *negrito*, _itálico_,
 * ~riscado~, quebras de linha e links. Monta nós React — nunca HTML cru —,
 * então um texto com "<script>" aparece como texto.
 */

const URL_RE = /(https?:\/\/[^\s]+)/g
const FORMAT_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g

function formatSegment(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  for (const part of text.split(FORMAT_RE)) {
    if (!part) continue
    const key = `${keyBase}-${i++}`
    const inner = part.slice(1, -1)
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) out.push(<strong key={key}>{inner}</strong>)
    else if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) out.push(<em key={key}>{inner}</em>)
    else if (part.length > 2 && part.startsWith('~') && part.endsWith('~')) out.push(<s key={key}>{inner}</s>)
    else out.push(part)
  }
  return out
}

function renderLine(line: string, lineIdx: number): ReactNode[] {
  const out: ReactNode[] = []
  line.split(URL_RE).forEach((seg, j) => {
    if (!seg) return
    if (/^https?:\/\//.test(seg)) {
      out.push(
        <a key={`u-${lineIdx}-${j}`} href={seg} target="_blank" rel="noopener noreferrer">
          {seg}
        </a>
      )
    } else {
      out.push(...formatSegment(seg, `f-${lineIdx}-${j}`))
    }
  })
  return out
}

export function WhatsAppBubble({ text, time }: { text: string; time?: string }) {
  const lines = text.split('\n')
  return (
    <div className="wa-chat">
      <div className="wa-bubble">
        {lines.map((line, idx) => (
          <span key={idx} className="wa-line">
            {line ? renderLine(line, idx) : ' '}
          </span>
        ))}
        {time && <span className="wa-time">{time}</span>}
      </div>
    </div>
  )
}
