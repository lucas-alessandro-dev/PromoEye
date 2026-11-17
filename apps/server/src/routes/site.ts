import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { daysUntilBlackFriday, displayGtin, flagTone, listDiscount } from '@promoeye/shared'
import type { Offer, PricePoint, Store, WatchItem } from '@prisma/client'
import { publicUrl } from '../config.js'
import { num, numReq, prisma } from '../lib/prisma.js'
import { render } from '../lib/render.js'
import { normalize } from '../lib/text.js'
import { breadcrumbLd, itemLd, jsonLdScript, siteLd } from '../lib/jsonld.js'
import { currentUser } from '../plugins/auth.js'
import { FRESH_MS } from '../collector/fresh.js'
import { nextRunAt } from '../collector/scheduler.js'
import { collectEveryMin } from '../lib/peak.js'
import { typicalPrice } from '../collector/scoring.js'
import { getSettings } from '../services/settings.js'
import { alertBoxVM } from './alerts.js'

/**
 * Vitrine pública. Tudo aqui é lido do banco; nenhuma página dispara busca
 * nas lojas (isso é trabalho do coletor, de hora em hora).
 *
 *   /                 listagem no estilo das lojas: busca, categorias, ordem e um cartão por item
 *   /ofertas/:slug    página do item: todas as lojas pesquisadas e o histórico de preço
 */

const DAY = 86_400_000

export interface CardVM {
  id: string
  href: string
  title: string
  itemName: string
  itemSlug: string
  storeId: string
  storeName: string
  imageUrl: string | null
  price: number
  listPrice: number | null
  /** Mostrar o "de" riscado? Não, quando o "de" é inflado. */
  showList: boolean
  listOff: number | null
  realOff: number | null
  flags: { id: string; tone: string }[]
  warn: boolean
  installments: string | null
  /** Preço no Pix MENOR que o preço principal (regra de Pix da loja). null = não há diferença. */
  pixLower: number | null
  /** O preço principal já é o do Pix (KaBuM!). */
  pixIsPrice: boolean
  /** Preço no cartão, quando é maior que o principal. */
  cardPrice: number | null
  sellerName: string | null
  promoLabel: string | null
  isDeal: boolean
  available: boolean
  /** Oferta cadastrada à mão (Mercado Livre, Magalu…): o "conferido há" não vale para ela. */
  manual: boolean
  lastSeenAt: Date
  /** Página do produto no catálogo (mesmo EAN em outras lojas). */
  productHref: string | null
}

export type OfferFull = Offer & { store: Store; watchItem: WatchItem; product?: { slug: string } | null }

const FLAG_ORDER = ['abaixo-do-alvo', 'menor-preco', 'mais-barato', 'desconto-real', 'caiu-agora', 'oferta-relampago', 'preco-de-inflado', 'subiu-antes']

export function cardVM(o: OfferFull): CardVM {
  const price = numReq(o.price)
  const listPrice = num(o.listPrice)
  const inflated = o.flags.includes('preco-de-inflado')
  const off = listDiscount(price, listPrice)
  const flags = FLAG_ORDER.filter((f) => o.flags.includes(f)).map((id) => ({ id, tone: flagTone(id) }))
  const showList = Boolean(listPrice && off && off >= 0.03 && !inflated)
  const pix = num(o.pixPrice)
  const card = num(o.cardPrice)
  return {
    id: o.id,
    href: `/ir/${o.id}`,
    title: o.title,
    itemName: o.watchItem.name,
    itemSlug: o.watchItem.slug,
    storeId: o.storeId,
    storeName: o.store.name,
    imageUrl: o.imageUrl,
    price,
    listPrice,
    showList,
    listOff: showList ? off : null,
    realOff: o.realDiscountPct && o.realDiscountPct >= 0.03 ? o.realDiscountPct : null,
    flags,
    warn: flags.some((f) => f.tone === 'warn'),
    installments: o.installments,
    pixLower: pix !== null && pix < price - 0.005 ? pix : null,
    pixIsPrice: pix !== null && Math.abs(pix - price) < 0.005,
    cardPrice: card !== null && card > price + 0.005 ? card : null,
    sellerName: o.soldByStore ? null : o.sellerName,
    promoLabel: o.promoLabel,
    isDeal: o.isDeal,
    available: o.available,
    manual: o.source === 'MANUAL',
    lastSeenAt: o.lastSeenAt,
    productHref: o.product ? `/produtos/${o.product.slug}` : null,
  }
}

/** Anúncio "de agora": visto na última coleta (ou cadastrado à mão). Esgotado entra; quem filtra é quem usa. */
const currentWhere = () => ({
  hidden: false,
  store: { enabled: true },
  watchItem: { active: true },
  OR: [{ source: 'MANUAL' as const }, { lastSeenAt: { gte: new Date(Date.now() - FRESH_MS) } }],
})
const freshWhere = () => ({ ...currentWhere(), available: true })
export const isCurrent = (o: Offer, now: Date) => o.source === 'MANUAL' || o.lastSeenAt.getTime() >= now.getTime() - FRESH_MS
export const byPrice = (a: Offer, b: Offer) => numReq(a.price) - numReq(b.price)

export async function gate(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const settings = await getSettings()
  if (settings.publicSite) return true
  if (await currentUser(request)) return true
  reply.redirect('/painel', 302)
  return false
}

export async function baseContext() {
  const settings = await getSettings()
  const lastRun = await prisma.collectorRun.findFirst({
    where: { status: { in: ['OK', 'PARTIAL'] } },
    orderBy: { startedAt: 'desc' },
  })
  const bf = daysUntilBlackFriday()
  return {
    site: {
      title: settings.siteTitle,
      url: publicUrl,
      disclosure: settings.affiliateDisclosure,
      allowIndexing: settings.allowIndexing,
      whatsappInvite: settings.whatsapp.groupInviteUrl || null,
      // canonical só com domínio de verdade (a skill pede: nada de localhost).
      canonical: !/localhost|127\.0\.0\.1/.test(publicUrl),
    },
    bf: { days: bf.days, date: bf.date },
    lastRunAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
    nextRunAt: nextRunAt(),
    // 60 = de hora em hora; menos que isso só na janela de pico (Black Friday).
    collectEvery: collectEveryMin(),
    year: new Date().getFullYear(),
  }
}

// ── Cartão de produto (a listagem) ─────────────────────────────────────────────────────────────

export interface ProductCardVM {
  id: string
  slug: string
  name: string
  category: string | null
  href: string
  imageUrl: string | null
  best: CardVM | null
  /** O maior desconto honesto do melhor anúncio: o real (contra o histórico) ou o do "de" que não é inflado. */
  off: number | null
  storeCount: number
  offerCount: number
  storeNames: string[]
  soldOutStores: number
  isDeal: boolean
  flags: { id: string; tone: string }[]
  inflated: CardVM | null
  byStore: { storeId: string; storeName: string; price: number }[]
  sortOrder: number
  createdAt: Date
}

function productCards(items: WatchItem[], offers: OfferFull[]): ProductCardVM[] {
  const byItem = new Map<string, OfferFull[]>()
  for (const o of offers) byItem.set(o.watchItemId, [...(byItem.get(o.watchItemId) ?? []), o])

  return items.map((item) => {
    const all = byItem.get(item.id) ?? []
    const avail = all.filter((o) => o.available).sort(byPrice)
    const best = avail[0] ? cardVM(avail[0]) : null
    const storeIds = [...new Set(avail.map((o) => o.storeId))]
    const soldOut = new Set(all.filter((o) => !o.available).map((o) => o.storeId))
    for (const id of storeIds) soldOut.delete(id)
    const inflated = avail
      .filter((o) => o.flags.includes('preco-de-inflado'))
      .sort((a, b) => (num(b.listPrice) ?? 0) - (num(a.listPrice) ?? 0))[0]
    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      category: item.category,
      href: `/ofertas/${item.slug}`,
      imageUrl: best?.imageUrl ?? all.find((o) => o.imageUrl)?.imageUrl ?? null,
      best,
      off: best ? Math.max(best.realOff ?? 0, best.listOff ?? 0) || null : null,
      storeCount: storeIds.length,
      offerCount: avail.length,
      storeNames: storeIds.map((id) => avail.find((o) => o.storeId === id)!.store.name),
      soldOutStores: soldOut.size,
      isDeal: avail.some((o) => o.isDeal),
      // "Mais barato entre as lojas" é verdade em todo cartão (ele mostra o mais barato): seria ruído.
      flags: best?.flags.filter((f) => f.id !== 'mais-barato').slice(0, 2) ?? [],
      inflated: inflated ? cardVM(inflated) : null,
      byStore: storeIds.map((id) => {
        const o = avail.find((x) => x.storeId === id)!
        return { storeId: id, storeName: o.store.name, price: numReq(o.price) }
      }),
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
    }
  })
}

async function loadProductCards(items: WatchItem[]): Promise<ProductCardVM[]> {
  if (!items.length) return []
  const offers = await prisma.offer.findMany({
    where: { ...currentWhere(), watchItemId: { in: items.map((i) => i.id) } },
    include: { store: true, watchItem: true },
  })
  return productCards(items, offers)
}

// ── Listagem: busca, categoria, só promoções e ordem, tudo na URL (funciona sem JavaScript) ────

const ORDERS = {
  relevancia: 'Mais relevantes',
  'menor-preco': 'Menor preço',
  'maior-preco': 'Maior preço',
  desconto: 'Maior desconto',
  lojas: 'Mais lojas',
} as const
type Order = keyof typeof ORDERS

interface ShopState {
  q: string
  cat: string
  promo: boolean
  ordem: Order
}

function shopHref(state: ShopState, patch: Partial<ShopState>): string {
  const s = { ...state, ...patch }
  const p = new URLSearchParams()
  if (s.q) p.set('q', s.q)
  if (s.cat) p.set('cat', s.cat)
  if (s.promo) p.set('promo', '1')
  if (s.ordem !== 'relevancia') p.set('ordem', s.ordem)
  const qs = p.toString()
  return `/${qs ? `?${qs}` : ''}#ofertas`
}

function sortCards(cards: ProductCardVM[], ordem: Order): ProductCardVM[] {
  const has = (c: ProductCardVM) => (c.best ? 0 : 1) // sem oferta vai para o fim, em qualquer ordem
  const base = (a: ProductCardVM, b: ProductCardVM) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()
  const by: Record<Order, (a: ProductCardVM, b: ProductCardVM) => number> = {
    relevancia: (a, b) => Number(b.isDeal) - Number(a.isDeal) || base(a, b),
    'menor-preco': (a, b) => (a.best?.price ?? 0) - (b.best?.price ?? 0),
    'maior-preco': (a, b) => (b.best?.price ?? 0) - (a.best?.price ?? 0),
    desconto: (a, b) => (b.off ?? 0) - (a.off ?? 0) || base(a, b),
    lojas: (a, b) => b.storeCount - a.storeCount || base(a, b),
  }
  return [...cards].sort((a, b) => has(a) - has(b) || by[ordem](a, b))
}

// ── Gráficos (desenhados no servidor; o JavaScript só acrescenta o cursor) ─────────────────────

export interface Point {
  at: Date
  price: number
  storeId?: string | null
}

/** Passos "redondos" para o eixo: 1, 2, 2,5 ou 5 × 10^k. */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = Math.max(hi - lo, Math.abs(hi) * 0.02, 1)
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const ticks: number[] = []
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100)
  if (ticks[ticks.length - 1]! < hi) ticks.push(ticks[ticks.length - 1]! + step)
  return ticks
}

/**
 * O menor preço entre as lojas ao longo do tempo, em degrau. As coordenadas
 * saem em 0–1000 (o SVG estica com preserveAspectRatio="none" e o traço não
 * engorda); rótulos, pontos e cursor são HTML posicionado em %, para o texto
 * ficar do mesmo tamanho no celular e no computador.
 */
export function historyChart(points: Point[], now: Date, typical: number | null, days: number) {
  // Um ponto só é um preço que não mudou desde então (quem garante as 2 coletas é quem chama).
  if (!points.length) return null
  const x0 = points[0]!.at.getTime()
  const x1 = now.getTime()
  if (x1 - x0 < 30 * 60_000) return null
  const prices = points.map((p) => p.price)
  const lo = Math.min(...prices, typical ?? Infinity)
  const hi = Math.max(...prices, typical ?? -Infinity)
  // Folga em volta: preço estável fica no meio do gráfico (colado no chão pareceria uma queda).
  const pad = Math.max((hi - lo) * 0.1, hi * 0.02)
  const ticks = niceTicks(lo - pad, hi + pad)
  const y0 = ticks[0]!
  const y1 = ticks[ticks.length - 1]!
  const X = (t: number) => ((t - x0) / Math.max(1, x1 - x0)) * 1000
  const Y = (v: number) => (1 - (v - y0) / Math.max(1, y1 - y0)) * 1000
  const f = (n: number) => n.toFixed(1)

  let d = `M${f(X(x0))},${f(Y(points[0]!.price))}`
  for (let i = 1; i < points.length; i++) d += ` H${f(X(points[i]!.at.getTime()))} V${f(Y(points[i]!.price))}`
  d += ` H1000`

  const minIdx = prices.indexOf(Math.min(...prices))
  const maxIdx = prices.indexOf(Math.max(...prices))
  const span = x1 - x0
  const fmt: Intl.DateTimeFormatOptions = span < 2 * DAY
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit' }
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((k) => ({
    pct: k * 100,
    label: new Date(x0 + k * span).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...fmt }),
  }))

  return {
    d,
    area: `${d} V1000 H0 Z`,
    yTicks: ticks.map((v) => ({ value: v, pct: Y(v) / 10 })),
    xTicks,
    typical: typical === null ? null : { value: typical, pct: Y(typical) / 10 },
    min: { pct: { x: X(points[minIdx]!.at.getTime()) / 10, y: Y(prices[minIdx]!) / 10 }, price: prices[minIdx]!, at: points[minIdx]!.at, storeId: points[minIdx]!.storeId ?? null },
    max: { price: prices[maxIdx]!, at: points[maxIdx]!.at },
    last: { pct: { x: 100, y: Y(prices[prices.length - 1]!) / 10 }, price: prices[prices.length - 1]! },
    first: points[0]!.at,
    days,
    // Para o cursor: um ponto por mudança, em % do gráfico.
    data: points.map((p) => ({ x: +(X(p.at.getTime()) / 10).toFixed(2), y: +(Y(p.price) / 10).toFixed(2), t: p.at.toISOString(), v: p.price, s: p.storeId ?? null })),
  }
}

/** Menor preço de uma loja em cada momento: junta o histórico de todos os anúncios dela. */
export function storeSeries(offers: (Offer & { history: PricePoint[] })[], since: Date, now: Date): Point[] {
  const times = new Set<number>([since.getTime()])
  for (const o of offers) for (const h of o.history) if (h.at > since) times.add(h.at.getTime())
  const out: Point[] = []
  for (const t of [...times].sort((a, b) => a - b)) {
    let min: number | null = null
    for (const o of offers) {
      // o anúncio vale do primeiro ponto até a última vez em que foi visto
      if (o.history[0] && o.history[0].at.getTime() > t) continue
      if (o.source !== 'MANUAL' && o.lastSeenAt.getTime() + FRESH_MS < t) continue
      const h = [...o.history].reverse().find((p) => p.at.getTime() <= t)
      if (h?.available) min = min === null ? numReq(h.price) : Math.min(min, numReq(h.price))
    }
    if (min !== null && out[out.length - 1]?.price !== min) out.push({ at: new Date(t), price: min })
  }
  return out
}

/** Mini-gráfico de uma loja (120×32), na mesma janela de tempo do gráfico grande. */
export function sparkline(points: Point[], since: Date, now: Date) {
  if (!points.length) return null
  const x0 = Math.max(since.getTime(), points[0]!.at.getTime())
  const x1 = now.getTime()
  // Menos de 2 h de dado não diz nada sobre a loja ("preço estável" depois de meia hora seria exagero).
  if (x1 - x0 < 2 * 3_600_000) return null
  const prices = points.map((p) => p.price)
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const flat = hi - lo < 0.01
  const X = (t: number) => 2 + ((Math.max(t, x0) - x0) / (x1 - x0)) * 116
  const Y = (v: number) => (flat ? 16 : 4 + (1 - (v - lo) / (hi - lo)) * 24)
  let d = `M${X(points[0]!.at.getTime()).toFixed(1)},${Y(prices[0]!).toFixed(1)}`
  for (let i = 1; i < points.length; i++) d += ` H${X(points[i]!.at.getTime()).toFixed(1)} V${Y(prices[i]!).toFixed(1)}`
  d += ` H118`
  return { d, endY: Y(prices[prices.length - 1]!), lo, hi, flat }
}

// ── Rotas ──────────────────────────────────────────────────────────────────────────────────────

/** Página 404 da vitrine, com alguns itens de verdade para a pessoa seguir navegando. */
export async function renderNotFound(request: FastifyRequest, reply: FastifyReply, kind: 'page' | 'item' = 'page') {
  const items = await prisma.watchItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
  const suggestions = sortCards(await loadProductCards(items), 'relevancia').filter((c) => c.best).slice(0, 5)
  return render(reply.code(404), 'not-found.njk', {
    ...(await baseContext()),
    kind,
    suggestions,
    page: { title: kind === 'item' ? 'Item não encontrado' : 'Página não encontrada', path: request.url },
  })
}

export async function siteRoutes(app: FastifyInstance) {
  // Navegadores pedem /favicon.ico por conta própria (ex.: na página 404); o ícone de verdade é o SVG.
  app.get('/favicon.ico', async (_req, reply) => reply.redirect('/static/favicon.svg', 301))

  app.get('/robots.txt', async (_req, reply) => {
    const settings = await getSettings()
    const body = settings.allowIndexing && settings.publicSite
      ? `User-agent: *\nDisallow: /painel\nDisallow: /api/\nDisallow: /ir/\nSitemap: ${publicUrl}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n'
    return reply.type('text/plain; charset=utf-8').send(body)
  })

  app.get('/sitemap.xml', async (_req, reply) => {
    const [items, products] = await Promise.all([
      prisma.watchItem.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } }),
      // Só produto com oferta de agora: página de produto sem preço é página vazia para o Google.
      prisma.product.findMany({
        where: { offers: { some: freshWhere() } },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 45_000,
      }),
    ])
    const urls = [
      `<url><loc>${publicUrl}/</loc></url>`,
      ...items.map((i) => `<url><loc>${publicUrl}/ofertas/${i.slug}</loc><lastmod>${i.updatedAt.toISOString()}</lastmod></url>`),
      ...products.map((p) => `<url><loc>${publicUrl}/produtos/${p.slug}</loc><lastmod>${p.updatedAt.toISOString()}</lastmod></url>`),
    ]
    return reply
      .type('application/xml; charset=utf-8')
      .send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`)
  })

  app.get<{ Querystring: { q?: string; cat?: string; promo?: string; ordem?: string } }>('/', async (request, reply) => {
    if (!(await gate(request, reply))) return reply
    const base = await baseContext()

    const [items, stores, offerCount, lastRun, dealTotal] = await Promise.all([
      prisma.watchItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.store.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.offer.count({ where: freshWhere() }),
      prisma.collectorRun.findFirst({ where: { status: { in: ['OK', 'PARTIAL'] } }, orderBy: { startedAt: 'desc' } }),
      prisma.offer.count({ where: { ...freshWhere(), isDeal: true } }),
    ])
    const cards = await loadProductCards(items)

    // Estado da listagem, só com valores conhecidos (o resto da URL é ignorado).
    const categories = [...new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    const qRaw = String(request.query.q ?? '').trim().slice(0, 80)
    const state: ShopState = {
      q: qRaw,
      cat: categories.includes(String(request.query.cat ?? '')) ? String(request.query.cat) : '',
      promo: request.query.promo === '1',
      ordem: (Object.keys(ORDERS) as Order[]).includes(request.query.ordem as Order) ? (request.query.ordem as Order) : 'relevancia',
    }
    const qTerms = normalize(state.q).split(' ').filter(Boolean)
    const matches = (c: ProductCardVM) => {
      if (state.cat && c.category !== state.cat) return false
      if (state.promo && !c.isDeal) return false
      if (qTerms.length) {
        const hay = ` ${normalize(`${c.name} ${c.category ?? ''} ${c.storeNames.join(' ')}`)} `
        return qTerms.every((t) => hay.includes(t))
      }
      return true
    }
    const shown = sortCards(cards.filter(matches), state.ordem)
    const filtered = Boolean(state.q || state.cat || state.promo)

    // As seções de baixo ("como funciona" e selos) contam a história de UM item real.
    const withOffers = cards.filter((c) => c.best)
    const story = [...withOffers].sort((a, b) => b.storeCount - a.storeCount || b.offerCount - a.offerCount)[0] ?? null
    const inflatedExample = withOffers.map((i) => i.inflated).find(Boolean) ?? null

    const autoStores = stores.filter((s) => s.adapter !== 'MANUAL')
    const offersByStore = await prisma.offer.groupBy({ by: ['storeId'], where: freshWhere(), _count: true })
    const storeCounts = new Map(offersByStore.map((r) => [r.storeId, r._count]))
    const rejects = ((lastRun?.rejects ?? []) as { store: string; item: string; title: string; price: number; reason: string }[])
      // um por motivo, para mostrar a variedade do filtro
      .filter((r, i, all) => all.findIndex((x) => x.reason.replace(/"[^"]*"|\([^)]*\)/g, '') === r.reason.replace(/"[^"]*"|\([^)]*\)/g, '')) === i)
      .slice(0, 5)

    return render(reply, 'home.njk', {
      ...base,
      useMoments: true,
      jsonLd: siteLd({ name: base.site.title, url: publicUrl }).map(jsonLdScript),
      page: {
        title: `${base.site.title}: menores preços conferidos em ${autoStores.length} lojas`,
        description: `O ${base.site.title} confere de hora em hora o preço dos itens que acompanha em ${autoStores.length} lojas confiáveis e mostra só o desconto real, contra o histórico.`,
        path: '/',
      },
      shop: {
        state,
        cards: shown,
        total: cards.length,
        filtered,
        orders: (Object.keys(ORDERS) as Order[]).map((id) => ({ id, label: ORDERS[id], selected: id === state.ordem })),
        chips: [
          { label: 'Todos', href: shopHref(state, { cat: '', promo: false }), active: !state.cat && !state.promo, count: cards.length },
          { label: 'Promoções de verdade', href: shopHref(state, { promo: !state.promo }), active: state.promo, count: cards.filter((c) => c.isDeal).length },
          ...categories.map((c) => ({
            label: c,
            href: shopHref(state, { cat: state.cat === c ? '' : c }),
            active: state.cat === c,
            count: cards.filter((x) => x.category === c).length,
          })),
        ],
        clearHref: shopHref(state, { q: '', cat: '', promo: false }),
      },
      story: story
        ? { ...story, byStore: [...story.byStore].sort((a, b) => a.price - b.price).slice(0, 5) }
        : null,
      inflatedExample,
      rejects,
      // As lojas que responderam, das que mais trouxeram ofertas para as que menos.
      stores: stores
        .map((s) => ({
          id: s.id,
          name: s.name,
          trustNote: s.trustNote,
          auto: s.adapter !== 'MANUAL',
          ok: Boolean(s.lastOkAt && (!s.lastErrorAt || s.lastOkAt >= s.lastErrorAt)),
          offers: storeCounts.get(s.id) ?? 0,
        }))
        .sort((a, b) => b.offers - a.offers),
      marquee: autoStores.slice(0, 14).map((s) => s.name),
      manualStores: stores.filter((s) => s.adapter === 'MANUAL').map((s) => s.name),
      counts: {
        items: items.length,
        offers: offerCount,
        deals: dealTotal,
        stores: stores.length,
        autoStores: autoStores.length,
      },
    })
  })

  app.get<{ Params: { slug: string }; Querystring: { dias?: string; alerta?: string } }>('/ofertas/:slug', async (request, reply) => {
    if (!(await gate(request, reply))) return reply
    const item = await prisma.watchItem.findUnique({ where: { slug: request.params.slug } })
    if (!item || !item.active) return renderNotFound(request, reply, 'item')
    const base = await baseContext()
    const now = new Date()
    const days = [7, 30, 90].includes(Number(request.query.dias)) ? Number(request.query.dias) : 30
    const since = new Date(now.getTime() - days * DAY)

    const [offers, stores, snaps, lastRun, others] = await Promise.all([
      prisma.offer.findMany({
        where: { watchItemId: item.id, hidden: false, store: { enabled: true } },
        include: { store: true, watchItem: true, product: { select: { slug: true, name: true, gtin: true } }, history: { orderBy: { at: 'asc' } } },
      }),
      prisma.store.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.itemSnapshot.findMany({
        where: { watchItemId: item.id, at: { gte: new Date(now.getTime() - 90 * DAY) }, minPrice: { not: null } },
        orderBy: { at: 'asc' },
      }),
      prisma.collectorRun.findFirst({ where: { status: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' } }),
      prisma.watchItem.findMany({ where: { active: true, id: { not: item.id } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ])

    const current = offers.filter((o) => isCurrent(o, now))
    const avail = current.filter((o) => o.available).sort(byPrice)
    const cards = avail.map(cardVM)
    const best = cards[0] ?? null
    const storeName = new Map(stores.map((s) => [s.id, s.name]))

    // ── Histórico: o menor preço entre as lojas, uma foto por coleta ──
    const allPoints: Point[] = snaps.map((s) => ({ at: s.at, price: numReq(s.minPrice!), storeId: s.minStoreId }))
    // "Preço típico" com poucas horas de dado seria só o preço de agora com outro nome: só a partir de 1 dia.
    const tracked = allPoints.length ? now.getTime() - allPoints[0]!.at.getTime() : 0
    const typical = tracked >= DAY
      ? typicalPrice(
          allPoints.filter((p) => p.at.getTime() >= now.getTime() - 30 * DAY).map((p) => ({ at: p.at, price: p.price, available: true })),
          now
        )
      : null
    // O valor que valia no começo da janela entra como primeiro ponto, para a linha começar na borda.
    const before = [...allPoints].reverse().find((p) => p.at < since)
    const inWindow = allPoints.filter((p) => p.at >= since)
    const seq = [...(before ? [{ ...before, at: since }] : []), ...inWindow]
    // Só os pontos em que o preço mudou: a linha em degrau e a tabela ficam iguais, e mais leves.
    const changes = seq.filter((p, i) => i === 0 || p.price !== seq[i - 1]!.price || p.storeId !== seq[i - 1]!.storeId)
    // Gráfico a partir da 2ª coleta, mesmo que o preço não tenha mudado (aí é uma linha reta, e isso é informação).
    const chart = seq.length >= 2 ? historyChart(changes, now, typical, days) : null
    const prices = seq.map((p) => p.price)
    const lowest = seq.length ? seq[prices.indexOf(Math.min(...prices))]! : null
    const highest = seq.length ? Math.max(...prices) : null

    // ── Todas as lojas pesquisadas, com a situação de cada uma ──
    const runErrors = ((lastRun?.errors ?? []) as { store?: string; item?: string; message?: string }[])
      .filter((e) => e.item === item.name && e.store)
    const rows = stores.flatMap((store) => {
      const auto = store.adapter !== 'MANUAL'
      if (auto && item.storeIds.length && !item.storeIds.includes(store.id)) return []
      const mine = offers.filter((o) => o.storeId === store.id)
      const cur = current.filter((o) => o.storeId === store.id)
      const ok = cur.filter((o) => o.available).sort(byPrice)
      const soldOut = cur.filter((o) => !o.available).sort(byPrice)
      const status = ok.length ? 'ok' : soldOut.length ? 'esgotado' : !auto ? 'manual' : runErrors.some((e) => e.store === store.name) ? 'erro' : 'nada'
      const spark = mine.length ? sparkline(storeSeries(mine, since, now), since, now) : null
      const lows = mine.filter((o) => o.lowestPriceAt >= since)
      return [{
        id: store.id,
        name: store.name,
        trustNote: store.trustNote,
        status,
        best: ok[0] ? cardVM(ok[0]) : null,
        lastPrice: soldOut[0] ? numReq(soldOut[0].price) : null,
        offers: [...ok, ...soldOut].map(cardVM),
        isBest: Boolean(best && ok[0] && ok[0].id === best.id),
        diff: best && ok[0] ? numReq(ok[0].price) - best.price : null,
        low: lows.length ? Math.min(...lows.map((o) => numReq(o.lowestPrice))) : null,
        spark,
      }]
    })
    const rank = { ok: 0, esgotado: 1, nada: 2, erro: 3, manual: 4 } as Record<string, number>
    rows.sort((a, b) => rank[a.status]! - rank[b.status]! || (a.best?.price ?? 0) - (b.best?.price ?? 0))
    const withOffer = rows.filter((r) => r.status === 'ok')
    const without = rows.filter((r) => r.status !== 'ok')

    // Fotos: uma por imagem diferente, dos anúncios disponíveis do mais barato ao mais caro.
    const images = [...new Set([...avail, ...current].map((o) => o.imageUrl).filter((u): u is string => Boolean(u)))].slice(0, 6)

    // Outros itens: os da mesma categoria primeiro.
    const relatedItems = [...others].sort((a, b) => Number(b.category === item.category) - Number(a.category === item.category)).slice(0, 5)
    const related = sortCards(await loadProductCards(relatedItems), 'relevancia')

    const typicalOff = best && typical && best.price < typical ? 1 - best.price / typical : null

    // ── Catálogo e dados estruturados ──
    // Produtos (mesmo EAN) entre os anúncios de agora, do mais barato para o mais caro.
    const products = [...new Map(avail.filter((o) => o.product).map((o) => [o.product!.slug, o.product!])).values()]
    const pageUrl = `${publicUrl}/ofertas/${item.slug}`
    const onlyProduct = products.length === 1 && avail.every((o) => o.productId === avail[0]!.productId) ? products[0]! : null
    const ld = itemLd({
      name: item.name,
      url: pageUrl,
      images,
      category: item.category,
      gtin: onlyProduct ? displayGtin(onlyProduct.gtin) : null,
      offers: avail.map((o) => ({ price: numReq(o.price), storeName: o.store.name, available: o.available })),
      brands: avail.map((o) => o.brand ?? '').filter(Boolean),
      products: products.map((p) => ({ name: p.name, url: `${publicUrl}/produtos/${p.slug}` })),
    })
    const crumbs = [
      { name: 'Início', url: `${publicUrl}/` },
      ...(item.category ? [{ name: item.category, url: `${publicUrl}/?cat=${encodeURIComponent(item.category)}` }] : []),
      { name: item.name, url: pageUrl },
    ]

    return render(reply, 'item.njk', {
      ...base,
      jsonLd: [...(ld ? [ld] : []), breadcrumbLd(crumbs)].map(jsonLdScript),
      alertBox: await alertBoxVM({ kind: 'item', slug: item.slug, code: request.query.alerta, bestPrice: best?.price ?? null }),
      catalog: products.slice(0, 8).map((p) => ({ name: p.name, href: `/produtos/${p.slug}` })),
      page: {
        title: `${item.name}: menor preço agora e histórico — ${base.site.title}`,
        description: best
          ? `${item.name} a partir de ${best.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} na ${best.storeName}. Preço conferido de hora em hora em ${rows.filter((r) => r.status !== 'manual').length} lojas, com histórico.`
          : `Acompanhamos o preço de ${item.name} de hora em hora em lojas confiáveis.`,
        path: `/ofertas/${item.slug}`,
      },
      item: { name: item.name, slug: item.slug, category: item.category, targetPrice: num(item.targetPrice), lastRunAt: item.lastRunAt },
      best,
      bestFlags: best?.flags.filter((f) => f.id !== 'mais-barato') ?? [],
      images,
      off: best ? Math.max(best.realOff ?? 0, best.listOff ?? 0) || null : null,
      typicalOff,
      offerCount: cards.length,
      stores: {
        rows,
        withOffer,
        without,
        searched: rows.filter((r) => r.status !== 'manual').length,
      },
      history: {
        days,
        ranges: [7, 30, 90].map((d) => ({ days: d, href: `/ofertas/${item.slug}${d === 30 ? '' : `?dias=${d}`}#historico`, active: d === days })),
        chart,
        chartData: chart ? JSON.stringify(chart.data.map((d) => ({ ...d, s: d.s ? storeName.get(d.s) ?? null : null }))) : null,
        typical,
        lowest: lowest ? { price: lowest.price, at: lowest.at, store: lowest.storeId ? storeName.get(lowest.storeId) ?? null : null } : null,
        highest,
        since: allPoints[0]?.at ?? null,
        // Tabela: as mudanças, da mais nova para a mais antiga.
        table: changes
          .map((p) => ({ at: p.at, price: p.price, store: p.storeId ? storeName.get(p.storeId) ?? '' : '' }))
          .reverse()
          .slice(0, 60),
      },
      related,
    })
  })
}
