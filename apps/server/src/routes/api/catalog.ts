import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { displayGtin, type ProductDTO, type ProductListDTO } from '@promoeye/shared'
import type { Offer, Product, Store } from '@prisma/client'
import { publicUrl } from '../../config.js'
import { numReq, prisma, type Prisma } from '../../lib/prisma.js'
import { FRESH_MS } from '../../collector/fresh.js'
import { offerDTO, offerInclude } from '../../services/dto.js'
import { runAffiliateCheck } from '../../services/affiliate-check.js'

/**
 * Painel: catálogo (produtos por EAN) e verificação dos links de afiliado.
 *
 *   GET /api/admin/products?q=&multi=1     lista, com quantas lojas têm cada produto
 *   GET /api/admin/products/:id            o produto e as ofertas ligadas a ele
 *   GET /api/admin/affiliates/check?live=1 confere o link de afiliado de cada loja
 */

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  multi: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
})

const fresh = (o: Offer) => o.source === 'MANUAL' || o.lastSeenAt.getTime() >= Date.now() - FRESH_MS

function productDTO(p: Product & { offers: (Offer & { store: Store })[] }): ProductDTO {
  const current = p.offers.filter((o) => !o.hidden && fresh(o))
  const avail = current.filter((o) => o.available).sort((a, b) => numReq(a.price) - numReq(b.price))
  return {
    id: p.id,
    slug: p.slug,
    gtin: displayGtin(p.gtin),
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl,
    category: p.category,
    publicUrl: `${publicUrl}/produtos/${p.slug}`,
    offerCount: p.offers.length,
    availableCount: avail.length,
    storeCount: new Set(avail.map((o) => o.storeId)).size,
    minPrice: avail[0] ? numReq(avail[0].price) : null,
    minStoreName: avail[0]?.store.name ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export async function catalogRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/products', async (request): Promise<ProductListDTO> => {
    const q = listQuery.parse(request.query)
    const digits = q.q?.replace(/\D/g, '') ?? ''
    const where: Prisma.ProductWhereInput = q.q
      ? digits.length >= 8
        ? { gtin: { endsWith: digits } }
        : { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { brand: { contains: q.q, mode: 'insensitive' } }] }
      : {}
    const all = await prisma.product.findMany({
      where,
      include: { offers: { include: { store: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    })
    const dtos = all.map(productDTO)
    const multiStore = dtos.filter((d) => d.storeCount >= 2).length
    const filtered = (q.multi === '1' ? dtos.filter((d) => d.storeCount >= 2) : dtos).sort(
      (a, b) => b.storeCount - a.storeCount || b.availableCount - a.availableCount || a.name.localeCompare(b.name, 'pt-BR')
    )
    return { total: filtered.length, multiStore, products: filtered.slice(q.offset, q.offset + q.limit) }
  })

  app.get<{ Params: { id: string } }>('/products/:id', async (request, reply) => {
    const p = await prisma.product.findUnique({ where: { id: request.params.id }, include: { offers: { include: { store: true } } } })
    if (!p) return reply.code(404).send({ error: 'Produto não encontrado.' })
    const offers = await prisma.offer.findMany({ where: { productId: p.id }, include: offerInclude, orderBy: { price: 'asc' } })
    return { ...productDTO(p), offers: offers.map(offerDTO) }
  })

  app.get<{ Querystring: { live?: string } }>('/affiliates/check', async (request) => {
    return runAffiliateCheck({ live: request.query.live === '1' })
  })
}
