import { Cron } from 'croner'
import type { FastifyBaseLogger } from 'fastify'
import { config } from '../config.js'
import { everyMinutesCron, inWindow, peakEveryMin, peakWindow } from '../lib/peak.js'
import { AlreadyRunningError, startCollection } from './run.js'

/**
 * Agendamento da coleta. Padrão "5 * * * *": no minuto 5 de cada hora — fora
 * da virada exata, quando muita loja publica oferta relâmpago e o tráfego
 * delas está no pico.
 *
 * Na janela de pico (PEAK_*, a Black Friday) um segundo agendamento assume,
 * a cada PEAK_EVERY_MIN minutos, e o normal fica parado até ela acabar.
 */
let job: Cron | null = null
let peakJob: Cron | null = null

const TZ = 'America/Sao_Paulo'
const when = (d: Date) => d.toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })

export function startScheduler(log: FastifyBaseLogger): void {
  if (!config.COLLECT_ENABLED) {
    log.info('coleta automática desligada (COLLECT_ENABLED=false)')
    return
  }

  const collect = async () => {
    try {
      const { done } = await startCollection({ trigger: 'schedule', log: (m) => log.info(m) })
      await done
    } catch (err) {
      if (err instanceof AlreadyRunningError) log.warn('coleta anterior ainda rodando; pulando esta vez')
      else log.error({ err }, 'falha ao iniciar coleta agendada')
    }
  }

  job = new Cron(config.COLLECT_CRON, { timezone: TZ, protect: true }, async () => {
    if (inWindow(peakWindow)) return // quem coleta agora é o agendamento de pico
    await collect()
  })

  if (peakWindow && Date.now() < peakWindow.until.getTime()) {
    const cron = everyMinutesCron(peakEveryMin)
    peakJob = new Cron(cron, { timezone: TZ, protect: true, startAt: peakWindow.from, stopAt: peakWindow.until }, collect)
    log.info(`janela de pico: a cada ${peakEveryMin} min ("${cron}") de ${when(peakWindow.from)} a ${when(peakWindow.until)}`)
  }

  log.info(`coleta automática: "${config.COLLECT_CRON}" (próxima: ${nextRunAt()?.toISOString() ?? '—'})`)
}

export function nextRunAt(): Date | null {
  const peak = peakJob?.nextRun() ?? null
  let normal = job?.nextRun() ?? null
  // O horário normal que cai dentro da janela de pico não roda.
  if (normal && peakWindow && inWindow(peakWindow, normal)) normal = job?.nextRun(peakWindow.until) ?? null
  if (!peak || !normal) return peak ?? normal
  return peak < normal ? peak : normal
}

export function scheduleEnabled(): boolean {
  return job !== null
}

export function stopScheduler(): void {
  job?.stop()
  peakJob?.stop()
  job = null
  peakJob = null
}
