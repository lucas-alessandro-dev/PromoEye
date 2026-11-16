import {
  DEFAULT_EXCLUDES,
  DEFAULT_TRUSTED_SELLERS,
  settingsInput,
  type SettingsDTO,
  type SettingsInput,
} from '@promoeye/shared'
import { prisma } from '../lib/prisma.js'

export const DEFAULT_SETTINGS: SettingsInput = {
  siteTitle: 'PromoEye',
  publicSite: true,
  allowIndexing: false,
  defaultMinDiscountPct: 10,
  globalExcludes: DEFAULT_EXCLUDES,
  trustedSellers: DEFAULT_TRUSTED_SELLERS,
  blockedSellers: [],
  affiliateDisclosure:
    'Alguns links são de afiliado: se você comprar por eles, o PromoEye pode receber uma comissão da loja. O preço para você é o mesmo.',
  whatsapp: {
    groupInviteUrl: '',
    autoDraft: true,
    provider: 'none',
    providerUrl: '',
    providerInstance: '',
    groupId: '',
  },
}

const KEY = 'app'
const TOKEN_KEY = 'whatsapp.providerToken'

let cache: { value: SettingsInput; at: number } | null = null

/** Configurações com os padrões por baixo — campo novo nunca chega undefined. */
export async function getSettings(): Promise<SettingsInput> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  const stored = (row?.value ?? {}) as Partial<SettingsInput>
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    whatsapp: { ...DEFAULT_SETTINGS.whatsapp, ...(stored.whatsapp ?? {}) },
  }
  const parsed = settingsInput.safeParse(merged)
  const value = parsed.success ? parsed.data : DEFAULT_SETTINGS
  cache = { value, at: Date.now() }
  return value
}

export async function getSettingsDTO(): Promise<SettingsDTO> {
  const [value, token] = await Promise.all([getSettings(), prisma.setting.findUnique({ where: { key: TOKEN_KEY } })])
  return { ...value, providerTokenSet: Boolean(token) }
}

export async function saveSettings(input: SettingsInput): Promise<SettingsDTO> {
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: input as object },
    update: { value: input as object },
  })
  cache = null
  return getSettingsDTO()
}
