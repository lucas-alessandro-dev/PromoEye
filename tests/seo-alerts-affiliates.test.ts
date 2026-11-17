import { describe, expect, it } from 'vitest'
import { alertSignupInput, parseMoneyInput } from '@promoeye/shared'
import { breadcrumbLd, itemLd, jsonLdScript, productLd } from '../apps/server/src/lib/jsonld.js'
import { alertMail, confirmMail, notifyDecision, RENOTIFY_MIN_MS, type BestOffer } from '../apps/server/src/services/alerts/rules.js'
import { alertSignature, alertUrl, verifyAlertSignature } from '../apps/server/src/services/alerts/tokens.js'
import { checkOfferLink, checkStoreTemplate } from '../apps/server/src/services/affiliate-check.js'

// ── JSON-LD ─────────────────────────────────────────────────────────────────

describe('JSON-LD', () => {
  const offers = [
    { price: 459.9, storeName: 'Britânia', available: true },
    { price: 489.0, storeName: 'Americanas', available: true },
    { price: 399.0, storeName: 'Carrefour', available: false },
  ]

  it('Product + AggregateOffer com a faixa das lojas DISPONÍVEIS, em BRL', () => {
    const ld = productLd({ name: 'Air Fryer BFR38', url: 'https://promoeye.example/produtos/x', images: ['https://img/1.jpg'], brand: 'Britânia', gtin: '7899963914386', offers })!
    expect(ld).toMatchObject({
      '@type': 'Product',
      gtin: '7899963914386',
      brand: { '@type': 'Brand', name: 'Britânia' },
      offers: { '@type': 'AggregateOffer', priceCurrency: 'BRL', lowPrice: 459.9, highPrice: 489, offerCount: 2 },
    })
    const inner = (ld.offers as { offers: { availability: string }[] }).offers
    expect(inner.map((o) => o.availability.split('/').pop())).toEqual(['InStock', 'InStock', 'OutOfStock'])
  })

  it('sem oferta disponível, nada de Product (o Google recusaria)', () => {
    expect(productLd({ name: 'X', url: 'u', images: [], offers: [{ price: 1, storeName: 'L', available: false }] })).toBeNull()
  })

  it('item com marcas diferentes vira ItemList, não Product (seria marcação enganosa)', () => {
    const base = { name: 'Air fryer 4L', url: 'u', images: [], offers }
    const list = itemLd({ ...base, brands: ['Britânia', 'Mondial'], products: [{ name: 'A', url: 'a' }, { name: 'B', url: 'b' }] })
    expect(list?.['@type']).toBe('ItemList')
    expect(itemLd({ ...base, brands: ['Britânia', 'Mondial'], products: [] })).toBeNull()
    expect(itemLd({ ...base, brands: ['Apple', 'apple'], products: [] })?.['@type']).toBe('Product')
    // "Não Informado" que a loja manda no campo de marca não é uma segunda marca.
    expect(itemLd({ ...base, brands: ['Mondial', 'MONDIAL', 'Não Informado', ''], products: [] })).toMatchObject({ '@type': 'Product', brand: { name: 'Mondial' } })
  })

  it('escapa < > & e os separadores de linha: um título com </script> não sai da tag', () => {
    const out = jsonLdScript({ name: 'Panela </script><script>alert(1)</script> & cia' })
    expect(out).not.toMatch(/[<>&]/)
    expect(JSON.parse(out)).toEqual({ name: 'Panela </script><script>alert(1)</script> & cia' })
    const seps = String.fromCharCode(0x2028) + String.fromCharCode(0x2029)
    const sepOut = jsonLdScript({ t: `a${seps}b` })
    expect(sepOut.includes(seps[0]!)).toBe(false)
    expect(JSON.parse(sepOut).t).toBe(`a${seps}b`)
  })

  it('breadcrumb numerado a partir de 1', () => {
    const ld = breadcrumbLd([{ name: 'Início', url: 'https://x/' }, { name: 'Item', url: 'https://x/ofertas/i' }])
    expect((ld.itemListElement as { position: number }[]).map((i) => i.position)).toEqual([1, 2])
  })
})

// ── Alertas ─────────────────────────────────────────────────────────────────

describe('alertas: quando mandar e-mail', () => {
  const now = new Date('2026-11-27T03:00:00-03:00')
  const best = (p: Partial<BestOffer> = {}): BestOffer => ({
    offerId: 'o1', title: 'Air Fryer', storeName: 'Britânia', imageUrl: null, price: 299, pixPrice: null, listPrice: null,
    available: true, isDeal: true, flags: ['desconto-real'], realDiscountPct: 0.2, ...p,
  })
  const active = { status: 'ACTIVE' as const, targetPrice: null, lastNotifiedAt: null, lastNotifiedPrice: null }

  it('sem preço-alvo: só promoção de verdade (isDeal)', () => {
    expect(notifyDecision(active, best(), now)).toEqual({ send: true, reason: 'promocao' })
    expect(notifyDecision(active, best({ isDeal: false }), now).send).toBe(false)
  })

  it('com preço-alvo: abaixo dele, mesmo sem ser "promoção"', () => {
    const a = { ...active, targetPrice: 300 }
    expect(notifyDecision(a, best({ isDeal: false, price: 299.9 }), now)).toEqual({ send: true, reason: 'abaixo-do-alvo' })
    expect(notifyDecision(a, best({ price: 300.5 }), now).send).toBe(false)
  })

  it('nada antes da confirmação, nada depois de cancelar, nada sem estoque', () => {
    expect(notifyDecision({ ...active, status: 'PENDING' }, best(), now).send).toBe(false)
    expect(notifyDecision({ ...active, status: 'UNSUBSCRIBED' }, best(), now).send).toBe(false)
    expect(notifyDecision(active, best({ available: false }), now).send).toBe(false)
    expect(notifyDecision(active, null, now).send).toBe(false)
  })

  it('no máximo um a cada 12 h, e de novo só se cair 2% além do último aviso', () => {
    const notified = { ...active, lastNotifiedAt: new Date(now.getTime() - RENOTIFY_MIN_MS + 60_000), lastNotifiedPrice: 320 }
    expect(notifyDecision(notified, best({ price: 250 }), now).send).toBe(false) // cedo demais
    const later = { ...notified, lastNotifiedAt: new Date(now.getTime() - RENOTIFY_MIN_MS - 60_000) }
    expect(notifyDecision(later, best({ price: 315 }), now).send).toBe(false) // caiu só 1,6%
    expect(notifyDecision(later, best({ price: 313 }), now).send).toBe(true)
  })

  it('o e-mail fala o motivo, o Pix e leva o link de cancelar; HTML escapado', () => {
    const m = alertMail({
      siteTitle: 'PromoEye', targetName: 'Panela <b>', targetUrl: 'https://x/ofertas/p', reason: 'abaixo-do-alvo', targetPrice: 300,
      best: best({ pixPrice: 284.05 }), goUrl: 'https://x/ir/o1?c=email', manageUrl: 'https://x/alertas/a/s', disclosure: 'Links de afiliado.',
    })
    expect(m.subject).toContain('abaixo do seu alvo')
    expect(m.text).toContain('no Pix')
    expect(m.text).toContain('https://x/alertas/a/s')
    expect(m.html).toContain('Panela &lt;b&gt;')
    expect(m.html).not.toContain('Panela <b>')
    expect(confirmMail({ siteTitle: 'PromoEye', targetName: 'X', targetPrice: null, confirmUrl: 'https://x/c' }).text).toContain('https://x/c')
  })
})

describe('alertas: formulário e links', () => {
  it('lê o preço-alvo como gente digita', () => {
    expect(parseMoneyInput('1.299,90')).toBe(1299.9)
    expect(parseMoneyInput('R$ 299,90')).toBe(299.9)
    expect(parseMoneyInput('1299.90')).toBe(1299.9)
    expect(parseMoneyInput('1.299')).toBe(1299)
    expect(parseMoneyInput('abc')).toBeNaN()
  })

  it('exige e-mail válido e consentimento marcado', () => {
    expect(alertSignupInput.safeParse({ email: 'A@Exemplo.com ', consent: 'on' })).toMatchObject({ success: true, data: { email: 'a@exemplo.com', targetPrice: null } })
    expect(alertSignupInput.safeParse({ email: 'a@exemplo.com' }).success).toBe(false)
    expect(alertSignupInput.safeParse({ email: 'nao-e-email', consent: 'on' }).success).toBe(false)
    expect(alertSignupInput.safeParse({ email: 'a@exemplo.com', consent: 'on', targetPrice: 'R$ abc' }).success).toBe(false)
    expect(alertSignupInput.parse({ email: 'a@exemplo.com', consent: 'on', targetPrice: '249,90' }).targetPrice).toBe(249.9)
  })

  it('o link assinado vale só para aquele alerta', () => {
    const sig = alertSignature('alerta1')
    expect(verifyAlertSignature('alerta1', sig)).toBe(true)
    expect(verifyAlertSignature('alerta2', sig)).toBe(false)
    expect(verifyAlertSignature('alerta1', `${sig.slice(0, -1)}x`)).toBe(false)
    expect(verifyAlertSignature('alerta1', '')).toBe(false)
    expect(alertUrl('alerta1')).toBe(`https://promoeye.example/alertas/alerta1/${sig}`)
  })
})

// ── Afiliados ───────────────────────────────────────────────────────────────

describe('verificação dos links de afiliado', () => {
  const amazon = { id: 'amazon', name: 'Amazon', domain: 'www.amazon.com.br', affiliateTemplate: 'tag=promoeye-20' }
  const sample = { id: 'o1', url: 'https://www.amazon.com.br/dp/B0TEST', externalId: 'B0TEST' }

  it('Amazon com tag -20: ok, e o link real leva a tag', () => {
    const r = checkStoreTemplate(amazon, sample)
    expect(r).toMatchObject({ mode: 'param', status: 'ok', sampleUrl: 'https://www.amazon.com.br/dp/B0TEST?tag=promoeye-20' })
  })

  it('tag da Amazon fora do padrão -20: aviso', () => {
    expect(checkStoreTemplate({ ...amazon, affiliateTemplate: 'tag=promoeye' }, sample).status).toBe('warn')
  })

  it('sem modelo: "none", com o motivo', () => {
    expect(checkStoreTemplate({ ...amazon, affiliateTemplate: null }, sample)).toMatchObject({ status: 'none', mode: 'none' })
  })

  it('rede de afiliados com {url_encoded}: ok; com {url} cru dentro de parâmetro: aviso', () => {
    const store = { id: 'americanas', name: 'Americanas', domain: 'www.americanas.com.br', affiliateTemplate: 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued={url_encoded}' }
    const s = { id: 'o2', url: 'https://www.americanas.com.br/produto/1', externalId: '1' }
    expect(checkStoreTemplate(store, s)).toMatchObject({ mode: 'wrapper', status: 'ok' })
    expect(checkStoreTemplate({ ...store, affiliateTemplate: 'https://www.awin1.com/cread.php?ued={url}' }, s).status).toBe('warn')
  })

  it('rede desconhecida: aviso; http: erro', () => {
    const store = { id: 'carrefour', name: 'Carrefour', domain: 'www.carrefour.com.br', affiliateTemplate: 'https://encurta.example/?u={url_encoded}' }
    const s = { id: 'o3', url: 'https://www.carrefour.com.br/p/1', externalId: '1' }
    expect(checkStoreTemplate(store, s).status).toBe('warn')
    expect(checkStoreTemplate({ ...store, affiliateTemplate: 'http://www.awin1.com/?u={url_encoded}' }, s).status).toBe('error')
  })

  it('link colado na oferta manual: https e domínio conhecido', () => {
    const ml = { id: 'mercadolivre', name: 'Mercado Livre', domain: 'www.mercadolivre.com.br', affiliateTemplate: null }
    expect(checkOfferLink(ml, { id: 'o', affiliateUrl: 'https://meli.la/abc123' }).status).toBe('ok')
    expect(checkOfferLink(ml, { id: 'o', affiliateUrl: 'http://meli.la/abc123' }).status).toBe('error')
    expect(checkOfferLink(ml, { id: 'o', affiliateUrl: 'https://bit.ly/x' }).status).toBe('warn')
  })
})
