import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { messageUpdateInput, settingsInput } from '@promoeye/shared'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { messageDTO } from '../../services/dto.js'
import { getSettingsDTO, saveSettings } from '../../services/settings.js'

const include = { offer: { include: { store: { select: { name: true } } } } } as const

export async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/messages', async (request) => {
    const { status } = z
      .object({ status: z.enum(['DRAFT', 'SENT', 'DISCARDED', 'FAILED']).optional() })
      .parse(request.query)
    const rows = await prisma.outboundMessage.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
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
    const updated = await prisma.outboundMessage.update({
      where: { id: exists.id },
      data: {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.status !== undefined
          ? { status: input.status, sentAt: input.status === 'SENT' ? new Date() : null }
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
