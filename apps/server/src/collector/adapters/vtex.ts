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
 */

interface VtexOffer {
  Price?: number
  ListPrice?: number
  PriceWithoutDiscount?: number
  spotPrice?: number
  AvailableQuantity?: number
  IsAvailable?: boolean
  Installments?: { Value: number; InterestRate: number; NumberOfInstallments: number }[]
}

interface VtexSeller {
  sellerId: string
  sellerName: string
  sellerDefault?: boolean
  commertialOffer: VtexOffer
}

interface VtexItem {
  itemId: string
  images?: { imageUrl: string }[]
  sellers: VtexSeller[]
}

interface VtexProduct {
  productId: string
  productName: string
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

export function mapVtexProducts(products: VtexProduct[], baseUrl: string): RawOffer[] {
  const out: RawOffer[] = []
  for (const p of products) {
    // Um produto pode ter vários SKUs (cores). Fica o SKU mais barato
    // disponível — é o que a pessoa vai querer comprar.
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
      installments: bestInstallment(o),
      sellerName: seller.sellerName || null,
      soldByStore: seller.sellerId === '1',
      available: Boolean(pick),
      sponsored: false,
      promoLabel: null,
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
