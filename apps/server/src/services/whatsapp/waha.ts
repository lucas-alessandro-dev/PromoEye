import type { WhatsAppGroupDTO, WhatsAppState } from '@promoeye/shared'
import { config } from '../../config.js'

/**
 * Cliente do WAHA (WhatsApp HTTP API, https://waha.devlike.pro), o serviço
 * gratuito e open source que mantém um número de WhatsApp conectado e expõe
 * uma API HTTP. Roda em outro container, com o motor GOWS (sem navegador).
 *
 * As respostas variam um pouco de motor para motor (o id do grupo pode vir
 * como texto ou objeto, o nome como `subject` ou `Name`), então a leitura é
 * tolerante e cada campo tem mais de um lugar onde procurar.
 */

export class WahaError extends Error {
  constructor(
    message: string,
    /** Código HTTP do WAHA; null quando nem houve resposta. */
    public status: number | null,
    /**
     * O pedido de envio esgotou o tempo: a mensagem pode ter saído. Nesse caso
     * não tentamos de novo sozinhos — mensagem repetida no grupo é pior que
     * uma a menos.
     */
    public maybeSent = false
  ) {
    super(message)
    this.name = 'WahaError'
  }
}

export interface WahaSession {
  status: string
  /** "5511912345678@c.us" (ou "…@lid" em contas novas). */
  meId: string | null
  pushName: string | null
}

export interface WahaOptions {
  url: string
  apiKey: string
  session: string
  fetch?: typeof fetch
  /** Prazo único para todas as chamadas (testes). Sem ele, cada chamada usa o seu. */
  timeoutMs?: number
}

const STATES: readonly WhatsAppState[] = ['STOPPED', 'STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED']

/** Status do WAHA → estado do painel. PASSKEY_* e afins contam como "iniciando". */
export function stateOf(status: string): WhatsAppState {
  return (STATES as readonly string[]).includes(status) ? (status as WhatsAppState) : 'STARTING'
}

/** Só os dígitos do número, quando o id é de telefone (não de @lid). */
export function phoneOf(meId: string | null): string | null {
  const m = meId ? /^(\d{8,15})(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(meId) : null
  return m ? m[1]! : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Id do WhatsApp em qualquer das formas: "x@g.us", {_serialized}, {user, server}, {User, Server}. */
export function jidOf(v: unknown): string | null {
  if (typeof v === 'string') return str(v)
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const serialized = str(o._serialized)
  if (serialized) return serialized
  const user = str(o.user) ?? str(o.User)
  const server = str(o.server) ?? str(o.Server)
  return user && server ? `${user}@${server}` : null
}

/** Lista de grupos: aceita array ou objeto indexado pelo id; ignora o que não for grupo. */
export function parseGroups(data: unknown): WhatsAppGroupDTO[] {
  const list: unknown[] = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : []
  const byId = new Map<string, WhatsAppGroupDTO>()
  for (const g of list) {
    if (!g || typeof g !== 'object') continue
    const o = g as Record<string, unknown>
    const id = jidOf(o.id) ?? jidOf(o.JID) ?? jidOf(o.jid)
    if (!id || !id.endsWith('@g.us')) continue
    const groupName = o.GroupName as Record<string, unknown> | undefined
    const name = str(o.subject) ?? str(o.name) ?? str(o.Name) ?? str(groupName?.Name) ?? id
    byId.set(id, { id, name })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

/** Id da mensagem enviada, onde quer que o motor o coloque. */
export function messageIdOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const key = o.key as Record<string, unknown> | undefined
  const id = jidOf(o.id) ?? str(o.ID) ?? str(key?.id)
  return id ? id.slice(0, 200) : null
}

/** Mensagem de erro legível a partir do corpo que o WAHA devolveu. */
export function errorText(status: number, body: unknown): string {
  let detail: string | null = null
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    const msg = o.message
    detail =
      (Array.isArray(msg) ? msg.filter((x) => typeof x === 'string').join('; ') || null : str(msg)) ??
      str((o.exception as Record<string, unknown> | undefined)?.message) ??
      str(o.error)
  } else {
    detail = str(body)
  }
  if (status === 401 || status === 403) return 'o WAHA recusou a chave (confira WAHA_API_KEY nos dois containers)'
  return detail ? `WAHA respondeu ${status}: ${detail.slice(0, 240)}` : `WAHA respondeu ${status}`
}

export function createWaha(opts: WahaOptions) {
  const doFetch = opts.fetch ?? fetch
  const base = opts.url.replace(/\/+$/, '')
  const session = encodeURIComponent(opts.session)

  async function call<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    o: { timeoutMs?: number; allow404?: boolean; send?: boolean } = {}
  ): Promise<T | null> {
    const timeoutMs = opts.timeoutMs ?? o.timeoutMs ?? 15_000
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          'X-Api-Key': opts.apiKey,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      const timedOut = ctrl.signal.aborted
      const reason = timedOut
        ? `o WAHA não respondeu em ${Math.round(timeoutMs / 1000)} s`
        : `sem conexão com o WAHA em ${base} (${(err as Error)?.message ?? err})`
      throw new WahaError(reason, null, timedOut && o.send === true)
    } finally {
      clearTimeout(timer)
    }
    const type = res.headers.get('content-type') ?? ''
    if (res.ok && type.startsWith('image/')) {
      // QR code em PNG puro (alguns motores ignoram o Accept: application/json).
      const bytes = Buffer.from(await res.arrayBuffer())
      return { mimetype: type.split(';')[0], data: bytes.toString('base64') } as T
    }
    const text = await res.text().catch(() => '')
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (res.status === 404 && o.allow404) return null
    if (!res.ok) throw new WahaError(errorText(res.status, data), res.status)
    return data as T
  }

  return {
    session: opts.session,

    /** null: a sessão ainda não existe no WAHA. */
    async getSession(): Promise<WahaSession | null> {
      const s = await call<Record<string, unknown>>('GET', `/api/sessions/${session}`, undefined, { allow404: true, timeoutMs: 8000 })
      if (!s) return null
      const me = (s.me ?? null) as Record<string, unknown> | null
      return { status: str(s.status) ?? 'STOPPED', meId: jidOf(me?.id), pushName: str(me?.pushName) }
    },

    /** Cria a sessão (já iniciando) ou inicia a existente. Idempotente. */
    async start(): Promise<void> {
      const s = await this.getSession()
      if (!s) {
        await call('POST', '/api/sessions', { name: opts.session, start: true })
        return
      }
      if (s.status === 'FAILED') await call('POST', `/api/sessions/${session}/restart`)
      else if (s.status === 'STOPPED') await call('POST', `/api/sessions/${session}/start`)
    },

    /** Desconecta o número (o celular deixa de listar o aparelho). */
    async logout(): Promise<void> {
      await call('POST', `/api/sessions/${session}/logout`)
    },

    /** QR code atual como data URL (muda a cada ~20 s). */
    async qr(): Promise<string> {
      const r = await call<Record<string, unknown>>('GET', `/api/${session}/auth/qr?format=image`)
      const data = str(r?.data)
      if (!data) throw new WahaError('o WAHA não devolveu o QR code', 200)
      return `data:${str(r?.mimetype) ?? 'image/png'};base64,${data}`
    },

    /** Código de 8 letras para "Conectar com número de telefone". */
    async requestCode(phone: string): Promise<string> {
      const r = await call<Record<string, unknown>>('POST', `/api/${session}/auth/request-code`, { phoneNumber: phone })
      const code = str(r?.code)
      if (!code) throw new WahaError('o WAHA não devolveu o código', 200)
      return code
    },

    async groups(): Promise<WhatsAppGroupDTO[]> {
      const r = await call('GET', `/api/${session}/groups?exclude=participants&limit=500`, undefined, { timeoutMs: 30_000 })
      return parseGroups(r)
    },

    /** "digitando…" por alguns segundos antes de mandar. Melhor esforço: erro aqui não importa. */
    async typing(chatId: string, on: boolean): Promise<void> {
      await call('POST', on ? '/api/startTyping' : '/api/stopTyping', { session: opts.session, chatId }, { timeoutMs: 5000 }).catch(
        () => undefined
      )
    },

    async sendText(chatId: string, text: string, linkPreview: boolean): Promise<string | null> {
      const r = await call('POST', '/api/sendText', { session: opts.session, chatId, text, linkPreview }, { send: true, timeoutMs: 30_000 })
      return messageIdOf(r)
    },

    /** O WAHA baixa a imagem da URL; por isso o prazo é maior. */
    async sendImage(chatId: string, image: { url: string; mimetype: string; filename: string }, caption: string): Promise<string | null> {
      const r = await call('POST', '/api/sendImage', { session: opts.session, chatId, file: image, caption }, { send: true, timeoutMs: 60_000 })
      return messageIdOf(r)
    },
  }
}

export type Waha = ReturnType<typeof createWaha>

export function wahaConfigured(): boolean {
  return Boolean(config.WAHA_URL && config.WAHA_API_KEY)
}

let instance: Waha | null = null

/** O cliente configurado pelo .env. Só chame depois de conferir `wahaConfigured()`. */
export function waha(): Waha {
  instance ??= createWaha({ url: config.WAHA_URL, apiKey: config.WAHA_API_KEY, session: config.WAHA_SESSION })
  return instance
}

/**
 * Imagem que dá para mandar como foto: só https, e só JPEG/PNG (WebP e GIF o
 * WhatsApp não mostra como foto comum). Sem extensão reconhecível, tratamos
 * como JPEG, que é o que as lojas servem quase sempre.
 */
export function imageForWhatsApp(url: string | null | undefined): { url: string; mimetype: string; filename: string } | null {
  if (!url || !/^https:\/\//i.test(url)) return null
  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return null
  }
  if (/\.(webp|gif|avif|svg|bmp|tiff?)$/.test(path)) return null
  if (path.endsWith('.png')) return { url, mimetype: 'image/png', filename: 'oferta.png' }
  return { url, mimetype: 'image/jpeg', filename: 'oferta.jpg' }
}
