import { hasAffiliateMarker, isUrlWithoutMarker } from '@promoeye/shared'
import type { AffiliateCheckDTO, AffiliateCheckRow, AffiliateMode, CheckStatus } from '@promoeye/shared'
import { config } from '../config.js'
import { prisma } from '../lib/prisma.js'
import { buildOutboundUrl, isSafeOutbound } from './affiliate.js'

/**
 * Confere os links de afiliado antes que a Black Friday descubra o problema
 * por você: link quebrado não dá erro, só deixa de pagar comissão.
 *
 * Para cada loja: monta o link que o /ir/ geraria para uma oferta REAL dela e
 * confere https, domínio, parâmetro e o formato da tag. Com `live`, segue os
 * redirecionamentos (sem baixar a página) e vê onde o link vai parar.
 */

/** Redes e encurtadores de afiliado conhecidos no Brasil. Outro domínio vira aviso, não erro. */
const NETWORK_HOSTS = [
  'awin1.com',
  'tidd.ly',
  'linksynergy.com',
  'click.linksynergy.com',
  'lomadee.com',
  'redir.lomadee.com',
  'admitad.com',
  'ad.admitad.com',
  'afilio.com.br',
  'v2.afilio.com.br',
  'rakuten.com.br',
  'mercadolivre.com',
  'mercadolivre.com.br',
  'meli.la',
  'magazinevoce.com.br',
  'divulgador.magalu.com',
  'amzn.to',
  'onelink.me',
]

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

const sameSite = (host: string, domain: string) => {
  const d = domain.toLowerCase().replace(/^www\./, '')
  return host === d || host.endsWith(`.${d}`)
}
const knownNetwork = (host: string) => NETWORK_HOSTS.some((n) => host === n || host.endsWith(`.${n}`))

/** Onde o afiliado vende com a vitrine da própria loja: chegar lá é chegar na loja. */
const AFFILIATE_STOREFRONTS: Record<string, string[]> = {
  'magazineluiza.com.br': ['magazinevoce.com.br'],
}
const storeHost = (host: string, domain: string) =>
  sameSite(host, domain) ||
  (AFFILIATE_STOREFRONTS[domain.toLowerCase().replace(/^www\./, '')] ?? []).some((h) => host === h || host.endsWith(`.${h}`))

const pathOf = (url: string): string => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return ''
  }
}

const worst = (a: CheckStatus, b: CheckStatus): CheckStatus => {
  const rank: Record<CheckStatus, number> = { none: 0, ok: 1, warn: 2, error: 3 }
  return rank[b] > rank[a] ? b : a
}

export interface StoreLite {
  id: string
  name: string
  domain: string
  affiliateTemplate: string | null
}

export interface SampleOffer {
  id: string
  url: string
  externalId: string
}

/** A parte sem rede: o modelo da loja aplicado a uma oferta de verdade. */
export function checkStoreTemplate(store: StoreLite, sample: SampleOffer | null): AffiliateCheckRow {
  const template = store.affiliateTemplate?.trim() || null
  const base: AffiliateCheckRow = {
    storeId: store.id,
    storeName: store.name,
    mode: 'none',
    status: 'none',
    messages: [],
    sampleOfferId: sample?.id ?? null,
    sampleUrl: null,
    finalUrl: null,
    hops: null,
  }
  if (!template) return { ...base, messages: ['Sem afiliado: o clique vai para a loja sem comissão.'] }

  const productUrl = sample?.url ?? `https://${store.domain.replace(/^https?:\/\//, '')}/`
  if (isUrlWithoutMarker(template)) {
    return {
      ...base,
      mode: 'param',
      status: 'error',
      sampleUrl: productUrl,
      messages: [
        'O modelo é um link inteiro sem marcador, então o clique vai para a loja sem comissão. Ponha {path} (loja de afiliado, como a da Magalu) ou {url_encoded} (rede) onde entra o produto, ou use parametro=valor.',
      ],
    }
  }
  const wrapper = hasAffiliateMarker(template)
  const mode: AffiliateMode = wrapper ? 'wrapper' : 'param'
  const out = buildOutboundUrl(productUrl, { template, externalId: sample?.externalId })
  let status: CheckStatus = 'ok'
  const messages: string[] = []
  if (!sample) {
    status = 'warn'
    messages.push('Ainda não há oferta desta loja para testar com um produto real; testei com a página inicial.')
  }

  if (!isSafeOutbound(out)) {
    return { ...base, mode, status: 'error', sampleUrl: out, messages: [...messages, 'O link gerado não é https: o /ir/ manda para a vitrine em vez da loja.'] }
  }
  const host = hostOf(out)!

  if (wrapper) {
    if (template.includes('{url}') && /[?&][^=]+=\{url\}/.test(template)) {
      status = worst(status, 'warn')
      messages.push('O modelo põe {url} dentro de um parâmetro sem codificar: prefira {url_encoded}.')
    }
    if (!sameSite(host, store.domain) && !knownNetwork(host)) {
      status = worst(status, 'warn')
      messages.push(`O link sai por ${host}, que não é a loja nem uma rede conhecida. Confira se é a sua rede de afiliados.`)
    }
    const carriesProduct =
      out.includes(encodeURIComponent(productUrl)) ||
      out.includes(productUrl) ||
      (template.includes('{id}') && sample !== null) ||
      (template.includes('{path}') && pathOf(productUrl) !== '' && out.includes(pathOf(productUrl)))
    if (!carriesProduct) {
      status = worst(status, 'error')
      messages.push('O link gerado não leva o endereço do produto: a rede não vai saber para onde mandar.')
    }
  } else {
    const params = [...new URLSearchParams(template.replace(/^[?&]/, '')).entries()]
    if (!params.length || params.some(([k]) => !k)) {
      return { ...base, mode, status: 'error', sampleUrl: out, messages: [...messages, 'Modelo inválido: use "parametro=valor" (ex.: tag=seutag-20) ou um link com {url_encoded}.'] }
    }
    if (!sameSite(host, store.domain)) {
      status = worst(status, 'warn')
      messages.push(`O produto não está no domínio da loja (${store.domain}): o parâmetro pode não valer lá.`)
    }
    const url = new URL(out)
    for (const [k, v] of params) {
      if (url.searchParams.get(k) !== v) {
        status = worst(status, 'error')
        messages.push(`O parâmetro ${k} não ficou no link gerado.`)
      }
    }
    if (store.id === 'amazon' || /amazon\./i.test(store.domain)) {
      const tag = url.searchParams.get('tag')
      if (!tag) {
        status = worst(status, 'error')
        messages.push('A Amazon identifica o associado pelo parâmetro tag= (ex.: tag=seutag-20).')
      } else if (!/^[\w.-]+-20$/.test(tag)) {
        status = worst(status, 'warn')
        messages.push(`A tag "${tag}" não termina em -20, o padrão da Amazon Brasil. Confira no painel de Associados.`)
      }
    }
  }
  if (status === 'ok') messages.push(wrapper ? `Sai pela rede ${host} e leva o produto.` : 'Parâmetro aplicado no link do produto.')
  return { ...base, mode, status, sampleUrl: out, messages }
}

/** Link de afiliado colado à mão numa oferta (Mercado Livre, Magalu…). */
export function checkOfferLink(store: StoreLite, offer: { id: string; affiliateUrl: string }): AffiliateCheckRow {
  const row: AffiliateCheckRow = {
    storeId: store.id,
    storeName: store.name,
    mode: 'offer',
    status: 'ok',
    messages: [],
    sampleOfferId: offer.id,
    sampleUrl: offer.affiliateUrl,
    finalUrl: null,
    hops: null,
  }
  if (!isSafeOutbound(offer.affiliateUrl)) return { ...row, status: 'error', messages: ['O link não é https: o /ir/ manda para a vitrine em vez da loja.'] }
  const host = hostOf(offer.affiliateUrl)!
  if (!sameSite(host, store.domain) && !knownNetwork(host)) {
    return { ...row, status: 'warn', messages: [`O link sai por ${host}, que não é a loja nem uma rede conhecida.`] }
  }
  return { ...row, messages: ['Link https para a loja ou uma rede conhecida.'] }
}

/** Segue até 6 redirecionamentos sem baixar a página. */
export async function followRedirects(url: string, timeoutMs = 8000): Promise<{ finalUrl: string; hops: number; status: number }> {
  let current = url
  for (let hops = 0; hops <= 6; hops++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': config.COLLECT_USER_AGENT, Accept: 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      })
      await res.body?.cancel().catch(() => undefined)
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).toString()
        continue
      }
      return { finalUrl: current, hops, status: res.status }
    } finally {
      clearTimeout(timer)
    }
  }
  return { finalUrl: current, hops: 7, status: 0 }
}

async function liveCheck(row: AffiliateCheckRow, store: StoreLite, template: string | null): Promise<AffiliateCheckRow> {
  if (!row.sampleUrl || row.status === 'error' || row.status === 'none') return row
  try {
    const r = await followRedirects(row.sampleUrl)
    const host = hostOf(r.finalUrl) ?? ''
    const out = { ...row, finalUrl: r.finalUrl, hops: r.hops, messages: [...row.messages] }
    if (r.status === 403 || r.status === 429 || r.status === 503) {
      out.status = worst(out.status, 'warn')
      out.messages.push(`A loja recusou a conferência automática (HTTP ${r.status}); abra o link no navegador para confirmar.`)
      return out
    }
    if (!storeHost(host, store.domain) && row.mode !== 'offer') {
      out.status = worst(out.status, 'warn')
      out.messages.push(`Depois de ${r.hops} redirecionamento(s), o link parou em ${host}, não na loja.`)
    }
    if (row.mode === 'param' && template) {
      const lost = [...new URLSearchParams(template.replace(/^[?&]/, '')).keys()].filter((k) => !new URL(r.finalUrl).searchParams.has(k))
      if (lost.length && r.hops > 0) {
        out.status = worst(out.status, 'warn')
        out.messages.push(`O redirecionamento da loja tirou ${lost.join(', ')} do link; confira se a comissão ainda é atribuída (cookie).`)
      }
    }
    if (out.status === 'ok') out.messages.push(`Ao vivo: chegou em ${host} em ${r.hops} redirecionamento(s).`)
    return out
  } catch (err) {
    return { ...row, status: worst(row.status, 'warn'), messages: [...row.messages, `Não deu para conferir ao vivo: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

export async function runAffiliateCheck(opts: { live: boolean }): Promise<AffiliateCheckDTO> {
  const stores = await prisma.store.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } })
  const rows: AffiliateCheckRow[] = []
  for (const s of stores) {
    const sample = await prisma.offer.findFirst({
      where: { storeId: s.id, hidden: false, affiliateUrl: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, url: true, externalId: true },
    })
    let row = checkStoreTemplate(s, sample)
    if (opts.live) row = await liveCheck(row, s, s.affiliateTemplate)
    rows.push(row)
  }
  const manual = await prisma.offer.findMany({
    where: { affiliateUrl: { not: null }, hidden: false },
    include: { store: true },
    orderBy: { lastSeenAt: 'desc' },
    take: 60,
  })
  const offerLinks: AffiliateCheckRow[] = []
  for (const o of manual) {
    let row = checkOfferLink(o.store, { id: o.id, affiliateUrl: o.affiliateUrl! })
    if (opts.live) row = await liveCheck(row, o.store, null)
    offerLinks.push(row)
  }
  return { checkedAt: new Date().toISOString(), live: opts.live, rows, offerLinks }
}
