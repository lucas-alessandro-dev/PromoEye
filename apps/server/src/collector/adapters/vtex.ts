import { cleanBrand, normalizeGtin } from '@promoeye/shared'
import { httpGetJson } from '../../lib/http.js'
import type { RawOffer, SearchOptions, StoreAdapter, StoreContext } from '../types.js'

/**
 * Lojas VTEX (Americanas, Carrefour, Brastemp, Electrolux, Motorola…).
 *
 * Duas APIs públicas, as mesmas que a vitrine da própria loja chama:
 *  - isearch: /api/io/_v/api/intelligent-search/product_search — relevância
 *    melhor, é a busca que o cliente da loja usa;
 *  - catalog: /api/catalog_system/pub/products/search — mais antiga, existe
 *    em quase toda loja VTEX; serve de reserva.
 *
 * As duas trazem o EAN de cada SKU (`items[].ean`) e a marca (`brand`): é o
 * que alimenta o catálogo por produto (collector/catalog.ts).
 */

/** Regra de promoção que a loja anuncia na vitrine ("Desconto PGTO Pix - 5%"). */
interface TeaserLite {
  name: string
  minimumQuantity: number
  conditions: { name: string; value: string }[]
  effects: { name: string; value: string }[]
}

interface VtexOffer {
  Price?: number
  ListPrice?: number
  PriceWithoutDiscount?: number
  spotPrice?: number
  AvailableQuantity?: number
  IsAvailable?: boolean
  Installments?: { Value: number; InterestRate: number; NumberOfInstallments: number }[]
  /** isearch: camelCase. */
  teasers?: unknown[]
  /** catalog: PascalCase limpo. */
  PromotionTeasers?: unknown[]
  /** catalog: serialização .NET ("<Name>k__BackingField"). */
  Teasers?: unknown[]
  /** catalog: as formas de pagamento, com o id de cada uma ("125" = Pix). */
  PaymentOptions?: { installmentOptions?: { paymentSystem?: string; paymentName?: string }[] }
}

interface VtexSeller {
  sellerId: string
  sellerName: string
  sellerDefault?: boolean
  commertialOffer: VtexOffer
}

interface VtexItem {
  itemId: string
  ean?: string
  images?: { imageUrl: string }[]
  sellers: VtexSeller[]
}

interface VtexProduct {
  productId: string
  productName: string
  brand?: string
  productReference?: string
  link?: string
  linkText?: string
  items: VtexItem[]
  productClusters?: Record<string, string> | { id: string; name: string }[]
}

function bestInstallment(offer: VtexOffer): string | null {
  const list = offer.Installments ?? []
  const noInterest = list.filter((i) => i.InterestRate === 0 && i.NumberOfInstallments > 1)
  if (!noInterest.length) return null
  const best = noInterest.reduce((a, b) => (b.NumberOfInstallments > a.NumberOfInstallments ? b : a))
  const value = best.Value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return `${best.NumberOfInstallments}x de ${value} sem juros`
}

// ── Pix ─────────────────────────────────────────────────────────────────────

/** Id padrão do Pix na VTEX. No catálogo, os ids vêm em PaymentOptions e substituem este. */
const DEFAULT_PIX_IDS = ['125']
/** Condições que não restringem quem ganha o desconto, só a forma de pagar. */
const PAYMENT_ONLY_CONDITIONS = new Set(['paymentmethodid', 'mininstallmentcount', 'maxinstallmentcount'])

/** "<Name>k__BackingField" → "name"; "Name" → "name". */
const key = (k: string) => k.replace(/^<|>k__BackingField$/g, '').toLowerCase()

function lowerKeys(o: unknown): Record<string, unknown> {
  if (!o || typeof o !== 'object') return {}
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [key(k), v]))
}

function params(list: unknown): { name: string; value: string }[] {
  if (!Array.isArray(list)) return []
  return list.map((p) => {
    const x = lowerKeys(p)
    return { name: String(x.name ?? ''), value: String(x.value ?? '') }
  })
}

/** Os três formatos de teaser da VTEX num só. */
export function readTeasers(offer: VtexOffer): TeaserLite[] {
  const raw = offer.PromotionTeasers?.length ? offer.PromotionTeasers : offer.teasers?.length ? offer.teasers : (offer.Teasers ?? [])
  return raw.map((t) => {
    const x = lowerKeys(t)
    const cond = lowerKeys(x.conditions)
    const eff = lowerKeys(x.effects)
    return {
      name: String(x.name ?? ''),
      minimumQuantity: Number(cond.minimumquantity ?? 0),
      conditions: params(cond.parameters),
      effects: params(eff.parameters),
    }
  })
}

/**
 * Preço no Pix a partir das regras que a loja publica. Só confia na regra
 * "desconto percentual para pagamento Pix em 1x", sem outra condição (cupom,
 * grupo de cliente, quantidade). Qualquer coisa além disso: null.
 *
 * Quando o `spotPrice` já é menor que o `Price`, a VTEX já aplicou algum
 * desconto à vista e não dá para saber se é o do Pix; para não descontar duas
 * vezes, também devolvemos null.
 *
 * Por que o Pix não vira o `price`: o histórico de meses foi gravado com o
 * preço sem o desconto do Pix. Trocar a base faria todo anúncio "cair 5%" de
 * uma coleta para outra e dispararia promoção falsa no grupo.
 */
export function pixPriceFrom(offer: VtexOffer, price: number): number | null {
  const spot = offer.spotPrice
  if (spot && offer.Price && spot < offer.Price - 0.005) return null
  const pixIds = new Set(
    (offer.PaymentOptions?.installmentOptions ?? [])
      .filter((o) => /\bpix\b/i.test(o.paymentName ?? ''))
      .map((o) => String(o.paymentSystem ?? ''))
      .filter(Boolean)
  )
  const ids = pixIds.size ? pixIds : new Set(DEFAULT_PIX_IDS)

  let best: number | null = null
  for (const t of readTeasers(offer)) {
    if (t.minimumQuantity > 1) continue
    if (!t.conditions.every((c) => PAYMENT_ONLY_CONDITIONS.has(c.name.toLowerCase()))) continue
    const method = t.conditions.find((c) => c.name.toLowerCase() === 'paymentmethodid')
    if (!method || !ids.has(method.value)) continue
    const max = t.conditions.find((c) => c.name.toLowerCase() === 'maxinstallmentcount')
    if (max && Number(max.value) > 1) continue
    if (t.effects.length !== 1 || t.effects[0]!.name.toLowerCase() !== 'percentualdiscount') continue
    const pct = Number(t.effects[0]!.value.replace(',', '.'))
    // Desconto de Pix acima de 30% é erro de cadastro ou campanha que não confiamos.
    if (!Number.isFinite(pct) || pct <= 0 || pct > 30) continue
    const value = Math.round(price * (1 - pct / 100) * 100) / 100
    if (best === null || value < best) best = value
  }
  return best !== null && best < price ? best : null
}

// ── Mapeamento ──────────────────────────────────────────────────────────────

export function mapVtexProducts(products: VtexProduct[], baseUrl: string): RawOffer[] {
  const out: RawOffer[] = []
  for (const p of products) {
    // Um produto pode ter vários SKUs (cores, voltagem). Fica o SKU mais
    // barato disponível — é o que a pessoa vai querer comprar — e o EAN é o dele.
    let pick: { item: VtexItem; seller: VtexSeller; price: number } | null = null
    for (const item of p.items ?? []) {
      for (const seller of item.sellers ?? []) {
        const o = seller.commertialOffer ?? {}
        const price = Math.min(o.Price || Infinity, o.spotPrice || Infinity)
        const available = (o.AvailableQuantity ?? 0) > 0 && price < Infinity && price > 0
        if (!available) continue
        if (!pick || price < pick.price) pick = { item, seller, price }
      }
    }
    const fallbackItem = p.items?.[0]
    const fallbackSeller = fallbackItem?.sellers?.find((s) => s.sellerDefault) ?? fallbackItem?.sellers?.[0]
    const item = pick?.item ?? fallbackItem
    const seller = pick?.seller ?? fallbackSeller
    if (!item || !seller) continue

    const o = seller.commertialOffer ?? {}
    const price = pick?.price ?? (o.Price || 0)
    if (!price) continue
    const list = Math.max(o.ListPrice ?? 0, o.PriceWithoutDiscount ?? 0)
    const card = o.Price && o.Price > price ? o.Price : null

    const rawLink = p.link ?? (p.linkText ? `/${p.linkText}/p` : '')
    const url = rawLink.startsWith('http') ? rawLink : `${baseUrl}${rawLink.startsWith('/') ? '' : '/'}${rawLink}`

    out.push({
      externalId: `${p.productId}`,
      title: p.productName,
      url: url.split('?')[0] ?? url,
      imageUrl: item.images?.[0]?.imageUrl ?? null,
      price,
      listPrice: list > price ? list : null,
      cardPrice: card,
      pixPrice: pick ? pixPriceFrom(o, price) : null,
      installments: bestInstallment(o),
      sellerName: seller.sellerName || null,
      soldByStore: seller.sellerId === '1',
      available: Boolean(pick),
      sponsored: false,
      promoLabel: null,
      gtin: normalizeGtin(item.ean),
      brand: cleanBrand(p.brand),
      modelRef: p.productReference?.trim() || null,
    })
  }
  return out
}

export function vtexAdapter(store: StoreContext): StoreAdapter {
  const baseUrl = String(store.config.baseUrl ?? `https://${store.domain}`).replace(/\/+$/, '')
  const mode = store.config.mode === 'catalog' ? 'catalog' : 'isearch'

  async function isearch(query: string, opts: SearchOptions) {
    const url = `${baseUrl}/api/io/_v/api/intelligent-search/product_search/?query=${encodeURIComponent(query)}&count=${opts.limit}&page=1&locale=pt-BR&hideUnavailableItems=false`
    const data = await httpGetJson<{ products?: VtexProduct[] }>(url, { signal: opts.signal })
    return mapVtexProducts(data.products ?? [], baseUrl)
  }

  async function catalog(query: string, opts: SearchOptions) {
    const url = `${baseUrl}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=${opts.limit - 1}`
    const data = await httpGetJson<VtexProduct[]>(url, { signal: opts.signal })
    return mapVtexProducts(Array.isArray(data) ? data : [], baseUrl)
  }

  return {
    async search(query, opts) {
      if (mode === 'catalog') return catalog(query, opts)
      const rows = await isearch(query, opts)
      // isearch às vezes devolve zero e um "redirect" para uma página de
      // categoria (Americanas faz isso com "iphone 16"). O catálogo antigo
      // ainda encontra os produtos nesse caso.
      if (rows.length) return rows
      return catalog(query, opts).catch(() => rows)
    },
  }
}
