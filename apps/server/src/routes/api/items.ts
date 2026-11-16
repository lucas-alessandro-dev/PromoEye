import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { previewInput, slugify, watchItemInput, type WatchItemInput } from '@promoeye/shared'
import { num, prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { previewSearch } from '../../collector/preview.js'
import { FRESH_MS } from '../../collector/run.js'
import { itemDTO } from '../../services/dto.js'

async function uniqueSlug(name: string, ignoreId?: string): Promise<string> {
  const base = slugify(name) || 'item'
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`
    const taken = await prisma.watchItem.findUnique({ where: { slug } })
    if (!taken || taken.id === ignoreId) return slug
  }
  return `${base}-${Date.now()}`
}

function toData(input: WatchItemInput) {
  return {
    name: input.name,
    query: input.query,
    mustInclude: input.mustInclude,
    mustExclude: input.mustExclude,
    minPrice: input.minPrice,
    targetPrice: input.targetPrice,
    minDiscountPct: input.minDiscountPct,
    storeIds: input.storeIds,
    category: input.category || null,
    active: input.active,
    notes: input.notes || null,
  }
}

async function loadItemDTO(id: string) {
  const fresh = new Date(Date.now() - FRESH_MS)
  const item = await prisma.watchItem.findUnique({ where: { id } })
  if (!item) return null
  const where = { watchItemId: id, hidden: false, OR: [{ source: 'MANUAL' as const }, { lastSeenAt: { gte: fresh } }] }
  const [best, offerCount, dealCount] = await Promise.all([
    prisma.offer.findFirst({ where: { ...where, available: true }, orderBy: { price: 'asc' }, include: { store: true } }),
    prisma.offer.count({ where }),
    prisma.offer.count({ where: { ...where, isDeal: true } }),
  ])
  return itemDTO(item, { best, offerCount, dealCount })
}

export async function itemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/items', async () => {
    const items = await prisma.watchItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
    const dtos = await Promise.all(items.map((i) => loadItemDTO(i.id)))
    return dtos.filter(Boolean)
  })

  app.get<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
    const dto = await loadItemDTO(request.params.id)
    if (!dto) return reply.code(404).send({ error: 'Item não encontrado.' })
    return dto
  })

  app.post('/items', async (request, reply) => {
    const input = parse(watchItemInput, request.body, reply)
    if (!input) return reply
    const item = await prisma.watchItem.create({ data: { ...toData(input), slug: await uniqueSlug(input.name) } })
    return reply.code(201).send(await loadItemDTO(item.id))
  })

  app.put<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
    const input = parse(watchItemInput, request.body, reply)
    if (!input) return reply
    const existing = await prisma.watchItem.findUnique({ where: { id: request.params.id } })
    if (!existing) return reply.code(404).send({ error: 'Item não encontrado.' })
    const slug = existing.name === input.name ? existing.slug : await uniqueSlug(input.name, existing.id)
    await prisma.watchItem.update({ where: { id: existing.id }, data: { ...toData(input), slug } })
    return loadItemDTO(existing.id)
  })

  app.delete<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
    await prisma.watchItem.deleteMany({ where: { id: request.params.id } })
    return reply.code(204).send()
  })

  app.post('/items/preview', async (request, reply) => {
    const input = parse(previewInput, request.body, reply)
    if (!input) return reply
    return previewSearch(input)
  })

  app.get<{ Params: { id: string } }>('/items/:id/snapshots', async (request) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query)
    const rows = await prisma.itemSnapshot.findMany({
      where: { watchItemId: request.params.id, at: { gte: new Date(Date.now() - days * 86_400_000) } },
      orderBy: { at: 'asc' },
    })
    return rows.map((r) => ({ at: r.at.toISOString(), minPrice: num(r.minPrice), storeId: r.minStoreId }))
  })
}
