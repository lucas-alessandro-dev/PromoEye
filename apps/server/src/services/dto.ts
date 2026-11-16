import type { MessageDTO, OfferDTO, RunDTO, StoreDTO, WatchItemDTO } from '@promoeye/shared'
import type { CollectorRun, Offer, OutboundMessage, Store, WatchItem } from '@prisma/client'
import { publicUrl } from '../config.js'
import { num, numReq } from '../lib/prisma.js'
import { buildOutboundUrl, hasAffiliate } from './affiliate.js'

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export type OfferWithRefs = Offer & {
  store: Store
  watchItem: Pick<WatchItem, 'id' | 'name'>
  _count?: { clicks: number }
}

export function offerDTO(o: OfferWithRefs): OfferDTO {
  return {
    id: o.id,
    watchItemId: o.watchItemId,
    watchItemName: o.watchItem.name,
    storeId: o.storeId,
    storeName: o.store.name,
    source: o.source,
    title: o.title,
    url: o.url,
    outboundUrl: `${publicUrl}/ir/${o.id}`,
    imageUrl: o.imageUrl,
    sellerName: o.sellerName,
    soldByStore: o.soldByStore,
    price: numReq(o.price),
    listPrice: num(o.listPrice),
    cardPrice: num(o.cardPrice),
    installments: o.installments,
    promoLabel: o.promoLabel,
    available: o.available,
    missingSince: iso(o.missingSince),
    lowestPrice: numReq(o.lowestPrice),
    highestPrice: numReq(o.highestPrice),
    affiliateUrl: o.affiliateUrl,
    hasAffiliate: hasAffiliate({ affiliateUrl: o.affiliateUrl, template: o.store.affiliateTemplate }),
    hidden: o.hidden,
    pinned: o.pinned,
    score: o.score,
    flags: o.flags,
    realDiscountPct: o.realDiscountPct,
    isDeal: o.isDeal,
    firstSeenAt: o.firstSeenAt.toISOString(),
    lastSeenAt: o.lastSeenAt.toISOString(),
    lastChangeAt: o.lastChangeAt.toISOString(),
    clicks: o._count?.clicks ?? 0,
  }
}

export function outboundFor(o: Offer & { store: Pick<Store, 'affiliateTemplate'> }): string {
  return buildOutboundUrl(o.url, { affiliateUrl: o.affiliateUrl, template: o.store.affiliateTemplate, externalId: o.externalId })
}

export function storeDTO(s: Store & { _count?: { offers: number } }): StoreDTO {
  return {
    id: s.id,
    name: s.name,
    domain: s.domain,
    adapter: s.adapter,
    enabled: s.enabled,
    sellerPolicy: s.sellerPolicy,
    affiliateTemplate: s.affiliateTemplate,
    trustNote: s.trustNote,
    lastOkAt: iso(s.lastOkAt),
    lastErrorAt: iso(s.lastErrorAt),
    lastError: s.lastError,
    offerCount: s._count?.offers ?? 0,
  }
}

export function runDTO(r: CollectorRun): RunDTO {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    itemsChecked: r.itemsChecked,
    requests: r.requests,
    offersSeen: r.offersSeen,
    offersNew: r.offersNew,
    priceChanges: r.priceChanges,
    newDeals: r.newDeals,
    errors: (Array.isArray(r.errors) ? r.errors : []) as RunDTO['errors'],
  }
}

export function itemDTO(
  i: WatchItem,
  extra: { best: (Offer & { store: Store }) | null; offerCount: number; dealCount: number }
): WatchItemDTO {
  return {
    id: i.id,
    slug: i.slug,
    name: i.name,
    query: i.query,
    mustInclude: i.mustInclude,
    mustExclude: i.mustExclude,
    minPrice: num(i.minPrice),
    targetPrice: num(i.targetPrice),
    minDiscountPct: i.minDiscountPct,
    storeIds: i.storeIds,
    category: i.category,
    active: i.active,
    notes: i.notes,
    lastRunAt: iso(i.lastRunAt),
    createdAt: i.createdAt.toISOString(),
    best: extra.best
      ? {
          offerId: extra.best.id,
          storeId: extra.best.storeId,
          storeName: extra.best.store.name,
          price: numReq(extra.best.price),
          url: `${publicUrl}/ir/${extra.best.id}`,
        }
      : null,
    offerCount: extra.offerCount,
    dealCount: extra.dealCount,
  }
}

export function messageDTO(
  m: OutboundMessage & { offer: (Offer & { store: Pick<Store, 'name'> }) | null }
): MessageDTO {
  return {
    id: m.id,
    channel: m.channel,
    offerId: m.offerId,
    offerTitle: m.offer?.title ?? null,
    storeName: m.offer?.store.name ?? null,
    imageUrl: m.offer?.imageUrl ?? null,
    price: num(m.price),
    reason: m.reason,
    body: m.body,
    status: m.status,
    error: m.error,
    createdAt: m.createdAt.toISOString(),
    sentAt: iso(m.sentAt),
  }
}
