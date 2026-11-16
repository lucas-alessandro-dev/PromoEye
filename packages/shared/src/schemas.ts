import { z } from 'zod'

/**
 * Contrato da API do painel (/api/admin/*). O servidor valida a entrada com
 * estes schemas; o painel usa os mesmos tipos. Mudou aqui, os dois lados
 * quebram juntos na compilação — que é o que queremos.
 */

const money = z.coerce.number().positive().max(10_000_000)
const optionalMoney = z
  .union([money, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v))

const terms = z
  .array(z.string().trim().min(1).max(60))
  .max(40)
  .default([])
  .transform((list) => [...new Set(list.map((t) => t.toLowerCase()))])

// ── Itens acompanhados ──────────────────────────────────────────────────────

export const watchItemInput = z.object({
  name: z.string().trim().min(2, 'Dê um nome ao item').max(120),
  query: z.string().trim().min(2, 'Diga o que buscar nas lojas').max(160),
  mustInclude: terms,
  mustExclude: terms,
  minPrice: optionalMoney,
  targetPrice: optionalMoney,
  minDiscountPct: z
    .union([z.coerce.number().int().min(0).max(95), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  storeIds: z.array(z.string().min(1).max(40)).max(60).default([]),
  category: z.string().trim().max(60).optional().nullable(),
  active: z.boolean().default(true),
  notes: z.string().trim().max(2000).optional().nullable(),
})
export type WatchItemInput = z.infer<typeof watchItemInput>

export interface WatchItemDTO {
  id: string
  slug: string
  name: string
  query: string
  mustInclude: string[]
  mustExclude: string[]
  minPrice: number | null
  targetPrice: number | null
  minDiscountPct: number | null
  storeIds: string[]
  category: string | null
  active: boolean
  notes: string | null
  lastRunAt: string | null
  createdAt: string
  /** Resumo calculado: melhor oferta disponível agora. */
  best: {
    offerId: string
    storeId: string
    storeName: string
    price: number
    url: string
  } | null
  offerCount: number
  dealCount: number
}

// ── Teste de busca (pré-visualização antes de salvar) ───────────────────────

export const previewInput = watchItemInput.pick({
  query: true,
  mustInclude: true,
  mustExclude: true,
  minPrice: true,
  storeIds: true,
})
export type PreviewInput = z.infer<typeof previewInput>

export interface PreviewRow {
  storeId: string
  storeName: string
  title: string
  url: string
  imageUrl: string | null
  price: number
  listPrice: number | null
  sellerName: string | null
  available: boolean
  accepted: boolean
  /** Por que foi descartado (vazio quando aceito). */
  reason: string | null
}

export interface PreviewResult {
  rows: PreviewRow[]
  storeErrors: { storeId: string; storeName: string; message: string }[]
  tookMs: number
}

/**
 * Campo de PATCH: ausente continua `undefined` (não mexe no que está gravado);
 * vazio ou null vira `null` (apaga). Sem essa distinção, um `{ pinned: true }`
 * apagaria o link de afiliado da oferta.
 */
const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null))

// ── Lojas ───────────────────────────────────────────────────────────────────

export const storeUpdateInput = z.object({
  enabled: z.boolean().optional(),
  sellerPolicy: z.enum(['OFFICIAL_ONLY', 'ALL']).optional(),
  affiliateTemplate: patchText(600),
  trustNote: patchText(200),
})
export type StoreUpdateInput = z.infer<typeof storeUpdateInput>

export interface StoreDTO {
  id: string
  name: string
  domain: string
  adapter: 'VTEX' | 'KABUM' | 'AMAZON' | 'MANUAL'
  enabled: boolean
  sellerPolicy: 'OFFICIAL_ONLY' | 'ALL'
  affiliateTemplate: string | null
  trustNote: string | null
  lastOkAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  offerCount: number
}

// ── Ofertas ─────────────────────────────────────────────────────────────────

export const offerUpdateInput = z.object({
  affiliateUrl: patchText(1200).refine(
    (v) => v === undefined || v === null || /^https:\/\//i.test(v),
    'O link de afiliado precisa começar com https://'
  ),
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
})
export type OfferUpdateInput = z.infer<typeof offerUpdateInput>

/** Oferta adicionada à mão (lojas que bloqueiam robôs, ou achados avulsos). */
export const manualOfferInput = z.object({
  watchItemId: z.string().min(1),
  storeId: z.string().min(1),
  title: z.string().trim().min(3).max(300),
  url: z.string().trim().url('Cole o link do produto').refine((v) => /^https:\/\//i.test(v), 'Use https://'),
  affiliateUrl: z
    .string()
    .trim()
    .max(1200)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https:\/\//i.test(v), 'O link de afiliado precisa começar com https://'),
  imageUrl: z
    .string()
    .trim()
    .max(1200)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https:\/\//i.test(v), 'A imagem precisa começar com https://'),
  price: money,
  listPrice: optionalMoney,
  sellerName: z.string().trim().max(120).optional().nullable(),
})
export type ManualOfferInput = z.infer<typeof manualOfferInput>

export interface OfferDTO {
  id: string
  watchItemId: string
  watchItemName: string
  storeId: string
  storeName: string
  source: 'AUTO' | 'MANUAL'
  title: string
  url: string
  outboundUrl: string
  imageUrl: string | null
  sellerName: string | null
  soldByStore: boolean | null
  price: number
  listPrice: number | null
  cardPrice: number | null
  installments: string | null
  promoLabel: string | null
  available: boolean
  missingSince: string | null
  lowestPrice: number
  highestPrice: number
  affiliateUrl: string | null
  hasAffiliate: boolean
  hidden: boolean
  pinned: boolean
  score: number
  flags: string[]
  realDiscountPct: number | null
  isDeal: boolean
  firstSeenAt: string
  lastSeenAt: string
  lastChangeAt: string
  clicks: number
}

export interface PricePointDTO {
  at: string
  price: number
  listPrice: number | null
  available: boolean
}

// ── Coletor ─────────────────────────────────────────────────────────────────

export interface RunDTO {
  id: string
  trigger: string
  status: 'RUNNING' | 'OK' | 'PARTIAL' | 'FAILED'
  startedAt: string
  finishedAt: string | null
  itemsChecked: number
  requests: number
  offersSeen: number
  offersNew: number
  priceChanges: number
  newDeals: number
  errors: { store?: string; item?: string; message: string }[]
}

export interface DashboardDTO {
  lastRun: RunDTO | null
  running: boolean
  nextRunAt: string | null
  scheduleEnabled: boolean
  counts: {
    items: number
    activeItems: number
    offers: number
    deals: number
    draftMessages: number
    clicks7d: number
  }
  topDeals: OfferDTO[]
  stores: StoreDTO[]
  blackFriday: { date: string; days: number }
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

export interface MessageDTO {
  id: string
  channel: string
  offerId: string | null
  offerTitle: string | null
  storeName: string | null
  imageUrl: string | null
  price: number | null
  reason: string | null
  body: string
  status: 'DRAFT' | 'SENT' | 'DISCARDED' | 'FAILED'
  error: string | null
  createdAt: string
  sentAt: string | null
}

export const messageUpdateInput = z.object({
  status: z.enum(['DRAFT', 'SENT', 'DISCARDED']).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
})
export type MessageUpdateInput = z.infer<typeof messageUpdateInput>

// ── Configurações ───────────────────────────────────────────────────────────

export const settingsInput = z.object({
  siteTitle: z.string().trim().min(2).max(60),
  /** Vitrine aberta ao público. Desligada, só quem está logado vê. */
  publicSite: z.boolean(),
  /** Deixa buscadores indexarem a vitrine. */
  allowIndexing: z.boolean(),
  /** Desconto real mínimo padrão (itens sem valor próprio). */
  defaultMinDiscountPct: z.coerce.number().int().min(0).max(95),
  globalExcludes: z.array(z.string().trim().min(1).max(60)).max(200),
  trustedSellers: z.array(z.string().trim().min(1).max(80)).max(400),
  blockedSellers: z.array(z.string().trim().min(1).max(80)).max(400),
  /** Aviso de afiliado no rodapé (CONAR: publicidade precisa ser identificada). */
  affiliateDisclosure: z.string().trim().max(400),
  whatsapp: z.object({
    /** Convite do grupo (https://chat.whatsapp.com/...). Aparece na vitrine. */
    groupInviteUrl: z
      .string()
      .trim()
      .max(300)
      .transform((v) => v || '')
      .refine((v) => v === '' || /^https:\/\/chat\.whatsapp\.com\//.test(v), 'Use um convite https://chat.whatsapp.com/...'),
    /** Gera rascunho de mensagem quando surge promoção nova. */
    autoDraft: z.boolean(),
    /** Provedor de envio automático — reservado para a próxima etapa. */
    provider: z.enum(['none', 'evolution', 'zapi', 'cloud']),
    providerUrl: z.string().trim().max(300),
    providerInstance: z.string().trim().max(120),
    groupId: z.string().trim().max(120),
  }),
})
export type SettingsInput = z.infer<typeof settingsInput>
export type SettingsDTO = SettingsInput & { providerTokenSet: boolean }

// ── Login ───────────────────────────────────────────────────────────────────

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha').max(200),
})
export type LoginInput = z.infer<typeof loginInput>

export interface MeDTO {
  id: string
  email: string
  name: string
}
