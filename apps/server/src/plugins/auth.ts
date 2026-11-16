import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { MeDTO } from '@promoeye/shared'
import { prisma } from '../lib/prisma.js'
import { config, isProd } from '../config.js'

export const SESSION_COOKIE = 'pe_admin'

declare module 'fastify' {
  interface FastifyRequest {
    user?: MeDTO
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>
  }
}

export async function createSession(userId: string, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000)
  await prisma.adminSession.create({
    data: { id, userId, expiresAt, userAgent: (request.headers['user-agent'] ?? '').slice(0, 300) || null },
  })
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    // Strict: o cookie nunca vai junto numa requisição vinda de outro site.
    sameSite: 'strict',
    secure: isProd,
    signed: true,
    expires: expiresAt,
  })
}

function readSessionId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE]
  if (!raw) return null
  const unsigned = request.unsignCookie(raw)
  return unsigned.valid && unsigned.value ? unsigned.value : null
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = readSessionId(request)
  if (id) await prisma.adminSession.deleteMany({ where: { id } })
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

/** Usuário da sessão, ou `null` se ausente, expirada ou revogada. */
export async function currentUser(request: FastifyRequest): Promise<MeDTO | null> {
  if (request.user) return request.user
  const id = readSessionId(request)
  if (!id) return null
  const session = await prisma.adminSession.findUnique({ where: { id }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.adminSession.delete({ where: { id } }).catch(() => undefined)
    return null
  }
  request.user = { id: session.user.id, email: session.user.email, name: session.user.name }
  return request.user
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', undefined)
  // `return reply` é obrigatório em hook async que responde: sem isso o
  // Fastify segue para o handler e a rota roda mesmo sem sessão.
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentUser(request)
    if (!user) {
      reply.code(401).send({ error: 'Faça login para continuar.' })
      return reply
    }
    return undefined
  })
})
