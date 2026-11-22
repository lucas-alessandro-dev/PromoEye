import { whatsappToTelegramHtml, type TelegramSettings } from '@promoeye/shared'
import type { Offer, OutboundMessage, Store } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { inWindow, quietOffWindow } from '../../lib/peak.js'
import { num, prisma } from '../../lib/prisma.js'
import { getTelegramSettings, saveTelegramSettings } from '../settings.js'
import { blockedNow, MAX_ATTEMPTS, staleReason } from '../whatsapp/queue.js'
import { imageForWhatsApp } from '../whatsapp/waha.js'
import { classifyTelegramError, isParseError, telegram, telegramConfigured, TelegramError } from './bot.js'

/**
 * Fila de envio automático para o grupo (ou canal) do Telegram.
 *
 * Mesmas regras da fila do WhatsApp, com as mesmas funções: uma mensagem por
 * vez, ≥1 min entre elas, teto por hora, horário de silêncio e, antes de
 * cada envio, a conferência de preço, estoque e mensagem mais nova do item.
 * Cada canal anda sozinho: o WhatsApp desconectado não segura o Telegram.
 *
 * Diferenças: bot oficial não precisa de "digitando…" nem de intervalo
 * aleatório, e o Telegram diz quando esperar (429) e quando o problema é de
 * configuração (bot fora do grupo). Nesse caso a mensagem espera na fila,
 * como no WhatsApp desconectado, até alguém corrigir ou ela vencer (12 h).
 */

const CHANNEL = 'telegram'
const HOUR = 3_600_000
const TICK_MS = 20_000
const MIN_GAP_MS = 60_000
/** Bot fora do grupo, sem permissão ou token errado: a fila tenta de novo a cada 10 min. */
const CONFIG_PAUSE_MS = 10 * 60_000
/** Legenda de foto tem até 1024 caracteres; acima disso vai como texto (até 4096). */
const MAX_CAPTION = 1000

type MessageWithOffer = OutboundMessage & { offer: (Offer & { store: Store }) | null }

const include = { offer: { include: { store: true } } } as const

let chain: Promise<unknown> = Promise.resolve()
let locked = false
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    locked = true
    try {
      return await fn()
    } finally {
      locked = false
    }
  })
  chain = run.catch(() => undefined)
  return run
}

/** Até quando a fila fica parada (429 do Telegram ou erro de configuração). */
let pauseUntil = 0

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 400)
}

/**
 * Manda uma mensagem para o grupo. `from: 'queue'` decide sozinho o que fazer
 * em erro (ver classifyTelegramError); `from: 'manual'` falha na hora, para o
 * painel mostrar.
 */
export async function deliverTelegram(messageId: string, from: 'queue' | 'manual'): Promise<{ ok: boolean; error: string | null }> {
  return exclusive(async () => {
    if (!telegramConfigured()) return { ok: false, error: 'O Telegram não está configurado neste servidor (TELEGRAM_BOT_TOKEN).' }
    const settings = await getTelegramSettings()
    if (!settings.chatId) return { ok: false, error: 'Escolha o grupo na página Telegram antes de enviar.' }

    const claimed = await prisma.outboundMessage.updateMany({
      where: { id: messageId, channel: CHANNEL, status: { in: from === 'queue' ? ['QUEUED'] : ['DRAFT', 'QUEUED', 'FAILED'] } },
      data: { status: 'SENDING' },
    })
    if (claimed.count === 0) return { ok: false, error: 'Essa mensagem já foi enviada ou descartada.' }
    const msg = (await prisma.outboundMessage.findUnique({ where: { id: messageId }, include })) as MessageWithOffer

    try {
      const providerId = await sendFollowingMigration(settings, msg)
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: 'SENT', sentAt: new Date(), providerId, error: null, attempts: { increment: 1 } },
      })
      return { ok: true, error: null }
    } catch (err) {
      const kind = classifyTelegramError(err)
      let error = errMessage(err)
      let status: 'QUEUED' | 'FAILED' = 'FAILED'
      let attempts = msg.attempts + 1

      if (kind === 'maybe-sent') {
        error = `${error}. A mensagem pode ter saído: confira no grupo antes de reenviar.`
      } else if (from === 'queue' && kind === 'config') {
        // Não é culpa da mensagem: ela espera, sem gastar tentativa.
        status = 'QUEUED'
        attempts = msg.attempts
        pauseUntil = Date.now() + CONFIG_PAUSE_MS
      } else if (from === 'queue' && kind === 'transient' && attempts < MAX_ATTEMPTS) {
        status = 'QUEUED'
        const wait = err instanceof TelegramError && err.retryAfterSec ? err.retryAfterSec * 1000 : attempts * 60_000
        pauseUntil = Date.now() + wait
      }
      await prisma.outboundMessage.update({ where: { id: msg.id }, data: { status, attempts, error } })
      return { ok: false, error }
    }
  })
}

/**
 * Grupo comum que vira supergrupo (por exemplo, ao passar de 200 membros ou
 * ganhar um @) troca de id. O Telegram avisa o id novo; guardamos e mandamos
 * de novo uma vez. Nada saiu na primeira tentativa (foi recusada).
 */
async function sendFollowingMigration(settings: TelegramSettings, msg: MessageWithOffer): Promise<string | null> {
  try {
    return await sendBody(settings.chatId, settings.withImage, msg)
  } catch (err) {
    if (!(err instanceof TelegramError) || !err.migrateTo) throw err
    await saveTelegramSettings({ ...settings, chatId: err.migrateTo })
    return sendBody(err.migrateTo, settings.withImage, msg)
  }
}

/** Foto com legenda quando dá; senão, texto com prévia do link. HTML recusado vira texto puro. */
async function sendBody(chatId: string, withImage: boolean, msg: MessageWithOffer): Promise<string | null> {
  const bot = telegram()
  const html = whatsappToTelegramHtml(msg.body)
  const photo = withImage && msg.body.length <= MAX_CAPTION ? (imageForWhatsApp(msg.offer?.imageUrl)?.url ?? null) : null

  if (photo) {
    try {
      return await bot.sendPhoto(chatId, photo, html, { html: true })
    } catch (err) {
      // O Telegram recusou a foto (não conseguiu baixar, formato…): ela não
      // saiu, então mandar o texto não duplica nada. Sem resposta, não arrisca.
      if (!(err instanceof TelegramError) || err.status !== 400 || err.migrateTo) throw err
    }
  }
  try {
    return await bot.sendMessage(chatId, html, { html: true, linkPreview: true })
  } catch (err) {
    if (!isParseError(err)) throw err
    return bot.sendMessage(chatId, msg.body, { html: false, linkPreview: true })
  }
}

/** Mensagem de teste no grupo escolhido. */
export async function sendTelegramTest(): Promise<void> {
  const settings = await getTelegramSettings()
  if (!settings.chatId) throw new TelegramError('Escolha e salve o grupo antes do teste.', 400)
  await exclusive(() =>
    telegram().sendMessage(settings.chatId, '✅ Teste do PromoEye: as promoções vão chegar aqui automaticamente.', {
      html: false,
      linkPreview: false,
    })
  )
}

// ── Laço da fila ────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null

async function tick(log: FastifyBaseLogger): Promise<void> {
  if (locked || Date.now() < pauseUntil) return
  const queued = await prisma.outboundMessage.count({ where: { channel: CHANNEL, status: 'QUEUED' } })
  if (!queued) return

  const now = new Date()
  const settings = await getTelegramSettings()
  const [sentLastHour, last] = await Promise.all([
    prisma.outboundMessage.count({ where: { channel: CHANNEL, status: 'SENT', sentAt: { gte: new Date(now.getTime() - HOUR) } } }),
    prisma.outboundMessage.findFirst({ where: { channel: CHANNEL, status: 'SENT', sentAt: { not: null } }, orderBy: { sentAt: 'desc' } }),
  ])
  const quietOff = inWindow(quietOffWindow, now)
  const sender = { ...settings, groupId: settings.chatId }
  if (blockedNow({ now, sender, sentLastHour, lastSentAt: last?.sentAt ?? null, gapMs: MIN_GAP_MS, quietOff })) return

  // Descarta o que perdeu a validade até achar uma mensagem que ainda vale.
  for (let i = 0; i < 20; i++) {
    const msg = (await prisma.outboundMessage.findFirst({
      where: { channel: CHANNEL, status: 'QUEUED' },
      orderBy: [{ queuedAt: 'asc' }, { createdAt: 'asc' }],
      include,
    })) as MessageWithOffer | null
    if (!msg) return

    const newer = msg.offer
      ? await prisma.outboundMessage.count({
          where: {
            id: { not: msg.id },
            channel: CHANNEL,
            createdAt: { gt: msg.createdAt },
            status: { in: ['QUEUED', 'SENDING', 'SENT'] },
            offer: { watchItemId: msg.offer.watchItemId },
          },
        })
      : 0
    const stale = staleReason({
      now,
      queuedAt: msg.queuedAt ?? msg.createdAt,
      messagePrice: num(msg.price),
      offer: msg.offer,
      hasNewer: newer > 0,
    })
    if (stale) {
      await prisma.outboundMessage.updateMany({ where: { id: msg.id, status: 'QUEUED' }, data: { status: 'DISCARDED', error: stale } })
      log.info(`telegram: mensagem ${msg.id} descartada — ${stale}`)
      continue
    }

    const res = await deliverTelegram(msg.id, 'queue')
    if (res.ok) log.info(`telegram: mensagem ${msg.id} enviada ao grupo`)
    else log.warn(`telegram: falha ao enviar ${msg.id} — ${res.error}`)
    return
  }
}

export function startTelegramQueue(log: FastifyBaseLogger): void {
  if (!telegramConfigured()) {
    log.info('envio pelo Telegram desligado (TELEGRAM_BOT_TOKEN vazio)')
    return
  }
  const loop = async () => {
    try {
      await tick(log)
    } catch (err) {
      log.error({ err }, 'telegram: erro na fila de envio')
    } finally {
      if (timer) timer = setTimeout(loop, TICK_MS)
    }
  }
  timer = setTimeout(loop, 7000)
  log.info('envio pelo Telegram: bot configurado')
}

export function stopTelegramQueue(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
