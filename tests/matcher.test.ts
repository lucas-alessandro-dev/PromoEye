import { describe, expect, it } from 'vitest'
import { DEFAULT_EXCLUDES } from '@promoeye/shared'
import { matchOffer, matchTitle, outlierCut, sellerAllowed } from '../apps/server/src/collector/matcher.js'
import { normalize, parseBRL, sellerMatches } from '../apps/server/src/lib/text.js'
import type { RawOffer } from '../apps/server/src/collector/types.js'

const iphone = {
  query: 'iphone 16 128gb',
  mustInclude: ['iphone', '16', '128gb'],
  mustExclude: ['pro', 'plus', '16e', 'max'],
  minPrice: null,
  globalExcludes: DEFAULT_EXCLUDES,
}

describe('normalize', () => {
  it('cola número e unidade, tira acento e pontuação', () => {
    expect(normalize('Apple iPhone 16 (128 GB) – Preto')).toBe('apple iphone 16 128gb preto')
    expect(normalize('Smart TV 55" 4K')).toContain('55pol')
    expect(normalize('TV 55 Polegadas')).toContain('55pol')
    expect(normalize('Geladeira/Refrigerador Frost Free')).toBe('geladeira refrigerador frost free')
  })
  it('não confunde "pol" de polishop com polegadas', () => {
    expect(normalize('TV 55 Polishop')).toBe('tv 55 polishop')
  })
})

describe('matchTitle — iPhone 16 128GB', () => {
  const ok = (t: string) => matchTitle(t, iphone).ok
  it('aceita as grafias das lojas', () => {
    expect(ok('Apple iPhone 16 (128 GB) – Branco')).toBe(true)
    expect(ok('Smartphone Apple iPhone 16 128GB 8GB RAM Rosa')).toBe(true)
    expect(ok('IPHONE 16 128 GB PRETO')).toBe(true)
  })
  it('recusa modelo vizinho (16e, Pro, Plus, 15)', () => {
    expect(ok('Apple iPhone 16e de 128 GB — Preto')).toBe(false)
    expect(ok('iPhone 16 Pro 128GB Titânio')).toBe(false)
    expect(ok('iPhone 16 Plus 128GB')).toBe(false)
    expect(ok('Apple iPhone 15 (128 GB) — Azul')).toBe(false)
  })
  it('recusa capa, usado, vitrine e seminovo', () => {
    expect(ok('Capa para iPhone 16 128GB Transparente')).toBe(false)
    expect(ok('Usado: iPhone 16 128GB Preto Bom - Trocafone')).toBe(false)
    expect(ok('Iphone 16 128 Gb Preto Vitrine Apple')).toBe(false)
    expect(ok('Apple iPhone 16 (128 GB) – Preto (Seminovo)')).toBe(false)
  })
  it('explica o motivo do descarte', () => {
    const v = matchTitle('Apple iPhone 15 (128 GB)', iphone)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('"16"')
  })
})

describe('matchTitle — termos alternativos e exclusões globais', () => {
  it('aceita alternativas com |', () => {
    const r = { ...iphone, query: 'air fryer', mustInclude: ['fryer|fritadeira'], mustExclude: [] }
    expect(matchTitle('Fritadeira Elétrica Sem Óleo Mondial 4L', r).ok).toBe(true)
    expect(matchTitle('Air Fryer Mondial 4L', r).ok).toBe(true)
    expect(matchTitle('Panela elétrica Mondial', r).ok).toBe(false)
  })
  it('exclusão global não vale quando a própria busca usa a palavra', () => {
    const r = { ...iphone, query: 'capa iphone 16', mustInclude: [], mustExclude: [] }
    expect(matchTitle('Capa para iPhone 16 Transparente', r).ok).toBe(true)
  })
})

describe('outlierCut', () => {
  it('derruba o "iPhone" de R$ 900 entre vários de R$ 4.700', () => {
    const rows = [4700, 4800, 4799, 900, 5549].map((price) => ({ price }))
    const { kept, dropped } = outlierCut(rows)
    expect(dropped.map((r) => r.price)).toEqual([900])
    expect(kept).toHaveLength(4)
  })
  it('não corta com menos de 3 anúncios', () => {
    expect(outlierCut([{ price: 10 }, { price: 1000 }]).dropped).toHaveLength(0)
  })
})

const raw = (over: Partial<RawOffer>): RawOffer => ({
  externalId: '1',
  title: 'x',
  url: 'https://loja.example/p',
  imageUrl: null,
  price: 100,
  listPrice: null,
  cardPrice: null,
  installments: null,
  sellerName: null,
  soldByStore: false,
  available: true,
  sponsored: false,
  promoLabel: null,
  pixPrice: null,
  gtin: null,
  brand: null,
  modelRef: null,
  notNew: null,
  ...over,
})

describe('sellerAllowed / sellerMatches', () => {
  const rules = { policy: 'OFFICIAL_ONLY' as const, trustedSellers: ['iplace', 'magazine luiza', 'apple'], blockedSellers: ['golpe store'] }
  it('aceita a própria loja e vendedores confiáveis', () => {
    expect(sellerAllowed(raw({ soldByStore: true }), rules).ok).toBe(true)
    expect(sellerAllowed(raw({ sellerName: 'Loja iPlace' }), rules).ok).toBe(true)
    expect(sellerAllowed(raw({ sellerName: 'Magazine Luiza' }), rules).ok).toBe(true)
  })
  it('recusa vendedor desconhecido e bloqueado', () => {
    expect(sellerAllowed(raw({ sellerName: 'MCS VARIEDADES' }), rules).ok).toBe(false)
    expect(sellerAllowed(raw({ sellerName: 'Golpe Store', soldByStore: true }), { ...rules, policy: 'ALL' }).ok).toBe(false)
  })
  it('compara por palavra inteira (marca pendurada no nome não passa)', () => {
    expect(sellerMatches('Applestore Importados', ['apple'])).toBe(false)
    expect(sellerMatches('Apple', ['apple'])).toBe(true)
  })
})

describe('matchOffer — unidade que a loja marca como não nova', () => {
  const airfryer = { query: 'airfryer ichef', mustInclude: [], mustExclude: [], minPrice: null, globalExcludes: DEFAULT_EXCLUDES }
  const title = 'Fritadeira Elétrica Airfryer Ichef Smart Vision 6L - Outlet'
  it('outlet da Polishop fica de fora, com o motivo, mesmo sem "outlet" nas exclusões salvas', () => {
    const v = matchOffer(raw({ title, notNew: 'outlet' }), airfryer)
    expect(v).toEqual({ ok: false, reason: 'não é novo (a loja marca como "outlet")' })
  })
  it('entra quando a própria busca pede outlet', () => {
    expect(matchOffer(raw({ title, notNew: 'outlet' }), { ...airfryer, query: 'airfryer ichef outlet' }).ok).toBe(true)
  })
  it('produto novo passa', () => {
    expect(matchOffer(raw({ title: 'Fritadeira Elétrica Airfryer Ichef Smart Vision 6L' }), airfryer).ok).toBe(true)
  })
})

describe('parseBRL', () => {
  it('lê o formato brasileiro', () => {
    expect(parseBRL('R$ 4.199,00')).toBe(4199)
    expect(parseBRL('R$ 10,90')).toBe(10.9)
    expect(parseBRL('3099.99')).toBe(3099.99)
    expect(parseBRL('')).toBeNull()
  })
})
