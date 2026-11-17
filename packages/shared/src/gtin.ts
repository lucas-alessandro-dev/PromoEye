/**
 * GTIN/EAN: o código de barras do produto. É o que permite dizer que o
 * anúncio da Americanas e o do Carrefour são o MESMO produto sem adivinhar
 * pelo título — a base do catálogo (entidade Product).
 *
 * Guardamos a forma canônica de 14 dígitos (zeros à esquerda): o EAN-13
 * 7891356121050 e o GTIN-14 07891356121050 são o mesmo código. Para mostrar,
 * `displayGtin` devolve a forma curta de costume (EAN-13 no Brasil).
 */

const LENGTHS = new Set([8, 12, 13, 14])

/** Dígito verificador GS1: da direita para a esquerda (sem o verificador), pesos 3, 1, 3, 1… */
export function gtinCheckDigitOk(g14: string): boolean {
  if (!/^\d{14}$/.test(g14)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) {
    const d = g14.charCodeAt(i) - 48
    sum += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (sum % 10)) % 10 === g14.charCodeAt(13) - 48
}

/**
 * Códigos de circulação restrita: cada loja usa os seus (balança, uso
 * interno, cupom). Dois produtos diferentes em lojas diferentes podem ter o
 * mesmo número, então eles NUNCA servem para juntar anúncios.
 *  - GTIN-8 começando com 0 ou 2;
 *  - EAN-13 020–029, 040–049 e 200–299 (e UPC-A 2, 4 e 5, que viram 02, 04 e 05).
 */
function restricted(g14: string): boolean {
  if (g14.startsWith('000000')) {
    const first = g14[6]
    return first === '0' || first === '2'
  }
  const g13 = g14.slice(1)
  return g14[0] === '0' && (g13.startsWith('02') || g13.startsWith('04') || g13.startsWith('05') || g13.startsWith('2'))
}

/**
 * Normaliza o que a loja mandou ("7891356121050", " 789-1356…", 7891356121050)
 * para a forma canônica de 14 dígitos. Devolve null quando não é um GTIN
 * confiável para cruzar lojas: tamanho errado, só zeros, dígito verificador
 * errado ou código de uso interno.
 */
export function normalizeGtin(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!LENGTHS.has(digits.length) || /^0+$/.test(digits)) return null
  const g14 = digits.padStart(14, '0')
  if (!gtinCheckDigitOk(g14) || restricted(g14)) return null
  return g14
}

/** Forma curta para mostrar e para o JSON-LD: GTIN-8, UPC-12, EAN-13 ou GTIN-14. */
export function displayGtin(g14: string): string {
  if (g14.startsWith('000000')) return g14.slice(6)
  if (g14.startsWith('00')) return g14.slice(2)
  if (g14.startsWith('0')) return g14.slice(1)
  return g14
}

/** "Não informado", "Genérico", "Sem marca"…: lojas preenchem o campo de marca com isso. Não é marca. */
const NO_BRAND = /^(n[ãa]o informad[oa]|nao_informado|sem marca|gen[ée]ric[oa]|outr[oa]s?|diversos|n\/?a|null|undefined|-+|\.+)$/i

/** Marca limpa, ou null quando a loja mandou um marcador de "sem marca". */
export function cleanBrand(raw: string | null | undefined): string | null {
  const b = raw?.replace(/\s+/g, ' ').trim()
  if (!b || NO_BRAND.test(b)) return null
  return b.slice(0, 80)
}
