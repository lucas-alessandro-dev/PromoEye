import type {
  AffiliateCheckDTO,
  AlertsDTO,
  DashboardDTO,
  LoginInput,
  ManualOfferInput,
  MeDTO,
  MessageChannel,
  MessageDTO,
  MessageUpdateInput,
  OfferDTO,
  OfferMessagesDTO,
  PreviewInput,
  PreviewResult,
  PreviewRow,
  PricePointDTO,
  ProductDetailDTO,
  ProductListDTO,
  RunDTO,
  SenderSettings,
  SettingsDTO,
  SettingsInput,
  StoreDTO,
  TelegramChatDTO,
  TelegramSettings,
  TelegramStatusDTO,
  WatchItemDTO,
  WatchItemInput,
  WhatsAppGroupDTO,
  WhatsAppStatusDTO,
} from '@promoeye/shared'

/**
 * Cliente da API do painel (/api/admin/*).
 *
 * Todo método que não é GET leva o cabeçalho `X-PromoEye: 1`: é a proteção
 * contra CSRF combinada com o servidor — um site de fora não consegue mandar
 * cabeçalho customizado sem preflight, e o preflight nunca é aprovado.
 */

export interface ApiIssue {
  path: string
  message: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues: ApiIssue[] = [],
    public data: unknown = null
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let onUnauthorized: (() => void) | null = null

/** Chamado quando uma rota protegida responde 401 (sessão expirou). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') headers['X-PromoEye'] = '1'
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Confira se ele está rodando e tente de novo.')
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    if (res.status === 401 && path !== '/login' && path !== '/me') onUnauthorized?.()
    const obj = (data ?? {}) as { error?: string; issues?: ApiIssue[] }
    const fallback =
      res.status === 401
        ? 'Sua sessão expirou. Entre de novo.'
        : res.status === 403
          ? 'Acesso negado.'
          : res.status >= 500
            ? 'O servidor teve um erro. Tente de novo em instantes.'
            : `Erro ${res.status}`
    throw new ApiError(res.status, obj.error || fallback, Array.isArray(obj.issues) ? obj.issues : [], data)
  }
  return data as T
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    sp.set(k, v === true ? '1' : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export interface SnapshotDTO {
  at: string
  minPrice: number | null
  storeId: string | null
}

export interface StoreTestResult {
  ok: boolean
  count: number
  sample: PreviewRow[]
  message: string | null
  tookMs: number
}

/**
 * Corpos de PATCH. Os tipos `OfferUpdateInput`/`StoreUpdateInput` do pacote
 * compartilhado são a SAÍDA do zod (o `.transform` torna o campo de afiliado
 * obrigatório), então aqui ficam os campos como a entrada aceita: opcionais.
 * Quem chama sempre reenvia o afiliado atual, para um servidor que grave o
 * resultado do parse não trocar o link por `null` sem querer.
 */
export interface OfferPatch {
  affiliateUrl?: string | null
  hidden?: boolean
  pinned?: boolean
}

export interface StorePatch {
  enabled?: boolean
  sellerPolicy?: StoreDTO['sellerPolicy']
  affiliateTemplate?: string | null
  trustNote?: string | null
}

export interface OffersQuery {
  itemId?: string
  storeId?: string
  deals?: boolean
  hidden?: boolean
  /** true (padrão) = só vistos nas últimas 3 h ou manuais. */
  fresh?: boolean
  q?: string
  limit?: number
  offset?: number
}

export const api = {
  // Sessão
  login: (input: LoginInput) => request<MeDTO>('POST', '/login', input),
  logout: () => request<void>('POST', '/logout'),
  me: () => request<MeDTO>('GET', '/me'),

  // Painel e coletas
  dashboard: () => request<DashboardDTO>('GET', '/dashboard'),
  runs: (limit = 20) => request<RunDTO[]>('GET', `/runs${qs({ limit })}`),
  run: (id: string) => request<RunDTO>('GET', `/runs/${encodeURIComponent(id)}`),
  startRun: (itemIds?: string[]) =>
    request<{ runId: string }>('POST', '/runs', itemIds?.length ? { itemIds } : {}),

  // Itens
  items: () => request<WatchItemDTO[]>('GET', '/items'),
  item: (id: string) => request<WatchItemDTO>('GET', `/items/${encodeURIComponent(id)}`),
  createItem: (input: WatchItemInput) => request<WatchItemDTO>('POST', '/items', input),
  updateItem: (id: string, input: WatchItemInput) =>
    request<WatchItemDTO>('PUT', `/items/${encodeURIComponent(id)}`, input),
  deleteItem: (id: string) => request<void>('DELETE', `/items/${encodeURIComponent(id)}`),
  preview: (input: PreviewInput) => request<PreviewResult>('POST', '/items/preview', input),
  snapshots: (id: string, days = 30) =>
    request<SnapshotDTO[]>('GET', `/items/${encodeURIComponent(id)}/snapshots${qs({ days })}`),

  // Ofertas
  offers: (q: OffersQuery = {}) =>
    request<{ rows: OfferDTO[]; total: number }>(
      'GET',
      `/offers${qs({
        itemId: q.itemId,
        storeId: q.storeId,
        deals: q.deals,
        hidden: q.hidden,
        fresh: q.fresh === false ? '0' : undefined,
        q: q.q?.trim(),
        limit: q.limit ?? 50,
        offset: q.offset || undefined,
      })}`
    ),
  updateOffer: (id: string, input: OfferPatch) =>
    request<OfferDTO>('PATCH', `/offers/${encodeURIComponent(id)}`, input),
  deleteOffer: (id: string) => request<void>('DELETE', `/offers/${encodeURIComponent(id)}`),
  offerHistory: (id: string) => request<PricePointDTO[]>('GET', `/offers/${encodeURIComponent(id)}/history`),
  manualOffer: (input: ManualOfferInput) => request<OfferDTO>('POST', '/offers/manual', input),
  offerMessage: (id: string) => request<OfferMessagesDTO>('POST', `/offers/${encodeURIComponent(id)}/message`),
  /** Liga a oferta ao produto do EAN (cria o produto se for o primeiro); null desliga. */
  linkOfferProduct: (id: string, gtin: string | null) =>
    request<OfferDTO>('POST', `/offers/${encodeURIComponent(id)}/product`, { gtin }),

  // Catálogo (produtos por EAN)
  listProducts: (q: { q?: string; multi?: boolean; limit?: number; offset?: number } = {}) =>
    request<ProductListDTO>(
      'GET',
      `/products${qs({ q: q.q?.trim(), multi: q.multi, limit: q.limit, offset: q.offset || undefined })}`
    ),
  getProduct: (id: string) => request<ProductDetailDTO>('GET', `/products/${encodeURIComponent(id)}`),

  // Lojas
  stores: () => request<StoreDTO[]>('GET', '/stores'),
  updateStore: (id: string, input: StorePatch) =>
    request<StoreDTO>('PATCH', `/stores/${encodeURIComponent(id)}`, input),
  testStore: (id: string, query: string) =>
    request<StoreTestResult>('POST', `/stores/${encodeURIComponent(id)}/test`, { query }),
  /** Confere o link de afiliado de cada loja; `live` segue os redirecionamentos de verdade. */
  checkAffiliates: (live: boolean) => request<AffiliateCheckDTO>('GET', `/affiliates/check?live=${live ? '1' : '0'}`),

  // Alertas de preço (leads da vitrine)
  listAlerts: () => request<AlertsDTO>('GET', '/alerts'),
  deleteAlert: (id: string) => request<void>('DELETE', `/alerts/${encodeURIComponent(id)}`),

  // Mensagens para os grupos (WhatsApp e Telegram)
  messages: (status?: MessageDTO['status'], channel?: MessageChannel) =>
    request<MessageDTO[]>('GET', `/messages${qs({ status, channel })}`),
  updateMessage: (id: string, input: MessageUpdateInput) =>
    request<MessageDTO>('PATCH', `/messages/${encodeURIComponent(id)}`, input),
  /** Manda na hora pelo canal da mensagem. Em erro, o ApiError traz a mensagem atualizada em `data.message`. */
  sendMessage: (id: string) => request<MessageDTO>('POST', `/messages/${encodeURIComponent(id)}/send`),

  // Envio automático (WAHA)
  whatsappStatus: () => request<WhatsAppStatusDTO>('GET', '/whatsapp/status'),
  whatsappConnect: () => request<WhatsAppStatusDTO>('POST', '/whatsapp/connect'),
  whatsappQr: () => request<{ image: string }>('GET', '/whatsapp/qr'),
  whatsappPair: (phone: string) => request<{ code: string }>('POST', '/whatsapp/pair', { phone }),
  whatsappLogout: () => request<WhatsAppStatusDTO>('POST', '/whatsapp/logout'),
  whatsappGroups: () => request<WhatsAppGroupDTO[]>('GET', '/whatsapp/groups'),
  saveSender: (input: SenderSettings) => request<WhatsAppStatusDTO>('PUT', '/whatsapp/settings', input),
  whatsappTest: (target: 'me' | 'group') => request<{ ok: true }>('POST', '/whatsapp/test', { target }),

  // Envio automático (bot do Telegram)
  telegramStatus: () => request<TelegramStatusDTO>('GET', '/telegram/status'),
  /** Grupos e canais onde o bot apareceu nas últimas 24 h. */
  telegramChats: () => request<TelegramChatDTO[]>('GET', '/telegram/chats'),
  saveTelegram: (input: TelegramSettings) => request<TelegramStatusDTO>('PUT', '/telegram/settings', input),
  telegramTest: () => request<{ ok: true }>('POST', '/telegram/test'),

  // Configurações
  settings: () => request<SettingsDTO>('GET', '/settings'),
  saveSettings: (input: SettingsInput) => request<SettingsDTO>('PUT', '/settings', input),
}

/** Download direto (link comum, o cookie da sessão autentica): só os alertas confirmados e ativos. */
export const ALERTS_CSV_URL = '/api/admin/alerts.csv'

/** Mensagem legível de qualquer erro. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Algo deu errado.'
}
