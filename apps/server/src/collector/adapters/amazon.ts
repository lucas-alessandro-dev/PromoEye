import * as cheerio from 'cheerio'
import { BlockedError, httpGet } from '../../lib/http.js'
import { parseBRL } from '../../lib/text.js'
import type { RawOffer, StoreAdapter } from '../types.js'

/**
 * Amazon.com.br: página pública de busca.
 *
 * A API oficial (PA-API 5) foi aposentada em 2026 e a sucessora (Creators
 * API) exige conta de Associado com vendas qualificadas. Até você ter essa
 * credencial, lemos a mesma página que qualquer pessoa vê, uma vez por hora
 * por item. Se a Amazon pedir captcha, paramos e registramos o bloqueio —
 * não tentamos resolver nem contornar.
 */

export function parseAmazonSearch(html: string): RawOffer[] {
  if (/captcha|Digite os caracteres que você vê|api-services-support@amazon/i.test(html.slice(0, 20_000)) && !html.includes('s-search-result')) {
    throw new BlockedError('a Amazon pediu captcha')
  }
  const $ = cheerio.load(html)
  const out: RawOffer[] = []

  $('div[data-component-type="s-search-result"]').each((_i, el) => {
    const row = $(el)
    const asin = row.attr('data-asin')
    if (!asin) return

    const sponsored = row.find('.puis-sponsored-label-text, .s-sponsored-label-text').length > 0
    let title = (row.find('h2').attr('aria-label') || row.find('h2 span').first().text() || '').trim()
    title = title.replace(/^Anúncio patrocinado\s*[–-]\s*/i, '').trim()
    if (!title) return

    const price = parseBRL(row.find('.a-price:not(.a-text-price) .a-offscreen').first().text())
    if (!price) return // sem preço = indisponível ou "ver opções de compra"
    const list = parseBRL(row.find('.a-price.a-text-price .a-offscreen').first().text())

    const img = row.find('img.s-image')
    out.push({
      externalId: asin,
      title,
      url: `https://www.amazon.com.br/dp/${asin}`,
      imageUrl: img.attr('src') ?? null,
      price,
      listPrice: list && list > price ? list : null,
      cardPrice: null,
      pixPrice: null,
      installments: null,
      sellerName: null,
      // A busca não diz quem vende; a Garantia de A a Z cobre todos.
      soldByStore: null,
      available: true,
      sponsored,
      promoLabel: row.find('.a-badge-text').first().text().trim() || null,
      // A página de busca não mostra EAN; com a Creators API isso muda.
      gtin: null,
      brand: null,
      modelRef: null,
    })
  })

  // Página sem nenhum resultado reconhecível e sem a mensagem de "nada
  // encontrado": a Amazon serviu uma versão degradada ou mudou o layout.
  // Tratar como falha evita que os anúncios já conhecidos sejam dados como
  // sumidos por causa de uma resposta ruim.
  if (!out.length && !/Nenhum resultado para|não encontramos resultados|No results for/i.test(html)) {
    throw new Error('a Amazon devolveu uma página sem resultados reconhecíveis')
  }
  return out
}

export function amazonAdapter(): StoreAdapter {
  return {
    async search(query, opts) {
      const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(query)}&language=pt_BR`
      const { body } = await httpGet(url, { signal: opts.signal })
      return parseAmazonSearch(body).slice(0, opts.limit)
    },
  }
}
