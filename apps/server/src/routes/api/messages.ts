import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MESSAGE_CHANNELS, MESSAGE_STATUSES, messageUpdateInput, settingsInput } from '@promoeye/shared'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { messageDTO } from '../../services/dto.js'
import { getSettingsDTO, saveSettings } from '../../services/settings.js'
import { telegramConfigured, TelegramError } from '../../services/telegram/bot.js'
import { deliverTelegram } from '../../services/telegram/queue.js'
import { deliver } from '../../services/whatsapp/queue.js'
import { wahaConfigured, WahaError } from '../../services/whatsapp/waha.js'

const include = { offer: { include: { store: { select: { name: true } } } } } as const

export async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/messages', async (request, reply) => {
    // Filtro inválido é 400, não 500.
    const query = parse(
      z.object({ status: z.enum(MESSAGE_STATUSES).optional(), channel: z.enum(MESSAGE_CHANNELS).optional() }),
      request.query,
      reply
    )
    if (!query) return reply
    const { status, channel } = query
    const rows = await prisma.outboundMessage.findMany({
      where: { ...(status ? { status } : {}), ...(channel ? { channel } : {}) },
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

  /** "Enviar agora": manda na hora pelo canal da mensagem, sem esperar a fila nem o horário de silêncio. */
  app.post<{ Params: { id: string } }>('/messages/:id/send', async (request, reply) => {
    const exists = await prisma.outboundMessage.findUnique({ where: { id: request.params.id } })
    if (!exists) return reply.code(404).send({ error: 'Mensagem não encontrada.' })
    const isTelegram = exists.channel === 'telegram'
    if (isTelegram ? !telegramConfigured() : !wahaConfigured()) {
      return reply.code(409).send({
        error: isTelegram
          ? 'O Telegram não está configurado neste servidor (TELEGRAM_BOT_TOKEN).'
          : 'O WAHA não está configurado neste servidor (WAHA_URL e WAHA_API_KEY).',
      })
    }
    let res: { ok: boolean; error: string | null }
    try {
      res = isTelegram ? await deliverTelegram(exists.id, 'manual') : await deliver(exists.id, 'manual')
    } catch (err) {
      if (err instanceof WahaError || err instanceof TelegramError) return reply.code(502).send({ error: err.message })
      throw err
    }
    const updated = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: exists.id }, include })
    if (!res.ok) return reply.code(502).send({ error: res.error, message: messageDTO(updated) })
    return messageDTO(updated)
  })

  app.get('/settings', async () => getSettingsDTO())

  app.put('/settings', async (request, reply) => {
    const input = parse(settingsInput, request.body, reply)
    if (!input) return reply
    return saveSettings(input)
  })
}
