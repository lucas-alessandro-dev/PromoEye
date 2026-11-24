/** Um anúncio como a loja devolveu, já traduzido para o nosso formato. */
export interface RawOffer {
  externalId: string
  title: string
  url: string
  imageUrl: string | null
  /** Melhor preço à vista (Pix/boleto quando a loja informa). */
  price: number
  /** Preço "de" anunciado. */
  listPrice: number | null
  /** Preço no cartão, quando difere do à vista. */
  cardPrice: number | null
  /**
   * Preço no Pix, quando a loja informa um valor ou regra explícita. Pode ser
   * menor que o `price`; nunca substitui o `price` (a base do histórico).
   */
  pixPrice: number | null
  installments: string | null
  sellerName: string | null
  /** true = vendido pela própria loja; null = a busca não informa. */
  soldByStore: boolean | null
  available: boolean
  sponsored: boolean
  promoLabel: string | null
  /** GTIN canônico de 14 dígitos (normalizeGtin), ou null se a loja não manda ou não é válido. */
  gtin: string | null
  brand: string | null
  /** Referência do produto na loja/fabricante, quando vem. */
  modelRef: string | null
  /**
   * A própria loja marca a unidade como não nova ("outlet": devolvida, com
   * marca de uso). O filtro descarta, salvo se a busca do item pedir a palavra.
   * null = nova ou a loja não informa.
   */
  notNew: string | null
}

export interface SearchOptions {
  limit: number
  signal?: AbortSignal
}

export interface StoreAdapter {
  search(query: string, opts: SearchOptions): Promise<RawOffer[]>
}

/** O que o adaptador precisa saber da loja (vem da tabela Store). */
export interface StoreContext {
  id: string
  name: string
  domain: string
  adapter: 'VTEX' | 'KABUM' | 'AMAZON' | 'MANUAL'
  config: Record<string, unknown>
}
