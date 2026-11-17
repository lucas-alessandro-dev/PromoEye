import { hourInSaoPaulo, inQuietHours, type SenderSettings } from '@promoeye/shared'
import type { Offer, OutboundMessage, Store } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import { FRESH_MS } from '../../collector/run.js'
import { config } from '../../config.js'
import { sleep } from '../../lib/http.js'
import { inWindow, quietOffWindow } from '../../lib/peak.js'
import { num, numReq, prisma } from '../../lib/prisma.js'
import { getSenderSettings } from '../settings.js'
import { imageForWhatsApp, waha, wahaConfigured, WahaError } from './waha.js'

/**
 * Fila de envio automático para o grupo.
 *
 * A cada 20 s o PromoEye olha a fila (status QUEUED) e manda UMA mensagem,
 * se puder: WhatsApp conectado, grupo escolhido, fora do horário de silêncio,
 * abaixo do limite por hora e pelo menos ~1 min depois da anterior. Número
 * comum que dispara mensagem em rajada é o que o WhatsApp bloqueia.
 *
 * Antes de mandar, confere se a mensagem ainda é verdade: o preço não subiu,
 * o anúncio não esgotou nem sumiu, e não há mensagem mais nova do mesmo item.
 * Se não for, ela é descartada com o motivo — nada de mandar preço velho.
 */

const HOUR = 3_600_000
const TICK_MS = 20_000
const MIN_GAP_MS = 60_000
const GAP_JITTER_MS = 30_000
export const MAX_ATTEMPTS = 3
export const MAX_QUEUE_AGE_MS = 12 * HOUR
/** Legenda de foto longa demais o WhatsApp corta; nesse caso vai como texto. */
const MAX_CAPTION = 1000

type MessageWithOffer = OutboundMessage & { offer: (Offer & { store: Store }) | null }

// ── Regras (funções puras, testadas em tests/whatsapp.test.ts) ──────────────

/** Por que não dá para enviar agora (null = pode). */
export function blockedNow(input: {
  now: Date
  sender: SenderSettings
  sentLastHour: number
  lastSentAt: Date | null
  gapMs: number
  /** Dentro da janela QUIET_OFF_* (Black Friday): o horário de silêncio não vale. */
  quietOff?: boolean
}): string | null {
  const { now, sender } = input
  if (!sender.groupId) return 'nenhum grupo escolhido'
  if (sender.quietHours && !input.quietOff && inQuietHours(hourInSaoPaulo(now), sender.quietStart, sender.quietEnd)) {
    return 'horário de silêncio'
  }
  if (input.sentLastHour >= sender.maxPerHour) return `limite de ${sender.maxPerHour} por hora`
  if (input.lastSentAt && now.getTime() - input.lastSentAt.getTime() < input.gapMs) return 'intervalo entre mensagens'
  return null
}

/** Por que a mensagem não vale mais (null = ainda vale). */
export function staleReason(input: {
  now: Date
  queuedAt: Date
  messagePrice: number | null
  offer: Pick<Offer, 'price' | 'available' | 'hidden' | 'source' | 'lastSeenAt'> | null
  hasNewer: boolean
}): string | null {
  const { offer, now } = input
  if (!offer) return 'A oferta foi apagada antes do envio.'
  if (offer.hidden) return 'A oferta foi escondida antes do envio.'
  if (!offer.available) return 'Esgotou antes do envio.'
  if (offer.source === 'AUTO' && now.getTime() - offer.lastSeenAt.getTime() > FRESH_MS) {
    return 'O anúncio sumiu da loja antes do envio.'
  }
  const price = numReq(offer.price)
  if (input.messagePrice !== null && price > input.messagePrice * 1.005) {
    return `O preço subiu para R$ ${price.toFixed(2).replace('.', ',')} antes do envio.`
  }
  if (input.hasNewer) return 'Substituída por uma mensagem mais nova do mesmo item.'
  if (now.getTime() - input.queuedAt.getTime() > MAX_QUEUE_AGE_MS) {
    return 'Ficou mais de 12 h na fila (WhatsApp desconectado ou horário de silêncio); o preço pode ter mudado.'
  }
  return null
}

// ── Envio ───────────────────────────────────────────────────────────────────

/** Um envio por vez, venha da fila ou do botão "Enviar agora". */
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

const include = { offer: { include: { store: true } } } as const

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 400)
}

/**
 * Manda uma mensagem para o grupo. `from: 'queue'` tenta de novo mais tarde
 * em erro (até 3 vezes); `from: 'manual'` falha na hora, para o painel mostrar.
 */
export async function deliver(messageId: string, from: 'queue' | 'manual'): Promise<{ ok: boolean; error: string | null }> {
  return exclusive(async () => {
    const sender = await getSenderSettings()
    if (!sender.groupId) return { ok: false, error: 'Escolha o grupo na página WhatsApp antes de enviar.' }
    if (from === 'manual') {
      const session = await waha().getSession()
      if (session?.status !== 'WORKING') return { ok: false, error: 'O WhatsApp não está conectado. Conecte na página WhatsApp.' }
    }

    const claimed = await prisma.outboundMessage.updateMany({
      where: { id: messageId, status: { in: from === 'queue' ? ['QUEUED'] : ['DRAFT', 'QUEUED', 'FAILED'] } },
      data: { status: 'SENDING' },
    })
    if (claimed.count === 0) return { ok: false, error: 'Essa mensagem já foi enviada ou descartada.' }
    const msg = (await prisma.outboundMessage.findUnique({ where: { id: messageId }, include })) as MessageWithOffer

    try {
      const providerId = await sendBody(sender, msg)
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: 'SENT', sentAt: new Date(), providerId, error: null, attempts: { increment: 1 } },
      })
      return { ok: true, error: null }
    } catch (err) {
      const attempts = msg.attempts + 1
      const maybeSent = err instanceof WahaError && err.maybeSent
      const retry = from === 'queue' && !maybeSent && attempts < MAX_ATTEMPTS
      const error = maybeSent
        ? `${errMessage(err)}. A mensagem pode ter saído: confira no grupo antes de reenviar.`
        : errMessage(err)
      await prisma.outboundMessage.update({
        where: { id: msg.id },
        data: { status: retry ? 'QUEUED' : 'FAILED', attempts, error },
      })
      return { ok: false, error }
    }
  })
}

/** Foto com legenda quando dá; senão, texto com prévia do link. */
async function sendBody(sender: SenderSettings, msg: MessageWithOffer): Promise<string | null> {
  const client = waha()
  const chatId = sender.groupId
  await client.typing(chatId, true)
  await sleep(1500 + Math.random() * 2500)
  await client.typing(chatId, false)

  const image = sender.withImage && msg.body.length <= MAX_CAPTION ? imageForWhatsApp(msg.offer?.imageUrl) : null
  if (image) {
    try {
      return await client.sendImage(chatId, image, msg.body)
    } catch (err) {
      // O WAHA respondeu com erro (ex.: não conseguiu baixar a foto): a foto não
      // saiu, então mandar o texto não duplica nada. Sem resposta, não arrisca.
      if (!(err instanceof WahaError) || err.status === null) throw err
    }
  }
  return client.sendText(chatId, msg.body, true)
}

/** Mensagem de teste para o próprio número ou para o grupo. */
export async function sendTest(target: 'me' | 'group'): Promise<void> {
  const client = waha()
  const sender = await getSenderSettings()
  let chatId: string
  if (target === 'group') {
    if (!sender.groupId) throw new WahaError('Escolha e salve o grupo antes do teste.', 400)
    chatId = sender.groupId
  } else {
    const s = await client.getSession()
    if (!s?.meId) throw new WahaError('O WhatsApp não está conectado.', 409)
    chatId = s.meId
  }
  const text =
    target === 'group'
      ? '✅ Teste do PromoEye: as promoções vão chegar aqui automaticamente.'
      : `✅ Teste do PromoEye: o envio automático está funcionando. Grupo escolhido: ${sender.groupName || 'nenhum'}.`
  await exclusive(() => client.sendText(chatId, text, false))
}

// ── Laço da fila ────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null
let gapMs = MIN_GAP_MS

async function tick(log: FastifyBaseLogger): Promise<void> {
  if (locked) return
  const queued = await prisma.outboundMessage.count({ where: { status: 'QUEUED' } })
  if (!queued) return

  const now = new Date()
  const sender = await getSenderSettings()
  const [sentLastHour, last] = await Promise.all([
    prisma.outboundMessage.count({ where: { status: 'SENT', sentAt: { gte: new Date(now.getTime() - HOUR) } } }),
    prisma.outboundMessage.findFirst({ where: { status: 'SENT', sentAt: { not: null } }, orderBy: { sentAt: 'desc' } }),
  ])
  const quietOff = inWindow(quietOffWindow, now)
  if (blockedNow({ now, sender, sentLastHour, lastSentAt: last?.sentAt ?? null, gapMs, quietOff })) return

  const session = await waha().getSession().catch(() => null)
  if (session?.status !== 'WORKING') return

  // Descarta o que perdeu a validade até achar uma mensagem que ainda vale.
  for (let i = 0; i < 20; i++) {
    const msg = (await prisma.outboundMessage.findFirst({
      where: { status: 'QUEUED' },
      orderBy: [{ queuedAt: 'asc' }, { createdAt: 'asc' }],
      include,
    })) as MessageWithOffer | null
    if (!msg) return

    const newer = msg.offer
      ? await prisma.outboundMessage.count({
          where: {
            id: { not: msg.id },
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
      log.info(`whatsapp: mensagem ${msg.id} descartada — ${stale}`)
      continue
    }

    const res = await deliver(msg.id, 'queue')
    if (res.ok) log.info(`whatsapp: mensagem ${msg.id} enviada ao grupo`)
    else log.warn(`whatsapp: falha ao enviar ${msg.id} — ${res.error}`)
    gapMs = MIN_GAP_MS + Math.random() * GAP_JITTER_MS
    return
  }
}

/** Mensagens que estavam saindo quando o servidor caiu: não sabemos se saíram. */
export async function failOrphanSends(): Promise<void> {
  await prisma.outboundMessage.updateMany({
    where: { status: 'SENDING' },
    data: { status: 'FAILED', error: 'O servidor reiniciou durante o envio. Confira no grupo antes de reenviar.' },
  })
}

export function startQueue(log: FastifyBaseLogger): void {
  if (!wahaConfigured()) {
    log.info('envio automático pelo WhatsApp desligado (WAHA_URL vazio)')
    return
  }
  const loop = async () => {
    try {
      await tick(log)
    } catch (err) {
      log.error({ err }, 'whatsapp: erro na fila de envio')
    } finally {
      if (timer) timer = setTimeout(loop, TICK_MS)
    }
  }
  timer = setTimeout(loop, 5000)

  // Depois de reiniciar, o WAHA pode deixar a sessão parada: religamos uma vez.
  // Com o celular ainda vinculado, ela volta sem QR code.
  setTimeout(() => {
    void (async () => {
      try {
        const s = await waha().getSession()
        if (s?.status === 'STOPPED') await waha().start()
      } catch (err) {
        log.warn(`whatsapp: não consegui falar com o WAHA na subida — ${errMessage(err)}`)
      }
    })()
  }, 8000).unref()
  log.info(`envio pelo WhatsApp: WAHA em ${config.WAHA_URL} (sessão "${config.WAHA_SESSION}")`)
}

export function stopQueue(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
