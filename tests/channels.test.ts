import { describe, expect, it } from 'vitest'
import { ADMIN_DISCARD_NOTE, blocksRepeat, REPEAT_WINDOW_MS, shouldAnnounce, type PastMessage } from '@promoeye/shared'

const NOW = new Date('2026-11-24T12:00:00Z')
const HOUR = 3_600_000
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR)
const msg = (status: PastMessage['status'], price: number | null, hoursAgo: number, error: string | null = null): PastMessage => ({
  status,
  price,
  createdAt: ago(hoursAgo),
  error,
})
const announce = (price: number, history: PastMessage[], autoQueue = true) => shouldAnnounce({ price, now: NOW, autoQueue, history })

const EXPIRED = 'Ficou mais de 12 h na fila (WhatsApp desconectado ou horário de silêncio); o preço pode ter mudado.'

describe('regra de repetição (os dois canais)', () => {
  it('item nunca avisado no canal: gera', () => {
    expect(announce(100, [])).toBe(true)
  })

  it('já avisado: só gera de novo se cair 1% ou mais', () => {
    const sent = [msg('SENT', 100, 5)]
    expect(announce(100, sent)).toBe(false)
    expect(announce(99.5, sent)).toBe(false)
    expect(announce(98.9, sent)).toBe(true)
  })

  it('aviso com mais de 7 dias não segura', () => {
    expect(announce(100, [msg('SENT', 100, REPEAT_WINDOW_MS / HOUR + 1)])).toBe(true)
  })

  it('na fila, saindo ou com erro (pode ter saído) segura', () => {
    for (const status of ['QUEUED', 'SENDING', 'FAILED'] as const) {
      expect(announce(100, [msg(status, 100, 1)])).toBe(false)
    }
  })

  it('mensagem que a fila descartou não segura: o canal ainda não avisou', () => {
    // O caso do Telegram: a mensagem esperou 12 h (bot sem permissão) e foi
    // descartada; o WhatsApp mandou a dele. O Telegram tem de ganhar outra.
    expect(announce(100, [msg('DISCARDED', 100, 2, EXPIRED)])).toBe(true)
    expect(announce(100, [msg('DISCARDED', 100, 2, 'Esgotou antes do envio.')])).toBe(true)
    expect(announce(100, [msg('DISCARDED', 100, 2, 'Substituída por uma mensagem mais nova do mesmo item.')])).toBe(true)
  })

  it('descartada no painel segura (antes sem motivo; agora com a nota)', () => {
    expect(announce(100, [msg('DISCARDED', 100, 2, null)])).toBe(false)
    expect(announce(100, [msg('DISCARDED', 100, 2, ADMIN_DISCARD_NOTE)])).toBe(false)
  })

  it('rascunho: segura com o envio automático desligado; ligado, a nova vai para a fila', () => {
    const draft = [msg('DRAFT', 100, 3)]
    expect(announce(100, draft, false)).toBe(false)
    // Rascunho de antes de ligar o envio automático não pode prender o item.
    expect(announce(100, draft, true)).toBe(true)
  })

  it('compara com a última que conta, não com a última de todas', () => {
    const history = [msg('SENT', 100, 30), msg('DISCARDED', 95, 3, 'O preço subiu para R$ 101,00 antes do envio.')]
    expect(announce(97, history)).toBe(true)
    expect(announce(99.5, history)).toBe(false)
  })

  it('a ordem do histórico não importa', () => {
    const history = [msg('SENT', 90, 1), msg('SENT', 120, 50)]
    expect(announce(95, history)).toBe(false)
    expect(announce(95, [...history].reverse())).toBe(false)
  })

  it('última sem preço não segura', () => {
    expect(announce(100, [msg('SENT', null, 1)])).toBe(true)
  })

  it('cada canal decide pelas mensagens dele', () => {
    const whatsapp = [msg('SENT', 100, 10)]
    const telegram = [msg('DISCARDED', 100, 10, EXPIRED)]
    expect(announce(100, whatsapp)).toBe(false)
    expect(announce(100, telegram)).toBe(true)
  })

  it('blocksRepeat cobre todos os status', () => {
    expect(blocksRepeat({ status: 'SENT', error: null }, true)).toBe(true)
    expect(blocksRepeat({ status: 'DRAFT', error: null }, false)).toBe(true)
    expect(blocksRepeat({ status: 'DRAFT', error: null }, true)).toBe(false)
    expect(blocksRepeat({ status: 'DISCARDED', error: EXPIRED }, false)).toBe(false)
  })
})
