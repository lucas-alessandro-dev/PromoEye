import closeWithGrace from 'close-with-grace'
import { config } from './config.js'
import { buildApp } from './app.js'
import { prisma } from './lib/prisma.js'
import { failOrphanRuns } from './collector/run.js'
import { startScheduler, stopScheduler } from './collector/scheduler.js'
import { failOrphanSends, startQueue, stopQueue } from './services/whatsapp/queue.js'

const app = await buildApp()
await failOrphanRuns()
await failOrphanSends()
await app.listen({ port: config.PORT, host: config.HOST })
startScheduler(app.log)
startQueue(app.log)

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'encerrando por erro')
  stopScheduler()
  stopQueue()
  await app.close()
  await prisma.$disconnect()
})
