import type { FastifyInstance } from 'fastify'
import { displayGtin } from '@promoeye/shared'
import { publicUrl } from '../config.js'
import { numReq, prisma } from '../lib/prisma.js'
import { render } from '../lib/render.js'
import { breadcrumbLd, jsonLdScript, productLd } from '../lib/jsonld.js'
import { typicalPrice } from '../collector/scoring.js'
import { alertBoxVM } from './alerts.js'
import { baseContext, byPrice, cardVM, gate, historyChart, isCurrent, renderNotFound, sparkline, storeSeries, type Point } from './site.js'

/**
 * /produtos/:slug — um produto do catálogo (o mesmo EAN em várias lojas).
 *
 * Diferente da página de item (/ofertas/:slug), que junta tudo o que casou
 * com uma busca, aqui é UM modelo: a comparação é exata, o JSON-LD leva o
 * EAN, e é esta a URL que o Google deve indexar para "preço de <modelo>".
 */

const DAY = 86_400_000

export async function productRoutes(app: FastifyInstance) {
  app.get<{ Params: { slug: string }; Querystring: { dias?: string; alerta?: string } }>('/produtos/:slug', async (request, reply) => {
    if (!(await gate(request, reply))) return reply
    const product = await prisma.product.findUnique({ where: { slug: request.params.slug } })
    if (!product) return renderNotFound(request, reply, 'item')
    const base = await baseContext()
    const now = new Date()
    const days = [7, 30, 90].includes(Number(request.query.dias)) ? Number(request.query.dias) : 30
    const since = new Date(now.getTime() - days * DAY)

    const offers = await prisma.offer.findMany({
      where: { productId: product.id, hidden: false, store: { enabled: true }, watchItem: { active: true } },
      include: { store: true, watchItem: true, product: { select: { slug: true } }, history: { orderBy: { at: 'asc' } } },
    })
    const current = offers.filter((o) => isCurrent(o, now))
    const avail = current.filter((o) => o.available).sort(byPrice)
    const cards = avail.map(cardVM)
    const best = cards[0] ?? null

    // ── Uma linha por loja: o anúncio mais barato dela, com o mini-gráfico ──
    const storeIds = [...new Set(offers.map((o) => o.storeId))]
    const rows = storeIds
      .map((storeId) => {
        const mine = offers.filter((o) => o.storeId === storeId)
        const cur = current.filter((o) => o.storeId === storeId)
        const ok = cur.filter((o) => o.available).sort(byPrice)
        const soldOut = cur.filter((o) => !o.available).sort(byPrice)
        const store = mine[0]!.store
        return {
          id: storeId,
          name: store.name,
          trustNote: store.trustNote,
          status: ok.length ? 'ok' : soldOut.length ? 'esgotado' : 'antigo',
          best: ok[0] ? cardVM(ok[0]) : null,
          lastPrice: soldOut[0] ? numReq(soldOut[0].price) : mine.length ? numReq(mine[0]!.price) : null,
          offers: [...ok, ...soldOut].map(cardVM),
          isBest: Boolean(best && ok[0] && ok[0].id === best.id),
          diff: best && ok[0] ? numReq(ok[0].price) - best.price : null,
          spark: sparkline(storeSeries(mine, since, now), since, now),
        }
      })
      .sort((a, b) => ({ ok: 0, esgotado: 1, antigo: 2 })[a.status]! - ({ ok: 0, esgotado: 1, antigo: 2 })[b.status]! || (a.best?.price ?? 0) - (b.best?.price ?? 0))
    const withOffer = rows.filter((r) => r.status === 'ok')
    const without = rows.filter((r) => r.status !== 'ok')

    // ── Histórico: o menor preço entre as lojas, a partir do histórico de cada anúncio ──
    const allPoints: Point[] = storeSeries(offers, new Date(now.getTime() - 90 * DAY), now)
    const tracked = allPoints.length ? now.getTime() - allPoints[0]!.at.getTime() : 0
    const typical =
      tracked >= DAY
        ? typicalPrice(
            allPoints.filter((p) => p.at.getTime() >= now.getTime() - 30 * DAY).map((p) => ({ at: p.at, price: p.price, available: true })),
            now
          )
        : null
    const before = [...allPoints].reverse().find((p) => p.at < since)
    const seq = [...(before ? [{ ...before, at: since }] : []), ...allPoints.filter((p) => p.at >= since)]
    const chart = seq.length >= 2 ? historyChart(seq, now, typical, days) : null
    const prices = seq.map((p) => p.price)
    const lowest = seq.length ? seq[prices.indexOf(Math.min(...prices))]! : null
    const typicalOff = best && typical && best.price < typical ? 1 - best.price / typical : null

    const images = [...new Set([product.imageUrl, ...avail.map((o) => o.imageUrl), ...current.map((o) => o.imageUrl)].filter((u): u is string => Boolean(u)))].slice(0, 6)
    const items = [...new Map(offers.map((o) => [o.watchItem.id, { name: o.watchItem.name, href: `/ofertas/${o.watchItem.slug}` }])).values()]
    const gtin = displayGtin(product.gtin)
    const pageUrl = `${publicUrl}/produtos/${product.slug}`

    const ld = productLd({
      name: product.name,
      url: pageUrl,
      images,
      brand: product.brand,
      gtin,
      category: product.category,
      offers: avail.map((o) => ({ price: numReq(o.price), storeName: o.store.name, available: true })),
    })
    const crumbs = [
      { name: 'Início', url: `${publicUrl}/` },
      ...(product.category ? [{ name: product.category, url: `${publicUrl}/?cat=${encodeURIComponent(product.category)}` }] : []),
      { name: product.name, url: pageUrl },
    ]

    return render(reply, 'product.njk', {
      ...base,
      jsonLd: [...(ld ? [ld] : []), breadcrumbLd(crumbs)].map(jsonLdScript),
      page: {
        title: `${product.name}: preço em ${withOffer.length || rows.length} ${withOffer.length === 1 ? 'loja' : 'lojas'} e histórico — ${base.site.title}`,
        description: best
          ? `${product.name} (EAN ${gtin}) a partir de ${best.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} na ${best.storeName}. O mesmo produto comparado em ${withOffer.length} ${withOffer.length === 1 ? 'loja' : 'lojas'}, com histórico de preço.`
          : `${product.name} (EAN ${gtin}): histórico de preço nas lojas que acompanhamos.`,
        path: `/produtos/${product.slug}`,
        // Sem preço de agora, a página não ajuda quem chega pela busca.
        noindex: !best,
      },
      product: { name: product.name, slug: product.slug, gtin, brand: product.brand, category: product.category },
      items,
      best,
      bestFlags: best?.flags.filter((f) => f.id !== 'mais-barato') ?? [],
      images,
      off: best ? Math.max(best.realOff ?? 0, best.listOff ?? 0) || null : null,
      typicalOff,
      stores: { rows, withOffer, without },
      history: {
        days,
        ranges: [7, 30, 90].map((d) => ({ days: d, href: `/produtos/${product.slug}${d === 30 ? '' : `?dias=${d}`}#historico`, active: d === days })),
        chart,
        chartData: chart ? JSON.stringify(chart.data.map((d) => ({ ...d, s: null }))) : null,
        typical,
        lowest: lowest ? { price: lowest.price, at: lowest.at } : null,
        highest: seq.length ? Math.max(...prices) : null,
        since: allPoints[0]?.at ?? null,
      },
      alertBox: await alertBoxVM({ kind: 'product', slug: product.slug, code: request.query.alerta, bestPrice: best?.price ?? null }),
    })
  })
}
