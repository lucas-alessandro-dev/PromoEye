/**
 * Seed: lojas confiáveis + configurações padrão. Idempotente — rodar de novo
 * atualiza nome/domínio/adaptador das lojas, mas NÃO mexe no que você
 * configurou pelo painel (ligada/desligada, afiliado, política de vendedor).
 *
 * Itens de exemplo só entram com SEED_EXAMPLES=1 — a lista de verdade é a sua.
 */
import { PrismaClient } from '@prisma/client'
import { DEFAULT_STORES, slugify } from '@promoeye/shared'

const prisma = new PrismaClient()

for (const s of DEFAULT_STORES) {
  await prisma.store.upsert({
    where: { id: s.id },
    create: {
      id: s.id,
      name: s.name,
      domain: s.domain,
      adapter: s.adapter,
      config: s.config as object,
      enabled: s.enabled,
      sellerPolicy: s.sellerPolicy,
      trustNote: s.trustNote,
      sortOrder: s.sortOrder,
    },
    update: { name: s.name, domain: s.domain, adapter: s.adapter, config: s.config as object, sortOrder: s.sortOrder },
  })
}
console.log(`${DEFAULT_STORES.length} lojas`)

if (process.env.SEED_EXAMPLES === '1') {
  const examples = [
    {
      name: 'iPhone 16 128GB',
      query: 'iphone 16 128gb',
      mustInclude: ['iphone', '16', '128gb'],
      mustExclude: ['pro', 'plus', '16e', 'max'],
      minPrice: 2500,
      targetPrice: 4300,
      category: 'Celulares',
    },
    {
      name: 'Air Fryer Mondial 4L ou mais',
      query: 'air fryer mondial',
      mustInclude: ['fryer|fritadeira', 'mondial'],
      mustExclude: ['forma', 'cesto', 'tapete', 'kit'],
      minPrice: 150,
      targetPrice: 300,
      category: 'Casa',
    },
    {
      name: 'Placa de vídeo RTX 5060',
      query: 'rtx 5060',
      mustInclude: ['rtx', '5060'],
      mustExclude: ['ti', 'notebook', 'pc gamer', 'computador'],
      minPrice: 1200,
      targetPrice: 2000,
      category: 'Informática',
    },
  ]
  for (const [i, e] of examples.entries()) {
    const slug = slugify(e.name)
    await prisma.watchItem.upsert({
      where: { slug },
      create: { ...e, slug, sortOrder: (i + 1) * 10 },
      update: {},
    })
  }
  console.log(`${examples.length} itens de exemplo`)
}

await prisma.$disconnect()
