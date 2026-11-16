import type { ReactNode } from 'react'
import { DEAL_FLAGS, flagLabel, flagTone, formatBRL, listDiscount } from '@promoeye/shared'

function flagHint(flag: string): string | undefined {
  return (DEAL_FLAGS as Record<string, { hint: string }>)[flag]?.hint
}

/** Selos com a cor do tom (bom / atenção / informação) e a explicação no `title`. */
export function Flags({ flags, max, hideShortHistory = false }: { flags: string[]; max?: number; hideShortHistory?: boolean }) {
  const list = flags.filter((f) => !(hideShortHistory && f === 'historico-curto'))
  const shown = max ? list.slice(0, max) : list
  if (!shown.length) return null
  return (
    <ul className="flags" aria-label="Selos">
      {shown.map((f) => (
        <li key={f} className={`flag flag-${flagTone(f)}`} title={flagHint(f)}>
          {flagLabel(f)}
        </li>
      ))}
      {max && list.length > max && <li className="flag flag-more">+{list.length - max}</li>}
    </ul>
  )
}

/**
 * Preço atual e preço "de". O "de" só aparece riscado (como desconto) quando
 * NÃO tem o selo de preço inflado — riscar um preço inventado seria repetir a
 * propaganda da loja.
 */
export function Price({
  price,
  listPrice,
  flags = [],
  size = 'md',
}: {
  price: number
  listPrice: number | null
  flags?: string[]
  size?: 'sm' | 'md' | 'lg'
}) {
  const off = listDiscount(price, listPrice)
  const inflated = flags.includes('preco-de-inflado')
  return (
    <div className={`price price-${size}`}>
      <span className="price-now">{formatBRL(price)}</span>
      {listPrice && off !== null && off >= 0.01 && (
        inflated ? (
          <span className="price-list price-inflated" title={flagHint('preco-de-inflado')}>
            “de” {formatBRL(listPrice)} (inflado)
          </span>
        ) : (
          <span className="price-list">
            <span className="sr-only">Preço anterior: </span>
            <s>{formatBRL(listPrice)}</s> <span className="price-off">−{Math.round(off * 100)}%</span>
          </span>
        )
      )}
    </div>
  )
}

export function Thumb({ src, alt = '', size = 64 }: { src: string | null; alt?: string; size?: number }) {
  if (!src) {
    return (
      <span className="thumb thumb-empty" style={{ width: size, height: size }} aria-hidden="true">
        sem foto
      </span>
    )
  }
  return (
    <img
      className="thumb"
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  )
}

export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'danger' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
