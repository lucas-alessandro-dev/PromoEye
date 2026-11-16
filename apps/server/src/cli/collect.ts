/**
 * Roda uma coleta pelo terminal: `npm run collect` (todos os itens ativos)
 * ou `npm run collect -- iphone-16-128gb` (só os slugs informados).
 */
import { prisma } from '../lib/prisma.js'
import { failOrphanRuns, startCollection } from '../collector/run.js'

const slugs = process.argv.slice(2)
await failOrphanRuns()
const items = slugs.length ? await prisma.watchItem.findMany({ where: { slug: { in: slugs } }, select: { id: true } }) : []
if (slugs.length && !items.length) {
  console.error(`Nenhum item com slug ${slugs.join(', ')}`)
  process.exit(1)
}
const started = Date.now()
const { runId, done } = await startCollection({
  trigger: 'cli',
  itemIds: items.map((i) => i.id),
  log: (m) => console.log(m),
})
await done
const run = await prisma.collectorRun.findUniqueOrThrow({ where: { id: runId } })
console.log(
  `\n${run.status} em ${((Date.now() - started) / 1000).toFixed(1)} s · ${run.requests} requisições · ${run.offersSeen} anúncios (${run.offersNew} novos, ${run.priceChanges} mudanças de preço) · ${run.newDeals} promoções novas`
)
const errors = run.errors as { store?: string; item?: string; message: string }[]
for (const e of errors.slice(0, 20)) console.log(`  ! ${e.store ?? ''} ${e.item ? `[${e.item}]` : ''} ${e.message}`)
await prisma.$disconnect()
