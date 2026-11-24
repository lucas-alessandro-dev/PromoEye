const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlInt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

/** "R$ 4.199,00" */
export function formatBRL(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? brl.format(n) : '—'
}

/** "R$ 4.199" quando não há centavos; "R$ 4.198,99" quando há. */
export function formatBRLShort(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? brlInt.format(n) : brl.format(n)
}

/** 0.3127 → "31%" */
export function formatPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—'
  return `${Math.round(fraction * 100)}%`
}

/** Desconto anunciado pela loja, 0..1. `null` quando não há preço "de". */
export function listDiscount(price: number, listPrice: number | null | undefined): number | null {
  if (!listPrice || listPrice <= price) return null
  return 1 - price / listPrice
}

/**
 * Desconto do "de" que pode aparecer riscado para o público (vitrine e grupo).
 * Quando o preço é à vista e o cartão custa mais, o "de" só conta se for maior
 * que o preço no cartão. Igual ao cartão, a "remarcação" é só o desconto do
 * Pix: riscar um preço que ainda vale no cartão engana. null = não mostrar.
 */
export function shownListDiscount(
  price: number,
  listPrice: number | null | undefined,
  cardPrice: number | null | undefined
): number | null {
  if (cardPrice && cardPrice > price + 0.005 && (!listPrice || listPrice <= cardPrice + 0.005)) return null
  return listDiscount(price, listPrice)
}

/**
 * Black Friday = a sexta-feira seguinte à quarta quinta-feira de novembro
 * (o mesmo critério americano que o varejo brasileiro adotou).
 */
export function blackFridayDate(year: number): Date {
  const firstNov = new Date(Date.UTC(year, 10, 1))
  const firstThursday = 1 + ((4 - firstNov.getUTCDay() + 7) % 7)
  const fourthThursday = firstThursday + 21
  return new Date(Date.UTC(year, 10, fourthThursday + 1, 3, 0, 0)) // 00:00 em Brasília
}

/** Dias inteiros até a próxima Black Friday (0 no próprio dia). */
export function daysUntilBlackFriday(now = new Date()): { days: number; date: Date } {
  let date = blackFridayDate(now.getUTCFullYear())
  const endOfDay = date.getTime() + 24 * 3600_000
  if (now.getTime() >= endOfDay) date = blackFridayDate(now.getUTCFullYear() + 1)
  const days = Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 86_400_000))
  return { days, date }
}

/** "há 12 min", "há 3 h", "há 2 dias" */
export function timeAgo(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return 'nunca'
  const d = typeof date === 'string' ? new Date(date) : date
  const s = Math.round((now.getTime() - d.getTime()) / 1000)
  if (s < 60) return 'agora há pouco'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

/** Slug ASCII para URLs: "iPhone 16 128GB" → "iphone-16-128gb". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
