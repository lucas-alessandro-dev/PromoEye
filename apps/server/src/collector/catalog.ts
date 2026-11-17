import { displayGtin, slugify } from '@promoeye/shared'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

/**
 * Catálogo: o mesmo produto em lojas diferentes, juntado pelo código de
 * barras (GTIN/EAN). É o primeiro passo do PromoEye de "lista de itens
 * acompanhados" para "comparador": o item "Air fryer" junta modelos
 * parecidos; o produto "Air Fryer Britânia BFR38 (EAN 7899963914386)" é UM
 * modelo, com o preço de cada loja lado a lado.
 *
 * Regras:
 *  - só EAN válido entra (dígito verificador e fora dos códigos internos,
 *    ver packages/shared/src/gtin.ts); título parecido NUNCA junta anúncios;
 *  - o produto nasce com o nome do primeiro anúncio e não é renomeado pelo
 *    coletor (o nome pode ser corrigido à mão no banco sem a coleta desfazer);
 *  - o slug leva o EAN: é único e não muda.
 */

export interface CatalogRow {
  offerId: string
  gtin: string
  title: string
  imageUrl: string | null
  brand: string | null
  modelRef: string | null
  category: string | null
}

/** Nome limpo para o produto: espaços normais e sem pontuação solta nas pontas. */
export function productName(title: string): string {
  return title.replace(/\s+/g, ' ').replace(/^[\s\-–|·]+|[\s\-–|·]+$/g, '').slice(0, 200)
}

/** "air-fryer-britania-4-2l-bfr38-7899963914386" */
export function productSlug(name: string, gtin14: string): string {
  const base = slugify(name).slice(0, 70).replace(/-+$/, '')
  return `${base || 'produto'}-${displayGtin(gtin14)}`
}

async function findOrCreate(row: CatalogRow): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.product.findUnique({ where: { gtin: row.gtin }, select: { id: true, imageUrl: true, brand: true, modelRef: true, category: true } })
  if (existing) {
    // Completa o que faltava; não sobrescreve o que já existe.
    const fill = {
      ...(!existing.imageUrl && row.imageUrl ? { imageUrl: row.imageUrl } : {}),
      ...(!existing.brand && row.brand ? { brand: row.brand } : {}),
      ...(!existing.modelRef && row.modelRef ? { modelRef: row.modelRef } : {}),
      ...(!existing.category && row.category ? { category: row.category } : {}),
    }
    if (Object.keys(fill).length) await prisma.product.update({ where: { id: existing.id }, data: fill })
    return { id: existing.id, created: false }
  }
  const name = productName(row.title)
  try {
    const created = await prisma.product.create({
      data: {
        gtin: row.gtin,
        slug: productSlug(name, row.gtin),
        name,
        brand: row.brand,
        modelRef: row.modelRef,
        imageUrl: row.imageUrl,
        category: row.category,
      },
      select: { id: true },
    })
    return { id: created.id, created: true }
  } catch (err) {
    // Outro processo (o painel) criou o mesmo EAN neste meio tempo.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await prisma.product.findUnique({ where: { gtin: row.gtin }, select: { id: true } })
      if (again) return { id: again.id, created: false }
    }
    throw err
  }
}

/** Liga cada anúncio ao produto do seu EAN. Devolve quantos produtos nasceram e quantos anúncios mudaram de produto. */
export async function linkOffersToProducts(rows: CatalogRow[]): Promise<{ created: number; linked: number }> {
  let created = 0
  let linked = 0
  const cache = new Map<string, string>()
  for (const row of rows) {
    let productId = cache.get(row.gtin)
    if (!productId) {
      const res = await findOrCreate(row)
      productId = res.id
      if (res.created) created++
      cache.set(row.gtin, productId)
    }
    const changed = await prisma.offer.updateMany({
      where: { id: row.offerId, OR: [{ productId: null }, { productId: { not: productId } }] },
      data: { productId, gtin: row.gtin },
    })
    linked += changed.count
  }
  return { created, linked }
}
