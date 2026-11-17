import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

/** Falhar no boot é melhor do que descobrir em produção que faltou um segredo. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa de ao menos 32 caracteres'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),

  COLLECT_CRON: z.string().default('5 * * * *'),
  COLLECT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  COLLECT_STORE_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(1500),
  COLLECT_TIMEOUT_MS: z.coerce.number().int().min(2000).max(120_000).default(15_000),
  /** Quantos resultados pedir por loja em cada busca. */
  COLLECT_RESULTS_PER_STORE: z.coerce.number().int().min(4).max(50).default(24),
  /**
   * User-Agent das requisições às lojas. As lojas servem a mesma página
   * pública a qualquer navegador; não usamos truque nenhum além disso.
   */
  COLLECT_USER_AGENT: z
    .string()
    .default(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
    ),

  /**
   * Confiar em exatamente um salto (o Nginx). Com `true` o Fastify pegaria a
   * entrada mais à esquerda do X-Forwarded-For — a que o cliente escreve.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => (v === 'true' ? 1 : false)),

  /**
   * WAHA (WhatsApp HTTP API, gratuito e open source) para o envio automático
   * ao grupo. Na VPS ele roda ao lado do app (http://waha:3000); no computador,
   * `docker compose up -d waha`. Vazio desliga o envio automático: as
   * mensagens continuam saindo à mão pelo painel.
   */
  WAHA_URL: z
    .string()
    .trim()
    .default('')
    .transform((v) => v.replace(/\/+$/, ''))
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/.test(v), 'WAHA_URL precisa começar com http:// ou https://'),
  /** A mesma chave do WAHA_API_KEY do container do WAHA. */
  WAHA_API_KEY: z.string().trim().default(''),
  /** Nome da sessão (um número de WhatsApp) dentro do WAHA. */
  WAHA_SESSION: z
    .string()
    .trim()
    .regex(/^[\w-]{1,60}$/, 'WAHA_SESSION: só letras, números, _ e -')
    .default('default'),
})

function load() {
  const env = envSchema.superRefine((v, ctx) => {
    if (v.WAHA_URL && !v.WAHA_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['WAHA_API_KEY'], message: 'com WAHA_URL definido, a chave do WAHA é obrigatória' })
    }
  })
  const parsed = env.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuração inválida no .env:\n${issues}`)
  }
  return parsed.data
}

export const config = load()
export const isProd = config.NODE_ENV === 'production'
export const isTest = config.NODE_ENV === 'test'
export const publicUrl = config.PUBLIC_URL.replace(/\/+$/, '')

/** `src` em dev, `dist` no build: a raiz do app está um nível acima nos dois. */
const here = dirname(fileURLToPath(import.meta.url))
export const appRoot = resolve(here, '..')
export const repoRoot = resolve(appRoot, '../..')
