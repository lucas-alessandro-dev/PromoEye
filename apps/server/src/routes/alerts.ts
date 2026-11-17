import type { FastifyInstance, FastifyReply } from 'fastify'
import { ALERT_CONSENT_TEXT, alertSignupInput } from '@promoeye/shared'
import { prisma } from '../lib/prisma.js'
import { render } from '../lib/render.js'
import { alertsAvailable } from '../services/alerts/notify.js'
import { confirmAlert, loadAlert, signupAlert, unsubscribeAlert, type AlertTarget } from '../services/alerts/signup.js'
import { verifyAlertSignature } from '../services/alerts/tokens.js'

/**
 * Alertas "me avise quando baixar", na vitrine. Tudo funciona sem JavaScript:
 *
 *   POST /alertas                          formulário da página do item/produto
 *   GET  /alertas/:id/:assinatura          ver, confirmar ou cancelar (link do e-mail)
 *   POST /alertas/:id/:assinatura/confirmar
 *   POST /alertas/:id/:assinatura/cancelar  (também o "cancelar inscrição" do Gmail, RFC 8058)
 *
 * Confirmar e cancelar são POST (botão na página), não GET: os antivírus de
 * e-mail abrem os links sozinhos, e um GET que confirma confirmaria por eles.
 */

const MESSAGES: Record<string, { tone: 'ok' | 'err'; text: string }> = {
  enviado: {
    tone: 'ok',
    text: 'Pronto. Se o e-mail estiver certo, chega em instantes um link para você confirmar o alerta (veja também o spam). Sem confirmar, nada é enviado.',
  },
  'erro-email': { tone: 'err', text: 'Confira o e-mail digitado.' },
  'erro-consentimento': { tone: 'err', text: 'Marque a caixa de consentimento para receber o aviso.' },
  'erro-preco': { tone: 'err', text: 'Preço-alvo inválido: use só números, como 299,90. Ou deixe em branco.' },
  erro: { tone: 'err', text: 'Não deu para criar o alerta agora. Tente de novo em alguns minutos.' },
  indisponivel: { tone: 'err', text: 'Os alertas por e-mail estão desligados no momento.' },
}

export interface AlertBoxVM {
  action: string
  kind: 'item' | 'product'
  slug: string
  message: { tone: 'ok' | 'err'; text: string } | null
  consentText: string
  placeholder: string
}

/** A caixa "me avise" da página. null = alertas desligados (sem SMTP ou desligado em Configurações). */
export async function alertBoxVM(opts: { kind: 'item' | 'product'; slug: string; code?: string; bestPrice: number | null }): Promise<AlertBoxVM | null> {
  if (!(await alertsAvailable())) return null
  const suggestion = opts.bestPrice ? Math.floor(opts.bestPrice * 0.9) : null
  return {
    action: '/alertas',
    kind: opts.kind,
    slug: opts.slug,
    message: opts.code ? (MESSAGES[opts.code] ?? null) : null,
    consentText: ALERT_CONSENT_TEXT,
    placeholder: suggestion ? `${suggestion.toLocaleString('pt-BR')},00` : '299,90',
  }
}

const back = (kind: string, slug: string, code: string) =>
  `/${kind === 'product' ? 'produtos' : 'ofertas'}/${encodeURIComponent(slug)}?alerta=${code}#alerta`

async function findTarget(kind: string, slug: string): Promise<AlertTarget | null> {
  if (kind === 'product') {
    const p = await prisma.product.findUnique({ where: { slug }, select: { id: true, name: true } })
    return p ? { kind: 'product', id: p.id, name: p.name } : null
  }
  const i = await prisma.watchItem.findUnique({ where: { slug }, select: { id: true, name: true, active: true } })
  return i?.active ? { kind: 'item', id: i.id, name: i.name } : null
}

function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex')
}

export async function alertRoutes(app: FastifyInstance) {
  app.post<{ Body: Record<string, string> | undefined }>(
    '/alertas',
    { config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = request.body ?? {}
      const kind = body.kind === 'product' ? 'product' : 'item'
      const slug = String(body.slug ?? '').slice(0, 200)
      const target = await findTarget(kind, slug)
      if (!target) return reply.redirect('/', 303)
      if (!(await alertsAvailable())) return reply.redirect(back(kind, slug, 'indisponivel'), 303)

      const parsed = alertSignupInput.safeParse(body)
      if (!parsed.success) {
        const field = String(parsed.error.issues[0]?.path[0] ?? '')
        const code = field === 'consent' ? 'erro-consentimento' : field === 'targetPrice' ? 'erro-preco' : 'erro-email'
        return reply.redirect(back(kind, slug, code), 303)
      }
      // Robô preencheu o campo escondido: responde igual, não grava nada.
      if (parsed.data.website) return reply.redirect(back(kind, slug, 'enviado'), 303)

      try {
        await signupAlert({ email: parsed.data.email, targetPrice: parsed.data.targetPrice, target })
      } catch (err) {
        request.log.error({ err }, 'alertas: falha na inscrição')
        return reply.redirect(back(kind, slug, 'erro'), 303)
      }
      return reply.redirect(back(kind, slug, 'enviado'), 303)
    }
  )

  app.get<{ Params: { id: string; sig: string }; Querystring: { ok?: string } }>('/alertas/:id/:sig', async (request, reply) => {
    const { id, sig } = request.params
    const alert = verifyAlertSignature(id, sig) ? await loadAlert(id) : null
    noStore(reply)
    const { baseContext } = await import('./site.js')
    const base = await baseContext()
    return render(alert ? reply : reply.code(404), 'alert.njk', {
      ...base,
      page: { title: `Seu alerta — ${base.site.title}`, description: 'Confirmar ou cancelar o alerta de preço.', path: '/alertas', noindex: true },
      alert,
      ok: request.query.ok === 'confirmado' || request.query.ok === 'cancelado' ? request.query.ok : null,
      actionBase: alert ? `/alertas/${encodeURIComponent(id)}/${encodeURIComponent(sig)}` : null,
    })
  })

  app.post<{ Params: { id: string; sig: string } }>(
    '/alertas/:id/:sig/confirmar',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const { id, sig } = request.params
      if (!verifyAlertSignature(id, sig)) return reply.redirect('/', 303)
      await confirmAlert(id)
      return noStore(reply).redirect(`/alertas/${encodeURIComponent(id)}/${encodeURIComponent(sig)}?ok=confirmado`, 303)
    }
  )

  app.post<{ Params: { id: string; sig: string }; Body: Record<string, string> | undefined }>(
    '/alertas/:id/:sig/cancelar',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const { id, sig } = request.params
      if (!verifyAlertSignature(id, sig)) return reply.code(404).send('Link inválido.')
      await unsubscribeAlert(id)
      // Cancelamento em um clique pelo provedor de e-mail: só precisa do 200.
      if (request.body?.['List-Unsubscribe'] === 'One-Click') return noStore(reply).type('text/plain; charset=utf-8').send('Alerta cancelado.')
      return noStore(reply).redirect(`/alertas/${encodeURIComponent(id)}/${encodeURIComponent(sig)}?ok=cancelado`, 303)
    }
  )
}
