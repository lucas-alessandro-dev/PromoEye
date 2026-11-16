import { Cron } from 'croner'
import type { FastifyBaseLogger } from 'fastify'
import { config } from '../config.js'
import { AlreadyRunningError, startCollection } from './run.js'

/**
 * Agendamento da coleta. Padrão "5 * * * *": no minuto 5 de cada hora — fora
 * da virada exata, quando muita loja publica oferta relâmpago e o tráfego
 * delas está no pico.
 */
let job: Cron | null = null

export function startScheduler(log: FastifyBaseLogger): void {
  if (!config.COLLECT_ENABLED) {
    log.info('coleta automática desligada (COLLECT_ENABLED=false)')
    return
  }
  job = new Cron(config.COLLECT_CRON, { timezone: 'America/Sao_Paulo', protect: true }, async () => {
    try {
      const { done } = await startCollection({ trigger: 'schedule', log: (m) => log.info(m) })
      await done
    } catch (err) {
      if (err instanceof AlreadyRunningError) log.warn('coleta anterior ainda rodando; pulando esta hora')
      else log.error({ err }, 'falha ao iniciar coleta agendada')
    }
  })
  log.info(`coleta automática: "${config.COLLECT_CRON}" (próxima: ${job.nextRun()?.toISOString() ?? '—'})`)
}

export function nextRunAt(): Date | null {
  return job?.nextRun() ?? null
}

export function scheduleEnabled(): boolean {
  return job !== null
}

export function stopScheduler(): void {
  job?.stop()
  job = null
}
