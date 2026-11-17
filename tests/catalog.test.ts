import { describe, expect, it } from 'vitest'
import { displayGtin, gtinCheckDigitOk, normalizeGtin, manualOfferInput, offerProductInput } from '@promoeye/shared'
import { mapVtexProducts, pixPriceFrom, readTeasers } from '../apps/server/src/collector/adapters/vtex.js'
import { mapKabumProducts } from '../apps/server/src/collector/adapters/kabum.js'
import { productName, productSlug } from '../apps/server/src/collector/catalog.js'

/** EANs reais vistos nas APIs VTEX em 17/11/2026 (Britânia e Mondial). */
const BRITANIA_BFR38 = '7899963914386'
const MONDIAL_AFDO = '7898578155764'

describe('GTIN/EAN', () => {
  it('aceita EAN-13 real e guarda na forma de 14 dígitos', () => {
    expect(normalizeGtin(BRITANIA_BFR38)).toBe(`0${BRITANIA_BFR38}`)
    expect(normalizeGtin(MONDIAL_AFDO)).toBe(`0${MONDIAL_AFDO}`)
    expect(normalizeGtin(` 789-9963914386 `)).toBe(`0${BRITANIA_BFR38}`)
  })

  it('EAN-13 e GTIN-14 com zero à esquerda são o mesmo produto', () => {
    expect(normalizeGtin(`0${BRITANIA_BFR38}`)).toBe(normalizeGtin(BRITANIA_BFR38))
  })

  it('recusa dígito verificador errado, tamanho errado e só zeros', () => {
    expect(normalizeGtin('7899963914387')).toBeNull()
    expect(normalizeGtin('789996391439')).toBeNull() // 12 dígitos, verificador não bate
    expect(normalizeGtin('12345')).toBeNull()
    expect(normalizeGtin('0000000000000')).toBeNull()
    expect(normalizeGtin('')).toBeNull()
    expect(normalizeGtin(null)).toBeNull()
  })

  it('recusa códigos de uso interno (cada loja usa os seus: não servem para cruzar lojas)', () => {
    // 2xx: balança/uso interno. Gera um com verificador correto para o teste não passar por acidente.
    const withCheck = (twelve: string) => {
      for (let d = 0; d <= 9; d++) if (gtinCheckDigitOk(`0${twelve}${d}`)) return `${twelve}${d}`
      throw new Error('sem verificador')
    }
    expect(normalizeGtin(withCheck('200123456789'))).toBeNull()
    expect(normalizeGtin(withCheck('020123456789'))).toBeNull()
    expect(normalizeGtin(withCheck('040123456789'))).toBeNull()
    expect(normalizeGtin(withCheck('789123456789'))).not.toBeNull()
  })

  it('mostra na forma curta de costume', () => {
    expect(displayGtin(`0${BRITANIA_BFR38}`)).toBe(BRITANIA_BFR38)
  })

  it('o painel valida o EAN da oferta manual e normaliza', () => {
    const base = { watchItemId: 'i', storeId: 's', title: 'Air fryer', url: 'https://www.magazineluiza.com.br/x', price: 299 }
    expect(manualOfferInput.parse({ ...base, gtin: BRITANIA_BFR38 }).gtin).toBe(`0${BRITANIA_BFR38}`)
    expect(manualOfferInput.parse({ ...base, gtin: '' }).gtin).toBeNull()
    expect(manualOfferInput.parse(base).gtin).toBeNull()
    expect(manualOfferInput.safeParse({ ...base, gtin: '7899963914387' }).success).toBe(false)
    expect(offerProductInput.parse({ gtin: null }).gtin).toBeNull()
  })
})

describe('catálogo: nome e slug do produto', () => {
  it('slug leva o EAN: único e estável', () => {
    const name = productName('  Air Fryer Britânia 4,2L  Dura Mais 1500W BFR38 - ')
    expect(name).toBe('Air Fryer Britânia 4,2L Dura Mais 1500W BFR38')
    expect(productSlug(name, `0${BRITANIA_BFR38}`)).toBe(`air-fryer-britania-4-2l-dura-mais-1500w-bfr38-${BRITANIA_BFR38}`)
    expect(productSlug('', `0${BRITANIA_BFR38}`)).toBe(`produto-${BRITANIA_BFR38}`)
  })
})

describe('VTEX: EAN, marca e Pix', () => {
  /** Recorte real da Britânia (17/11/2026): Pix 5% só nos teasers, spotPrice igual ao Price. */
  const pixTeaserIsearch = {
    name: 'Desconto PGTO Pix - 5% Institucional e indicados',
    conditions: {
      minimumQuantity: 0,
      parameters: [
        { name: 'PaymentMethodId', value: '125' },
        { name: 'MinInstallmentCount', value: '0' },
        { name: 'MaxInstallmentCount', value: '1' },
      ],
    },
    effects: { parameters: [{ name: 'PercentualDiscount', value: '5' }] },
  }
  const pixTeaserCatalogNet = {
    '<Name>k__BackingField': 'Desconto PGTO Pix - 5%',
    '<Conditions>k__BackingField': {
      '<MinimumQuantity>k__BackingField': 0,
      '<Parameters>k__BackingField': [
        { '<Name>k__BackingField': 'PaymentMethodId', '<Value>k__BackingField': '125' },
        { '<Name>k__BackingField': 'MaxInstallmentCount', '<Value>k__BackingField': '1' },
      ],
    },
    '<Effects>k__BackingField': { '<Parameters>k__BackingField': [{ '<Name>k__BackingField': 'PercentualDiscount', '<Value>k__BackingField': '5' }] },
  }

  it('lê os três formatos de teaser da VTEX', () => {
    expect(readTeasers({ teasers: [pixTeaserIsearch] })[0]).toMatchObject({ name: pixTeaserIsearch.name, effects: [{ name: 'PercentualDiscount', value: '5' }] })
    expect(readTeasers({ Teasers: [pixTeaserCatalogNet] })[0]?.conditions).toEqual([
      { name: 'PaymentMethodId', value: '125' },
      { name: 'MaxInstallmentCount', value: '1' },
    ])
  })

  it('calcula o Pix pela regra "5% no Pix em 1x" e não mexe no preço principal', () => {
    const [o] = mapVtexProducts(
      [
        {
          productId: '1',
          productName: 'Air Fryer Oven Britânia 16L',
          brand: 'Britânia',
          productReference: 'BRI-BAF16A-PI',
          link: '/air-fryer/p',
          items: [
            {
              itemId: '10',
              ean: '7891356121050',
              sellers: [{ sellerId: '1', sellerName: 'Britânia', commertialOffer: { Price: 459.9, spotPrice: 459.9, ListPrice: 1189.9, AvailableQuantity: 9, teasers: [pixTeaserIsearch] } }],
            },
          ],
        },
      ],
      'https://www.britania.com.br'
    )
    expect(o).toMatchObject({ price: 459.9, pixPrice: 436.91, gtin: '07891356121050', brand: 'Britânia', modelRef: 'BRI-BAF16A-PI' })
  })

  it('não desconta duas vezes quando o spotPrice já é menor (desconto à vista já aplicado)', () => {
    expect(pixPriceFrom({ Price: 5549, spotPrice: 5270, teasers: [pixTeaserIsearch] }, 5270)).toBeNull()
  })

  it('ignora regra com condição que não é só de pagamento (cupom, grupo de cliente)', () => {
    const withCoupon = {
      ...pixTeaserIsearch,
      conditions: { ...pixTeaserIsearch.conditions, parameters: [...pixTeaserIsearch.conditions.parameters, { name: 'Coupon', value: 'BLACK' }] },
    }
    expect(pixPriceFrom({ Price: 100, teasers: [withCoupon] }, 100)).toBeNull()
  })

  it('ignora parcelado, outro meio de pagamento e desconto absurdo', () => {
    const t = (cond: { name: string; value: string }[], pct = '5') => ({ ...pixTeaserIsearch, conditions: { minimumQuantity: 0, parameters: cond }, effects: { parameters: [{ name: 'PercentualDiscount', value: pct }] } })
    expect(pixPriceFrom({ Price: 100, teasers: [t([{ name: 'PaymentMethodId', value: '125' }, { name: 'MaxInstallmentCount', value: '10' }])] }, 100)).toBeNull()
    expect(pixPriceFrom({ Price: 100, teasers: [t([{ name: 'PaymentMethodId', value: '2' }])] }, 100)).toBeNull()
    expect(pixPriceFrom({ Price: 100, teasers: [t([{ name: 'PaymentMethodId', value: '125' }], '60')] }, 100)).toBeNull()
  })

  it('no catálogo, usa o id do Pix que a própria loja informa em PaymentOptions', () => {
    const teaser = { ...pixTeaserIsearch, conditions: { minimumQuantity: 0, parameters: [{ name: 'PaymentMethodId', value: '201' }] } }
    const offer = { Price: 200, PromotionTeasers: [teaser], PaymentOptions: { installmentOptions: [{ paymentSystem: '201', paymentName: 'Pix' }, { paymentSystem: '2', paymentName: 'Visa' }] } }
    expect(pixPriceFrom(offer, 200)).toBe(190)
  })

  it('EAN vazio ou inválido vira null (o anúncio fica fora do catálogo, mas continua sendo coletado)', () => {
    const rows = mapVtexProducts(
      [
        { productId: '1', productName: 'A', link: '/a/p', items: [{ itemId: '1', ean: '', sellers: [{ sellerId: '1', sellerName: 'L', commertialOffer: { Price: 10, AvailableQuantity: 1 } }] }] },
        { productId: '2', productName: 'B', link: '/b/p', items: [{ itemId: '2', ean: '123', sellers: [{ sellerId: '1', sellerName: 'L', commertialOffer: { Price: 10, AvailableQuantity: 1 } }] }] },
      ],
      'https://loja.example'
    )
    expect(rows.map((r) => r.gtin)).toEqual([null, null])
    expect(rows).toHaveLength(2)
  })
})

describe('KaBuM!: o preço gravado já é o do Pix', () => {
  it('marca pixPrice igual ao price e guarda o cartão à parte', () => {
    const [o] = mapKabumProducts([
      { id: 1, attributes: { title: 'Placa', price: 2000, price_with_discount: 1800, old_price: 0, offer: null, available: true, is_marketplace: false } },
    ])
    expect(o).toMatchObject({ price: 1800, pixPrice: 1800, cardPrice: 2000, gtin: null })
  })
})
