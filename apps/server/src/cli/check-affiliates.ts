/**
 * Confere os links de afiliado de cada loja e das ofertas manuais.
 *
 *   npm run check:affiliates            só as regras (sem rede)
 *   npm run check:affiliates -- --live  segue os redirecionamentos de verdade
 *
 * Na VPS: docker compose exec app npm run check:affiliates -- --live
 * Sai com código 1 se algum link estiver quebrado (dá para usar antes do deploy).
 */
import { prisma } from '../lib/prisma.js'
import { runAffiliateCheck } from '../services/affiliate-check.js'

const ICON = { ok: '✔', warn: '!', error: '✘', none: '·' } as const

const live = process.argv.includes('--live')
const res = await runAffiliateCheck({ live })
let broken = 0
const print = (title: string, rows: typeof res.rows) => {
  if (!rows.length) return
  console.log(`\n${title}`)
  for (const r of rows) {
    if (r.status === 'error') broken++
    console.log(`  ${ICON[r.status]} ${r.storeName.padEnd(16)} ${r.mode.padEnd(8)} ${r.messages.join(' ')}`)
    if (r.sampleUrl && r.status !== 'none') console.log(`      ${r.sampleUrl}`)
    if (r.finalUrl && r.finalUrl !== r.sampleUrl) console.log(`      → ${r.finalUrl}`)
  }
}
print(`Lojas (${live ? 'ao vivo' : 'só regras'}):`, res.rows)
print('Links colados nas ofertas:', res.offerLinks)
console.log(`\n${broken ? `${broken} link(s) quebrado(s).` : 'Nenhum link quebrado.'}`)
await prisma.$disconnect()
process.exit(broken ? 1 : 0)
