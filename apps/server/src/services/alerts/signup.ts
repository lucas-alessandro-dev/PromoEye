import { ALERT_CONSENT_TEXT } from '@promoeye/shared'
import { num, prisma } from '../../lib/prisma.js'
import { getSettings } from '../settings.js'
import { sendMail } from './mailer.js'
import { confirmMail } from './rules.js'
import { alertUrl } from './tokens.js'

/**
 * Inscrição no alerta (opt-in duplo).
 *
 * A resposta para quem preencheu é SEMPRE a mesma ("confira seu e-mail"),
 * exista ou não um alerta para aquele endereço: assim o formulário não serve
 * para descobrir quem está inscrito em quê.
 */

const MAX_ACTIVE_PER_EMAIL = 30
const MAX_CONFIRM_SENDS = 3
const CONFIRM_RESEND_GAP_MS = 10 * 60_000

export type AlertTarget = { kind: 'item'; id: string; name: string } | { kind: 'product'; id: string; name: string }

export async function signupAlert(input: { email: string; targetPrice: number | null; target: AlertTarget; now?: Date }): Promise<void> {
  const now = input.now ?? new Date()
  const where = input.target.kind === 'item' ? { watchItemId: input.target.id } : { productId: input.target.id }
  const existing = await prisma.priceAlert.findFirst({ where: { email: input.email, ...where }, orderBy: { createdAt: 'desc' } })

  // Já confirmado: nada a fazer (mudar o alvo pede o link do e-mail, que é a prova de dono).
  if (existing?.status === 'ACTIVE') return

  if (existing?.status === 'PENDING') {
    const recent = existing.lastConfirmSentAt && now.getTime() - existing.lastConfirmSentAt.getTime() < CONFIRM_RESEND_GAP_MS
    if (existing.confirmSends >= MAX_CONFIRM_SENDS || recent) return
    await prisma.priceAlert.update({
      where: { id: existing.id },
      data: { targetPrice: input.targetPrice, consentText: ALERT_CONSENT_TEXT, consentAt: now },
    })
    await sendConfirmation(existing.id, input.target.name, input.targetPrice, now)
    return
  }

  const open = await prisma.priceAlert.count({ where: { email: input.email, status: { in: ['PENDING', 'ACTIVE'] } } })
  if (open >= MAX_ACTIVE_PER_EMAIL) return

  const alert = existing
    ? // Tinha cancelado e voltou: mesmo registro, consentimento novo.
      await prisma.priceAlert.update({
        where: { id: existing.id },
        data: {
          status: 'PENDING',
          targetPrice: input.targetPrice,
          consentText: ALERT_CONSENT_TEXT,
          consentAt: now,
          confirmedAt: null,
          unsubscribedAt: null,
          confirmSends: 0,
          lastNotifiedAt: null,
          lastNotifiedPrice: null,
        },
      })
    : await prisma.priceAlert.create({
        data: { email: input.email, ...where, targetPrice: input.targetPrice, consentText: ALERT_CONSENT_TEXT, consentAt: now },
      })
  await sendConfirmation(alert.id, input.target.name, input.targetPrice, now)
}

async function sendConfirmation(alertId: string, targetName: string, targetPrice: number | null, now: Date): Promise<void> {
  const settings = await getSettings()
  const alert = await prisma.priceAlert.findUniqueOrThrow({ where: { id: alertId } })
  const mail = confirmMail({ siteTitle: settings.siteTitle, targetName, targetPrice, confirmUrl: alertUrl(alertId) })
  await sendMail({ to: alert.email, ...mail })
  await prisma.priceAlert.update({ where: { id: alertId }, data: { confirmSends: { increment: 1 }, lastConfirmSentAt: now } })
}

export async function confirmAlert(alertId: string): Promise<void> {
  await prisma.priceAlert.updateMany({ where: { id: alertId, status: 'PENDING' }, data: { status: 'ACTIVE', confirmedAt: new Date() } })
}

export async function unsubscribeAlert(alertId: string): Promise<void> {
  await prisma.priceAlert.updateMany({
    where: { id: alertId, status: { in: ['PENDING', 'ACTIVE'] } },
    data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
  })
}

/** Para a página do alerta. */
export async function loadAlert(alertId: string) {
  const a = await prisma.priceAlert.findUnique({
    where: { id: alertId },
    include: { watchItem: { select: { name: true, slug: true } }, product: { select: { name: true, slug: true } } },
  })
  if (!a) return null
  const target = a.product
    ? { name: a.product.name, href: `/produtos/${a.product.slug}` }
    : a.watchItem
      ? { name: a.watchItem.name, href: `/ofertas/${a.watchItem.slug}` }
      : null
  return { id: a.id, status: a.status, email: a.email, targetPrice: num(a.targetPrice), target, confirmedAt: a.confirmedAt, lastNotifiedAt: a.lastNotifiedAt }
}
