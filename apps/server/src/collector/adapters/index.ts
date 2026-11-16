import type { StoreAdapter, StoreContext } from '../types.js'
import { amazonAdapter } from './amazon.js'
import { kabumAdapter } from './kabum.js'
import { vtexAdapter } from './vtex.js'

/** `null` = loja MANUAL: o coletor pula, as ofertas entram pelo painel. */
export function adapterFor(store: StoreContext): StoreAdapter | null {
  switch (store.adapter) {
    case 'VTEX':
      return vtexAdapter(store)
    case 'KABUM':
      return kabumAdapter()
    case 'AMAZON':
      return amazonAdapter()
    case 'MANUAL':
      return null
  }
}
