/**
 * Modelo de afiliado da loja aplicado ao link de um produto. A mesma regra vale
 * no /ir/ (servidor) e na prévia do painel.
 *
 * Três formas:
 *  - parâmetro:    "tag=seutag-20" → anexa à URL do produto (Amazon, Mercado Livre);
 *  - embrulho:     "https://rede.exemplo/click?u={url_encoded}" → a rede de afiliados
 *                  redireciona para a loja (Awin, Rakuten, Lomadee…);
 *  - loja própria: "https://www.magazinevoce.com.br/magazinesualoja{path}" → o mesmo
 *                  caminho do produto no endereço do afiliado (Influenciador Magalu).
 *
 * Marcadores: {url}, {url_encoded}, {id} e {path} (caminho e query do produto,
 * começando pela barra; "sualoja/{path}" e "sualoja{path}" dão o mesmo link).
 */
const MARKER = /\{(url_encoded|url|id|path)\}/g

export const AFFILIATE_MARKERS = ['{url}', '{url_encoded}', '{id}', '{path}'] as const

export function hasAffiliateMarker(template: string): boolean {
  return new RegExp(MARKER.source).test(template)
}

/**
 * Link inteiro sem marcador (ex.: o endereço da loja de afiliado colado como
 * está). Não é parâmetro nem embrulho: aplicado, sairia um link quebrado.
 */
export function isUrlWithoutMarker(template: string): boolean {
  return /^\s*https?:\/\//i.test(template) && !hasAffiliateMarker(template)
}

export function applyAffiliateTemplate(productUrl: string, template: string | null | undefined, externalId = ''): string {
  const t = template?.trim()
  if (!t || isUrlWithoutMarker(t)) return productUrl

  if (hasAffiliateMarker(t)) {
    let path = ''
    if (t.includes('{path}')) {
      try {
        const u = new URL(productUrl)
        path = u.pathname + u.search
      } catch {
        return productUrl
      }
    }
    const values: Record<string, string> = {
      url: productUrl,
      url_encoded: encodeURIComponent(productUrl),
      id: encodeURIComponent(externalId),
      path,
    }
    // Uma passada só: o que entra no lugar de um marcador nunca é lido de novo.
    return t.replaceAll('/{path}', '{path}').replace(MARKER, (_, key: string) => values[key] ?? '')
  }

  try {
    const url = new URL(productUrl)
    const params = new URLSearchParams(t.replace(/^[?&]/, ''))
    for (const [k, v] of params) url.searchParams.set(k, v)
    return url.toString()
  } catch {
    return productUrl
  }
}
