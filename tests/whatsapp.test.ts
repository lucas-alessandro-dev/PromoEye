import { describe, expect, it } from 'vitest'
import { formatPhone, hourInSaoPaulo, inQuietHours, senderSettingsInput, type SenderSettings } from '@promoeye/shared'
import { Prisma } from '@prisma/client'
import {
  createWaha,
  errorText,
  imageForWhatsApp,
  messageIdOf,
  parseGroups,
  phoneOf,
  stateOf,
  WahaError,
} from '../apps/server/src/services/whatsapp/waha.js'
import { blockedNow, MAX_QUEUE_AGE_MS, staleReason } from '../apps/server/src/services/whatsapp/queue.js'
import { isLinkPreviewBot } from '../apps/server/src/routes/go.js'

const HOUR = 3_600_000

describe('horário de silêncio', () => {
  it('intervalo que vira a meia-noite (22 → 8)', () => {
    expect(inQuietHours(22, 22, 8)).toBe(true)
    expect(inQuietHours(3, 22, 8)).toBe(true)
    expect(inQuietHours(7, 22, 8)).toBe(true)
    expect(inQuietHours(8, 22, 8)).toBe(false)
    expect(inQuietHours(21, 22, 8)).toBe(false)
  })
  it('intervalo no mesmo dia e intervalo vazio', () => {
    expect(inQuietHours(13, 12, 14)).toBe(true)
    expect(inQuietHours(14, 12, 14)).toBe(false)
    expect(inQuietHours(5, 6, 6)).toBe(false)
  })
  it('hora de Brasília independe do fuso do servidor', () => {
    // 2026-11-16 02:30 UTC = 23:30 do dia 15 em São Paulo (UTC−3, sem horário de verão).
    expect(hourInSaoPaulo(new Date('2026-11-16T02:30:00Z'))).toBe(23)
    expect(hourInSaoPaulo(new Date('2026-11-16T03:00:00Z'))).toBe(0)
  })
})

describe('formatPhone', () => {
  it('celular e fixo brasileiros; estrangeiro só ganha o +', () => {
    expect(formatPhone('5511912345678')).toBe('+55 11 91234-5678')
    expect(formatPhone('551132345678')).toBe('+55 11 3234-5678')
    expect(formatPhone('14155550100')).toBe('+14155550100')
    expect(formatPhone(null)).toBe('')
  })
})

describe('leitura das respostas do WAHA (variam por motor)', () => {
  it('grupos em array, em objeto indexado e no formato do GOWS', () => {
    const noweb = { '1203@g.us': { id: '1203@g.us', subject: 'Promoções BF' } }
    const webjs = [{ id: { _serialized: '9999@g.us' }, name: 'Achadinhos' }, { id: { _serialized: '5511@c.us' }, name: 'Pessoa' }]
    const gows = [{ JID: '7777@g.us', Name: 'Ofertas da Família' }, { JID: { User: '8888', Server: 'g.us' }, GroupName: { Name: 'Zeta' } }]
    expect(parseGroups(noweb)).toEqual([{ id: '1203@g.us', name: 'Promoções BF' }])
    expect(parseGroups(webjs)).toEqual([{ id: '9999@g.us', name: 'Achadinhos' }])
    expect(parseGroups(gows)).toEqual([
      { id: '7777@g.us', name: 'Ofertas da Família' },
      { id: '8888@g.us', name: 'Zeta' },
    ])
    expect(parseGroups(null)).toEqual([])
  })
  it('grupo sem nome usa o id; repetido aparece uma vez; ordem alfabética', () => {
    const r = parseGroups([{ id: 'b@g.us', subject: 'beta' }, { id: 'a@g.us' }, { id: 'b@g.us', subject: 'beta' }, { id: 'c@g.us', subject: 'Álbum' }])
    expect(r.map((g) => g.name)).toEqual(['a@g.us', 'Álbum', 'beta'])
  })
  it('id da mensagem enviada', () => {
    expect(messageIdOf({ id: 'true_1203@g.us_ABC' })).toBe('true_1203@g.us_ABC')
    expect(messageIdOf({ id: { _serialized: 'X1' } })).toBe('X1')
    expect(messageIdOf({ key: { id: 'K9' } })).toBe('K9')
    expect(messageIdOf({ ID: 'G7' })).toBe('G7')
    expect(messageIdOf('ok')).toBeNull()
  })
  it('número conectado e estado', () => {
    expect(phoneOf('5511912345678@c.us')).toBe('5511912345678')
    expect(phoneOf('5511912345678:12@s.whatsapp.net')).toBe('5511912345678')
    expect(phoneOf('123456789012345@lid')).toBeNull()
    expect(stateOf('WORKING')).toBe('WORKING')
    expect(stateOf('PASSKEY_REQUIRED')).toBe('STARTING')
  })
  it('mensagem de erro legível', () => {
    expect(errorText(401, {})).toMatch(/recusou a chave/)
    expect(errorText(422, { message: ['chatId inválido', 'text vazio'] })).toBe('WAHA respondeu 422: chatId inválido; text vazio')
    expect(errorText(500, { exception: { message: 'falhou ao baixar' } })).toBe('WAHA respondeu 500: falhou ao baixar')
    expect(errorText(502, null)).toBe('WAHA respondeu 502')
  })
})

describe('foto da oferta', () => {
  it('JPEG e PNG viram foto; WebP/GIF e http, não', () => {
    expect(imageForWhatsApp('https://m.media-amazon.com/images/I/x._AC_SL1500_.jpg')?.mimetype).toBe('image/jpeg')
    expect(imageForWhatsApp('https://loja.vteximg.com.br/arquivos/ids/1/foto.PNG?v=2')?.mimetype).toBe('image/png')
    expect(imageForWhatsApp('https://images.kabum.com.br/produtos/fotos/1/foto')?.mimetype).toBe('image/jpeg')
    expect(imageForWhatsApp('https://cdn.loja.com/p.webp')).toBeNull()
    expect(imageForWhatsApp('https://cdn.loja.com/p.gif')).toBeNull()
    expect(imageForWhatsApp('http://cdn.loja.com/p.jpg')).toBeNull()
    expect(imageForWhatsApp(null)).toBeNull()
  })
})

// ── Cliente HTTP com fetch simulado ─────────────────────────────────────────

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(c)
    return handler(c)
  }) as typeof fetch
  return { fn, calls }
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

describe('cliente do WAHA', () => {
  it('sessão inexistente é null; start cria a sessão já iniciando', async () => {
    const f = fakeFetch((c) => (c.method === 'GET' ? json(404, { message: 'not found' }) : json(201, { name: 'default' })))
    const w = createWaha({ url: 'http://waha:3000/', apiKey: 'k1', session: 'default', fetch: f.fn })
    expect(await w.getSession()).toBeNull()
    await w.start()
    expect(f.calls.at(-1)).toMatchObject({ url: 'http://waha:3000/api/sessions', method: 'POST', body: { name: 'default', start: true } })
    expect(f.calls[0]!.headers['X-Api-Key']).toBe('k1')
  })

  it('sessão parada é iniciada; a que falhou é reiniciada; a conectada fica como está', async () => {
    for (const [status, expected] of [
      ['STOPPED', '/api/sessions/default/start'],
      ['FAILED', '/api/sessions/default/restart'],
      ['WORKING', null],
    ] as const) {
      const f = fakeFetch((c) => (c.method === 'GET' ? json(200, { name: 'default', status, me: null }) : json(201, {})))
      await createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: f.fn }).start()
      const post = f.calls.find((c) => c.method === 'POST')
      expect(post?.url.replace('http://w', '') ?? null).toBe(expected)
    }
  })

  it('lê o número conectado da sessão', async () => {
    const f = fakeFetch(() => json(200, { name: 'default', status: 'WORKING', me: { id: '5511912345678@c.us', pushName: 'Promo' } }))
    const s = await createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: f.fn }).getSession()
    expect(s).toEqual({ status: 'WORKING', meId: '5511912345678@c.us', pushName: 'Promo' })
  })

  it('envia foto com legenda no formato da API', async () => {
    const f = fakeFetch(() => json(201, { id: 'MSG1' }))
    const w = createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: f.fn })
    const id = await w.sendImage('1203@g.us', { url: 'https://x/p.jpg', mimetype: 'image/jpeg', filename: 'oferta.jpg' }, 'texto')
    expect(id).toBe('MSG1')
    expect(f.calls[0]).toMatchObject({
      url: 'http://w/api/sendImage',
      body: { session: 'default', chatId: '1203@g.us', caption: 'texto', file: { url: 'https://x/p.jpg', mimetype: 'image/jpeg' } },
    })
  })

  it('QR code em JSON (base64) ou em PNG puro vira data URL', async () => {
    const asJson = fakeFetch(() => json(200, { mimetype: 'image/png', data: 'iVBORw0KGgo=' }))
    expect(await createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: asJson.fn }).qr()).toBe(
      'data:image/png;base64,iVBORw0KGgo='
    )
    const asPng = fakeFetch(() => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }))
    expect(await createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: asPng.fn }).qr()).toBe('data:image/png;base64,iVBORw==')
  })

  it('erro HTTP vira WahaError com o código; prazo esgotado num envio avisa que pode ter saído', async () => {
    const bad = fakeFetch(() => json(500, { message: 'falhou ao baixar a imagem' }))
    const w1 = createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: bad.fn })
    await expect(w1.sendText('1@g.us', 'oi', false)).rejects.toMatchObject({ status: 500, maybeSent: false })

    // Nunca responde; rejeita quando o cliente aborta, como o fetch de verdade.
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    const w2 = createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: hang, timeoutMs: 10 })
    const sendErr = await w2.sendText('1@g.us', 'oi', false).catch((e: unknown) => e)
    expect(sendErr).toBeInstanceOf(WahaError)
    expect(sendErr).toMatchObject({ status: null, maybeSent: true })
    // Ler a sessão não envia nada: prazo esgotado ali não é "pode ter saído".
    await expect(w2.getSession()).rejects.toMatchObject({ status: null, maybeSent: false })

    const refused = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const w3 = createWaha({ url: 'http://w', apiKey: 'k', session: 'default', fetch: refused })
    await expect(w3.sendText('1@g.us', 'oi', false)).rejects.toMatchObject({ status: null, maybeSent: false })
  })
})

// ── Regras da fila ──────────────────────────────────────────────────────────

const sender: SenderSettings = {
  autoSend: true,
  groupId: '1203@g.us',
  groupName: 'Promo',
  withImage: true,
  maxPerHour: 10,
  quietHours: true,
  quietStart: 22,
  quietEnd: 8,
}
// 15:00 em São Paulo.
const afternoon = new Date('2026-11-16T18:00:00Z')

describe('pode enviar agora?', () => {
  const base = { now: afternoon, sender, sentLastHour: 0, lastSentAt: null, gapMs: 60_000 }
  it('à tarde, sem envio recente: pode', () => {
    expect(blockedNow(base)).toBeNull()
  })
  it('sem grupo, de madrugada, no limite ou logo depois da anterior: não', () => {
    expect(blockedNow({ ...base, sender: { ...sender, groupId: '' } })).toMatch(/grupo/)
    expect(blockedNow({ ...base, now: new Date('2026-11-16T06:00:00Z') })).toMatch(/silêncio/) // 03:00
    expect(blockedNow({ ...base, sentLastHour: 10 })).toMatch(/limite/)
    expect(blockedNow({ ...base, lastSentAt: new Date(afternoon.getTime() - 30_000) })).toMatch(/intervalo/)
  })
  it('silêncio desligado deixa enviar de madrugada', () => {
    expect(blockedNow({ ...base, now: new Date('2026-11-16T06:00:00Z'), sender: { ...sender, quietHours: false } })).toBeNull()
  })
  it('na janela sem silêncio (virada da Black Friday) sai de madrugada, mas o limite por hora continua', () => {
    const midnight = new Date('2026-11-27T03:05:00Z') // 00:05 em Brasília
    expect(blockedNow({ ...base, now: midnight, lastSentAt: null })).toMatch(/silêncio/)
    expect(blockedNow({ ...base, now: midnight, lastSentAt: null, quietOff: true })).toBeNull()
    expect(blockedNow({ ...base, now: midnight, lastSentAt: null, quietOff: true, sentLastHour: 10 })).toMatch(/limite/)
  })
})

describe('a mensagem ainda vale?', () => {
  const offer = {
    price: new Prisma.Decimal('3999.00'),
    available: true,
    hidden: false,
    source: 'AUTO' as const,
    lastSeenAt: new Date(afternoon.getTime() - 20 * 60_000),
  }
  const base = {
    now: afternoon,
    queuedAt: new Date(afternoon.getTime() - HOUR),
    messagePrice: 3999,
    messageBody: '🔥 *iPhone 16* por *R$ 3.999*',
    offer: { ...offer, cardPrice: null, pixPrice: null },
    hasNewer: false,
  }

  it('mesmo preço, anúncio visto há pouco: vale', () => {
    expect(staleReason(base)).toBeNull()
  })
  it('preço caiu mais um pouco: ainda vale (o texto só fica conservador)', () => {
    expect(staleReason({ ...base, offer: { ...offer, price: new Prisma.Decimal('3899.00') } })).toBeNull()
  })
  it('preço subiu: descarta, com o preço novo no motivo', () => {
    expect(staleReason({ ...base, offer: { ...offer, price: new Prisma.Decimal('4299.90') } })).toBe(
      'O preço subiu para R$ 4299,90 antes do envio.'
    )
  })
  it('esgotou, escondida, apagada, sumiu da loja, substituída, velha demais', () => {
    expect(staleReason({ ...base, offer: { ...offer, available: false } })).toMatch(/Esgotou/)
    expect(staleReason({ ...base, offer: { ...offer, hidden: true } })).toMatch(/escondida/)
    expect(staleReason({ ...base, offer: null })).toMatch(/apagada/)
    expect(staleReason({ ...base, offer: { ...offer, lastSeenAt: new Date(afternoon.getTime() - 4 * HOUR) } })).toMatch(/sumiu/)
    expect(staleReason({ ...base, hasNewer: true })).toMatch(/mais nova/)
    expect(staleReason({ ...base, queuedAt: new Date(afternoon.getTime() - MAX_QUEUE_AGE_MS - 1) })).toMatch(/12 h/)
  })
  it('oferta manual não "some da loja" (ninguém a revisita)', () => {
    expect(staleReason({ ...base, offer: { ...base.offer, source: 'MANUAL', lastSeenAt: new Date(0) } })).toBeNull()
  })

  describe('mensagem que diz "no Pix" (Polishop)', () => {
    const pixMsg = {
      ...base,
      messagePrice: 499.95,
      messageBody: '🔥 *Airfryer Smart Vision* por *R$ 499,95 no Pix*\nou R$ 555,50 no cartão',
    }
    const polishop = {
      ...offer,
      price: new Prisma.Decimal('499.95'),
      cardPrice: new Prisma.Decimal('555.50'),
      pixPrice: new Prisma.Decimal('499.95'),
    }
    it('a última coleta ainda confirma o Pix: vale', () => {
      expect(staleReason({ ...pixMsg, offer: polishop })).toBeNull()
    })
    it('a loja tirou o Pix e o preço à vista ficou igual: descarta', () => {
      expect(staleReason({ ...pixMsg, offer: { ...polishop, pixPrice: null } })).toBe('A loja não mostra mais esse preço no Pix.')
    })
    it('a loja tirou o Pix e o preço subiu: descarta pelo preço', () => {
      const card = new Prisma.Decimal('555.50')
      expect(staleReason({ ...pixMsg, offer: { ...polishop, price: card, cardPrice: null, pixPrice: null } })).toMatch(/subiu/)
    })
    it('mensagem sem "no Pix" não depende do Pix', () => {
      expect(staleReason({ ...pixMsg, messageBody: '🔥 *Airfryer* por *R$ 499,95 à vista*', offer: { ...polishop, pixPrice: null } })).toBeNull()
    })
  })
})

describe('configurações do envio', () => {
  it('aceita id de grupo e números como texto; recusa id de pessoa', () => {
    const r = senderSettingsInput.parse({ ...sender, maxPerHour: '12', quietStart: '23' })
    expect(r.maxPerHour).toBe(12)
    expect(r.quietStart).toBe(23)
    expect(senderSettingsInput.safeParse({ ...sender, groupId: '5511912345678@c.us' }).success).toBe(false)
    expect(senderSettingsInput.safeParse({ ...sender, maxPerHour: 100 }).success).toBe(false)
  })
})

describe('/ir não conta prévia de link como clique', () => {
  it('robôs e clientes HTTP; navegador de verdade conta', () => {
    expect(isLinkPreviewBot('WhatsApp/2.24.1 A')).toBe(true)
    expect(isLinkPreviewBot('facebookexternalhit/1.1')).toBe(true)
    expect(isLinkPreviewBot('Go-http-client/1.1')).toBe(true)
    expect(isLinkPreviewBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(isLinkPreviewBot('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(true)
    expect(isLinkPreviewBot(undefined)).toBe(true)
    // Celular da marca Cubot: tem "bot" no nome, mas é gente.
    expect(isLinkPreviewBot('Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36')).toBe(false)
    expect(
      isLinkPreviewBot('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36')
    ).toBe(false)
  })
})
