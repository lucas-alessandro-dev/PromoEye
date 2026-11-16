/**
 * Testa uma busca em cada loja automática, sem gravar nada:
 *   npm run probe -- "air fryer"
 * Útil para ver na hora se alguma loja passou a bloquear ou mudou o formato.
 */
import { adapterFor } from '../collector/adapters/index.js'
import { DEFAULT_STORES } from '@promoeye/shared'

const query = process.argv.slice(2).join(' ') || 'smart tv 55'
console.log(`Buscando "${query}"…\n`)
await Promise.all(
  DEFAULT_STORES.filter((s) => s.adapter !== 'MANUAL').map(async (s) => {
    const adapter = adapterFor({ id: s.id, name: s.name, domain: s.domain, adapter: s.adapter, config: s.config })!
    const t = Date.now()
    try {
      const rows = await adapter.search(query, { limit: 12 })
      const cheapest = rows.filter((r) => r.available).sort((a, b) => a.price - b.price)[0]
      console.log(
        `✔ ${s.name.padEnd(14)} ${String(rows.length).padStart(3)} resultados  ${String(Date.now() - t).padStart(5)} ms  ${cheapest ? `menor: R$ ${cheapest.price.toFixed(2)} — ${cheapest.title.slice(0, 60)}` : ''}`
      )
    } catch (err) {
      console.log(`✘ ${s.name.padEnd(14)} ${err instanceof Error ? err.message : String(err)}`)
    }
  })
)
