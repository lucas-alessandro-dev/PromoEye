import { describe, expect, it } from 'vitest'
import { blackFridayDate, formatWhatsAppMessage } from '@promoeye/shared'
import { buildOutboundUrl, hasAffiliate, isSafeOutbound } from '../apps/server/src/services/affiliate.js'

describe('buildOutboundUrl', () => {
  const url = 'https://www.amazon.com.br/dp/B0DJFTCKNN'
  it('sem afiliado devolve a URL do produto', () => {
    expect(buildOutboundUrl(url, {})).toBe(url)
  })
  it('parâmetro da loja é anexado à URL (Amazon Associados)', () => {
    expect(buildOutboundUrl(url, { template: 'tag=promoeye-20' })).toBe(`${url}?tag=promoeye-20`)
    expect(buildOutboundUrl(`${url}?th=1`, { template: '?tag=x-20' })).toBe(`${url}?th=1&tag=x-20`)
  })
  it('modelo de rede embrulha a URL codificada', () => {
    const t = 'https://rede.example/click?id=9&u={url_encoded}'
    expect(buildOutboundUrl(url, { template: t })).toBe(`https://rede.example/click?id=9&u=${encodeURIComponent(url)}`)
  })
  it('link colado na oferta vence o modelo da loja', () => {
    expect(buildOutboundUrl(url, { template: 'tag=a-20', affiliateUrl: 'https://meli.la/abc' })).toBe('https://meli.la/abc')
  })
  it('{path}: mesmo caminho e query do produto na loja de afiliado (Influenciador Magalu)', () => {
    const magalu = 'https://www.magazineluiza.com.br/fritadeira-xyz/p/237184100/ep/fit/?seller_id=magazineluiza'
    const out = 'https://www.magazinevoce.com.br/magazinepromoeye/fritadeira-xyz/p/237184100/ep/fit/?seller_id=magazineluiza'
    expect(buildOutboundUrl(magalu, { template: 'https://www.magazinevoce.com.br/magazinepromoeye{path}' })).toBe(out)
    // Com ou sem a barra antes do marcador, o link é o mesmo.
    expect(buildOutboundUrl(magalu, { template: 'https://www.magazinevoce.com.br/magazinepromoeye/{path}' })).toBe(out)
    expect(buildOutboundUrl(`${magalu}#avaliacoes`, { template: 'https://www.magazinevoce.com.br/magazinepromoeye{path}' })).toBe(out)
  })
  it('{path} com URL inválida não inventa link: vai para o produto', () => {
    expect(buildOutboundUrl('não é url', { template: 'https://www.magazinevoce.com.br/magazinepromoeye{path}' })).toBe('não é url')
  })
  it('URL inteira sem marcador é ignorada em vez de virar parâmetro quebrado', () => {
    const ml = 'https://www.mercadolivre.com.br/produto/MLB123'
    expect(buildOutboundUrl(ml, { template: 'https://www.mercadolivre.com.br/social/allu2219049' })).toBe(ml)
    expect(hasAffiliate({ template: 'https://www.magazinevoce.com.br/magazinepromoeye/' })).toBe(false)
    expect(hasAffiliate({ template: 'https://www.magazinevoce.com.br/magazinepromoeye{path}' })).toBe(true)
  })
  it('o que entra num marcador não é substituído de novo', () => {
    const odd = 'https://loja.example/p?x={id}'
    expect(buildOutboundUrl(odd, { template: 'https://rede.example/?u={url}&id={id}', externalId: '9' })).toBe(
      'https://rede.example/?u=https://loja.example/p?x={id}&id=9'
    )
  })
  it('só redireciona para https', () => {
    expect(isSafeOutbound('https://loja.example')).toBe(true)
    expect(isSafeOutbound('javascript:alert(1)')).toBe(false)
    expect(isSafeOutbound('http://loja.example')).toBe(false)
  })
})

describe('blackFridayDate', () => {
  it('é a sexta depois da 4ª quinta de novembro', () => {
    expect(blackFridayDate(2026).toISOString().slice(0, 10)).toBe('2026-11-27')
    expect(blackFridayDate(2027).toISOString().slice(0, 10)).toBe('2027-11-26')
    expect(blackFridayDate(2025).toISOString().slice(0, 10)).toBe('2025-11-28')
  })
})

describe('formatWhatsAppMessage', () => {
  it('monta a mensagem e esconde o "de" quando é inflado', () => {
    const msg = formatWhatsAppMessage({
      itemName: 'iPhone 16 128GB',
      title: 'Apple iPhone 16 (128 GB) – Branco',
      storeName: 'Amazon',
      price: 4700.63,
      listPrice: 6799,
      installments: null,
      flags: ['mais-barato', 'preco-de-inflado'],
      link: 'https://promoeye.example/ir/abc?c=wa',
      realDiscountPct: null,
    })
    // O Intl separa "R$" do número com espaço não separável (U+00A0); \s cobre.
    expect(msg).toMatch(/\*iPhone 16 128GB\* por \*R\$\s4\.700,63\*/)
    expect(msg).not.toContain('6.799')
    expect(msg).toContain('Mais barato entre as lojas')
    expect(msg.trim().endsWith('https://promoeye.example/ir/abc?c=wa')).toBe(true)
  })
})
