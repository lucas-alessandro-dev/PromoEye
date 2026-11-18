import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import nunjucks from 'nunjucks'
import type { FastifyReply } from 'fastify'
import { DEAL_FLAGS, flagLabel, flagTone, formatBRL, formatBRLShort, formatPct, listDiscount, timeAgo } from '@promoeye/shared'
import { appRoot, isProd } from '../config.js'

/** Um único ambiente Nunjucks, com os filtros da vitrine. */
const env = nunjucks.configure(resolve(appRoot, 'src/views'), {
  autoescape: true,
  noCache: !isProd,
  throwOnUndefined: false,
})

env.addFilter('brl', (v: number | null) => formatBRL(v))
env.addFilter('brlShort', (v: number | null) => formatBRLShort(v))
env.addFilter('pct', (v: number | null) => formatPct(v))
env.addFilter('ago', (v: Date | string | null) => timeAgo(v))
env.addFilter('flagLabel', (f: string) => flagLabel(f))
env.addFilter('flagTone', (f: string) => flagTone(f))
env.addFilter('flagHint', (f: string) => (DEAL_FLAGS as Record<string, { hint: string }>)[f]?.hint ?? '')
env.addFilter('listOff', (price: number, list: number | null) => listDiscount(price, list))
/** Parte inteira e centavos separados, para o preço grande da vitrine. */
env.addFilter('priceParts', (v: number) => {
  const [int, cents] = v.toFixed(2).split('.')
  return { int: Number(int).toLocaleString('pt-BR'), cents: cents ?? '00' }
})
env.addFilter('dateBR', (v: Date | string) =>
  new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
)
env.addFilter('dateLong', (v: Date | string) =>
  new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long' })
)
env.addFilter('hourBR', (v: Date | string) =>
  new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
)

/**
 * Versão dos arquivos de /static (site.css, shop.js): um hash do conteúdo que
 * vai no endereço (?v=…). Eles são servidos com cache de 7 dias; sem a versão,
 * quem já tinha visitado continuava com o CSS antigo por até uma semana depois
 * de cada deploy (página nova + CSS velho = ícone gigante, botão sem estilo).
 * O kit de /assets não entra: não é editado, e versionar módulos que importam
 * uns aos outros faria o navegador carregar duas cópias.
 */
const STATIC_DIR = resolve(appRoot, 'public/site')
const LOGO_DIR = resolve(STATIC_DIR, 'logos')
const LOGO_EXT = ['svg', 'webp', 'png'] as const

/** Arquivos de public/site e de public/site/logos (um nível), em ordem estável. */
function staticFiles(): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  for (const [dir, prefix] of [[STATIC_DIR, ''], [LOGO_DIR, 'logos/']] as const) {
    let names: string[] = []
    try {
      names = readdirSync(dir).sort()
    } catch {
      continue // sem pasta de logos: tudo bem
    }
    for (const name of names) {
      const abs = resolve(dir, name)
      if (statSync(abs).isFile()) out.push({ rel: prefix + name, abs })
    }
  }
  return out
}

function computeStaticState(): { version: string; logos: Map<string, string> } {
  const h = createHash('sha256')
  const logos = new Map<string, string>()
  const files = staticFiles()
  for (const f of files) {
    h.update(f.rel)
    h.update(readFileSync(f.abs))
  }
  const version = h.digest('hex').slice(0, 10)
  // Logo de cada loja: logos/<id>.svg (ou .webp/.png), com a mesma versão no endereço.
  for (const ext of [...LOGO_EXT].reverse()) {
    for (const f of files) {
      const m = f.rel.match(new RegExp(`^logos/([a-z0-9-]+)\\.${ext}$`))
      if (m) logos.set(m[1]!, `/static/${f.rel}?v=${version}`)
    }
  }
  return { version, logos }
}

// Em produção os arquivos não mudam com o servidor no ar; em dev, recalcula a cada página.
const prodState = isProd ? computeStaticState() : null
const staticState = () => prodState ?? computeStaticState()
export const staticVersion = (): string => staticState().version

/** Endereço do logo da loja, ou null (a página mostra o nome em texto). */
export function storeLogo(storeId: string | null | undefined): string | null {
  return storeId ? (staticState().logos.get(storeId) ?? null) : null
}
env.addFilter('storeLogo', (id: string) => storeLogo(id))

export function render(reply: FastifyReply, template: string, ctx: Record<string, unknown>): FastifyReply {
  const html = env.render(template, { ...ctx, nonce: reply.peNonce, v: staticVersion() })
  return reply.type('text/html; charset=utf-8').send(html)
}
