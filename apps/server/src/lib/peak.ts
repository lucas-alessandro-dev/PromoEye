import type { TimeWindowDTO } from '@promoeye/shared'
import { config } from '../config.js'

/**
 * Janelas com data marcada (Black Friday), definidas no .env:
 *  - pico: coleta mais frequente (PEAK_FROM, PEAK_UNTIL, PEAK_EVERY_MIN);
 *  - sem silêncio: o WhatsApp ignora o horário de silêncio (QUIET_OFF_*).
 * Passada a data, não fazem nada.
 */

/** Intervalo [from, until). */
export interface TimeWindow {
  from: Date
  until: Date
}

const pair = (from: Date | null, until: Date | null): TimeWindow | null => (from && until ? { from, until } : null)

export const peakWindow = pair(config.PEAK_FROM, config.PEAK_UNTIL)
export const peakEveryMin = config.PEAK_EVERY_MIN
export const quietOffWindow = pair(config.QUIET_OFF_FROM, config.QUIET_OFF_UNTIL)

export function inWindow(w: TimeWindow | null, at: Date = new Date()): boolean {
  return w !== null && at >= w.from && at < w.until
}

/**
 * "A cada N minutos" começando no minuto 5, como o horário normal: fora da
 * virada exata, quando as lojas publicam as ofertas. 20 → "5,25,45 * * * *".
 */
export function everyMinutesCron(every: number): string {
  const minutes: number[] = []
  for (let m = 5 % every; m < 60; m += every) minutes.push(m)
  return `${minutes.join(',')} * * * *`
}

/** Para o painel: a janela valendo ou por vir. Depois que passou, null. */
export function windowDTO(w: TimeWindow | null, now: Date = new Date()): TimeWindowDTO | null {
  if (!w || now >= w.until) return null
  return { from: w.from.toISOString(), until: w.until.toISOString(), active: inWindow(w, now) }
}

/** De quantos em quantos minutos a coleta roda agora (só para mostrar). */
export function collectEveryMin(now: Date = new Date()): number {
  return inWindow(peakWindow, now) ? peakEveryMin : 60
}
