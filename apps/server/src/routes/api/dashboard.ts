import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { daysUntilBlackFriday, type DashboardDTO } from '@promoeye/shared'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { AlreadyRunningError, currentRun, FRESH_MS, startCollection } from '../../collector/run.js'
import { nextRunAt, scheduleEnabled } from '../../collector/scheduler.js'
import { offerDTO, runDTO, storeDTO } from '../../services/dto.js'

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/dashboard', async (): Promise<DashboardDTO> => {
    const fresh = new Date(Date.now() - FRESH_MS)
    const freshWhere = { hidden: false, OR: [{ source: 'MANUAL' as const }, { lastSeenAt: { gte: fresh } }] }
    const [lastRun, items, activeItems, offers, deals, drafts, clicks7d, topDeals, stores] = await Promise.all([
      prisma.collectorRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.watchItem.count(),
      prisma.watchItem.count({ where: { active: true } }),
      prisma.offer.count({ where: freshWhere }),
      prisma.offer.count({ where: { ...freshWhere, isDeal: true } }),
      prisma.outboundMessage.count({ where: { status: 'DRAFT' } }),
      prisma.click.count({ where: { at: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      prisma.offer.findMany({
        where: { ...freshWhere, available: true, isDeal: true },
        orderBy: [{ pinned: 'desc' }, { score: 'desc' }],
        take: 8,
        include: { store: true, watchItem: { select: { id: true, name: true } }, _count: { select: { clicks: true } } },
      }),
      prisma.store.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { offers: true } } } }),
    ])
    const bf = daysUntilBlackFriday()
    return {
      lastRun: lastRun ? runDTO(lastRun) : null,
      running: currentRun() !== null,
      nextRunAt: nextRunAt()?.toISOString() ?? null,
      scheduleEnabled: scheduleEnabled(),
      counts: { items, activeItems, offers, deals, draftMessages: drafts, clicks7d },
      topDeals: topDeals.map(offerDTO),
      stores: stores.map(storeDTO),
      blackFriday: { date: bf.date.toISOString(), days: bf.days },
    }
  })

  app.get('/runs', async (request) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(request.query)
    const runs = await prisma.collectorRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit })
    return runs.map(runDTO)
  })

  app.get<{ Params: { id: string } }>('/runs/:id', async (request, reply) => {
    const run = await prisma.collectorRun.findUnique({ where: { id: request.params.id } })
    if (!run) return reply.code(404).send({ error: 'Coleta não encontrada.' })
    return runDTO(run)
  })

  app.post('/runs', async (request, reply) => {
    const body = parse(z.object({ itemIds: z.array(z.string()).max(200).optional() }), request.body, reply)
    if (!body) return reply
    try {
      const { runId, done } = await startCollection({
        trigger: 'manual',
        itemIds: body.itemIds,
        log: (m) => request.log.info(m),
      })
      done.catch((err) => request.log.error({ err }, 'coleta manual falhou'))
      return reply.code(202).send({ runId })
    } catch (err) {
      if (err instanceof AlreadyRunningError) {
        return reply.code(409).send({ error: 'Já existe uma coleta em andamento.', runId: err.runId })
      }
      throw err
    }
  })
}
