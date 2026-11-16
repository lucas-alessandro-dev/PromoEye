import { httpGetJson } from '../../lib/http.js'
import type { RawOffer, StoreAdapter } from '../types.js'

/**
 * KaBuM!: a API JSON que o próprio site chama na página de busca.
 *
 * Preços: `price` é o preço cheio (cartão), `price_with_discount` é o do Pix.
 * Quando há oferta relâmpago ("ESQUENTA BLACK DAS BLACKS"), ela vem em
 * `offer` com os próprios preços e vale mais que os de fora.
 */

interface KabumOffer {
  name?: string
  price?: number
  price_with_discount?: number
  quantity_available?: number
  ends_at?: number
}

interface KabumAttributes {
  title: string
  price: number
  price_with_discount: number
  old_price: number
  offer: KabumOffer | null
  available: boolean
  is_marketplace: boolean
  marketplace?: { seller_name?: string } | null
  photos?: { m?: string[]; g?: string[] }
  product_link?: string
  max_installment?: string
}

interface KabumProduct {
  id: number | string
  attributes: KabumAttributes
}

const API = 'https://servicespub.prod.api.aws.grupokabum.com.br/catalog/v2/products'

export function mapKabumProducts(products: KabumProduct[]): RawOffer[] {
  const out: RawOffer[] = []
  const now = Date.now() / 1000
  for (const p of products) {
    const a = p.attributes
    if (!a?.title) continue
    const offerLive = a.offer && (!a.offer.ends_at || a.offer.ends_at > now) && (a.offer.quantity_available ?? 1) > 0
    const pix = (offerLive ? a.offer?.price_with_discount : undefined) || a.price_with_discount || a.price
    const card = (offerLive ? a.offer?.price : undefined) || a.price
    if (!pix) continue
    // `old_price` é o "de" quando existe; senão o preço normal fora da oferta.
    const list = a.old_price > pix ? a.old_price : offerLive && a.price > pix ? a.price : null

    out.push({
      externalId: String(p.id),
      title: a.title,
      url: `https://www.kabum.com.br/produto/${p.id}${a.product_link ? `/${a.product_link}` : ''}`,
      imageUrl: a.photos?.g?.[0] ?? a.photos?.m?.[0] ?? null,
      price: pix,
      listPrice: list,
      cardPrice: card && card > pix ? card : null,
      installments: a.max_installment ? String(a.max_installment) : null,
      sellerName: a.is_marketplace ? (a.marketplace?.seller_name ?? null) : 'KaBuM!',
      soldByStore: !a.is_marketplace,
      available: Boolean(a.available),
      sponsored: false,
      promoLabel: offerLive ? (a.offer?.name ?? null) : null,
    })
  }
  return out
}

export function kabumAdapter(): StoreAdapter {
  return {
    async search(query, opts) {
      const url = `${API}?query=${encodeURIComponent(query)}&page_size=${opts.limit}&page_number=1&facet_filters=&sort=most_searched&include=gift`
      const data = await httpGetJson<{ data?: KabumProduct[] }>(url, {
        signal: opts.signal,
        headers: { Origin: 'https://www.kabum.com.br', Referer: 'https://www.kabum.com.br/' },
      })
      return mapKabumProducts(data.data ?? [])
    },
  }
}
