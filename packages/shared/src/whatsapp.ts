import { flagLabel } from './flags.js'
import { formatBRLShort, listDiscount } from './format.js'

export interface WhatsAppOfferInput {
  itemName: string
  title: string
  storeName: string
  price: number
  listPrice: number | null
  installments: string | null
  flags: string[]
  /** Link curto do PromoEye (/ir/:id), que conta o clique e aplica o afiliado. */
  link: string
  realDiscountPct: number | null
}

/**
 * Texto da mensagem do grupo. Fica no pacote compartilhado para o painel
 * mostrar exatamente o que vai ser enviado.
 *
 * Formatação do WhatsApp: *negrito*, _itálico_, ~riscado~. O link vai sozinho
 * na última linha para o WhatsApp gerar a prévia com a foto do produto.
 */
export function formatWhatsAppMessage(o: WhatsAppOfferInput): string {
  const lines: string[] = []
  lines.push(`🔥 *${o.itemName}* por *${formatBRLShort(o.price)}*`)
  lines.push(o.title.length > 90 ? `${o.title.slice(0, 87).trimEnd()}…` : o.title)

  const off = listDiscount(o.price, o.listPrice)
  const honestList = !o.flags.includes('preco-de-inflado')
  if (o.listPrice && off && off >= 0.05 && honestList) {
    lines.push(`De ~${formatBRLShort(o.listPrice)}~ (−${Math.round(off * 100)}%)`)
  }
  if (o.installments) lines.push(o.installments)

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
