import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

/** Data e hora ISO com fuso explícito (2026-11-26T18:00:00-03:00). Vazio = não definido. */
const isoDateTime = z
  .string()
  .trim()
  .default('')
  .refine(
    (v) => v === '' || (/(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v))),
    'use data e hora ISO com fuso, ex.: 2026-11-26T18:00:00-03:00'
  )
  .transform((v) => (v ? new Date(v) : null))

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
  /**
   * Janela de pico (Black Friday): entre PEAK_FROM e PEAK_UNTIL a coleta roda
   * a cada PEAK_EVERY_MIN minutos (no minuto 5, 25, 45… como o horário
   * normal) no lugar do COLLECT_CRON. Os dois vazios = sem janela.
   */
  PEAK_FROM: isoDateTime,
  PEAK_UNTIL: isoDateTime,
  PEAK_EVERY_MIN: z.enum(['10', '15', '20', '30']).default('20').transform(Number),
  /**
   * Entre QUIET_OFF_FROM e QUIET_OFF_UNTIL o WhatsApp ignora o horário de
   * silêncio: a Black Friday abre à meia-noite. Os dois vazios = nunca.
   */
  QUIET_OFF_FROM: isoDateTime,
  QUIET_OFF_UNTIL: isoDateTime,
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
    const windows = [
      ['PEAK_FROM', 'PEAK_UNTIL'],
      ['QUIET_OFF_FROM', 'QUIET_OFF_UNTIL'],
    ] as const
    for (const [a, b] of windows) {
      const from = v[a]
      const until = v[b]
      if (!from !== !until) ctx.addIssue({ code: 'custom', path: [from ? b : a], message: `defina ${a} e ${b} juntos` })
      else if (from && until && until <= from) ctx.addIssue({ code: 'custom', path: [b], message: `${b} precisa ser depois de ${a}` })
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
