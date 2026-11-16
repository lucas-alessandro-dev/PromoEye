import closeWithGrace from 'close-with-grace'
import { config } from './config.js'
import { buildApp } from './app.js'
import { prisma } from './lib/prisma.js'
import { failOrphanRuns } from './collector/run.js'
import { startScheduler, stopScheduler } from './collector/scheduler.js'

const app = await buildApp()
await failOrphanRuns()
await app.listen({ port: config.PORT, host: config.HOST })
startScheduler(app.log)

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'encerrando por erro')
  stopScheduler()
  await app.close()
  await prisma.$disconnect()
})
