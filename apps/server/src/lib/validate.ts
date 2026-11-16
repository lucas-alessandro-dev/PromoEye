import type { FastifyReply } from 'fastify'
import type { ZodType, ZodTypeDef } from 'zod'

/**
 * Valida o corpo com o schema compartilhado. Em erro, responde 400 com a
 * lista de campos (o painel mostra cada mensagem embaixo do seu campo) e
 * devolve `null` — quem chama só faz `if (!data) return reply`.
 */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown, reply: FastifyReply): T | null {
  const res = schema.safeParse(body ?? {})
  if (res.success) return res.data
  reply.code(400).send({
    error: 'Confira os campos destacados.',
    issues: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  })
  return null
}
