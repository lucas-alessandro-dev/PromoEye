import type { MessageStatus } from './schemas.js'

/**
 * Regra de repetição das mensagens do grupo, a mesma no WhatsApp e no
 * Telegram (cada canal aplica sobre as mensagens dele).
 *
 * Uma promoção nova só vira mensagem se for mais barata (1% ou mais) que a
 * última que o canal já avisou ou ainda vai avisar nos últimos 7 dias. O que
 * nunca chegou ao grupo não conta: rascunho com o envio automático ligado,
 * mensagem que a fila descartou (ficou 12 h esperando, esgotou, o preço subiu)
 * e mensagem trocada por uma mais nova. Antes, essas mensagens seguravam o
 * item por 7 dias, e o Telegram, que começou depois, ficava sem as promoções
 * que o WhatsApp já tinha mandado.
 */

export const REPEAT_WINDOW_MS = 7 * 24 * 3_600_000
/** Queda mínima sobre a última avisada para avisar de novo. */
export const REPEAT_MIN_DROP = 0.01

/** Motivo gravado quando alguém descarta a mensagem no painel: essa decisão vale para a regra. */
export const ADMIN_DISCARD_NOTE = 'Descartada no painel.'

export interface PastMessage {
  status: MessageStatus
  price: number | null
  createdAt: Date
  error: string | null
}

/**
 * Esta mensagem segura uma nova do mesmo item no mesmo canal?
 * - enviada, saindo, na fila ou com erro (pode ter saído): sim;
 * - rascunho: só se o envio automático estiver desligado (evita rascunho
 *   repetido). Ligado, a nova entra na fila e substitui o rascunho;
 * - descartada: só se foi alguém no painel (sem motivo, como era antes, ou
 *   com `ADMIN_DISCARD_NOTE`). A fila sempre grava o motivo do descarte.
 */
export function blocksRepeat(m: Pick<PastMessage, 'status' | 'error'>, autoQueue: boolean): boolean {
  switch (m.status) {
    case 'SENT':
    case 'SENDING':
    case 'QUEUED':
    case 'FAILED':
      return true
    case 'DRAFT':
      return !autoQueue
    case 'DISCARDED':
      return m.error === null || m.error === ADMIN_DISCARD_NOTE
  }
}

/** Gera mensagem nova para o item neste canal? `history`: as mensagens do item no canal, em qualquer ordem. */
export function shouldAnnounce(input: { price: number; now: Date; autoQueue: boolean; history: readonly PastMessage[] }): boolean {
  const since = input.now.getTime() - REPEAT_WINDOW_MS
  let last: PastMessage | null = null
  for (const m of input.history) {
    if (m.createdAt.getTime() < since || !blocksRepeat(m, input.autoQueue)) continue
    if (!last || m.createdAt > last.createdAt) last = m
  }
  if (!last || last.price === null) return true
  return input.price < last.price * (1 - REPEAT_MIN_DROP)
}
