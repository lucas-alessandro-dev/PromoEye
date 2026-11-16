import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { daysUntilBlackFriday, flagTone, listDiscount } from '@promoeye/shared'
import type { Offer, Store, WatchItem } from '@prisma/client'
import { publicUrl } from '../config.js'
import { num, numReq, prisma } from '../lib/prisma.js'
import { render } from '../lib/render.js'
import { currentUser } from '../plugins/auth.js'
import { FRESH_MS } from '../collector/run.js'
import { nextRunAt } from '../collector/scheduler.js'
import { getSettings } from '../services/settings.js'

/**
 * Vitrine pública. Tudo aqui é lido do banco; nenhuma página dispara busca
 * nas lojas (isso é trabalho do coletor, de hora em hora).
 */

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
  sellerName: string | null
  promoLabel: string | null
  isDeal: boolean
  lastSeenAt: Date
}

type OfferFull = Offer & { store: Store; watchItem: WatchItem }

const FLAG_ORDER = ['abaixo-do-alvo', 'menor-preco', 'mais-barato', 'desconto-real', 'caiu-agora', 'oferta-relampago', 'preco-de-inflado', 'subiu-antes']

export function cardVM(o: OfferFull): CardVM {
  const price = numReq(o.price)
  const listPrice = num(o.listPrice)
  const inflated = o.flags.includes('preco-de-inflado')
  const off = listDiscount(price, listPrice)
  const flags = FLAG_ORDER.filter((f) => o.flags.includes(f)).map((id) => ({ id, tone: flagTone(id) }))
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
    showList: Boolean(listPrice && off && off >= 0.03 && !inflated),
    listOff: off,
    realOff: o.realDiscountPct && o.realDiscountPct >= 0.03 ? o.realDiscountPct : null,
    flags,
    warn: flags.some((f) => f.tone === 'warn'),
    installments: o.installments,
    sellerName: o.soldByStore ? null : o.sellerName,
    promoLabel: o.promoLabel,
    isDeal: o.isDeal,
    lastSeenAt: o.lastSeenAt,
  }
}

const freshWhere = () => ({
  hidden: false,
  available: true,
  store: { enabled: true },
  watchItem: { active: true },
  OR: [{ source: 'MANUAL' as const }, { lastSeenAt: { gte: new Date(Date.now() - FRESH_MS) } }],
})

async function gate(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const settings = await getSettings()
  if (settings.publicSite) return true
  if (await currentUser(request)) return true
  reply.redirect('/painel', 302)
  return false
}

async function baseContext() {
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
    year: new Date().getFullYear(),
  }
}

/** Linha em degrau do menor preço por coleta, desenhada no servidor (SVG). */
function priceChart(points: { at: Date; price: number }[], width = 720, height = 220) {
  if (points.length < 2) return null
  const pad = { l: 8, r: 8, t: 16, b: 16 }
  const xs = points.map((p) => p.at.getTime())
  const ys = points.map((p) => p.price)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  // Folga em cima e embaixo: a linha nunca encosta no chão nem no teto do gráfico.
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const span = Math.max(hi - lo, hi * 0.04)
  const y0 = lo - span * 0.35
  const y1 = hi + span * 0.15
  const X = (t: number) => pad.l + ((t - x0) / Math.max(1, x1 - x0)) * (width - pad.l - pad.r)
  const Y = (v: number) => pad.t + (1 - (v - y0) / Math.max(1, y1 - y0)) * (height - pad.t - pad.b)
  let d = `M${X(xs[0]!).toFixed(1)},${Y(ys[0]!).toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    d += ` H${X(xs[i]!).toFixed(1)} V${Y(ys[i]!).toFixed(1)}`
  }
  const minIdx = ys.indexOf(Math.min(...ys))
  return {
    width,
    height,
    d,
    area: `${d} V${height - pad.b} H${X(xs[0]!).toFixed(1)} Z`,
    min: { x: X(xs[minIdx]!), y: Y(ys[minIdx]!), price: ys[minIdx]!, at: points[minIdx]!.at },
    last: { x: X(xs[xs.length - 1]!), y: Y(ys[ys.length - 1]!), price: ys[ys.length - 1]! },
    low: Math.min(...ys),
    high: Math.max(...ys),
    from: new Date(x0),
    to: new Date(x1),
  }
}

export async function siteRoutes(app: FastifyInstance) {
  app.get('/robots.txt', async (_req, reply) => {
    const settings = await getSettings()
    const body = settings.allowIndexing && settings.publicSite
      ? `User-agent: *\nDisallow: /painel\nDisallow: /api/\nDisallow: /ir/\nSitemap: ${publicUrl}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n'
    return reply.type('text/plain; charset=utf-8').send(body)
  })

  app.get('/sitemap.xml', async (_req, reply) => {
    const items = await prisma.watchItem.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } })
    const urls = [`<url><loc>${publicUrl}/</loc></url>`, ...items.map((i) => `<url><loc>${publicUrl}/ofertas/${i.slug}</loc><lastmod>${i.updatedAt.toISOString()}</lastmod></url>`)]
    return reply
      .type('application/xml; charset=utf-8')
      .send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`)
  })

  app.get('/', async (request, reply) => {
    if (!(await gate(request, reply))) return reply
    const base = await baseContext()
    const include = { store: true, watchItem: true } as const

    const [items, deals, stores, offerCount, lastRun, dealTotal] = await Promise.all([
      prisma.watchItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.offer.findMany({
        where: { ...freshWhere(), isDeal: true },
        include,
        orderBy: [{ pinned: 'desc' }, { score: 'desc' }],
        take: 40,
      }),
      prisma.store.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.offer.count({ where: freshWhere() }),
      prisma.collectorRun.findFirst({ where: { status: { in: ['OK', 'PARTIAL'] } }, orderBy: { startedAt: 'desc' } }),
      prisma.offer.count({ where: { ...freshWhere(), isDeal: true } }),
    ])

    // Por item: as ofertas de agora, da mais barata à mais cara.
    const itemsVM = await Promise.all(
      items.map(async (item) => {
        const where = { ...freshWhere(), watchItemId: item.id }
        const [offers, count, storesWith, inflated] = await Promise.all([
          prisma.offer.findMany({ where, include, orderBy: [{ price: 'asc' }], take: 6 }),
          prisma.offer.count({ where }),
          prisma.offer.groupBy({ by: ['storeId'], where, _min: { price: true } }),
          prisma.offer.findFirst({
            where: { ...where, flags: { has: 'preco-de-inflado' } },
            include,
            orderBy: { listPrice: 'desc' },
          }),
        ])
        const cards = offers.map(cardVM)
        return {
          id: item.id,
          name: item.name,
          slug: item.slug,
          category: item.category,
          targetPrice: num(item.targetPrice),
          best: cards[0] ?? null,
          offers: cards,
          offerCount: count,
          storeCount: storesWith.length,
          dealCount: cards.filter((c) => c.isDeal).length,
          inflated: inflated ? cardVM(inflated) : null,
          // o menor preço de cada loja: a comparação "entre lojas" do passo 3
          byStore: storesWith
            .map((g) => ({ storeId: g.storeId, price: num(g._min.price) ?? 0 }))
            .sort((a, b) => a.price - b.price),
        }
      })
    )
    const withOffers = itemsVM.filter((i) => i.best)

    // Variedade primeiro (até duas por item); depois completa até 5 com as de maior pontuação.
    const perItem = new Map<string, number>()
    const picked = new Set<string>()
    const topDeals: CardVM[] = []
    for (const d of deals) {
      const n = perItem.get(d.watchItemId) ?? 0
      if (n >= 2) continue
      perItem.set(d.watchItemId, n + 1)
      picked.add(d.id)
      topDeals.push(cardVM(d))
      if (topDeals.length >= 5) break
    }
    for (const d of deals) {
      if (topDeals.length >= 5) break
      if (!picked.has(d.id)) topDeals.push(cardVM(d))
    }
    const dealItems = new Set(deals.map((d) => d.watchItemId)).size

    // O cartão do herói conta a história de UM item real: em quantas lojas
    // foi conferido, que preço "de" foi desmascarado, quem tem o menor preço.
    const story = [...withOffers].sort((a, b) => b.storeCount - a.storeCount || b.offerCount - a.offerCount)[0] ?? null

    // Oferta com preço "de" inflado para a aba que explica o selo (real, quando há).
    const inflatedExample = withOffers.map((i) => i.inflated).find(Boolean) ?? null

    const autoStores = stores.filter((s) => s.adapter !== 'MANUAL')
    const offersByStore = await prisma.offer.groupBy({ by: ['storeId'], where: freshWhere(), _count: true })
    const storeCounts = new Map(offersByStore.map((r) => [r.storeId, r._count]))
    const rejects = ((lastRun?.rejects ?? []) as { store: string; item: string; title: string; price: number; reason: string }[])
      // um por motivo, para o painel mostrar a variedade do filtro
      .filter((r, i, all) => all.findIndex((x) => x.reason.replace(/"[^"]*"|\([^)]*\)/g, '') === r.reason.replace(/"[^"]*"|\([^)]*\)/g, '')) === i)
      .slice(0, 5)

    return render(reply, 'home.njk', {
      ...base,
      useMoments: true,
      page: {
        title: `${base.site.title}: promoções de Black Friday conferidas em ${autoStores.length} lojas`,
        description: `O ${base.site.title} confere de hora em hora o preço dos itens que acompanha em ${autoStores.length} lojas confiáveis e mostra só o desconto real, contra o histórico.`,
        path: '/',
      },
      items: itemsVM,
      itemsWithOffers: withOffers,
      deals: topDeals,
      story: story
        ? {
            ...story,
            byStore: story.byStore.slice(0, 5).map((b) => ({ ...b, storeName: stores.find((s) => s.id === b.storeId)?.name ?? b.storeId })),
          }
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
        dealItems,
        stores: stores.length,
        autoStores: autoStores.length,
      },
    })
  })

  app.get<{ Params: { slug: string } }>('/ofertas/:slug', async (request, reply) => {
    if (!(await gate(request, reply))) return reply
    const item = await prisma.watchItem.findUnique({ where: { slug: request.params.slug } })
    if (!item || !item.active) {
      return render(reply.code(404), 'not-found.njk', { ...(await baseContext()), page: { title: 'Página não encontrada', path: request.url } })
    }
    const base = await baseContext()

    const [offers, snaps] = await Promise.all([
      prisma.offer.findMany({
        where: { ...freshWhere(), watchItemId: item.id },
        include: { store: true, watchItem: true },
        orderBy: [{ price: 'asc' }],
        take: 60,
      }),
      prisma.itemSnapshot.findMany({
        where: { watchItemId: item.id, at: { gte: new Date(Date.now() - 30 * 86_400_000) }, minPrice: { not: null } },
        orderBy: { at: 'asc' },
      }),
    ])
    const cards = offers.map(cardVM)
    const chart = priceChart(snaps.map((s) => ({ at: s.at, price: numReq(s.minPrice!) })))

    return render(reply, 'item.njk', {
      ...base,
      page: {
        title: `${item.name}: menor preço agora em lojas confiáveis — ${base.site.title}`,
        description: cards[0]
          ? `${item.name} a partir de ${cards[0].price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} na ${cards[0].storeName}. Preço conferido de hora em hora e comparado com o histórico.`
          : `Acompanhamos o preço de ${item.name} de hora em hora em lojas confiáveis.`,
        path: `/ofertas/${item.slug}`,
      },
      item: { name: item.name, slug: item.slug, targetPrice: num(item.targetPrice), lastRunAt: item.lastRunAt },
      best: cards[0] ?? null,
      offers: cards,
      storeCount: new Set(cards.map((c) => c.storeId)).size,
      chart,
    })
  })
}
