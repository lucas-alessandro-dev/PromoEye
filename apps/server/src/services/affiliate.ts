import { applyAffiliateTemplate, isUrlWithoutMarker } from '@promoeye/shared'

/**
 * Link final para onde o clique vai.
 *
 * Ordem de prioridade:
 *  1. link de afiliado colado na própria oferta (Mercado Livre, Magalu e
 *     outros programas que geram um link por produto);
 *  2. modelo de afiliado da loja (parâmetro, embrulho de rede ou {path};
 *     a regra está em packages/shared/src/affiliate.ts);
 *  3. a URL do produto, limpa.
 */
export function buildOutboundUrl(
  productUrl: string,
  opts: { affiliateUrl?: string | null; template?: string | null; externalId?: string }
): string {
  if (opts.affiliateUrl) return opts.affiliateUrl
  return applyAffiliateTemplate(productUrl, opts.template, opts.externalId)
}

export function hasAffiliate(opts: { affiliateUrl?: string | null; template?: string | null }): boolean {
  const t = opts.template?.trim()
  return Boolean(opts.affiliateUrl || (t && !isUrlWithoutMarker(t)))
}

/** Só aceitamos redirecionar para https — o /ir/ nunca vira um redirecionador aberto para qualquer coisa. */
export function isSafeOutbound(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
