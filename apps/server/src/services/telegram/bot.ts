import type { TelegramChatDTO, TelegramChatType } from '@promoeye/shared'
import { config } from '../../config.js'

/**
 * Cliente da Bot API do Telegram (https://core.telegram.org/bots/api): o
 * canal oficial para robôs postarem em grupos e canais, gratuito e sem o
 * risco de bloqueio de um número comum de WhatsApp.
 *
 * O token vai na URL de toda chamada. Por isso nenhuma mensagem de erro leva
 * a URL, e qualquer texto que volte passa por `hide`, que troca o token por
 * "<token>": erro aparece no painel e no log, e token vazado posta no grupo.
 */

export class TelegramError extends Error {
  constructor(
    message: string,
    /** `error_code` do Telegram (ou o HTTP); null quando nem houve resposta. */
    public status: number | null,
    /**
     * O pedido de envio esgotou o tempo: a mensagem pode ter saído. Não
     * tentamos de novo sozinhos — repetida no grupo é pior que uma a menos.
     */
    public maybeSent = false,
    /** 429: quantos segundos o Telegram pediu para esperar. */
    public retryAfterSec: number | null = null,
    /** O grupo virou supergrupo e ganhou outro id. */
    public migrateTo: string | null = null,
    /** O texto original do Telegram ("Bad Request: chat not found"), para classificar. */
    public description: string | null = null
  ) {
    super(message)
    this.name = 'TelegramError'
  }
}

export interface TelegramOptions {
  token: string
  fetch?: typeof fetch
  /** Prazo único para todas as chamadas (testes). Sem ele, cada chamada usa o seu. */
  timeoutMs?: number
  baseUrl?: string
}

export interface TelegramMember {
  status: string
  canPostMessages: boolean | null
  canSendMessages: boolean | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function idOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v)
  return typeof v === 'string' && /^-?\d+$/.test(v) ? v : null
}

const CHAT_TYPES: readonly string[] = ['group', 'supergroup', 'channel']

/** Chat de grupo ou canal; conversa privada não interessa (o bot só posta em grupo). */
export function chatOf(v: unknown): TelegramChatDTO | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = idOf(o.id)
  const type = str(o.type)
  if (!id || !type || !CHAT_TYPES.includes(type)) return null
  const username = str(o.username)
  return { id, type: type as TelegramChatType, title: str(o.title) ?? (username ? `@${username}` : id), username }
}

/**
 * Grupos e canais onde o bot apareceu, a partir do getUpdates (o Telegram
 * guarda as últimas 24 h). As atualizações vêm em ordem; vale a mais recente
 * de cada chat. Bot removido sai da lista; grupo que virou supergrupo é
 * trocado pelo supergrupo.
 */
export function parseTelegramChats(updates: unknown): TelegramChatDTO[] {
  const byId = new Map<string, TelegramChatDTO>()
  for (const u of Array.isArray(updates) ? updates : []) {
    if (!u || typeof u !== 'object') continue
    const o = u as Record<string, unknown>
    const msg = (o.message ?? o.edited_message ?? o.channel_post ?? o.edited_channel_post) as Record<string, unknown> | undefined
    const member = o.my_chat_member as Record<string, unknown> | undefined
    const chat = chatOf(msg?.chat ?? member?.chat)
    if (!chat) continue
    if (msg?.migrate_to_chat_id != null) {
      byId.delete(chat.id)
      continue
    }
    const status = str((member?.new_chat_member as Record<string, unknown> | undefined)?.status)
    if (status === 'left' || status === 'kicked') {
      byId.delete(chat.id)
      continue
    }
    byId.set(chat.id, chat)
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' }))
}

/**
 * O bot consegue postar? No canal ele precisa ser administrador com
 * permissão de publicar; no grupo basta ser membro (ou admin, se o grupo
 * só deixa admins falarem).
 */
export function postProblem(type: TelegramChatType, member: TelegramMember, membersCanSend: boolean | null): string | null {
  const { status } = member
  if (status === 'left' || status === 'kicked') return 'O bot não está mais nesse grupo. Adicione de novo.'
  if (type === 'channel') {
    if (status === 'creator') return null
    if (status === 'administrator' && member.canPostMessages !== false) return null
    return 'No canal, o bot precisa ser administrador com permissão de publicar mensagens.'
  }
  if (status === 'creator' || status === 'administrator') return null
  if (status === 'restricted') return member.canSendMessages ? null : 'O bot está restrito nesse grupo e não pode mandar mensagens.'
  if (membersCanSend === false) return 'Só administradores falam nesse grupo: torne o bot administrador.'
  return null
}

const FRIENDLY: [RegExp, string][] = [
  [/chat not found/i, 'grupo ou canal não encontrado: confira o id e se o bot foi adicionado'],
  [/bot was kicked/i, 'o bot foi removido do grupo'],
  [/bot is not a member/i, 'o bot não está nesse grupo ou canal'],
  [/not enough rights|need administrator rights|have no rights/i, 'o bot não tem permissão para postar (no canal, ele precisa ser administrador)'],
  [/can't use getUpdates method while webhook is active/i, 'o bot está com webhook ativo, então não dá para listar os grupos: digite o id'],
  [/terminated by other getUpdates request/i, 'outro programa está lendo as atualizações deste bot agora; tente de novo em instantes'],
]

/** Mensagem legível a partir da resposta de erro do Telegram. */
export function telegramErrorText(code: number, description: string | null): string {
  if (code === 401 || code === 404) return 'o Telegram recusou o token do bot (confira TELEGRAM_BOT_TOKEN)'
  const friendly = description ? FRIENDLY.find(([re]) => re.test(description))?.[1] : undefined
  if (friendly) return friendly
  return description ? `Telegram respondeu ${code}: ${description.slice(0, 240)}` : `Telegram respondeu ${code}`
}

/** Erro de formatação do HTML: dá para reenviar o texto puro, porque nada saiu. */
export function isParseError(err: unknown): boolean {
  return err instanceof TelegramError && err.status === 400 && /can't parse entities/i.test(err.description ?? '')
}

/**
 * O que fazer depois de uma falha de envio:
 * - maybe-sent: pode ter saído; ninguém reenvia sozinho;
 * - config: bot fora do grupo, sem permissão, token errado. A mensagem espera
 *   na fila, como no WhatsApp desconectado, até alguém corrigir;
 * - transient: rede, limite (429) ou Telegram fora do ar. Tenta de novo depois;
 * - rejected: o Telegram recusou ESTA mensagem. Vai para "com erro".
 */
export type TelegramFailure = 'maybe-sent' | 'config' | 'transient' | 'rejected'

export function classifyTelegramError(err: unknown): TelegramFailure {
  if (!(err instanceof TelegramError)) return 'transient'
  if (err.maybeSent) return 'maybe-sent'
  const s = err.status
  if (s === null || s === 429 || s >= 500) return 'transient'
  if (s === 401 || s === 403 || s === 404) return 'config'
  if (/chat not found|not a member|not enough rights|need administrator rights|have no rights/i.test(err.description ?? '')) return 'config'
  return 'rejected'
}

export function createTelegram(opts: TelegramOptions) {
  const doFetch = opts.fetch ?? fetch
  const base = (opts.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '')
  const hide = (s: string) => (opts.token ? s.split(opts.token).join('<token>') : s)

  async function call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    o: { timeoutMs?: number; send?: boolean } = {}
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? o.timeoutMs ?? 15_000
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res: Response
    let text: string
    try {
      res = await doFetch(`${base}/bot${opts.token}/${method}`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(params),
      })
      text = await res.text()
    } catch (err) {
      const timedOut = ctrl.signal.aborted
      const cause = (err as { cause?: { code?: unknown } })?.cause?.code
      const detail = typeof cause === 'string' ? cause : ((err as Error)?.message ?? String(err))
      const reason = timedOut ? `o Telegram não respondeu em ${Math.round(timeoutMs / 1000)} s` : `sem conexão com o Telegram (${hide(detail).slice(0, 120)})`
      throw new TelegramError(reason, null, timedOut && o.send === true)
    } finally {
      clearTimeout(timer)
    }

    let data: Record<string, unknown> | null = null
    try {
      const parsed: unknown = text ? JSON.parse(text) : null
      data = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      data = null
    }
    if (!data) throw new TelegramError(`o Telegram respondeu ${res.status} sem JSON`, res.status)
    if (data.ok !== true || !res.ok) {
      const code = typeof data.error_code === 'number' ? data.error_code : res.status
      const description = str(data.description)
      const params = (data.parameters ?? {}) as Record<string, unknown>
      const retryAfter = typeof params.retry_after === 'number' ? params.retry_after : null
      const migrateTo = idOf(params.migrate_to_chat_id)
      const message = code === 429 && retryAfter !== null ? `limite do Telegram: esperar ${retryAfter} s` : telegramErrorText(code, description)
      throw new TelegramError(hide(message), code, false, retryAfter, migrateTo, description && hide(description))
    }
    return data.result as T
  }

  const messageId = (r: unknown): string | null => {
    const id = (r as Record<string, unknown> | null)?.message_id
    return typeof id === 'number' ? String(id) : null
  }

  return {
    async getMe(): Promise<{ id: string; username: string; name: string }> {
      const r = await call<Record<string, unknown>>('getMe', {}, { timeoutMs: 8000 })
      const id = idOf(r?.id)
      if (!id) throw new TelegramError('o Telegram não devolveu o bot', 200)
      return { id, username: str(r.username) ?? '', name: str(r.first_name) ?? str(r.username) ?? 'bot' }
    },

    async getChat(chatId: string): Promise<TelegramChatDTO & { membersCanSend: boolean | null }> {
      const r = await call<Record<string, unknown>>('getChat', { chat_id: chatId }, { timeoutMs: 8000 })
      const chat = chatOf(r)
      if (!chat) throw new TelegramError('isso não é um grupo nem um canal (o bot só posta em grupo ou canal)', 400)
      const perms = r.permissions as Record<string, unknown> | undefined
      return { ...chat, membersCanSend: typeof perms?.can_send_messages === 'boolean' ? perms.can_send_messages : null }
    },

    async getChatMember(chatId: string, userId: string): Promise<TelegramMember> {
      const r = await call<Record<string, unknown>>('getChatMember', { chat_id: chatId, user_id: Number(userId) }, { timeoutMs: 8000 })
      const flag = (k: string) => (typeof r?.[k] === 'boolean' ? (r[k] as boolean) : null)
      return { status: str(r?.status) ?? 'left', canPostMessages: flag('can_post_messages'), canSendMessages: flag('can_send_messages') }
    },

    /** Sem `offset`: lê sem confirmar, então nada se perde para outra leitura. */
    async recentChats(): Promise<TelegramChatDTO[]> {
      const r = await call('getUpdates', { limit: 100, timeout: 0 }, { timeoutMs: 10_000 })
      return parseTelegramChats(r)
    },

    async sendMessage(chatId: string, text: string, o: { html: boolean; linkPreview: boolean }): Promise<string | null> {
      const r = await call(
        'sendMessage',
        { chat_id: chatId, text, ...(o.html ? { parse_mode: 'HTML' } : {}), link_preview_options: { is_disabled: !o.linkPreview } },
        { send: true, timeoutMs: 30_000 }
      )
      return messageId(r)
    },

    /** O Telegram baixa a foto da URL; por isso o prazo é maior. */
    async sendPhoto(chatId: string, photoUrl: string, caption: string, o: { html: boolean }): Promise<string | null> {
      const r = await call(
        'sendPhoto',
        { chat_id: chatId, photo: photoUrl, caption, ...(o.html ? { parse_mode: 'HTML' } : {}) },
        { send: true, timeoutMs: 60_000 }
      )
      return messageId(r)
    },
  }
}

export type Telegram = ReturnType<typeof createTelegram>

export function telegramConfigured(): boolean {
  return Boolean(config.TELEGRAM_BOT_TOKEN)
}

let instance: Telegram | null = null

/** O cliente configurado pelo .env. Só chame depois de conferir `telegramConfigured()`. */
export function telegram(): Telegram {
  instance ??= createTelegram({ token: config.TELEGRAM_BOT_TOKEN })
  return instance
}
