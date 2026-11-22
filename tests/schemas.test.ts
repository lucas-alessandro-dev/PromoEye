import { describe, expect, it } from 'vitest'
import { offerUpdateInput, storeUpdateInput, watchItemInput } from '@promoeye/shared'

describe('PATCH parcial não apaga o que não veio', () => {
  it('fixar uma oferta não mexe no link de afiliado', () => {
    const r = offerUpdateInput.parse({ pinned: true })
    expect(r.affiliateUrl).toBeUndefined()
    expect(r.pinned).toBe(true)
  })
  it('string vazia apaga o link; link https é aceito; http não', () => {
    expect(offerUpdateInput.parse({ affiliateUrl: '' }).affiliateUrl).toBeNull()
    expect(offerUpdateInput.parse({ affiliateUrl: 'https://meli.la/x' }).affiliateUrl).toBe('https://meli.la/x')
    expect(offerUpdateInput.safeParse({ affiliateUrl: 'http://x.example' }).success).toBe(false)
  })
  it('ligar uma loja não apaga o modelo de afiliado', () => {
    const r = storeUpdateInput.parse({ enabled: true })
    expect(r.affiliateTemplate).toBeUndefined()
    expect(r.trustNote).toBeUndefined()
  })
  it('modelo de afiliado: parâmetro, rede e {path} passam; link inteiro sem marcador não', () => {
    for (const ok of ['tag=x-20', 'matt_word=a&matt_tool=1', 'https://www.awin1.com/?ued={url_encoded}', 'https://www.magazinevoce.com.br/magazinepromoeye{path}']) {
      expect(storeUpdateInput.safeParse({ affiliateTemplate: ok }).success).toBe(true)
    }
    expect(storeUpdateInput.parse({ affiliateTemplate: '' }).affiliateTemplate).toBeNull()
    expect(storeUpdateInput.safeParse({ affiliateTemplate: 'https://www.magazinevoce.com.br/magazinepromoeye/' }).success).toBe(false)
  })
})

describe('watchItemInput', () => {
  it('normaliza termos e aceita preço vazio', () => {
    const r = watchItemInput.parse({
      name: 'iPhone 16',
      query: 'iphone 16',
      mustInclude: ['IPhone', 'iphone', '16'],
      minPrice: '',
      targetPrice: '4300',
    })
    expect(r.mustInclude).toEqual(['iphone', '16'])
    expect(r.minPrice).toBeNull()
    expect(r.targetPrice).toBe(4300)
  })
})
