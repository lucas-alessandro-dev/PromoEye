import { applyAffiliateTemplate, type RunDTO } from '@promoeye/shared'

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const timeOnly = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
const dayMonthTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateTime.format(d)
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : timeOnly.format(d)
}

export function formatDayMonth(ms: number): string {
  return dayMonth.format(new Date(ms))
}

export function formatDayMonthTime(ms: number): string {
  return dayMonthTime.format(new Date(ms))
}

/** 83_000 → "1 min 23 s" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m} min ${rest} s` : `${m} min`
}

/** 42_000 → "0:42" (cronômetro). */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const RUN_STATUS: Record<RunDTO['status'], { label: string; tone: 'info' | 'good' | 'warn' | 'danger' }> = {
  RUNNING: { label: 'Em andamento', tone: 'info' },
  OK: { label: 'Concluída', tone: 'good' },
  PARTIAL: { label: 'Concluída com falhas', tone: 'warn' },
  FAILED: { label: 'Falhou', tone: 'danger' },
}

export const ADAPTER_LABEL: Record<'VTEX' | 'KABUM' | 'AMAZON' | 'MANUAL', string> = {
  VTEX: 'API pública VTEX',
  KABUM: 'API do KaBuM!',
  AMAZON: 'Página de busca',
  MANUAL: 'Manual',
}

/**
 * Converte o que a pessoa digita ("4.199,90", "R$ 4199", "4199.9") em uma
 * string numérica que o zod entende ("4199.90"). Vazio continua vazio.
 */
export function moneyInput(raw: string): string {
  const s = raw.replace(/[R$\s]/g, '')
  if (!s) return ''
  if (s.includes(',')) return s.replace(/\./g, '').replace(',', '.')
  return s
}

/** Prévia do link de afiliado — a mesma regra do /ir/ (packages/shared/src/affiliate.ts). */
export function previewOutbound(productUrl: string, template: string | null | undefined, externalId = '123456'): string {
  return applyAffiliateTemplate(productUrl, template, externalId)
}

/** Copia para a área de transferência, com reserva para navegador sem Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.className = 'sr-only'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
