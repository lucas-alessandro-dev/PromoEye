import { flagLabel, formatBRL, formatPct } from '@promoeye/shared'

/**
 * Regras dos alertas por e-mail (funções puras, testadas em tests/alerts.test.ts).
 *
 * O que vale a pena avisar:
 *  - com preço-alvo: o menor preço disponível ficou abaixo do alvo;
 *  - sem preço-alvo: o melhor anúncio é "promoção de verdade" (isDeal — o
 *    mesmo critério do grupo: desconto contra o NOSSO histórico, sem o
 *    "subiu antes de baixar").
 *
 * E o que segura a mão: no máximo um e-mail a cada 12 h por alerta, e de
 * novo só se o preço cair pelo menos mais 2% do que o último avisado.
 * Caixa de entrada cheia de "baixou R$ 1" é o caminho do descadastro.
 */

export const RENOTIFY_MIN_MS = 12 * 3_600_000
export const RENOTIFY_MIN_DROP = 0.02

export interface AlertState {
  status: 'PENDING' | 'ACTIVE' | 'UNSUBSCRIBED'
  targetPrice: number | null
  lastNotifiedAt: Date | null
  lastNotifiedPrice: number | null
}

export interface BestOffer {
  offerId: string
  title: string
  storeName: string
  imageUrl: string | null
  price: number
  pixPrice: number | null
  listPrice: number | null
  available: boolean
  isDeal: boolean
  flags: string[]
  realDiscountPct: number | null
}

export type NotifyDecision = { send: true; reason: 'abaixo-do-alvo' | 'promocao' } | { send: false; why: string }

export function notifyDecision(alert: AlertState, best: BestOffer | null, now: Date): NotifyDecision {
  if (alert.status !== 'ACTIVE') return { send: false, why: 'alerta não está ativo' }
  if (!best || !best.available) return { send: false, why: 'sem oferta disponível' }

  let reason: 'abaixo-do-alvo' | 'promocao'
  if (alert.targetPrice !== null) {
    if (best.price > alert.targetPrice + 0.005) return { send: false, why: 'acima do preço-alvo' }
    reason = 'abaixo-do-alvo'
  } else {
    if (!best.isDeal) return { send: false, why: 'não é promoção de verdade' }
    reason = 'promocao'
  }

  if (alert.lastNotifiedAt && now.getTime() - alert.lastNotifiedAt.getTime() < RENOTIFY_MIN_MS) {
    return { send: false, why: 'avisado há menos de 12 h' }
  }
  if (alert.lastNotifiedPrice !== null && best.price > alert.lastNotifiedPrice * (1 - RENOTIFY_MIN_DROP)) {
    return { send: false, why: 'não caiu 2% além do último aviso' }
  }
  return { send: true, reason }
}

// ── Textos dos e-mails ──────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const shell = (siteTitle: string, body: string, footer: string) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(siteTitle)}</title></head>
<body style="margin:0;background:#F7F5EE;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 16px;font-weight:600;color:#072C2C">${esc(siteTitle)}</p>
<div style="background:#ffffff;border-radius:12px;padding:24px">${body}</div>
<p style="font-size:12px;line-height:1.5;color:#62656d;margin:16px 0 0">${footer}</p>
</div></body></html>`

const button = (href: string, label: string) =>
  `<p style="margin:24px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:#E95603;color:#111827;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(label)}</a></p>`

export interface ConfirmMailInput {
  siteTitle: string
  targetName: string
  targetPrice: number | null
  confirmUrl: string
}

export function confirmMail(i: ConfirmMailInput): { subject: string; text: string; html: string } {
  const what = i.targetPrice !== null ? `quando ${i.targetName} ficar abaixo de ${formatBRL(i.targetPrice)}` : `quando ${i.targetName} entrar em promoção de verdade`
  const subject = `Confirme o alerta: ${i.targetName}`
  const text = [
    `Você pediu para o ${i.siteTitle} avisar ${what}.`,
    '',
    `Para ligar o alerta, confirme neste link: ${i.confirmUrl}`,
    '',
    'Se não foi você, ignore este e-mail: sem a confirmação, nada mais é enviado.',
  ].join('\n')
  const html = shell(
    i.siteTitle,
    `<h1 style="font-size:20px;margin:0 0 12px">Confirme o seu alerta</h1>
<p style="margin:0;line-height:1.5">Você pediu para o ${esc(i.siteTitle)} avisar ${esc(what)}.</p>
${button(i.confirmUrl, 'Confirmar o alerta')}`,
    'Se não foi você, ignore este e-mail: sem a confirmação, nada mais é enviado.'
  )
  return { subject, text, html }
}

export interface AlertMailInput {
  siteTitle: string
  targetName: string
  targetUrl: string
  reason: 'abaixo-do-alvo' | 'promocao'
  targetPrice: number | null
  best: BestOffer
  goUrl: string
  manageUrl: string
  disclosure: string
}

export function alertMail(i: AlertMailInput): { subject: string; text: string; html: string } {
  const price = formatBRL(i.best.price)
  const subject =
    i.reason === 'abaixo-do-alvo' ? `${i.targetName} por ${price}: abaixo do seu alvo` : `${i.targetName} por ${price}: promoção de verdade`
  const why: string[] = []
  if (i.reason === 'abaixo-do-alvo' && i.targetPrice !== null) why.push(`Abaixo do seu preço-alvo de ${formatBRL(i.targetPrice)}.`)
  if (i.best.realDiscountPct && i.best.realDiscountPct >= 0.03) why.push(`${formatPct(i.best.realDiscountPct)} abaixo do preço típico dos últimos 30 dias.`)
  const labels = i.best.flags.filter((f) => ['menor-preco', 'mais-barato', 'caiu-agora'].includes(f)).map(flagLabel)
  if (labels.length) why.push(`${labels.join(' · ')}.`)
  const pix = i.best.pixPrice !== null && i.best.pixPrice < i.best.price - 0.005 ? ` (${formatBRL(i.best.pixPrice)} no Pix)` : ''

  const text = [
    `${i.targetName}: ${price}${pix} na ${i.best.storeName}.`,
    i.best.title,
    ...why,
    '',
    `Ver na loja: ${i.goUrl}`,
    `Histórico e outras lojas: ${i.targetUrl}`,
    '',
    'O preço pode mudar na loja a qualquer momento.',
    i.disclosure,
    `Cancelar este alerta: ${i.manageUrl}`,
  ].join('\n')

  const html = shell(
    i.siteTitle,
    `${i.best.imageUrl ? `<img src="${esc(i.best.imageUrl)}" alt="" width="120" height="120" style="display:block;object-fit:contain;margin:0 0 16px">` : ''}
<p style="margin:0 0 4px;color:#62656d;font-size:14px">${esc(i.best.storeName)}</p>
<h1 style="font-size:20px;margin:0 0 8px">${esc(i.targetName)}</h1>
<p style="margin:0 0 12px;font-size:28px;font-weight:700">${esc(price)}${pix ? `<span style="font-size:14px;font-weight:500;color:#62656d">${esc(pix)}</span>` : ''}</p>
<p style="margin:0 0 8px;line-height:1.5">${esc(i.best.title)}</p>
${why.map((w) => `<p style="margin:0;line-height:1.5">${esc(w)}</p>`).join('')}
${button(i.goUrl, 'Ver na loja')}
<p style="margin:0"><a href="${esc(i.targetUrl)}" style="color:#072C2C">Ver o histórico e as outras lojas</a></p>`,
    `O preço pode mudar na loja a qualquer momento. ${esc(i.disclosure)}<br><a href="${esc(i.manageUrl)}" style="color:#62656d">Cancelar este alerta</a>`
  )
  return { subject, text, html }
}
