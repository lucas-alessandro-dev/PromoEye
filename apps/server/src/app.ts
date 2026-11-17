import { resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { appRoot, config, isProd } from './config.js'
import { authPlugin } from './plugins/auth.js'
import { securityPlugin } from './plugins/security.js'
import { authRoutes } from './routes/api/auth.js'
import { dashboardRoutes } from './routes/api/dashboard.js'
import { itemRoutes } from './routes/api/items.js'
import { offerRoutes } from './routes/api/offers.js'
import { storeRoutes } from './routes/api/stores.js'
import { messageRoutes } from './routes/api/messages.js'
import { whatsappRoutes } from './routes/api/whatsapp.js'
import { goRoutes } from './routes/go.js'
import { adminAppRoutes } from './routes/admin-app.js'
import { renderNotFound, siteRoutes } from './routes/site.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Número de saltos confiáveis (1 = o Nginx). O proxy-addr aceita número;
    // os tipos do Fastify é que não declaram.
    trustProxy: config.TRUST_PROXY as unknown as boolean,
    logger: isProd
      ? { level: 'info' }
      : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    bodyLimit: 256 * 1024,
  })

  // JSON com corpo vazio vira `undefined` em vez de 400: o painel manda o mesmo
  // Content-Type em todo pedido, inclusive DELETE e POST sem corpo.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8')
    if (!text.trim()) return done(null, undefined)
    try {
      done(null, JSON.parse(text))
    } catch {
      const err = new Error('JSON inválido') as Error & { statusCode: number }
      err.statusCode = 400
      done(err, undefined)
    }
  })

  await app.register(securityPlugin)
  await app.register(cookie, { secret: config.SESSION_SECRET })
  await app.register(rateLimit, { global: false })
  await app.register(authPlugin)

  // /static: o CSS e as imagens da própria vitrine.
  await app.register(fastifyStatic, {
    root: resolve(appRoot, 'public/site'),
    prefix: '/static/',
    maxAge: isProd ? '7d' : 0,
  })
  // /assets: o kit da taste-skill (MIT), copiado sem edição — ver public/assets/LICENSE-taste-skill.txt.
  await app.register(fastifyStatic, {
    root: resolve(appRoot, 'public/assets'),
    prefix: '/assets/',
    decorateReply: false,
    maxAge: isProd ? '7d' : 0,
  })

  app.get('/healthz', async () => ({ ok: true }))

  await app.register(
    async (api) => {
      await api.register(authRoutes)
      await api.register(dashboardRoutes)
      await api.register(itemRoutes)
      await api.register(offerRoutes)
      await api.register(storeRoutes)
      await api.register(messageRoutes)
      await api.register(whatsappRoutes)
    },
    { prefix: '/api/admin' }
  )

  await app.register(goRoutes)
  await app.register(adminAppRoutes)
  await app.register(siteRoutes)

  // Endereço desconhecido: a API responde JSON; quem navega vê a página 404 da vitrine
  // (antes recebia o JSON cru do Fastify).
  app.setNotFoundHandler(async (request, reply) => {
    const wantsPage = request.method === 'GET' && !request.url.startsWith('/api/') && (request.headers.accept ?? '').includes('text/html')
    if (!wantsPage) return reply.code(404).send({ error: 'Não encontrado.' })
    return renderNotFound(request, reply)
  })

  return app
}
