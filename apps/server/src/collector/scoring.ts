import type { DealFlag } from '@promoeye/shared'

/**
 * Pontuação e selos de cada oferta — o que faz o PromoEye dizer "promoção de
 * verdade" e não só "a loja diz que tem 50% off".
 *
 * Três fontes de verdade, da mais à menos confiável:
 *  1. o nosso histórico do próprio anúncio (preço típico dos últimos 30 dias);
 *  2. o preço das outras lojas confiáveis agora;
 *  3. o preço "de" que a loja anuncia — o menos confiável, porque é ela que
 *     escolhe. É aqui que mora o "metade do dobro" da Black Friday.
 */

export interface PricePointLite {
  at: Date
  price: number
  available: boolean
}

export interface ScoreInput {
  price: number
  listPrice: number | null
  available: boolean
  /** Pontos de mudança de preço, do mais antigo ao mais novo, INCLUINDO o atual. */
  history: PricePointLite[]
  firstSeenAt: Date
  /** Preço anterior a esta coleta (null se o anúncio é novo). */
  previousPrice: number | null
  /** Menor e mediana dos preços disponíveis do item entre as lojas, agora. */
  minPriceNow: number | null
  medianPriceNow: number | null
  offersNow: number
  targetPrice: number | null
  /** Desconto real mínimo para virar promoção, 0..1. */
  minDiscount: number
  promoLabel: string | null
  now: Date
}

export interface ScoreResult {
  score: number
  flags: DealFlag[]
  realDiscountPct: number | null
  isDeal: boolean
  /** Selo principal, usado como motivo da mensagem do WhatsApp. */
  reason: DealFlag | null
}

const DAY = 86_400_000
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Mediana ponderada pelo TEMPO em que cada preço vigorou nos últimos 30 dias.
 * Contar pontos de mudança daria peso igual a um preço que durou 29 dias e a
 * outro que durou uma hora — e a "mediana" viraria qualquer coisa.
 */
export function typicalPrice(history: PricePointLite[], now: Date, windowDays = 30): number | null {
  const start = now.getTime() - windowDays * DAY
  const pts = history.filter((p) => p.available).sort((a, b) => a.at.getTime() - b.at.getTime())
  if (!pts.length) return null

  const spans: { price: number; ms: number }[] = []
  for (let i = 0; i < pts.length; i++) {
    const from = Math.max(pts[i]!.at.getTime(), start)
    const to = i + 1 < pts.length ? pts[i + 1]!.at.getTime() : now.getTime()
    if (to > from) spans.push({ price: pts[i]!.price, ms: to - from })
  }
  if (!spans.length) return null
  spans.sort((a, b) => a.price - b.price)
  const total = spans.reduce((s, x) => s + x.ms, 0)
  let acc = 0
  for (const s of spans) {
    acc += s.ms
    if (acc >= total / 2) return s.price
  }
  return spans[spans.length - 1]!.price
}

export function scoreOffer(i: ScoreInput): ScoreResult {
  const flags: DealFlag[] = []
  const historyDays = (i.now.getTime() - i.firstSeenAt.getTime()) / DAY
  const windowStart = i.now.getTime() - 30 * DAY

  // Histórico ANTES do preço atual (o último ponto é o atual).
  const past = i.history.slice(0, -1).filter((p) => p.available && p.at.getTime() >= windowStart - DAY)
  const pastPrices = past.map((p) => p.price)
  const minPast = pastPrices.length ? Math.min(...pastPrices) : null
  const maxPast = pastPrices.length ? Math.max(...pastPrices) : null

  // Preço típico só depois de 1 dia de observação; antes disso é ruído.
  const typical = historyDays >= 1 ? typicalPrice(i.history, i.now) : null
  const realDiscountPct = typical && typical > i.price ? 1 - i.price / typical : typical ? 0 : null

  if (historyDays < 3) flags.push('historico-curto')

  // Selo de vantagem só para o que dá para comprar agora: um anúncio esgotado
  // "mais barato" é só um anúncio esgotado.
  if (i.available) {
    if (minPast !== null && maxPast !== null && historyDays >= 2 && i.price <= minPast && i.price < maxPast * 0.98) {
      flags.push('menor-preco')
    }
    if (i.targetPrice !== null && i.price <= i.targetPrice) flags.push('abaixo-do-alvo')
    if (i.minPriceNow !== null && i.offersNow >= 2 && i.price <= i.minPriceNow + 0.005) flags.push('mais-barato')
    if (i.previousPrice !== null && i.price < i.previousPrice * 0.99) flags.push('caiu-agora')
    if (realDiscountPct !== null && realDiscountPct >= Math.max(0.05, i.minDiscount)) flags.push('desconto-real')
    if (i.promoLabel) flags.push('oferta-relampago')
  }

  // "Metade do dobro" — parte 1: o preço "de" é uma ficção.
  const listOff = i.listPrice && i.listPrice > i.price ? 1 - i.price / i.listPrice : 0
  const seenMax = Math.max(maxPast ?? 0, i.price)
  const inflated =
    listOff >= 0.15 &&
    i.listPrice !== null &&
    ((historyDays >= 3 && i.listPrice > seenMax * 1.2) ||
      (i.medianPriceNow !== null && i.offersNow >= 3 && i.listPrice > i.medianPriceNow * 1.35))
  if (inflated) flags.push('preco-de-inflado')

  // "Metade do dobro" — parte 2: subiu nas semanas anteriores e a "queda"
  // só devolve o preço de antes.
  const inWindow = i.history.filter((p) => p.available && p.at.getTime() >= windowStart)
  if (inWindow.length >= 3) {
    const first = inWindow[0]!.price
    const peak = Math.max(...inWindow.slice(1, -1).map((p) => p.price))
    if (peak >= first * 1.1 && i.price >= first * 0.97) flags.push('subiu-antes')
  }

  // ── Pontuação 0–100 ──────────────────────────────────────────────────────
  let score = 0
  if (i.available) {
    if (flags.includes('mais-barato')) score += 30
    else if (i.minPriceNow) score += 30 * clamp01(1 - (i.price / i.minPriceNow - 1) * 5)
    if (realDiscountPct !== null) score += 30 * clamp01(realDiscountPct / 0.25)
    if (flags.includes('menor-preco')) score += 15
    if (flags.includes('abaixo-do-alvo')) score += 15
    if (!inflated) score += 10 * clamp01(listOff / 0.4)
    if (flags.includes('caiu-agora')) score += 5
    if (flags.includes('subiu-antes')) score -= 20
    if (inflated) score -= 5
  }
  score = Math.round(Math.max(0, Math.min(100, score)))

  const isDeal =
    i.available &&
    (flags.includes('abaixo-do-alvo') ||
      ((flags.includes('menor-preco') || flags.includes('desconto-real')) && !flags.includes('subiu-antes')))

  const reason =
    (['abaixo-do-alvo', 'menor-preco', 'desconto-real', 'mais-barato'] as const).find((f) => flags.includes(f)) ?? null

  return { score, flags, realDiscountPct, isDeal, reason }
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
