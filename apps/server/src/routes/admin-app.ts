import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import { repoRoot } from '../config.js'

/**
 * Painel React em /painel. Em produção serve o build do Vite; em dev, quem
 * serve é o Vite (porta 5173) e esta rota só explica isso.
 */
export async function adminAppRoutes(app: FastifyInstance) {
  const dist = resolve(repoRoot, 'apps/admin/dist')
  const indexFile = resolve(dist, 'index.html')

  if (!existsSync(indexFile)) {
    app.get('/painel', async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send(
          '<!doctype html><meta charset="utf-8"><title>Painel</title><p>O painel ainda não foi compilado. Em desenvolvimento, abra <a href="http://localhost:5173/painel/">http://localhost:5173/painel/</a> (npm run dev). Para produção: npm run build.</p>'
        )
    )
    app.get('/painel/*', async (_req, reply) => reply.redirect('/painel', 302))
    return
  }

  const html = readFileSync(indexFile, 'utf8')
  await app.register(fastifyStatic, {
    root: resolve(dist, 'assets'),
    prefix: '/painel/assets/',
    decorateReply: false,
    immutable: true,
    maxAge: '365d',
  })
  // Qualquer outra rota do painel é a SPA (react-router resolve no navegador).
  const sendIndex = async (_req: unknown, reply: import('fastify').FastifyReply) =>
    reply.header('Cache-Control', 'no-cache').header('X-Robots-Tag', 'noindex').type('text/html; charset=utf-8').send(html)
  app.get('/painel', sendIndex)
  app.get('/painel/', sendIndex)
  app.get('/painel/*', sendIndex)
}
