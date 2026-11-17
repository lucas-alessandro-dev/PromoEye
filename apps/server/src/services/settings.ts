import {
  DEFAULT_EXCLUDES,
  DEFAULT_TRUSTED_SELLERS,
  senderSettingsInput,
  settingsInput,
  type SenderSettings,
  type SettingsDTO,
  type SettingsInput,
} from '@promoeye/shared'
import { prisma } from '../lib/prisma.js'
import { wahaConfigured } from './whatsapp/waha.js'

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
  },
}

/**
 * Envio automático: começa desligado. Limite de 10 por hora e silêncio das 22h
 * às 8h — grupo de promoção que apita de madrugada perde gente.
 */
export const DEFAULT_SENDER: SenderSettings = {
  autoSend: false,
  groupId: '',
  groupName: '',
  withImage: true,
  maxPerHour: 10,
  quietHours: true,
  quietStart: 22,
  quietEnd: 8,
}

const KEY = 'app'
const SENDER_KEY = 'whatsapp.sender'
const TTL = 10_000

let cache: { value: SettingsInput; at: number } | null = null
let senderCache: { value: SenderSettings; at: number } | null = null

/** Configurações com os padrões por baixo — campo novo nunca chega undefined. */
export async function getSettings(): Promise<SettingsInput> {
  if (cache && Date.now() - cache.at < TTL) return cache.value
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
  return getSettings()
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

export async function getSenderSettings(): Promise<SenderSettings> {
  if (senderCache && Date.now() - senderCache.at < TTL) return senderCache.value
  const row = await prisma.setting.findUnique({ where: { key: SENDER_KEY } })
  const parsed = senderSettingsInput.safeParse({ ...DEFAULT_SENDER, ...((row?.value ?? {}) as object) })
  const value = parsed.success ? parsed.data : DEFAULT_SENDER
  senderCache = { value, at: Date.now() }
  return value
}

export async function saveSenderSettings(input: SenderSettings): Promise<SenderSettings> {
  await prisma.setting.upsert({
    where: { key: SENDER_KEY },
    create: { key: SENDER_KEY, value: input as object },
    update: { value: input as object },
  })
  senderCache = null
  // Ligar o envio automático liga também a geração das mensagens: sem ela
  // não haveria o que enviar, e o motivo ficaria escondido em outra página.
  if (input.autoSend) {
    const app = await getSettings()
    if (!app.whatsapp.autoDraft) await saveSettings({ ...app, whatsapp: { ...app.whatsapp, autoDraft: true } })
  }
  return getSenderSettings()
}

/** Promoção nova vai direto para a fila? Só com WAHA configurado, envio ligado e grupo escolhido. */
export async function autoQueueEnabled(): Promise<boolean> {
  if (!wahaConfigured()) return false
  const s = await getSenderSettings()
  return s.autoSend && s.groupId !== ''
}
