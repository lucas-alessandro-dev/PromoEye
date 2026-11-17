import { describe, expect, it } from 'vitest'
import { parseAmazonSearch } from '../apps/server/src/collector/adapters/amazon.js'
import { isKabumNoMatch, mapKabumProducts } from '../apps/server/src/collector/adapters/kabum.js'
import { mapVtexProducts } from '../apps/server/src/collector/adapters/vtex.js'
import { BlockedError, HttpStatusError } from '../apps/server/src/lib/http.js'

/** Recortes das respostas reais de 16/11/2026, só com os campos usados. */

describe('VTEX', () => {
  const product = (sellers: object[]) => ({
    productId: '3613755',
    productName: 'Apple iPhone 16 128GB Ultramarino',
    link: '/apple-iphone-16-128gb-ultramarino/p',
    items: [{ itemId: '1', images: [{ imageUrl: 'https://cdn.example/1.jpg' }], sellers }],
  })

  it('pega o vendedor disponível mais barato, preço à vista e parcelamento sem juros', () => {
    const [o] = mapVtexProducts(
      [
        product([
          { sellerId: '1', sellerName: 'Americanas', sellerDefault: true, commertialOffer: { Price: 5999, ListPrice: 6999, AvailableQuantity: 0 } },
          {
            sellerId: 'TALD1',
            sellerName: 'Loja iPlace',
            commertialOffer: {
              Price: 5549,
              spotPrice: 5270,
              ListPrice: 6104,
              AvailableQuantity: 5,
              Installments: [
                { Value: 554.9, InterestRate: 0, NumberOfInstallments: 10 },
                { Value: 500, InterestRate: 1.8, NumberOfInstallments: 12 },
              ],
            },
          },
        ]),
      ],
      'https://www.americanas.com.br'
    )
    expect(o).toMatchObject({
      externalId: '3613755',
      url: 'https://www.americanas.com.br/apple-iphone-16-128gb-ultramarino/p',
      price: 5270,
      cardPrice: 5549,
      listPrice: 6104,
      sellerName: 'Loja iPlace',
      soldByStore: false,
      available: true,
    })
    expect(o!.installments).toMatch(/^10x de R\$\s?554,90 sem juros$/)
  })

  it('sem estoque fica indisponível, sem inventar preço', () => {
    const [o] = mapVtexProducts(
      [product([{ sellerId: '1', sellerName: 'iByte', commertialOffer: { Price: 3099.9, AvailableQuantity: 0 } }])],
      'https://www.ibyte.com.br'
    )
    expect(o!.available).toBe(false)
    expect(o!.soldByStore).toBe(true)
  })
})

describe('KaBuM!', () => {
  it('usa o preço da oferta relâmpago quando está valendo', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const [o] = mapKabumProducts([
      {
        id: 877566,
        attributes: {
          title: 'Placa de Vídeo MSI RTX 5060 8G SHADOW 2X OC',
          price: 4003.52,
          price_with_discount: 3402.99,
          old_price: 0,
          offer: { name: 'ESQUENTA BLACK DAS BLACKS', price: 3647.05, price_with_discount: 3099.99, quantity_available: 9, ends_at: future },
          available: true,
          is_marketplace: false,
          photos: { g: ['https://images.kabum.example/g.jpg'] },
          product_link: 'placa-de-video-msi-rtx-5060',
        },
      },
    ])
    expect(o).toMatchObject({
      price: 3099.99,
      cardPrice: 3647.05,
      listPrice: 4003.52,
      promoLabel: 'ESQUENTA BLACK DAS BLACKS',
      soldByStore: true,
      url: 'https://www.kabum.com.br/produto/877566/placa-de-video-msi-rtx-5060',
    })
  })

  it('oferta vencida é ignorada', () => {
    const [o] = mapKabumProducts([
      {
        id: 1,
        attributes: {
          title: 'X',
          price: 100,
          price_with_discount: 90,
          old_price: 0,
          offer: { name: 'Velha', price: 50, price_with_discount: 40, ends_at: 1000 },
          available: true,
          is_marketplace: true,
          marketplace: { seller_name: 'UP DISTRIBUIDORA' },
        },
      },
    ])
    expect(o).toMatchObject({ price: 90, promoLabel: null, soldByStore: false, sellerName: 'UP DISTRIBUIDORA' })
  })

  it('404 CATALOG_NOT_MATCH é busca vazia, não erro (resposta real de 17/11/2026)', () => {
    const noMatch = '{"errors":[{"code":"CATALOG_NOT_MATCH","detail":"No matching data have been found."}]}'
    expect(isKabumNoMatch(new HttpStatusError(404, noMatch))).toBe(true)
    // Qualquer outro 404 ou erro continua sendo erro.
    expect(isKabumNoMatch(new HttpStatusError(404, '<html>Not Found</html>'))).toBe(false)
    expect(isKabumNoMatch(new HttpStatusError(500, noMatch))).toBe(false)
    expect(isKabumNoMatch(new Error('HTTP 404'))).toBe(false)
  })
})

describe('Amazon', () => {
  const card = (asin: string, title: string, price: string, list = '', sponsored = false) => `
    <div data-component-type="s-search-result" data-asin="${asin}">
      ${sponsored ? '<span class="puis-sponsored-label-text">Patrocinado</span>' : ''}
      <img class="s-image" src="https://m.media-amazon.example/${asin}.jpg">
      <h2 aria-label="${sponsored ? 'Anúncio patrocinado – ' : ''}${title}"><span>${title}</span></h2>
      <span class="a-price"><span class="a-offscreen">${price}</span></span>
      ${list ? `<span class="a-price a-text-price"><span class="a-offscreen">${list}</span></span>` : ''}
    </div>`

  it('lê título, preço, "de" e marca patrocinado', () => {
    const html = `<html><body>${card('B0DJFTCKNN', 'Apple iPhone 16 (128 GB) – Branco', 'R$ 4.799,00', 'R$ 6.799,00')}${card('B0DXR6MKR8', 'iPhone 16e Apple 128GB', 'R$ 3.129,00', '', true)}</body></html>`
    const rows = parseAmazonSearch(html)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ externalId: 'B0DJFTCKNN', price: 4799, listPrice: 6799, url: 'https://www.amazon.com.br/dp/B0DJFTCKNN', sponsored: false })
    expect(rows[1]).toMatchObject({ title: 'iPhone 16e Apple 128GB', sponsored: true })
  })

  it('captcha vira bloqueio, sem tentar contornar', () => {
    expect(() => parseAmazonSearch('<html><form action="/errors/validateCaptcha">Digite os caracteres que você vê</form></html>')).toThrow(BlockedError)
  })

  it('página sem resultados reconhecíveis é falha, não "zero anúncios"', () => {
    expect(() => parseAmazonSearch('<html><body><div>layout novo</div></body></html>')).toThrow(/sem resultados/)
    expect(parseAmazonSearch('<html><body>Nenhum resultado para xyz</body></html>')).toEqual([])
  })
})
