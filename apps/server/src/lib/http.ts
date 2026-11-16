import { config } from '../config.js'

/** A loja recusou a requisição (403, captcha, "tráfego suspeito"). */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedError'
  }
}

export interface FetchOptions {
  accept?: 'json' | 'html'
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
}

/**
 * GET com timeout, cabeçalhos de navegador comum e uma nova tentativa em
 * erro de rede ou 5xx. Bloqueio (403/429) NÃO é tentado de novo: insistir
 * com quem disse não é o caminho mais rápido para ser banido.
 */
export async function httpGet(url: string, opts: FetchOptions = {}): Promise<{ status: number; body: string }> {
  const timeoutMs = opts.timeoutMs ?? config.COLLECT_TIMEOUT_MS
  let lastErr: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new Error(`tempo esgotado (${timeoutMs} ms)`)), timeoutMs)
    const onAbort = () => ctrl.abort(opts.signal?.reason)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': config.COLLECT_USER_AGENT,
          Accept:
            opts.accept === 'json'
              ? 'application/json, text/plain, */*'
              : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
          ...opts.headers,
        },
      })
      const body = await res.text()
      if (res.status === 403 || res.status === 429) {
        throw new BlockedError(`a loja recusou a requisição (HTTP ${res.status})`)
      }
      if (res.status >= 500 && attempt === 0) {
        lastErr = new Error(`HTTP ${res.status}`)
        await sleep(1200)
        continue
      }
      // VTEX responde 206 (Partial Content) com a página de resultados.
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      return { status: res.status, body }
    } catch (err) {
      if (err instanceof BlockedError || opts.signal?.aborted) throw err
      lastErr = err
      if (attempt === 0) await sleep(1200)
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function httpGetJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { body } = await httpGet(url, { ...opts, accept: 'json' })
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error('a loja respondeu algo que não é JSON')
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
