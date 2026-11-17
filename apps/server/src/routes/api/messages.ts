import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MESSAGE_STATUSES, messageUpdateInput, settingsInput } from '@promoeye/shared'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { messageDTO } from '../../services/dto.js'
import { getSettingsDTO, saveSettings } from '../../services/settings.js'

const include = { offer: { include: { store: { select: { name: true } } } } } as const

export async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/messages', async (request) => {
    const { status } = z.object({ status: z.enum(MESSAGE_STATUSES).optional() }).parse(request.query)
    const rows = await prisma.outboundMessage.findMany({
      where: status ? { status } : {},
      // A fila na ordem em que vai sair; o resto, mais novo primeiro.
      orderBy: status === 'QUEUED' ? [{ queuedAt: 'asc' }, { createdAt: 'asc' }] : { createdAt: 'desc' },
      take: 200,
      include,
    })
    return rows.map(messageDTO)
  })

  app.patch<{ Params: { id: string } }>('/messages/:id', async (request, reply) => {
    const input = parse(messageUpdateInput, request.body, reply)
    if (!input) return reply
    const exists = await prisma.outboundMessage.findUnique({ where: { id: request.params.id } })
    if (!exists) return reply.code(404).send({ error: 'Mensagem não encontrada.' })
    if (exists.status === 'SENDING') return reply.code(409).send({ error: 'Essa mensagem está saindo agora. Espere alguns segundos.' })
    const status = input.status
    const updated = await prisma.outboundMessage.update({
      where: { id: exists.id },
      data: {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(status !== undefined
          ? {
              status,
              sentAt: status === 'SENT' ? new Date() : null,
              // Entrar na fila de novo é recomeçar: prazo, tentativas e erro zerados.
              ...(status === 'QUEUED' ? { queuedAt: new Date(), attempts: 0, error: null } : {}),
              ...(status === 'DRAFT' ? { queuedAt: null } : {}),
            }
          : {}),
      },
      include,
    })
    return messageDTO(updated)
  })

  app.get('/settings', async () => getSettingsDTO())

  app.put('/settings', async (request, reply) => {
    const input = parse(settingsInput, request.body, reply)
    if (!input) return reply
    return saveSettings(input)
  })
}
