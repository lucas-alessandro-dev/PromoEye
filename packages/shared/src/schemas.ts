import { z } from 'zod'
import { normalizeGtin } from './gtin.js'
import { isUrlWithoutMarker } from './affiliate.js'

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
  affiliateTemplate: patchText(600).refine(
    (v) => !v || !isUrlWithoutMarker(v),
    'Link sem marcador: ponha {path} (loja de afiliado, como a da Magalu) ou {url_encoded} (rede) onde entra o produto, ou use parametro=valor.'
  ),
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

/** EAN/GTIN opcional: vazio vira null; preenchido precisa ser um código válido (dígito verificador). */
const optionalGtin = z
  .union([z.string().trim().max(20), z.null()])
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || normalizeGtin(v) !== null, 'EAN inválido: confira os dígitos do código de barras')
  .transform((v) => (v === null ? null : normalizeGtin(v)))

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
  /** EAN do produto (na embalagem e na ficha da loja). Junta a oferta às das outras lojas no catálogo. */
  gtin: optionalGtin,
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
  /** Preço no Pix quando a loja informa (pode ser menor que o `price`). */
  pixPrice: number | null
  installments: string | null
  promoLabel: string | null
  available: boolean
  missingSince: string | null
  /** EAN para mostrar (13 dígitos, em geral). */
  gtin: string | null
  brand: string | null
  productId: string | null
  /** Endereço público do produto no catálogo (/produtos/<slug>). */
  productUrl: string | null
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

/** Liga (ou desliga, com null) uma oferta a um produto do catálogo pelo EAN. */
export const offerProductInput = z.object({ gtin: optionalGtin })
export type OfferProductInput = z.infer<typeof offerProductInput>

// ── Catálogo (produtos por EAN) ─────────────────────────────────────────────

export interface ProductDTO {
  id: string
  slug: string
  /** EAN para mostrar (13 dígitos, em geral). */
  gtin: string
  name: string
  brand: string | null
  imageUrl: string | null
  category: string | null
  publicUrl: string
  /** Ofertas ligadas e quantas estão disponíveis agora. */
  offerCount: number
  availableCount: number
  storeCount: number
  minPrice: number | null
  minStoreName: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductDetailDTO extends ProductDTO {
  offers: OfferDTO[]
}

export interface ProductListDTO {
  total: number
  /** Produtos com 2 lojas ou mais: onde o EAN já está comparando de verdade. */
  multiStore: number
  products: ProductDTO[]
}

// ── Afiliados: verificação dos links ────────────────────────────────────────

export type AffiliateMode = 'none' | 'param' | 'wrapper' | 'offer'
export type CheckStatus = 'ok' | 'warn' | 'error' | 'none'

export interface AffiliateCheckRow {
  storeId: string
  storeName: string
  /** param = "tag=…" na URL; wrapper = rede que redireciona ({url}); offer = link colado na oferta. */
  mode: AffiliateMode
  status: CheckStatus
  messages: string[]
  sampleOfferId: string | null
  /** O link que o /ir/ geraria para uma oferta real desta loja. */
  sampleUrl: string | null
  /** Só no teste ao vivo: onde o link foi parar depois dos redirecionamentos. */
  finalUrl: string | null
  hops: number | null
}

export interface AffiliateCheckDTO {
  checkedAt: string
  live: boolean
  rows: AffiliateCheckRow[]
  /** Ofertas manuais com link de afiliado colado à mão. */
  offerLinks: AffiliateCheckRow[]
}

// ── Alertas de queda de preço (vitrine pública) ─────────────────────────────

/** Texto exato do consentimento. Vai gravado em cada alerta (LGPD: prova do que a pessoa aceitou). */
export const ALERT_CONSENT_TEXT =
  'Quero receber por e-mail o aviso quando o preço deste item cair. Posso cancelar quando quiser pelo link que vem em cada e-mail.'

/**
 * Valor digitado por gente: "1.299,90", "1299,90", "R$ 1299" ou "1299.90".
 * Vírgula = decimal brasileiro (pontos são milhar); sem vírgula, um ponto
 * seguido de 1 ou 2 dígitos no fim é decimal. NaN quando não dá para ler.
 */
export function parseMoneyInput(text: string): number {
  const t = text.replace(/[R$\s]/g, '')
  if (!/^[\d.,]+$/.test(t)) return Number.NaN
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (/^\d+\.\d{1,2}$/.test(t)) return Number(t)
  return Number(t.replace(/\./g, ''))
}

export const ALERT_STATUSES = ['PENDING', 'ACTIVE', 'UNSUBSCRIBED'] as const
export type AlertStatus = (typeof ALERT_STATUSES)[number]

/** Formulário público (vem como application/x-www-form-urlencoded, então tudo chega como texto). */
export const alertSignupInput = z.object({
  email: z.string().trim().toLowerCase().max(160).email('Confira o e-mail'),
  /** Opcional: "me avise abaixo de R$ X". Vazio = qualquer promoção de verdade. */
  targetPrice: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? parseMoneyInput(v) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0 && v < 10_000_000), 'Preço-alvo inválido: use só números, como 299,90'),
  consent: z.literal('on', { errorMap: () => ({ message: 'Marque a caixa de consentimento para receber o aviso' }) }),
  /** Armadilha para robô: campo escondido que gente não preenche. */
  website: z.string().max(200).optional(),
})
export type AlertSignupInput = z.infer<typeof alertSignupInput>

export interface AlertDTO {
  id: string
  email: string
  status: AlertStatus
  targetPrice: number | null
  target: { kind: 'item' | 'product'; name: string; url: string }
  createdAt: string
  confirmedAt: string | null
  unsubscribedAt: string | null
  lastNotifiedAt: string | null
  lastNotifiedPrice: number | null
  notifyCount: number
}

export interface AlertsDTO {
  /** SMTP_URL definido no .env: sem ele nenhum e-mail sai e o formulário some da vitrine. */
  smtpConfigured: boolean
  enabled: boolean
  counts: { pending: number; active: number; unsubscribed: number; notified7d: number }
  alerts: AlertDTO[]
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

/** Janela com data marcada (Black Friday), valendo agora ou por vir. */
export interface TimeWindowDTO {
  from: string
  until: string
  /** Estamos dentro dela agora. */
  active: boolean
}

export interface DashboardDTO {
  lastRun: RunDTO | null
  running: boolean
  nextRunAt: string | null
  scheduleEnabled: boolean
  /** Coleta mais frequente (PEAK_* no .env). null = nenhuma por vir. */
  peak: (TimeWindowDTO & { everyMin: number }) | null
  counts: {
    items: number
    activeItems: number
    offers: number
    deals: number
    draftMessages: number
    queuedMessages: number
    clicks7d: number
  }
  topDeals: OfferDTO[]
  stores: StoreDTO[]
  blackFriday: { date: string; days: number }
  /** Só com o envio automático ligado: o painel avisa se o WhatsApp caiu. */
  whatsapp: { autoSend: boolean; state: WhatsAppState | null }
  /** O mesmo para o Telegram; `queued` é a fila dele (a de `counts` é a do WhatsApp). */
  telegram: { autoSend: boolean; state: TelegramState | null; queued: number }
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

export const MESSAGE_STATUSES = ['DRAFT', 'QUEUED', 'SENDING', 'SENT', 'DISCARDED', 'FAILED'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

/** Para onde a mensagem vai. Cada canal tem fila, limite e regra de repetição próprios. */
export const MESSAGE_CHANNELS = ['whatsapp', 'telegram'] as const
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number]

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
  status: MessageStatus
  error: string | null
  attempts: number
  createdAt: string
  queuedAt: string | null
  sentAt: string | null
}

/** QUEUED põe na fila do envio automático; DRAFT tira de lá. */
export const messageUpdateInput = z.object({
  status: z.enum(['DRAFT', 'QUEUED', 'SENT', 'DISCARDED']).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
})
export type MessageUpdateInput = z.infer<typeof messageUpdateInput>

/**
 * Estado da conexão com o WhatsApp, visto pelo WAHA:
 * - UNCONFIGURED: o servidor não tem WAHA_URL/WAHA_API_KEY;
 * - UNREACHABLE: tem, mas o WAHA não respondeu (ou recusou a chave);
 * - NO_SESSION: o WAHA está no ar, mas nenhum número foi conectado ainda;
 * - os demais são os do próprio WAHA (WORKING = conectado e pronto).
 */
export type WhatsAppState =
  | 'UNCONFIGURED'
  | 'UNREACHABLE'
  | 'NO_SESSION'
  | 'STOPPED'
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'WORKING'
  | 'FAILED'

const hour = z.coerce.number().int().min(0).max(23)

/** Envio automático. Fica numa chave própria, fora das Configurações gerais. */
export const senderSettingsInput = z.object({
  /** Promoção nova vai direto para a fila, sem esperar você revisar. */
  autoSend: z.boolean(),
  /** Id do grupo no WhatsApp (120363…@g.us), escolhido na lista. */
  groupId: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === '' || /^[\w.-]+@g\.us$/.test(v), 'Escolha um grupo da lista'),
  groupName: z.string().trim().max(200),
  /** Manda a foto do produto com o texto na legenda. Sem foto, vai só o texto. */
  withImage: z.boolean(),
  /** Teto de mensagens por hora (contando as que você marcou como enviadas). */
  maxPerHour: z.coerce.number().int().min(1, 'Use de 1 a 30').max(30, 'Use de 1 a 30'),
  /** Sem envio entre quietStart e quietEnd (horário de Brasília); a fila espera. */
  quietHours: z.boolean(),
  quietStart: hour,
  quietEnd: hour,
})
export type SenderSettings = z.infer<typeof senderSettingsInput>

export interface WhatsAppStatusDTO {
  state: WhatsAppState
  /** Número conectado, só dígitos com DDI (5511912345678). */
  phone: string | null
  pushName: string | null
  error: string | null
  settings: SenderSettings
  queue: { queued: number; failed: number; sentLastHour: number }
  /** Agora é horário de silêncio: a fila não anda. */
  quietNow: boolean
  /** Janela em que o horário de silêncio fica suspenso (QUIET_OFF_* no .env). null = nenhuma por vir. */
  quietOff: TimeWindowDTO | null
  /** Conectado e com grupo escolhido: dá para enviar. */
  ready: boolean
}

export interface WhatsAppGroupDTO {
  id: string
  name: string
}

export const pairInput = z.object({
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length >= 12 && v.length <= 15, 'Use o número com DDI e DDD, como 55 11 91234-5678'),
})

export const testSendInput = z.object({ target: z.enum(['me', 'group']) })

// ── Telegram ────────────────────────────────────────────────────────────────

/**
 * Onde o bot posta: o id do grupo, supergrupo ou canal (-100…, como o Telegram
 * devolve) ou o @ de um canal público. Ao salvar, o servidor confere com o
 * Telegram e guarda o id numérico, que não muda se o @ mudar.
 */
export const telegramChatId = z
  .string()
  .trim()
  .max(64)
  .refine(
    (v) => v === '' || /^-?\d{5,20}$/.test(v) || /^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(v),
    'Use o id do grupo (-100…) ou o @ do canal'
  )

/** Envio pelo bot do Telegram. Fica numa chave própria, como o do WhatsApp. */
export const telegramSettingsInput = z.object({
  /** Promoção nova vai direto para a fila, sem esperar você revisar. */
  autoSend: z.boolean(),
  chatId: telegramChatId,
  chatTitle: z.string().trim().max(200),
  /** Manda a foto do produto com o texto na legenda. Sem foto, vai só o texto. */
  withImage: z.boolean(),
  /** Bot oficial não corre risco de bloqueio como número comum; o teto é pelo grupo. */
  maxPerHour: z.coerce.number().int().min(1, 'Use de 1 a 60').max(60, 'Use de 1 a 60'),
  quietHours: z.boolean(),
  quietStart: hour,
  quietEnd: hour,
})
export type TelegramSettings = z.infer<typeof telegramSettingsInput>

/**
 * - UNCONFIGURED: o servidor não tem TELEGRAM_BOT_TOKEN;
 * - INVALID_TOKEN: tem, mas o Telegram recusou;
 * - UNREACHABLE: o Telegram não respondeu;
 * - READY: o bot está no ar.
 */
export type TelegramState = 'UNCONFIGURED' | 'INVALID_TOKEN' | 'UNREACHABLE' | 'READY'

export type TelegramChatType = 'group' | 'supergroup' | 'channel'

export interface TelegramChatDTO {
  id: string
  title: string
  type: TelegramChatType
  /** @ do grupo ou canal público, sem o @. */
  username: string | null
}

export interface TelegramStatusDTO {
  state: TelegramState
  /** O bot do token, conferido agora. */
  bot: { username: string; name: string } | null
  error: string | null
  settings: TelegramSettings
  /** O grupo escolhido, conferido agora. null = nenhum escolhido ou bot fora do ar. */
  chat: { title: string; type: TelegramChatType | null; canPost: boolean; problem: string | null } | null
  queue: { queued: number; failed: number; sentLastHour: number }
  quietNow: boolean
  quietOff: TimeWindowDTO | null
  /** Bot no ar, grupo escolhido e com permissão de postar: dá para enviar. */
  ready: boolean
}

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
    /**
     * Gera a mensagem quando surge promoção nova. O envio automático (página
     * WhatsApp) depende disto: desligado, nada é gerado e nada sai.
     */
    autoDraft: z.boolean(),
  }),
  /**
   * Convite do grupo ou canal do Telegram, mostrado na vitrine ao lado do
   * WhatsApp. `default` para configurações salvas antes de existir o campo.
   */
  telegram: z
    .object({
      inviteUrl: z
        .string()
        .trim()
        .max(300)
        .refine(
          (v) => v === '' || /^https:\/\/(t\.me|telegram\.me)\/(\+|joinchat\/)?[A-Za-z0-9_-]{4,64}\/?$/.test(v),
          'Use um convite https://t.me/...'
        ),
    })
    .default({ inviteUrl: '' }),
  alerts: z.object({
    /** Formulário "me avise quando baixar" na página do item. Só aparece com SMTP_URL no .env. */
    enabled: z.boolean(),
  }),
})
export type SettingsInput = z.infer<typeof settingsInput>
export type SettingsDTO = SettingsInput

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
