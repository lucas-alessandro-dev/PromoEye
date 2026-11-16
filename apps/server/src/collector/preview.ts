import type { PreviewInput, PreviewResult, PreviewRow } from '@promoeye/shared'
import { config } from '../config.js'
import { prisma } from '../lib/prisma.js'
import { getSettings } from '../services/settings.js'
import { adapterFor } from './adapters/index.js'
import { matchOffer, outlierCut, sellerAllowed } from './matcher.js'
import { sellerRulesFor, storeContext } from './run.js'

/**
 * "Testar busca": roda a busca ao vivo em cada loja e devolve TUDO — o que
 * entraria e o que ficaria de fora, com o motivo. Não grava nada.
 * É assim que se afina "iphone 16" para não pegar "iPhone 16 Pro".
 */
export async function previewSearch(input: PreviewInput): Promise<PreviewResult> {
  const started = Date.now()
  const settings = await getSettings()
  const stores = await prisma.store.findMany({
    where: {
      enabled: true,
      adapter: { not: 'MANUAL' },
      ...(input.storeIds.length ? { id: { in: input.storeIds } } : {}),
    },
    orderBy: { sortOrder: 'asc' },
  })
  const rules = {
    query: input.query,
    mustInclude: input.mustInclude,
    mustExclude: input.mustExclude,
    minPrice: input.minPrice ?? null,
    globalExcludes: settings.globalExcludes,
  }

  const rows: PreviewRow[] = []
  const storeErrors: PreviewResult['storeErrors'] = []

  await Promise.all(
    stores.map(async (store) => {
      const adapter = adapterFor(storeContext(store))
      if (!adapter) return
      try {
        const found = await adapter.search(input.query, { limit: config.COLLECT_RESULTS_PER_STORE })
        for (const raw of found) {
          const m = matchOffer(raw, rules)
          const s = m.ok ? sellerAllowed(raw, sellerRulesFor(store, settings)) : m
          rows.push({
            storeId: store.id,
            storeName: store.name,
            title: raw.title,
            url: raw.url,
            imageUrl: raw.imageUrl,
            price: raw.price,
            listPrice: raw.listPrice,
            sellerName: raw.sellerName,
            available: raw.available,
            accepted: m.ok && s.ok,
            reason: m.ok ? (s.ok ? null : s.reason) : m.reason,
          })
        }
      } catch (err) {
        storeErrors.push({ storeId: store.id, storeName: store.name, message: err instanceof Error ? err.message : String(err) })
      }
    })
  )

  if (rules.minPrice === null) {
    const { dropped } = outlierCut(rows.filter((r) => r.accepted))
    for (const r of dropped) {
      r.accepted = false
      r.reason = 'preço muito abaixo dos outros anúncios (provável acessório)'
    }
  }

  rows.sort((a, b) => Number(b.accepted) - Number(a.accepted) || a.price - b.price)
  return { rows, storeErrors, tookMs: Date.now() - started }
}
