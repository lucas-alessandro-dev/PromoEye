import { PrismaClient, Prisma } from '@prisma/client'

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})

/** Decimal do Prisma → number. Preço em reais cabe com folga num double. */
export function num(value: Prisma.Decimal | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value.toString())
  return Number.isFinite(n) ? n : null
}

/** Como `num`, mas para colunas NOT NULL. */
export function numReq(value: Prisma.Decimal | number | string): number {
  return num(value) ?? 0
}

export { Prisma }
