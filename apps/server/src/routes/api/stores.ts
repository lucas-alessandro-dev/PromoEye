import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { storeUpdateInput, type PreviewRow } from '@promoeye/shared'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { adapterFor } from '../../collector/adapters/index.js'
import { storeContext } from '../../collector/run.js'
import { storeDTO } from '../../services/dto.js'

export async function storeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/stores', async () => {
    const stores = await prisma.store.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { offers: true } } },
    })
    return stores.map(storeDTO)
  })

  app.patch<{ Params: { id: string } }>('/stores/:id', async (request, reply) => {
    const input = parse(storeUpdateInput, request.body, reply)
    if (!input) return reply
    const exists = await prisma.store.findUnique({ where: { id: request.params.id } })
    if (!exists) return reply.code(404).send({ error: 'Loja não encontrada.' })
    const updated = await prisma.store.update({
      where: { id: exists.id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.sellerPolicy !== undefined ? { sellerPolicy: input.sellerPolicy } : {}),
        ...(input.affiliateTemplate !== undefined ? { affiliateTemplate: input.affiliateTemplate } : {}),
        ...(input.trustNote !== undefined ? { trustNote: input.trustNote } : {}),
      },
      include: { _count: { select: { offers: true } } },
    })
    return storeDTO(updated)
  })

  /** Uma busca ao vivo só nesta loja — para saber se ela está respondendo. */
  app.post<{ Params: { id: string } }>('/stores/:id/test', async (request, reply) => {
    const body = parse(z.object({ query: z.string().trim().min(2).max(160) }), request.body, reply)
    if (!body) return reply
    const store = await prisma.store.findUnique({ where: { id: request.params.id } })
    if (!store) return reply.code(404).send({ error: 'Loja não encontrada.' })
    const adapter = adapterFor(storeContext(store))
    if (!adapter) {
      return { ok: false, count: 0, sample: [], message: 'Esta loja não tem coleta automática: as ofertas entram à mão.', tookMs: 0 }
    }
    const started = Date.now()
    try {
      const rows = await adapter.search(body.query, { limit: 12 })
      const sample: PreviewRow[] = rows.slice(0, 8).map((r) => ({
        storeId: store.id,
        storeName: store.name,
        title: r.title,
        url: r.url,
        imageUrl: r.imageUrl,
        price: r.price,
        listPrice: r.listPrice,
        sellerName: r.sellerName,
        available: r.available,
        accepted: true,
        reason: null,
      }))
      await prisma.store.update({ where: { id: store.id }, data: { lastOkAt: new Date() } })
      return { ok: true, count: rows.length, sample, message: null, tookMs: Date.now() - started }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.store.update({ where: { id: store.id }, data: { lastErrorAt: new Date(), lastError: message } })
      return { ok: false, count: 0, sample: [], message, tookMs: Date.now() - started }
    }
  })
}
