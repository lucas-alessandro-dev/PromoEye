import type { FastifyInstance, FastifyReply } from 'fastify'
import { hourInSaoPaulo, inQuietHours, telegramSettingsInput, type TelegramStatusDTO } from '@promoeye/shared'
import { inWindow, quietOffWindow, windowDTO } from '../../lib/peak.js'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { getTelegramSettings, saveTelegramSettings } from '../../services/settings.js'
import { postProblem, telegram, telegramConfigured, TelegramError } from '../../services/telegram/bot.js'
import { sendTelegramTest } from '../../services/telegram/queue.js'

const HOUR = 3_600_000

/** Bot, grupo e regras do envio automático (página Telegram do painel). */
export async function telegramRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof TelegramError) return reply.code(502).send({ error: err.message })
    throw err
  }
  const needBot = (reply: FastifyReply): boolean => {
    if (telegramConfigured()) return true
    reply.code(409).send({ error: 'O Telegram não está configurado neste servidor (TELEGRAM_BOT_TOKEN).' })
    return false
  }

  app.get('/telegram/status', async () => telegramStatusDTO())

  /** Grupos e canais onde o bot apareceu nas últimas 24 h. */
  app.get('/telegram/chats', async (_request, reply) => {
    if (!needBot(reply)) return reply
    try {
      return await telegram().recentChats()
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.put('/telegram/settings', async (request, reply) => {
    const input = parse(telegramSettingsInput, request.body, reply)
    if (!input) return reply
    if (input.autoSend && !input.chatId) {
      return reply.code(400).send({
        error: 'Escolha o grupo antes de ligar o envio automático.',
        issues: [{ path: 'chatId', message: 'Escolha um grupo' }],
      })
    }

    const current = await getTelegramSettings()
    // O nome do grupo vem sempre do Telegram, nunca do formulário.
    let next = { ...input, chatTitle: input.chatId && input.chatId === current.chatId ? current.chatTitle : '' }
    // Grupo novo: confere com o Telegram e guarda o id numérico e o nome
    // de verdade (o @ de um canal pode mudar; o id, não).
    if (input.chatId && input.chatId !== current.chatId) {
      if (!needBot(reply)) return reply
      try {
        const chat = await telegram().getChat(input.chatId)
        next = { ...input, chatId: chat.id, chatTitle: chat.title }
      } catch (err) {
        if (!(err instanceof TelegramError)) throw err
        if (err.status === null || err.status === 429 || err.status >= 500) return fail(reply, err)
        return reply.code(400).send({
          error: `Não deu para usar esse grupo: ${err.message}.`,
          issues: [{ path: 'chatId', message: err.message }],
        })
      }
    }
    await saveTelegramSettings(next)
    return telegramStatusDTO()
  })

  app.post('/telegram/test', async (_request, reply) => {
    if (!needBot(reply)) return reply
    try {
      await sendTelegramTest()
    } catch (err) {
      return fail(reply, err)
    }
    return { ok: true }
  })
}

export async function telegramStatusDTO(): Promise<TelegramStatusDTO> {
  const since = new Date(Date.now() - HOUR)
  const channel = 'telegram'
  const [settings, queued, failed, sentLastHour] = await Promise.all([
    getTelegramSettings(),
    prisma.outboundMessage.count({ where: { channel, status: 'QUEUED' } }),
    prisma.outboundMessage.count({ where: { channel, status: 'FAILED' } }),
    prisma.outboundMessage.count({ where: { channel, status: 'SENT', sentAt: { gte: since } } }),
  ])
  const now = new Date()
  const quietNow =
    settings.quietHours &&
    !inWindow(quietOffWindow, now) &&
    inQuietHours(hourInSaoPaulo(now), settings.quietStart, settings.quietEnd)
  const base = {
    settings,
    queue: { queued, failed, sentLastHour },
    quietNow,
    quietOff: windowDTO(quietOffWindow, now),
    bot: null,
    chat: null,
    error: null,
  }

  if (!telegramConfigured()) return { ...base, state: 'UNCONFIGURED', ready: false }
  let me: Awaited<ReturnType<ReturnType<typeof telegram>['getMe']>>
  try {
    me = await telegram().getMe()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const invalid = err instanceof TelegramError && (err.status === 401 || err.status === 404)
    return { ...base, state: invalid ? 'INVALID_TOKEN' : 'UNREACHABLE', error: message, ready: false }
  }

  let chat: TelegramStatusDTO['chat'] = null
  if (settings.chatId) {
    try {
      const c = await telegram().getChat(settings.chatId)
      const member = await telegram().getChatMember(settings.chatId, me.id)
      const problem = postProblem(c.type, member, c.membersCanSend)
      chat = { title: c.title, type: c.type, canPost: problem === null, problem }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      chat = { title: settings.chatTitle || settings.chatId, type: null, canPost: false, problem: message }
    }
  }
  return {
    ...base,
    state: 'READY',
    bot: { username: me.username, name: me.name },
    chat,
    ready: chat?.canPost ?? false,
  }
}
