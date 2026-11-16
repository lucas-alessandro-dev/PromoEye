/**
 * Link final para onde o clique vai.
 *
 * Ordem de prioridade:
 *  1. link de afiliado colado na própria oferta (Mercado Livre, Magalu e
 *     outros programas que geram um link por produto);
 *  2. modelo de afiliado da loja;
 *  3. a URL do produto, limpa.
 *
 * O modelo da loja tem duas formas:
 *  - parâmetro:  "tag=seutag-20"  → anexa à URL (Amazon Associados);
 *  - embrulho:   "https://rede.exemplo/click?u={url_encoded}" → a rede de
 *                afiliados redireciona para a loja (Awin, Rakuten, Lomadee…).
 *    Marcadores: {url}, {url_encoded}, {id}.
 */
export function buildOutboundUrl(
  productUrl: string,
  opts: { affiliateUrl?: string | null; template?: string | null; externalId?: string }
): string {
  if (opts.affiliateUrl) return opts.affiliateUrl
  const template = opts.template?.trim()
  if (!template) return productUrl

  if (/\{url(_encoded)?\}|\{id\}/.test(template)) {
    return template
      .replaceAll('{url_encoded}', encodeURIComponent(productUrl))
      .replaceAll('{url}', productUrl)
      .replaceAll('{id}', encodeURIComponent(opts.externalId ?? ''))
  }

  try {
    const url = new URL(productUrl)
    const params = new URLSearchParams(template.replace(/^[?&]/, ''))
    for (const [k, v] of params) url.searchParams.set(k, v)
    return url.toString()
  } catch {
    return productUrl
  }
}

export function hasAffiliate(opts: { affiliateUrl?: string | null; template?: string | null }): boolean {
  return Boolean(opts.affiliateUrl || opts.template?.trim())
}

/** Só aceitamos redirecionar para https — o /ir/ nunca vira um redirecionador aberto para qualquer coisa. */
export function isSafeOutbound(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
