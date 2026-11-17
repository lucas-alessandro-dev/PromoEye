import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  hourInSaoPaulo,
  inQuietHours,
  pairInput,
  senderSettingsInput,
  testSendInput,
  type WhatsAppStatusDTO,
} from '@promoeye/shared'
import { inWindow, quietOffWindow, windowDTO } from '../../lib/peak.js'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { messageDTO } from '../../services/dto.js'
import { getSenderSettings, saveSenderSettings } from '../../services/settings.js'
import { deliver, sendTest } from '../../services/whatsapp/queue.js'
import { phoneOf, stateOf, waha, wahaConfigured, WahaError } from '../../services/whatsapp/waha.js'

const HOUR = 3_600_000
const include = { offer: { include: { store: { select: { name: true } } } } } as const

/** Conexão do número, grupo e regras do envio automático (página WhatsApp do painel). */
export async function whatsappRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  /** Erro do WAHA vira 502 com a explicação; o resto segue para o tratador padrão. */
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof WahaError) return reply.code(502).send({ error: err.message })
    throw err
  }
  const needWaha = (reply: FastifyReply): boolean => {
    if (wahaConfigured()) return true
    reply.code(409).send({ error: 'O WAHA não está configurado neste servidor (WAHA_URL e WAHA_API_KEY).' })
    return false
  }

  app.get('/whatsapp/status', async () => statusDTO())

  app.post('/whatsapp/connect', async (_request, reply) => {
    if (!needWaha(reply)) return reply
    try {
      await waha().start()
    } catch (err) {
      return fail(reply, err)
    }
    return statusDTO()
  })

  app.get('/whatsapp/qr', async (_request, reply) => {
    if (!needWaha(reply)) return reply
    try {
      const s = await waha().getSession()
      if (s?.status !== 'SCAN_QR_CODE') return reply.code(409).send({ error: 'Não há QR code agora.' })
      return { image: await waha().qr() }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/whatsapp/pair', async (request, reply) => {
    if (!needWaha(reply)) return reply
    const input = parse(pairInput, request.body, reply)
    if (!input) return reply
    try {
      return { code: await waha().requestCode(input.phone) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/whatsapp/logout', async (_request, reply) => {
    if (!needWaha(reply)) return reply
    try {
      await waha().logout()
    } catch (err) {
      return fail(reply, err)
    }
    return statusDTO()
  })

  app.get('/whatsapp/groups', async (_request, reply) => {
    if (!needWaha(reply)) return reply
    try {
      return await waha().groups()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.put('/whatsapp/settings', async (request, reply) => {
    const input = parse(senderSettingsInput, request.body, reply)
    if (!input) return reply
    if (input.autoSend && !input.groupId) {
      return reply.code(400).send({
        error: 'Escolha o grupo antes de ligar o envio automático.',
        issues: [{ path: 'groupId', message: 'Escolha um grupo' }],
      })
    }
    await saveSenderSettings(input)
    return statusDTO()
  })

  app.post('/whatsapp/test', async (request, reply) => {
    if (!needWaha(reply)) return reply
    const input = parse(testSendInput, request.body, reply)
    if (!input) return reply
    try {
      await sendTest(input.target)
    } catch (err) {
      return fail(reply, err)
    }
    return { ok: true }
  })

  /** "Enviar agora": manda na hora, sem esperar a fila nem o horário de silêncio. */
  app.post<{ Params: { id: string } }>('/messages/:id/send', async (request, reply) => {
    if (!needWaha(reply)) return reply
    const exists = await prisma.outboundMessage.findUnique({ where: { id: request.params.id } })
    if (!exists) return reply.code(404).send({ error: 'Mensagem não encontrada.' })
    let res: { ok: boolean; error: string | null }
    try {
      res = await deliver(exists.id, 'manual')
    } catch (err) {
      return fail(reply, err)
    }
    const updated = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: exists.id }, include })
    if (!res.ok) return reply.code(502).send({ error: res.error, message: messageDTO(updated) })
    return messageDTO(updated)
  })
}

export async function statusDTO(): Promise<WhatsAppStatusDTO> {
  const since = new Date(Date.now() - HOUR)
  const [settings, queued, failed, sentLastHour] = await Promise.all([
    getSenderSettings(),
    prisma.outboundMessage.count({ where: { status: 'QUEUED' } }),
    prisma.outboundMessage.count({ where: { status: 'FAILED' } }),
    prisma.outboundMessage.count({ where: { status: 'SENT', sentAt: { gte: since } } }),
  ])
  const now = new Date()
  const quietNow =
    settings.quietHours &&
    !inWindow(quietOffWindow, now) &&
    inQuietHours(hourInSaoPaulo(now), settings.quietStart, settings.quietEnd)
  const quietOff = windowDTO(quietOffWindow, now)
  const base = { settings, queue: { queued, failed, sentLastHour }, quietNow, quietOff, phone: null, pushName: null, error: null }

  if (!wahaConfigured()) return { ...base, state: 'UNCONFIGURED', ready: false }
  try {
    const s = await waha().getSession()
    if (!s) return { ...base, state: 'NO_SESSION', ready: false }
    const state = stateOf(s.status)
    return {
      ...base,
      state,
      phone: phoneOf(s.meId),
      pushName: s.pushName,
      error: s.status === 'FAILED' ? 'O QR code expirou sem ser lido. Conecte de novo.' : null,
      ready: state === 'WORKING' && settings.groupId !== '',
    }
  } catch (err) {
    return { ...base, state: 'UNREACHABLE', error: err instanceof Error ? err.message : String(err), ready: false }
  }
}
