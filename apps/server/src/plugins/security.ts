import { randomBytes } from 'node:crypto'
import fp from 'fastify-plugin'
import helmet from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'
import { isProd } from '../config.js'

declare module 'fastify' {
  interface FastifyReply {
    /** Nonce dos scripts inline desta resposta. */
    peNonce: string
  }
}

/**
 * Cabeçalhos de segurança + CSP por requisição + proteção CSRF da API.
 *
 * Imagens: as fotos dos produtos vêm dos CDNs das lojas (vtexassets,
 * media-amazon, images.kabum…). Liberamos `img-src https:` em vez de manter
 * uma lista que quebra a cada loja nova; imagem não executa código.
 */
export const securityPlugin = fp(async (app: FastifyInstance) => {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  })

  app.decorateReply('peNonce', '')
  app.addHook('onRequest', async (_request, reply) => {
    reply.peNonce = randomBytes(16).toString('base64')
  })

  // CSRF: a API só aceita escrita com um cabeçalho que um formulário ou
  // <img> de outro site não consegue mandar (exigiria preflight CORS, que
  // não liberamos). Somado ao cookie SameSite=Strict, fecha a porta.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return
    if (request.headers['x-promoeye'] !== '1') {
      reply.code(403).send({ error: 'Requisição recusada (cabeçalho de segurança ausente).' })
      return reply
    }
    return undefined
  })

  app.addHook('onSend', async (_request, reply, payload) => {
    const type = reply.getHeader('content-type')
    if (typeof type !== 'string' || !type.includes('text/html')) return payload
    const connect = ["'self'"]
    if (!isProd) connect.push('ws:', 'http://localhost:*')
    const directives = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${reply.peNonce}'`,
      // Google Fonts: a vitrine carrega a Mona Sans de lá, como a taste-skill pede.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src ${connect.join(' ')}`,
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      ...(isProd ? ['upgrade-insecure-requests'] : []),
    ]
    reply.header('Content-Security-Policy', directives.join('; '))
    return payload
  })
})
