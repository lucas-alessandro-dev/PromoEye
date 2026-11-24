import { flagLabel } from './flags.js'
import { formatBRLShort, shownListDiscount } from './format.js'

export interface WhatsAppOfferInput {
  itemName: string
  title: string
  storeName: string
  price: number
  listPrice: number | null
  /** Preço no cartão (`Offer.cardPrice`), quando é maior que o `price`. */
  cardPrice: number | null
  /** Preço no Pix (`Offer.pixPrice`). Igual ao `price` = o preço da mensagem é o do Pix. */
  pixPrice: number | null
  installments: string | null
  flags: string[]
  /** Link curto do PromoEye (/ir/:id), que conta o clique e aplica o afiliado. */
  link: string
  realDiscountPct: number | null
}

/**
 * Em que condição vale o preço da mensagem. Quando o cartão custa mais, o
 * preço é à vista, e a mensagem precisa dizer isso. Sem a condição, quem paga
 * no cartão chega à loja e encontra outro preço.
 *  - 'pix': o preço é o do Pix (Polishop, Mondial, iByte, KaBuM!);
 *  - 'cash': à vista, sem a loja dizer em qual meio (Pix ou boleto);
 *  - null: o mesmo preço no cartão, ou a loja não informa o do cartão.
 *
 * Só fala em Pix quando o Pix É o preço da mensagem. É esse preço que a fila
 * confere antes de enviar (`staleReason`): se a loja tirar o desconto, o
 * preço sobe e a mensagem é descartada. Um Pix menor, à parte, não entra no
 * grupo, porque a fila não teria como conferir.
 */
export function priceCondition(o: Pick<WhatsAppOfferInput, 'price' | 'cardPrice' | 'pixPrice'>): 'pix' | 'cash' | null {
  if (!o.cardPrice || o.cardPrice <= o.price + 0.005) return null
  return o.pixPrice != null && Math.abs(o.pixPrice - o.price) < 0.005 ? 'pix' : 'cash'
}

const CONDITION_LABEL = { pix: ' no Pix', cash: ' à vista' } as const

/**
 * Texto da mensagem do grupo. Fica no pacote compartilhado para o painel
 * mostrar exatamente o que vai ser enviado.
 *
 * Formatação do WhatsApp: *negrito*, _itálico_, ~riscado~. O link vai sozinho
 * na última linha para o WhatsApp gerar a prévia com a foto do produto.
 */
export function formatWhatsAppMessage(o: WhatsAppOfferInput): string {
  const cond = priceCondition(o)
  const lines: string[] = []
  lines.push(`🔥 *${o.itemName}* por *${formatBRLShort(o.price)}${cond ? CONDITION_LABEL[cond] : ''}*`)
  lines.push(o.title.length > 90 ? `${o.title.slice(0, 87).trimEnd()}…` : o.title)

  const off = shownListDiscount(o.price, o.listPrice, o.cardPrice)
  const honestList = !o.flags.includes('preco-de-inflado')
  if (o.listPrice && off && off >= 0.05 && honestList) {
    lines.push(`De ~${formatBRLShort(o.listPrice)}~ (−${Math.round(off * 100)}%)`)
  }
  // O parcelamento é do preço no cartão: vai junto dele.
  if (cond) lines.push(`ou ${formatBRLShort(o.cardPrice)} no cartão${o.installments ? ` · ${o.installments}` : ''}`)
  else if (o.installments) lines.push(o.installments)

  const highlights = o.flags
    .filter((f) => ['menor-preco', 'abaixo-do-alvo', 'mais-barato', 'caiu-agora', 'oferta-relampago'].includes(f))
    .slice(0, 2)
    .map(flagLabel)
  if (o.realDiscountPct && o.realDiscountPct >= 0.05) {
    highlights.unshift(`${Math.round(o.realDiscountPct * 100)}% abaixo do preço normal`)
  }
  if (highlights.length) lines.push(`📉 ${highlights.join(' · ')}`)

  lines.push(`🏬 ${o.storeName}`)
  lines.push('')
  lines.push(`👉 ${o.link}`)
  return lines.join('\n')
}

// ── Horário de silêncio ─────────────────────────────────────────────────────

const spHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' })

/** Hora cheia (0–23) no horário de Brasília, seja qual for o fuso do servidor. */
export function hourInSaoPaulo(d: Date = new Date()): number {
  return Number(spHour.format(d)) % 24
}

/**
 * A hora cai no intervalo [start, end)? O intervalo pode passar da meia-noite
 * (22 → 8 silencia das 22:00 às 07:59). start igual a end: nunca silencia.
 */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

/** "5511912345678" → "+55 11 91234-5678". Outros formatos: "+" e os dígitos. */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return ''
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${digits}`
}
