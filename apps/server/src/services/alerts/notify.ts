import type { Prisma } from '@prisma/client'
import { FRESH_MS } from '../../collector/fresh.js'
import { publicUrl } from '../../config.js'
import { sleep } from '../../lib/http.js'
import { num, numReq, prisma } from '../../lib/prisma.js'
import { getSettings } from '../settings.js'
import { sendMail, smtpConfigured } from './mailer.js'
import { alertMail, notifyDecision, type BestOffer } from './rules.js'
import { alertUnsubscribeUrl, alertUrl } from './tokens.js'

/**
 * Depois de cada coleta: para cada alerta ativo, olha o menor preço
 * disponível do item (ou do produto) e manda o e-mail se a regra deixar
 * (services/alerts/rules.ts). Um e-mail por vez, com teto por coleta.
 */

const MAX_PER_RUN = 300
const GAP_MS = 150

/** Mesmo critério da vitrine: visível, loja ativa, disponível e visto na última coleta (ou manual). */
const offerWhere = (): Prisma.OfferWhereInput => ({
  hidden: false,
  available: true,
  store: { enabled: true },
  OR: [{ source: 'MANUAL' }, { lastSeenAt: { gte: new Date(Date.now() - FRESH_MS) } }],
})

async function bestFor(where: Prisma.OfferWhereInput): Promise<BestOffer | null> {
  const o = await prisma.offer.findFirst({ where: { ...offerWhere(), ...where }, orderBy: { price: 'asc' }, include: { store: true } })
  if (!o) return null
  return {
    offerId: o.id,
    title: o.title,
    storeName: o.store.name,
    imageUrl: o.imageUrl,
    price: numReq(o.price),
    pixPrice: num(o.pixPrice),
    listPrice: num(o.listPrice),
    available: o.available,
    isDeal: o.isDeal,
    flags: o.flags,
    realDiscountPct: o.realDiscountPct,
  }
}

/** Os alertas estão ligados (SMTP no .env e a chave em Configurações)? */
export async function alertsAvailable(): Promise<boolean> {
  if (!smtpConfigured()) return false
  return (await getSettings()).alerts.enabled
}

export async function processAlerts(opts: { log?: (m: string) => void; now?: Date } = {}): Promise<{ notified: number; failed: number }> {
  if (!(await alertsAvailable())) return { notified: 0, failed: 0 }
  const now = opts.now ?? new Date()
  const settings = await getSettings()
  const alerts = await prisma.priceAlert.findMany({
    where: { status: 'ACTIVE' },
    include: { watchItem: { select: { id: true, name: true, slug: true, active: true } }, product: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
    take: 20_000,
  })

  const bestCache = new Map<string, BestOffer | null>()
  let notified = 0
  let failed = 0
  for (const a of alerts) {
    if (notified >= MAX_PER_RUN) break
    const target = a.product
      ? { key: `p:${a.product.id}`, where: { productId: a.product.id }, name: a.product.name, url: `${publicUrl}/produtos/${a.product.slug}` }
      : a.watchItem && a.watchItem.active
        ? { key: `i:${a.watchItem.id}`, where: { watchItemId: a.watchItem.id }, name: a.watchItem.name, url: `${publicUrl}/ofertas/${a.watchItem.slug}` }
        : null
    if (!target) continue
    if (!bestCache.has(target.key)) bestCache.set(target.key, await bestFor(target.where))
    const best = bestCache.get(target.key) ?? null

    const decision = notifyDecision(
      { status: a.status, targetPrice: num(a.targetPrice), lastNotifiedAt: a.lastNotifiedAt, lastNotifiedPrice: num(a.lastNotifiedPrice) },
      best,
      now
    )
    if (!decision.send || !best) continue

    const mail = alertMail({
      siteTitle: settings.siteTitle,
      targetName: target.name,
      targetUrl: target.url,
      reason: decision.reason,
      targetPrice: num(a.targetPrice),
      best,
      goUrl: `${publicUrl}/ir/${best.offerId}?c=email`,
      manageUrl: alertUrl(a.id),
      disclosure: settings.affiliateDisclosure,
    })
    try {
      await sendMail({ to: a.email, ...mail, unsubscribeUrl: alertUnsubscribeUrl(a.id) })
      await prisma.priceAlert.update({
        where: { id: a.id },
        data: { lastNotifiedAt: now, lastNotifiedPrice: best.price, notifyCount: { increment: 1 } },
      })
      notified++
    } catch (err) {
      failed++
      opts.log?.(`alertas: falha ao enviar para o alerta ${a.id} — ${err instanceof Error ? err.message : String(err)}`)
      // SMTP fora do ar: não adianta insistir com os outros nesta coleta.
      if (failed >= 5 && notified === 0) break
    }
    await sleep(GAP_MS)
  }
  return { notified, failed }
}
