import argon2 from 'argon2'
import type { FastifyInstance } from 'fastify'
import { loginInput } from '@promoeye/shared'
import { prisma } from '../../lib/prisma.js'
import { parse } from '../../lib/validate.js'
import { createSession, currentUser, destroySession } from '../../plugins/auth.js'

/**
 * Hash usado quando o e-mail não existe, para o tempo de resposta ser igual
 * ao de uma senha errada — senão dá para descobrir quais e-mails têm conta.
 */
let dummyHash: string | null = null
async function dummy(): Promise<string> {
  dummyHash ??= await argon2.hash('promoeye-dummy-password')
  return dummyHash
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/login',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const data = parse(loginInput, request.body, reply)
      if (!data) return reply

      const user = await prisma.adminUser.findUnique({ where: { email: data.email } })
      const ok = await argon2.verify(user?.passwordHash ?? (await dummy()), data.password).catch(() => false)
      if (!user || !ok) {
        return reply.code(401).send({ error: 'E-mail ou senha incorretos.' })
      }
      await createSession(user.id, request, reply)
      await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      return { id: user.id, email: user.email, name: user.name }
    }
  )

  app.post('/logout', async (request, reply) => {
    await destroySession(request, reply)
    return reply.code(204).send()
  })

  app.get('/me', async (request, reply) => {
    const user = await currentUser(request)
    if (!user) return reply.code(401).send({ error: 'Faça login para continuar.' })
    return user
  })
}
