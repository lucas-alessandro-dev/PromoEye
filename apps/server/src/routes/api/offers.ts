import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { manualOfferInput, offerUpdateInput } from '@promoeye/shared'
import { num, numReq, prisma, type Prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { draftForBestDeal, FRESH_MS } from '../../collector/run.js'
import { messageDTO, offerDTO } from '../../services/dto.js'

const include = {
  store: true,
  watchItem: { select: { id: true, name: true } },
  _count: { select: { clicks: true } },
} as const

const listQuery = z.object({
  itemId: z.string().optional(),
  storeId: z.string().optional(),
  deals: z.enum(['0', '1']).optional(),
  hidden: z.enum(['0', '1']).optional(),
  fresh: z.enum(['0', '1']).default('1'),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function offerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/offers', async (request) => {
    const q = listQuery.parse(request.query)
    const and: Prisma.OfferWhereInput[] = []
    if (q.itemId) and.push({ watchItemId: q.itemId })
    if (q.storeId) and.push({ storeId: q.storeId })
    if (q.deals === '1') and.push({ isDeal: true })
    if (q.hidden !== '1') and.push({ hidden: false })
    if (q.fresh === '1') {
      and.push({ OR: [{ source: 'MANUAL' }, { lastSeenAt: { gte: new Date(Date.now() - FRESH_MS) } }] })
    }
    if (q.q) and.push({ title: { contains: q.q, mode: 'insensitive' } })
    const where: Prisma.OfferWhereInput = { AND: and }
    const [rows, total] = await Promise.all([
      prisma.offer.findMany({
        where,
        include,
        orderBy: [{ pinned: 'desc' }, { isDeal: 'desc' }, { score: 'desc' }, { price: 'asc' }],
        take: q.limit,
        skip: q.offset,
      }),
      prisma.offer.count({ where }),
    ])
    return { rows: rows.map(offerDTO), total }
  })

  app.patch<{ Params: { id: string } }>('/offers/:id', async (request, reply) => {
    const input = parse(offerUpdateInput, request.body, reply)
    if (!input) return reply
    const exists = await prisma.offer.findUnique({ where: { id: request.params.id } })
    if (!exists) return reply.code(404).send({ error: 'Oferta não encontrada.' })
    const updated = await prisma.offer.update({
      where: { id: exists.id },
      data: {
        ...(input.affiliateUrl !== undefined ? { affiliateUrl: input.affiliateUrl } : {}),
        ...(input.hidden !== undefined ? { hidden: input.hidden, ...(input.hidden ? { isDeal: false } : {}) } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      },
      include,
    })
    return offerDTO(updated)
  })

  app.delete<{ Params: { id: string } }>('/offers/:id', async (request, reply) => {
    // Rascunho (ou mensagem na fila) de uma oferta que não existe mais não deve
    // ir para o grupo. As já enviadas ficam (com offerId nulo) como histórico.
    await prisma.$transaction([
      prisma.outboundMessage.deleteMany({ where: { offerId: request.params.id, status: { in: ['DRAFT', 'QUEUED'] } } }),
      prisma.offer.deleteMany({ where: { id: request.params.id } }),
    ])
    return reply.code(204).send()
  })

  app.get<{ Params: { id: string } }>('/offers/:id/history', async (request) => {
    const points = await prisma.pricePoint.findMany({
      where: { offerId: request.params.id },
      orderBy: { at: 'asc' },
      take: 2000,
    })
    return points.map((p) => ({ at: p.at.toISOString(), price: numReq(p.price), listPrice: num(p.listPrice), available: p.available }))
  })

  /**
   * Oferta manual: Mercado Livre, Magalu e Casas Bahia bloqueiam robôs, então
   * o achado entra por aqui, com o link de afiliado gerado no programa da loja.
   * Recebe selos básicos na hora; os de histórico vêm nas próximas coletas.
   */
  app.post('/offers/manual', async (request, reply) => {
    const input = parse(manualOfferInput, request.body, reply)
    if (!input) return reply
    const [item, store] = await Promise.all([
      prisma.watchItem.findUnique({ where: { id: input.watchItemId } }),
      prisma.store.findUnique({ where: { id: input.storeId } }),
    ])
    if (!item) return reply.code(400).send({ error: 'Item não encontrado.' })
    if (!store) return reply.code(400).send({ error: 'Loja não encontrada.' })

    const now = new Date()
    const externalId = `manual-${Buffer.from(input.url).toString('base64url').slice(-40)}`
    const target = num(item.targetPrice)
    const flags = target !== null && input.price <= target ? ['abaixo-do-alvo'] : []
    const data = {
      title: input.title,
      url: input.url,
      imageUrl: input.imageUrl,
      affiliateUrl: input.affiliateUrl,
      sellerName: input.sellerName || store.name,
      soldByStore: !input.sellerName,
      price: input.price,
      listPrice: input.listPrice,
      available: true,
      lastSeenAt: now,
      lastChangeAt: now,
      flags,
      isDeal: flags.length > 0,
      dealSince: flags.length ? now : null,
      score: flags.length ? 60 : 40,
    }
    const offer = await prisma.offer.upsert({
      where: { watchItemId_storeId_externalId: { watchItemId: item.id, storeId: store.id, externalId } },
      create: {
        ...data,
        source: 'MANUAL',
        watchItemId: item.id,
        storeId: store.id,
        externalId,
        lowestPrice: input.price,
        highestPrice: input.price,
        history: { create: { price: input.price, listPrice: input.listPrice, available: true } },
      },
      update: { ...data, history: { create: { price: input.price, listPrice: input.listPrice, available: true } } },
      include,
    })
    return reply.code(201).send(offerDTO(offer))
  })

  app.post<{ Params: { id: string } }>('/offers/:id/message', async (request, reply) => {
    const offer = await prisma.offer.findUnique({ where: { id: request.params.id }, include: { watchItem: true } })
    if (!offer) return reply.code(404).send({ error: 'Oferta não encontrada.' })
    await draftForBestDeal(offer.watchItem, offer.id, { force: true })
    const msg = await prisma.outboundMessage.findFirst({
      where: { offerId: offer.id },
      orderBy: { createdAt: 'desc' },
      include: { offer: { include: { store: { select: { name: true } } } } },
    })
    return reply.code(201).send(msg ? messageDTO(msg) : null)
  })
}
