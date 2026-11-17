import { describe, expect, it } from 'vitest'
import { everyMinutesCron, inWindow, windowDTO } from '../apps/server/src/lib/peak.js'

// A janela da Black Friday que vai no compose.yml de produção.
const bf = { from: new Date('2026-11-26T18:00:00-03:00'), until: new Date('2026-11-29T00:00:00-03:00') }

describe('janela de pico (Black Friday)', () => {
  it('a cada N minutos, começando no minuto 5', () => {
    expect(everyMinutesCron(20)).toBe('5,25,45 * * * *')
    expect(everyMinutesCron(15)).toBe('5,20,35,50 * * * *')
    expect(everyMinutesCron(30)).toBe('5,35 * * * *')
    expect(everyMinutesCron(10)).toBe('5,15,25,35,45,55 * * * *')
  })

  it('o início conta, o fim não', () => {
    expect(inWindow(bf, new Date('2026-11-26T17:59:59-03:00'))).toBe(false)
    expect(inWindow(bf, bf.from)).toBe(true)
    expect(inWindow(bf, new Date('2026-11-27T00:05:00-03:00'))).toBe(true)
    expect(inWindow(bf, bf.until)).toBe(false)
    expect(inWindow(null, bf.from)).toBe(false)
  })

  it('o painel vê a janela por vir e a valendo; depois que passa, some', () => {
    expect(windowDTO(bf, new Date('2026-11-17T12:00:00-03:00'))).toEqual({
      from: '2026-11-26T21:00:00.000Z',
      until: '2026-11-29T03:00:00.000Z',
      active: false,
    })
    expect(windowDTO(bf, new Date('2026-11-27T10:00:00-03:00'))?.active).toBe(true)
    expect(windowDTO(bf, new Date('2026-11-29T00:00:00-03:00'))).toBeNull()
    expect(windowDTO(null)).toBeNull()
  })
})
