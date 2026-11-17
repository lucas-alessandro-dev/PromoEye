import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { isSafeOutbound } from '../services/affiliate.js'
import { outboundFor } from '../services/dto.js'

/**
 * /ir/:id — todo clique para a loja passa por aqui.
 *
 * 1. aplica o link de afiliado (da oferta ou o modelo da loja);
 * 2. conta o clique (só o domínio de origem e o canal; nada de IP);
 * 3. redireciona com 302 — temporário, porque o destino muda quando você
 *    troca o afiliado.
 *
 * Só redireciona para https. Um id inexistente vai para a vitrine, nunca
 * para uma URL arbitrária: isto não é um redirecionador aberto.
 */
// "bot/" e "bot-" (Googlebot/2.1, Slackbot-LinkExpanding) ou "bot" como palavra
// solta — e não qualquer "bot", senão o celular Cubot ("CUBOT X30") deixaria de contar.
const PREVIEW_BOTS =
  /bot[/-]|\bbot\b|crawler|spider|preview|facebookexternalhit|whatsapp\/|telegram|slack|discord|skype|go-http-client|okhttp|node-fetch|undici|axios|python|curl\/|wget/i

/** Robô de prévia de link ou cliente HTTP genérico (sem navegador). */
export function isLinkPreviewBot(ua: string | undefined): boolean {
  return !ua || PREVIEW_BOTS.test(ua)
}

export async function goRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { c?: string } }>(
    '/ir/:id',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const offer = await prisma.offer.findUnique({ where: { id: request.params.id }, include: { store: true } })
      if (!offer) return reply.redirect('/', 302)

      const target = outboundFor(offer)
      if (!isSafeOutbound(target)) return reply.redirect('/', 302)

      let referrer: string | null = null
      try {
        const ref = request.headers.referer
        referrer = ref ? new URL(ref).hostname.slice(0, 120) : null
      } catch {
        referrer = null
      }
      const channel = request.query.c === 'wa' ? 'whatsapp' : request.query.c === 'email' ? 'email' : 'site'
      // A prévia do link (WhatsApp, WAHA, redes sociais) abre a URL sozinha;
      // isso não é gente clicando.
      if (!isLinkPreviewBot(request.headers['user-agent'])) {
        prisma.click.create({ data: { offerId: offer.id, referrer, channel } }).catch(() => undefined)
      }

      reply.header('Cache-Control', 'no-store')
      reply.header('Referrer-Policy', 'no-referrer-when-downgrade')
      return reply.redirect(target, 302)
    }
  )
}
