import { describe, expect, it } from 'vitest'
import { scoreOffer, typicalPrice, type ScoreInput } from '../apps/server/src/collector/scoring.js'

const DAY = 86_400_000
const now = new Date('2026-11-27T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY)

const base = (over: Partial<ScoreInput>): ScoreInput => ({
  price: 1000,
  listPrice: null,
  available: true,
  history: [{ at: daysAgo(20), price: 1000, available: true }],
  firstSeenAt: daysAgo(20),
  previousPrice: 1000,
  minPriceNow: 1000,
  medianPriceNow: 1000,
  offersNow: 1,
  targetPrice: null,
  minDiscount: 0.1,
  promoLabel: null,
  now,
  ...over,
})

describe('typicalPrice', () => {
  it('pondera pelo tempo, não pelo número de mudanças', () => {
    // 29 dias a 5.000 e 1 hora a 4.000: o típico é 5.000, não 4.500.
    const history = [
      { at: daysAgo(29), price: 5000, available: true },
      { at: new Date(now.getTime() - 3_600_000), price: 4000, available: true },
    ]
    expect(typicalPrice(history, now)).toBe(5000)
  })
  it('considera o preço que já vigorava antes da janela de 30 dias', () => {
    expect(typicalPrice([{ at: daysAgo(90), price: 700, available: true }], now)).toBe(700)
  })
})

describe('scoreOffer', () => {
  it('queda real contra o histórico vira promoção, com selos', () => {
    const r = scoreOffer(
      base({
        price: 800,
        previousPrice: 1000,
        history: [
          { at: daysAgo(20), price: 1000, available: true },
          { at: now, price: 800, available: true },
        ],
        minPriceNow: 800,
        offersNow: 3,
      })
    )
    expect(r.isDeal).toBe(true)
    expect(r.realDiscountPct).toBeCloseTo(0.2, 2)
    expect(r.flags).toEqual(expect.arrayContaining(['menor-preco', 'desconto-real', 'mais-barato', 'caiu-agora']))
    expect(r.reason).toBe('menor-preco')
    expect(r.score).toBeGreaterThan(60)
  })

  it('"metade do dobro": subiu e voltou ao preço de antes NÃO é promoção', () => {
    const r = scoreOffer(
      base({
        price: 1000,
        previousPrice: 1400,
        listPrice: 2000,
        history: [
          { at: daysAgo(25), price: 1000, available: true },
          { at: daysAgo(10), price: 1400, available: true },
          { at: now, price: 1000, available: true },
        ],
      })
    )
    expect(r.flags).toContain('subiu-antes')
    expect(r.flags).toContain('preco-de-inflado')
    expect(r.isDeal).toBe(false)
  })

  it('preço "de" muito acima das outras lojas é marcado como inflado', () => {
    const r = scoreOffer(
      base({ price: 4799, listPrice: 6799, medianPriceNow: 4800, offersNow: 5, firstSeenAt: now, history: [{ at: now, price: 4799, available: true }] })
    )
    expect(r.flags).toContain('preco-de-inflado')
    expect(r.flags).toContain('historico-curto')
  })

  it('preço-alvo atingido é promoção mesmo sem histórico', () => {
    const r = scoreOffer(base({ price: 950, targetPrice: 999, firstSeenAt: now, history: [{ at: now, price: 950, available: true }] }))
    expect(r.flags).toContain('abaixo-do-alvo')
    expect(r.isDeal).toBe(true)
    expect(r.reason).toBe('abaixo-do-alvo')
  })

  it('anúncio esgotado não ganha selo de vantagem nem pontos', () => {
    const r = scoreOffer(base({ available: false, price: 500, minPriceNow: 800, offersNow: 4, targetPrice: 900 }))
    expect(r.flags).not.toContain('mais-barato')
    expect(r.flags).not.toContain('abaixo-do-alvo')
    expect(r.score).toBe(0)
    expect(r.isDeal).toBe(false)
  })

  it('preço que nunca mudou não é "menor preço que já vimos"', () => {
    const r = scoreOffer(base({ history: [{ at: daysAgo(20), price: 1000, available: true }, { at: daysAgo(10), price: 1000, available: true }] }))
    expect(r.flags).not.toContain('menor-preco')
  })
})
