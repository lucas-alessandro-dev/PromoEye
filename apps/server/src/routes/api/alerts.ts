import type { FastifyInstance } from 'fastify'
import type { AlertDTO, AlertsDTO } from '@promoeye/shared'
import { publicUrl } from '../../config.js'
import { num, prisma } from '../../lib/prisma.js'
import { smtpConfigured } from '../../services/alerts/mailer.js'
import { getSettings } from '../../services/settings.js'

/**
 * Painel: os alertas de preço (leads da vitrine).
 *
 *   GET    /api/admin/alerts           resumo e os 500 mais recentes
 *   GET    /api/admin/alerts.csv       exportação (só os confirmados e ativos)
 *   DELETE /api/admin/alerts/:id       apaga de vez (pedido de exclusão, LGPD)
 */

type AlertRow = Awaited<ReturnType<typeof loadAlerts>>[number]

function loadAlerts(take: number, where: object = {}) {
  return prisma.priceAlert.findMany({
    where,
    include: { watchItem: { select: { name: true, slug: true } }, product: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  })
}

function alertDTO(a: AlertRow): AlertDTO {
  const target = a.product
    ? { kind: 'product' as const, name: a.product.name, url: `${publicUrl}/produtos/${a.product.slug}` }
    : { kind: 'item' as const, name: a.watchItem?.name ?? '(item apagado)', url: a.watchItem ? `${publicUrl}/ofertas/${a.watchItem.slug}` : publicUrl }
  return {
    id: a.id,
    email: a.email,
    status: a.status,
    targetPrice: num(a.targetPrice),
    target,
    createdAt: a.createdAt.toISOString(),
    confirmedAt: a.confirmedAt?.toISOString() ?? null,
    unsubscribedAt: a.unsubscribedAt?.toISOString() ?? null,
    lastNotifiedAt: a.lastNotifiedAt?.toISOString() ?? null,
    lastNotifiedPrice: num(a.lastNotifiedPrice),
    notifyCount: a.notifyCount,
  }
}

/** CSV que abre certo no Excel em português: ";" como separador e BOM UTF-8. */
const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v)
  // Fórmula no começo da célula vira código no Excel (CSV injection): prefixa com apóstrofo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export async function alertAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  app.get('/alerts', async (): Promise<AlertsDTO> => {
    const week = new Date(Date.now() - 7 * 86_400_000)
    const [settings, pending, active, unsubscribed, notified7d, rows] = await Promise.all([
      getSettings(),
      prisma.priceAlert.count({ where: { status: 'PENDING' } }),
      prisma.priceAlert.count({ where: { status: 'ACTIVE' } }),
      prisma.priceAlert.count({ where: { status: 'UNSUBSCRIBED' } }),
      prisma.priceAlert.count({ where: { lastNotifiedAt: { gte: week } } }),
      loadAlerts(500),
    ])
    return {
      smtpConfigured: smtpConfigured(),
      enabled: settings.alerts.enabled,
      counts: { pending, active, unsubscribed, notified7d },
      alerts: rows.map(alertDTO),
    }
  })

  app.get('/alerts.csv', async (_request, reply) => {
    const rows = await loadAlerts(50_000, { status: 'ACTIVE' })
    const header = ['email', 'alvo', 'tipo', 'preco_alvo', 'confirmado_em', 'avisos_enviados', 'ultimo_aviso']
    const lines = rows.map(alertDTO).map((a) =>
      [a.email, a.target.name, a.target.kind === 'product' ? 'produto' : 'item', a.targetPrice, a.confirmedAt, a.notifyCount, a.lastNotifiedAt]
        .map(csvCell)
        .join(';')
    )
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="promoeye-alertas-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(`﻿${[header.join(';'), ...lines].join('\r\n')}`)
  })

  app.delete<{ Params: { id: string } }>('/alerts/:id', async (request, reply) => {
    await prisma.priceAlert.deleteMany({ where: { id: request.params.id } })
    return reply.code(204).send()
  })
}
