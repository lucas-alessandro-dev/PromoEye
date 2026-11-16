/**
 * Normalização de títulos de produto para comparar com a busca.
 *
 * As lojas escrevem o mesmo produto de vinte jeitos: "iPhone 16 (128 GB) –
 * Preto", "Apple iPhone 16 128GB Preto", "IPHONE 16 128 GB". Normalizar antes
 * de comparar é o que faz "128gb" casar com "128 GB" e "geladeira" casar com
 * "Geladeira/Refrigerador".
 */

const UNITS = [
  'gb',
  'tb',
  'mb',
  'w',
  'mah',
  'hz',
  'mp',
  'l',
  'litros',
  'kg',
  'ml',
  'pol',
  'polegadas',
  'btus',
  'btu',
  'v',
  'mm',
  'cm',
  'k',
]
const unitGlue = new RegExp(`(\\d)\\s+(${UNITS.join('|')})\\b`, 'g')

export function normalize(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // 55" e 55'' viram 55pol
      .replace(/(\d)\s*(?:"|''|”|polegadas|pol\.?)(?=\s|$|[^a-z])/g, '$1pol ')
      .replace(/[^a-z0-9.,]+/g, ' ')
      // pontuação solta (fim de frase, "R$ 1.299,00") não é parte de token
      .replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
      .replace(unitGlue, '$1$2')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export function tokens(text: string): string[] {
  const n = normalize(text)
  return n ? n.split(' ') : []
}

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'com', 'para', 'pra', 'em', 'no', 'na', 'por', 'um', 'uma'])

/** Termos significativos da busca (sem "de", "para", "com"…). */
export function queryTerms(query: string): string[] {
  return tokens(query).filter((t) => !STOPWORDS.has(t))
}

/**
 * O título contém o termo? Termo pode ser uma palavra ("pro"), uma frase
 * ("pro max", em sequência) ou alternativas ("128gb|128 gb"). Compara palavra
 * inteira: "16" não casa com "16e", e "pro" não casa com "produto".
 */
export function containsTerm(normTitle: string, term: string): boolean {
  const padded = ` ${normTitle} `
  return term
    .split('|')
    .map((alt) => normalize(alt))
    .filter(Boolean)
    .some((alt) => padded.includes(` ${alt} `))
}

/** Parse de "R$ 4.199,00" / "4.199,00" / "4199.00" → 4199 */
export function parseBRL(text: string | null | undefined): number | null {
  if (!text) return null
  const cleaned = text.replace(/[^\d,.-]/g, '')
  if (!cleaned) return null
  // Formato brasileiro: ponto de milhar, vírgula decimal.
  const n = cleaned.includes(',') ? Number(cleaned.replace(/\./g, '').replace(',', '.')) : Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * O vendedor está na lista? Compara por PALAVRA inteira: "Loja iPlace" casa
 * "iplace", mas "Applestore Importados" não casa "apple". Trecho solto
 * deixaria passar qualquer revendedor que pendurasse uma marca no nome.
 */
export function sellerMatches(sellerName: string | null | undefined, list: string[]): boolean {
  if (!sellerName) return false
  const s = normalize(sellerName)
  return list.some((entry) => {
    const e = normalize(entry)
    return e.length > 0 && containsTerm(s, e)
  })
}
