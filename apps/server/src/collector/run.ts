import { formatWhatsAppMessage, type MessageChannel } from '@promoeye/shared'
import type { Offer, Store, WatchItem } from '@prisma/client'
import { config, publicUrl } from '../config.js'
import { BlockedError, sleep } from '../lib/http.js'
import { num, numReq, prisma } from '../lib/prisma.js'
import { autoQueueEnabled, getSettings, telegramAutoQueueEnabled, telegramDraftEnabled } from '../services/settings.js'
import { adapterFor } from './adapters/index.js'
import { matchOffer, outlierCut, requiredTerms, sellerAllowed, type MatchRules, type SellerRules } from './matcher.js'
import { containsTerm, normalize } from '../lib/text.js'
import { median, scoreOffer, type PricePointLite } from './scoring.js'
import type { RawOffer, StoreContext } from './types.js'
import { linkOffersToProducts, type CatalogRow } from './catalog.js'
import { FRESH_MS } from './fresh.js'
import { processAlerts } from '../services/alerts/notify.js'

/**
 * Uma coleta: para cada loja ativa, busca cada item acompanhado; filtra o que
 * é mesmo o item; grava preço e histórico; recalcula selos e pontuação; e
 * deixa rascunho de mensagem para o WhatsApp quando surge promoção nova.
 *
 * Lojas rodam em paralelo (são servidores diferentes); dentro de uma mesma
 * loja os itens vão um de cada vez, com pausa — uma pessoa navegando faria
 * mais requisições que isso.
 */

const HOUR = 3_600_000
export { FRESH_MS }

type StoreResult = { ok: true; rows: RawOffer[] } | { ok: false; error: string }

interface Stats {
  itemsChecked: number
  requests: number
  offersSeen: number
  offersNew: number
  priceChanges: number
  newDeals: number
  /** Produtos novos no catálogo (EAN visto pela primeira vez). Só para o log. */
  productsNew: number
}

export interface RejectSample {
  store: string
  item: string
  title: string
  price: number
  reason: string
}

/**
 * Guarda poucos descartes por coleta, variando o motivo: três "não tem 16"
 * seguidos não ensinam nada; um usado, um vitrine e um modelo vizinho, sim.
 */
function keepReject(list: RejectSample[], r: RejectSample, max = 48): void {
  if (list.length >= max) return
  // O "tipo" do motivo, sem o termo nem o nome do vendedor.
  const kind = (x: RejectSample) => x.reason.replace(/"[^"]*"|\([^)]*\)/g, '').trim()
  const ofItem = list.filter((x) => x.item === r.item)
  if (ofItem.length >= 12) return
  if (ofItem.some((x) => x.title === r.title)) return
  if (ofItem.filter((x) => kind(x) === kind(r)).length >= 3) return
  list.push(r)
}

export class AlreadyRunningError extends Error {
  constructor(public runId: string) {
    super('Já existe uma coleta em andamento.')
  }
}

let current: { runId: string; done: Promise<void> } | null = null

export function currentRun(): string | null {
  return current?.runId ?? null
}

export async function startCollection(opts: {
  trigger: 'schedule' | 'manual' | 'cli'
  itemIds?: string[]
  log?: (msg: string) => void
}): Promise<{ runId: string; done: Promise<void> }> {
  if (current) throw new AlreadyRunningError(current.runId)
  const run = await prisma.collectorRun.create({ data: { trigger: opts.trigger } })
  const done = execute(run.id, opts).finally(() => {
    current = null
  })
  current = { runId: run.id, done }
  return current
}

/** Coletas marcadas RUNNING de um processo que morreu no meio. */
export async function failOrphanRuns(): Promise<void> {
  await prisma.collectorRun.updateMany({
    where: { status: 'RUNNING' },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errors: [{ message: 'O servidor reiniciou durante a coleta.' }],
    },
  })
}

export function storeContext(s: Store): StoreContext {
  return { id: s.id, name: s.name, domain: s.domain, adapter: s.adapter, config: (s.config ?? {}) as Record<string, unknown> }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300)
  return String(err).slice(0, 300)
}

async function execute(runId: string, opts: { itemIds?: string[]; log?: (m: string) => void }): Promise<void> {
  const log = opts.log ?? (() => undefined)
  const stats: Stats = { itemsChecked: 0, requests: 0, offersSeen: 0, offersNew: 0, priceChanges: 0, newDeals: 0, productsNew: 0 }
  const errors: { store?: string; item?: string; message: string }[] = []
  const rejects: RejectSample[] = []

  try {
    const settings = await getSettings()
    const items = await prisma.watchItem.findMany({
      where: { active: true, ...(opts.itemIds?.length ? { id: { in: opts.itemIds } } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const stores = await prisma.store.findMany({
      where: { enabled: true, adapter: { not: 'MANUAL' } },
      orderBy: { sortOrder: 'asc' },
    })
    log(`coleta ${runId}: ${items.length} itens × ${stores.length} lojas`)

    // results[itemId][storeId]
    const results = new Map<string, Map<string, StoreResult>>()
    const put = (itemId: string, storeId: string, r: StoreResult) => {
      if (!results.has(itemId)) results.set(itemId, new Map())
      results.get(itemId)!.set(storeId, r)
    }

    await Promise.all(
      stores.map(async (store) => {
        const adapter = adapterFor(storeContext(store))
        if (!adapter) return
        let blocked: string | null = null
        let okCount = 0
        let rawCount = 0
        let lastError: string | null = null
        let first = true

        for (const item of items) {
          if (item.storeIds.length && !item.storeIds.includes(store.id)) continue
          if (blocked) {
            put(item.id, store.id, { ok: false, error: blocked })
            continue
          }
          if (!first) await sleep(config.COLLECT_STORE_DELAY_MS)
          first = false
          stats.requests++
          try {
            const rows = await adapter.search(item.query, { limit: config.COLLECT_RESULTS_PER_STORE })
            put(item.id, store.id, { ok: true, rows })
            okCount++
            rawCount += rows.length
          } catch (err) {
            const message = errMessage(err)
            put(item.id, store.id, { ok: false, error: message })
            errors.push({ store: store.name, item: item.name, message })
            lastError = message
            // Bloqueou uma vez, para por esta coleta. Insistir só piora.
            if (err instanceof BlockedError) blocked = message
          }
        }

        const now = new Date()
        await prisma.store.update({
          where: { id: store.id },
          data: okCount
            ? { lastOkAt: now, ...(lastError ? { lastErrorAt: now, lastError } : {}) }
            : lastError
              ? { lastErrorAt: now, lastError }
              : {},
        })
        log(`  ${store.name}: ${okCount} buscas ok, ${rawCount} resultados${lastError ? `, erro: ${lastError}` : ''}`)
      })
    )

    const storesById = new Map(stores.map((s) => [s.id, s]))
    for (const item of items) {
      try {
        await processItem(item, results.get(item.id) ?? new Map(), storesById, settings, runId, stats, rejects)
      } catch (err) {
        errors.push({ item: item.name, message: `falha ao gravar: ${errMessage(err)}` })
      }
      stats.itemsChecked++
    }

    const status = errors.length === 0 ? 'OK' : stats.offersSeen > 0 || stats.requests > errors.length ? 'PARTIAL' : 'FAILED'
    await prisma.collectorRun.update({
      where: { id: runId },
      data: { ...runColumns(stats), status, finishedAt: new Date(), errors: errors.slice(0, 200), rejects: rejects as object[] },
    })
    log(
      `coleta ${runId}: ${status} — ${stats.offersSeen} anúncios, ${stats.newDeals} promoções novas` +
        (stats.productsNew ? `, ${stats.productsNew} produtos novos no catálogo` : '')
    )
  } catch (err) {
    errors.push({ message: errMessage(err) })
    await prisma.collectorRun
      .update({ where: { id: runId }, data: { ...runColumns(stats), status: 'FAILED', finishedAt: new Date(), errors } })
      .catch(() => undefined)
    log(`coleta ${runId}: FALHOU — ${errMessage(err)}`)
    return
  }

  // Alertas por e-mail: depois de gravar a coleta, e fora dela — e-mail que
  // falha não pode marcar a coleta como falha nem atrasar a próxima.
  try {
    const sent = await processAlerts({ log })
    if (sent.notified || sent.failed) log(`alertas: ${sent.notified} e-mails enviados${sent.failed ? `, ${sent.failed} falharam` : ''}`)
  } catch (err) {
    log(`alertas: erro — ${errMessage(err)}`)
  }
}

/** Só as colunas que existem em CollectorRun. */
function runColumns(s: Stats): Omit<Stats, 'productsNew'> {
  const { productsNew: _ignored, ...cols } = s
  return cols
}

export function sellerRulesFor(store: Pick<Store, 'sellerPolicy'>, settings: { trustedSellers: string[]; blockedSellers: string[] }): SellerRules {
  return { policy: store.sellerPolicy, trustedSellers: settings.trustedSellers, blockedSellers: settings.blockedSellers }
}

export function matchRulesFor(
  item: Pick<WatchItem, 'query' | 'mustInclude' | 'mustExclude' | 'minPrice'>,
  settings: { globalExcludes: string[] }
): MatchRules {
  return {
    query: item.query,
    mustInclude: item.mustInclude,
    mustExclude: item.mustExclude,
    minPrice: num(item.minPrice),
    globalExcludes: settings.globalExcludes,
  }
}

async function processItem(
  item: WatchItem,
  byStore: Map<string, StoreResult>,
  storesById: Map<string, Store>,
  settings: Awaited<ReturnType<typeof getSettings>>,
  runId: string,
  stats: Stats,
  rejects: RejectSample[]
): Promise<void> {
  const now = new Date()
  const rules = matchRulesFor(item, settings)

  // 1. Filtrar: é o item? o vendedor é confiável?
  const accepted: { store: Store; raw: RawOffer }[] = []
  const okStores: string[] = []
  for (const [storeId, res] of byStore) {
    const store = storesById.get(storeId)
    if (!store || !res.ok) continue
    okStores.push(storeId)
    const seen = new Set<string>()
    for (const raw of res.rows) {
      if (seen.has(raw.externalId)) continue
      seen.add(raw.externalId)
      const m = matchOffer(raw, rules)
      const s = m.ok ? sellerAllowed(raw, sellerRulesFor(store, settings)) : m
      if (!s.ok) {
        // "não tem X" em título que nem é do produto (pen drive na busca de
        // iPhone) não diz nada; guardamos os quase-acertos: o item certo com
        // um problema (usado, vitrine, modelo vizinho, vendedor desconhecido).
        const lead = requiredTerms(rules)[0]
        const nearMiss = !/^não tem/.test(s.reason) || (lead !== undefined && containsTerm(normalize(raw.title), lead))
        if (nearMiss) keepReject(rejects, { store: store.name, item: item.name, title: raw.title.slice(0, 140), price: raw.price, reason: s.reason })
        continue
      }
      accepted.push({ store, raw })
    }
  }
  // Com preço mínimo definido pela pessoa, confiamos nele e não no corte automático.
  const kept =
    rules.minPrice === null ? outlierCut(accepted.map((a) => ({ ...a, price: a.raw.price }))).kept : accepted

  // 2. Gravar anúncio e histórico.
  const previousPrice = new Map<string, number | null>()
  const seenOfferIds = new Set<string>()
  const catalogRows: CatalogRow[] = []
  for (const { store, raw } of kept) {
    stats.offersSeen++
    const where = {
      watchItemId_storeId_externalId: { watchItemId: item.id, storeId: store.id, externalId: raw.externalId },
    }
    const existing = await prisma.offer.findUnique({ where })
    const data = {
      title: raw.title.slice(0, 300),
      url: raw.url,
      imageUrl: raw.imageUrl,
      sellerName: raw.sellerName,
      soldByStore: raw.soldByStore,
      price: raw.price,
      listPrice: raw.listPrice,
      cardPrice: raw.cardPrice,
      pixPrice: raw.pixPrice,
      installments: raw.installments,
      promoLabel: raw.promoLabel,
      available: raw.available,
      missingSince: null,
      lastSeenAt: now,
      // Sem EAN nesta resposta, fica o que já estava (inclusive o ligado à mão no painel).
      ...(raw.gtin ? { gtin: raw.gtin } : {}),
      ...(raw.brand ? { brand: raw.brand } : {}),
    }
    const catalogRow = (offerId: string): CatalogRow | null =>
      raw.gtin
        ? { offerId, gtin: raw.gtin, title: raw.title, imageUrl: raw.imageUrl, brand: raw.brand, modelRef: raw.modelRef, category: item.category }
        : null

    if (!existing) {
      const created = await prisma.offer.create({
        data: {
          ...data,
          watchItemId: item.id,
          storeId: store.id,
          externalId: raw.externalId,
          lowestPrice: raw.price,
          highestPrice: raw.price,
          lowestPriceAt: now,
          history: { create: { price: raw.price, listPrice: raw.listPrice, available: raw.available, at: now } },
        },
      })
      stats.offersNew++
      previousPrice.set(created.id, null)
      seenOfferIds.add(created.id)
      const row = catalogRow(created.id)
      if (row) catalogRows.push(row)
      continue
    }

    const oldPrice = numReq(existing.price)
    const changed =
      Math.abs(oldPrice - raw.price) >= 0.01 ||
      existing.available !== raw.available ||
      Math.abs((num(existing.listPrice) ?? 0) - (raw.listPrice ?? 0)) >= 0.01
    const lowest = numReq(existing.lowestPrice)
    const highest = numReq(existing.highestPrice)

    await prisma.offer.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(changed ? { lastChangeAt: now } : {}),
        ...(raw.available && raw.price < lowest ? { lowestPrice: raw.price, lowestPriceAt: now } : {}),
        ...(raw.price > highest ? { highestPrice: raw.price } : {}),
        ...(changed
          ? { history: { create: { price: raw.price, listPrice: raw.listPrice, available: raw.available, at: now } } }
          : {}),
      },
    })
    if (changed) stats.priceChanges++
    previousPrice.set(existing.id, oldPrice)
    seenOfferIds.add(existing.id)
    const row = catalogRow(existing.id)
    if (row) catalogRows.push(row)
  }

  // 2b. Catálogo: liga cada anúncio com EAN ao produto (cria na primeira vez).
  if (catalogRows.length) {
    const res = await linkOffersToProducts(catalogRows)
    stats.productsNew += res.created
  }

  // 3. Quem sumiu da busca de uma loja que respondeu.
  if (okStores.length) {
    await prisma.offer.updateMany({
      where: {
        watchItemId: item.id,
        source: 'AUTO',
        storeId: { in: okStores },
        id: { notIn: [...seenOfferIds] },
        missingSince: null,
      },
      data: { missingSince: now },
    })
  }

  // 4. Selos e pontuação, comparando com as outras lojas.
  const fresh = await prisma.offer.findMany({
    where: {
      watchItemId: item.id,
      hidden: false,
      OR: [{ source: 'MANUAL' }, { lastSeenAt: { gte: new Date(now.getTime() - FRESH_MS) } }],
    },
    include: { history: { orderBy: { at: 'desc' }, take: 300 } },
  })
  const availablePrices = fresh.filter((o) => o.available).map((o) => numReq(o.price))
  const minPriceNow = availablePrices.length ? Math.min(...availablePrices) : null
  const medianPriceNow = median(availablePrices)
  const minDiscount = (item.minDiscountPct ?? settings.defaultMinDiscountPct) / 100

  const scored: { offer: Offer; isDeal: boolean; price: number }[] = []
  for (const o of fresh) {
    const history: PricePointLite[] = o.history
      .map((h) => ({ at: h.at, price: numReq(h.price), available: h.available }))
      .reverse()
    const res = scoreOffer({
      price: numReq(o.price),
      listPrice: num(o.listPrice),
      available: o.available,
      history,
      firstSeenAt: o.firstSeenAt,
      previousPrice: previousPrice.get(o.id) ?? null,
      minPriceNow,
      medianPriceNow,
      offersNow: availablePrices.length,
      targetPrice: num(item.targetPrice),
      minDiscount,
      promoLabel: o.promoLabel,
      now,
    })
    const becameDeal = res.isDeal && !o.isDeal
    if (becameDeal) stats.newDeals++
    await prisma.offer.update({
      where: { id: o.id },
      data: {
        score: res.score,
        flags: res.flags,
        realDiscountPct: res.realDiscountPct,
        isDeal: res.isDeal,
        dealSince: res.isDeal ? (o.dealSince ?? now) : null,
      },
    })
    scored.push({ offer: o, isDeal: res.isDeal, price: numReq(o.price) })
  }

  // Anúncio velho não é promoção de agora.
  await prisma.offer.updateMany({
    where: {
      watchItemId: item.id,
      source: 'AUTO',
      isDeal: true,
      lastSeenAt: { lt: new Date(now.getTime() - FRESH_MS) },
    },
    data: { isDeal: false, dealSince: null },
  })

  // 5. Retrato do item para o gráfico.
  const best = scored
    .filter((s) => s.offer.available)
    .sort((a, b) => a.price - b.price)[0]
  await prisma.itemSnapshot.create({
    data: {
      watchItemId: item.id,
      runId,
      at: now,
      minPrice: best?.price ?? null,
      minOfferId: best?.offer.id ?? null,
      minStoreId: best?.offer.storeId ?? null,
      offerCount: availablePrices.length,
    },
  })
  await prisma.watchItem.update({ where: { id: item.id }, data: { lastRunAt: now } })

  // 6. Rascunho para o grupo: só a oferta mais barata do item, e só se for
  //    promoção e mais barata que a última que já mandamos. Assim o grupo não
  //    recebe cinco mensagens do mesmo iPhone em cores diferentes. Cada canal
  //    (WhatsApp, Telegram) tem a sua mensagem e a sua regra de repetição.
  if (best?.isDeal) {
    if (settings.whatsapp.autoDraft) await draftForBestDeal(item, best.offer.id)
    if (await telegramDraftEnabled()) await draftForBestDeal(item, best.offer.id, { channel: 'telegram' })
  }
}

/** Parâmetro do /ir/ que diz de onde veio o clique (go.ts). */
const CLICK_PARAM: Record<MessageChannel, string> = { whatsapp: 'wa', telegram: 'tg' }

/**
 * Monta a mensagem do grupo para a oferta. Com o envio automático ligado ela
 * já nasce na fila (QUEUED); senão, fica como rascunho para você revisar.
 * `force` (botão "Gerar mensagem") pula a regra de não repetir preço e sempre
 * gera rascunho: quem pediu quer ver antes.
 */
export async function draftForBestDeal(
  item: WatchItem,
  offerId: string,
  opts: { force?: boolean; channel?: MessageChannel } = {}
): Promise<boolean> {
  const force = opts.force ?? false
  const channel = opts.channel ?? 'whatsapp'
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { store: true } })
  if (!offer) return false
  const price = numReq(offer.price)

  if (!force) {
    const last = await prisma.outboundMessage.findFirst({
      where: { channel, offer: { watchItemId: item.id } },
      orderBy: { createdAt: 'desc' },
    })
    const lastPrice = num(last?.price)
    const recent = last && Date.now() - last.createdAt.getTime() < 7 * 24 * HOUR
    if (recent && lastPrice !== null && price >= lastPrice * 0.99) return false
  }

  const reason =
    (['abaixo-do-alvo', 'menor-preco', 'desconto-real', 'mais-barato'] as const).find((f) => offer.flags.includes(f)) ??
    null
  const body = formatWhatsAppMessage({
    itemName: item.name,
    title: offer.title,
    storeName: offer.store.name,
    price,
    listPrice: num(offer.listPrice),
    installments: offer.installments,
    flags: offer.flags,
    link: `${publicUrl}/ir/${offer.id}?c=${CLICK_PARAM[channel]}`,
    realDiscountPct: offer.realDiscountPct,
  })
  const queue = !force && (channel === 'telegram' ? await telegramAutoQueueEnabled() : await autoQueueEnabled())
  const created = await prisma.outboundMessage.create({
    data: { channel, offerId: offer.id, price, reason, body, status: queue ? 'QUEUED' : 'DRAFT', queuedAt: queue ? new Date() : null },
  })
  // No máximo UMA mensagem ativa por item em cada canal: a nova (mais barata)
  // substitui as que ainda esperavam. O botão "Gerar mensagem" (force) não
  // mexe nas outras: quem pediu quer comparar antes de decidir.
  if (!force) await supersedeOlderMessages(item.id, created.id, created.createdAt, channel)
  return true
}

/** Rascunhos e mensagens na fila do mesmo item e canal, mais velhos que `keepId`, viram DISCARDED com o motivo. */
export async function supersedeOlderMessages(
  watchItemId: string,
  keepId: string,
  before: Date,
  channel: MessageChannel = 'whatsapp'
): Promise<number> {
  const res = await prisma.outboundMessage.updateMany({
    where: {
      id: { not: keepId },
      channel,
      status: { in: ['DRAFT', 'QUEUED'] },
      createdAt: { lte: before },
      offer: { watchItemId },
    },
    data: { status: 'DISCARDED', error: 'Substituída por uma mensagem mais nova (e mais barata) do mesmo item.' },
  })
  return res.count
}
