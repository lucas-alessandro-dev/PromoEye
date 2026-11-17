/**
 * Dados estruturados (Schema.org em JSON-LD) para o Google e para buscas por
 * IA entenderem a página: produto, faixa de preço entre as lojas, caminho.
 *
 * Regra de ouro do Google: a marcação descreve o que está VISÍVEL na página.
 * Por isso só marcamos como Product o que é um produto (ver itemLd).
 */

import { cleanBrand } from '@promoeye/shared'

const BRL = 'BRL'
const IN_STOCK = 'https://schema.org/InStock'
const OUT_OF_STOCK = 'https://schema.org/OutOfStock'

/**
 * JSON seguro dentro de <script type="application/ld+json">. Um título de
 * anúncio com "</script>" fecharia a tag e viraria HTML; com < > & (e os
 * separadores de linha U+2028/U+2029) trocados pelo escape unicode do JSON,
 * o dado continua o mesmo para quem lê e nada escapa da tag.
 */
const BACKSLASH = String.fromCharCode(92)
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g')
const unicodeEscape = (c: string) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`

export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE, unicodeEscape)
}

const money = (n: number) => Number(n.toFixed(2))

export interface LdOffer {
  price: number
  storeName: string
  available: boolean
}

export interface ProductLdInput {
  name: string
  url: string
  images: string[]
  description?: string | null
  brand?: string | null
  /** Forma curta (13 dígitos, em geral). */
  gtin?: string | null
  category?: string | null
  offers: LdOffer[]
}

/**
 * Product + AggregateOffer: o menor e o maior preço entre as lojas, quantas
 * ofertas, e cada oferta com a loja. Sem oferta disponível, sem marcação de
 * preço (o Google recusa Product sem offers/review/rating; melhor não marcar).
 */
export function productLd(p: ProductLdInput): Record<string, unknown> | null {
  const available = p.offers.filter((o) => o.available)
  if (!available.length) return null
  const prices = available.map((o) => o.price)
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url: p.url,
    ...(p.images.length ? { image: p.images.slice(0, 6) } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(p.gtin ? { gtin: p.gtin } : {}),
    ...(p.category ? { category: p.category } : {}),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: BRL,
      lowPrice: money(Math.min(...prices)),
      highPrice: money(Math.max(...prices)),
      offerCount: available.length,
      offers: p.offers.slice(0, 30).map((o) => ({
        '@type': 'Offer',
        price: money(o.price),
        priceCurrency: BRL,
        availability: o.available ? IN_STOCK : OUT_OF_STOCK,
        seller: { '@type': 'Organization', name: o.storeName },
      })),
    },
  }
}

export interface Crumb {
  name: string
  url: string
}

export function breadcrumbLd(crumbs: Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
  }
}

/** Lista de produtos (páginas de item que juntam modelos de marcas diferentes). */
export function itemListLd(name: string, items: Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListElement: items.slice(0, 30).map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, url: c.url })),
  }
}

/**
 * Página de item (/ofertas/<slug>): um item pode ser UM produto ("iPhone 16
 * 128GB", em várias cores) ou uma categoria ("Air fryer 4L", com modelos de
 * marcas diferentes). Marcar uma categoria como Product é dado estruturado
 * enganoso para o Google; então:
 *  - anúncios de 2 marcas diferentes ou mais → ItemList dos produtos do catálogo;
 *  - senão → Product + AggregateOffer.
 */
export function itemLd(i: ProductLdInput & { brands: string[]; products: Crumb[] }): Record<string, unknown> | null {
  const clean = i.brands.map(cleanBrand).filter((b): b is string => b !== null)
  const brands = new Set(clean.map((b) => b.toLowerCase()))
  if (brands.size >= 2) return i.products.length >= 2 ? itemListLd(i.name, i.products) : null
  return productLd({ ...i, brand: i.brand ?? clean[0] ?? null })
}

export function siteLd(site: { name: string; url: string }): Record<string, unknown>[] {
  return [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: `${site.url}/`, inLanguage: 'pt-BR' },
    { '@context': 'https://schema.org', '@type': 'Organization', name: site.name, url: `${site.url}/`, logo: `${site.url}/static/favicon.svg` },
  ]
}
