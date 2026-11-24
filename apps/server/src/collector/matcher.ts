import { containsTerm, normalize, queryTerms, sellerMatches } from '../lib/text.js'
import type { RawOffer } from './types.js'

/**
 * Decide se um anúncio é mesmo o item acompanhado.
 *
 * Buscar "iphone 16 128gb" nas lojas devolve capinha, película, iPhone 16e,
 * iPhone 15 e vitrine. Sem este filtro, a "melhor promoção" seria uma capa de
 * R$ 27. Cada descarte diz o motivo, para o "Testar busca" do painel mostrar
 * por que um anúncio ficou de fora e você ajustar os termos.
 */

export interface MatchRules {
  query: string
  mustInclude: string[]
  mustExclude: string[]
  minPrice: number | null
  globalExcludes: string[]
}

export interface SellerRules {
  policy: 'OFFICIAL_ONLY' | 'ALL'
  trustedSellers: string[]
  blockedSellers: string[]
}

export type Verdict = { ok: true } | { ok: false; reason: string }

export function requiredTerms(rules: Pick<MatchRules, 'query' | 'mustInclude'>): string[] {
  return rules.mustInclude.length ? rules.mustInclude : queryTerms(rules.query)
}

/** Palavras que a própria busca pede: nelas, exclusão automática não vale. */
function wantedTerms(rules: Pick<MatchRules, 'query' | 'mustInclude'>): Set<string> {
  return new Set([...queryTerms(rules.query), ...rules.mustInclude.flatMap((t) => t.split('|').map(normalize))])
}

export function matchTitle(title: string, rules: MatchRules): Verdict {
  const norm = normalize(title)

  for (const term of requiredTerms(rules)) {
    if (!containsTerm(norm, term)) return { ok: false, reason: `não tem "${term}" no título` }
  }

  for (const term of rules.mustExclude) {
    if (containsTerm(norm, term)) return { ok: false, reason: `tem "${term}" (excluído)` }
  }

  // Exclusões globais ("capa", "usado"…) não valem se a própria busca as usa.
  const wanted = wantedTerms(rules)
  for (const term of rules.globalExcludes) {
    const n = normalize(term)
    if (!n || wanted.has(n)) continue
    if (containsTerm(norm, n)) return { ok: false, reason: `parece acessório ou usado ("${term}")` }
  }
  return { ok: true }
}

export function matchOffer(raw: RawOffer, rules: MatchRules): Verdict {
  const t = matchTitle(raw.title, rules)
  if (!t.ok) return t
  // A loja diz que a unidade não é nova (outlet da Polishop: devolvida, com
  // marca de uso). Vale mesmo com as exclusões globais já salvas no painel.
  if (raw.notNew && !wantedTerms(rules).has(normalize(raw.notNew))) {
    return { ok: false, reason: `não é novo (a loja marca como "${raw.notNew}")` }
  }
  if (rules.minPrice !== null && raw.price < rules.minPrice) {
    return { ok: false, reason: `abaixo do preço mínimo (${raw.price.toFixed(2)})` }
  }
  return { ok: true }
}

export function sellerAllowed(raw: RawOffer, rules: SellerRules): Verdict {
  if (raw.sellerName && sellerMatches(raw.sellerName, rules.blockedSellers)) {
    return { ok: false, reason: `vendedor bloqueado (${raw.sellerName})` }
  }
  if (rules.policy === 'ALL') return { ok: true }
  if (raw.soldByStore === true || raw.soldByStore === null) return { ok: true }
  if (sellerMatches(raw.sellerName, rules.trustedSellers)) return { ok: true }
  return { ok: false, reason: `vendedor de marketplace fora da lista de confiáveis (${raw.sellerName ?? 'sem nome'})` }
}

/**
 * Guarda contra acessório que escapou do filtro de palavras: com 3+ anúncios,
 * o que custa menos de 40% da mediana quase nunca é o produto. Um iPhone de
 * R$ 900 entre vários de R$ 4.500 é capa, golpe ou erro de cadastro.
 */
export function outlierCut<T extends { price: number }>(rows: T[]): { kept: T[]; dropped: T[] } {
  if (rows.length < 3) return { kept: rows, dropped: [] }
  const sorted = rows.map((r) => r.price).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  const floor = median * 0.4
  const kept: T[] = []
  const dropped: T[] = []
  for (const r of rows) (r.price < floor ? dropped : kept).push(r)
  return { kept, dropped }
}
