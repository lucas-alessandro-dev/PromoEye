import closeWithGrace from 'close-with-grace'
import { config } from './config.js'
import { buildApp } from './app.js'
import { prisma } from './lib/prisma.js'
import { failOrphanRuns } from './collector/run.js'
import { startScheduler, stopScheduler } from './collector/scheduler.js'
import { failOrphanSends, startQueue, stopQueue } from './services/whatsapp/queue.js'
import { startTelegramQueue, stopTelegramQueue } from './services/telegram/queue.js'

const app = await buildApp()
await failOrphanRuns()
// Vale para os dois canais: o que estava saindo quando o servidor caiu vira "com erro".
await failOrphanSends()
await app.listen({ port: config.PORT, host: config.HOST })
startScheduler(app.log)
startQueue(app.log)
startTelegramQueue(app.log)

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'encerrando por erro')
  stopScheduler()
  stopQueue()
  stopTelegramQueue()
  await app.close()
  await prisma.$disconnect()
})
