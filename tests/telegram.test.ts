import { describe, expect, it } from 'vitest'
import { formatWhatsAppMessage, settingsInput, telegramSettingsInput, whatsappToTelegramHtml } from '@promoeye/shared'
import {
  classifyTelegramError,
  createTelegram,
  isParseError,
  parseTelegramChats,
  postProblem,
  TelegramError,
  telegramErrorText,
} from '../apps/server/src/services/telegram/bot.js'
import { clickChannel } from '../apps/server/src/routes/go.js'

// ── Texto: formato do WhatsApp → HTML do Telegram ───────────────────────────

describe('texto do Telegram', () => {
  it('negrito, itálico e riscado viram tags; o resto fica igual', () => {
    expect(whatsappToTelegramHtml('🔥 *Air fryer* por *R$ 299*')).toBe('🔥 <b>Air fryer</b> por <b>R$ 299</b>')
    expect(whatsappToTelegramHtml('De ~R$ 499~ (−40%)')).toBe('De <s>R$ 499</s> (−40%)')
    expect(whatsappToTelegramHtml('_só hoje_')).toBe('<i>só hoje</i>')
    expect(whatsappToTelegramHtml('linha 1\n\nlinha 2')).toBe('linha 1\n\nlinha 2')
  })

  it('escapa < > & do título: nada do texto vira tag', () => {
    expect(whatsappToTelegramHtml('Panela <Tramontina> & cia')).toBe('Panela &lt;Tramontina&gt; &amp; cia')
    expect(whatsappToTelegramHtml('*<script>alert(1)</script>*')).toBe('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>')
    expect(whatsappToTelegramHtml('<b>falso</b>')).toBe('&lt;b&gt;falso&lt;/b&gt;')
  })

  it('URL fica intacta: "_" e "*" dentro do link não são formatação', () => {
    const url = 'https://loja.example/p/panela_inox_5l?a=1&b=*2*'
    expect(whatsappToTelegramHtml(`👉 ${url}`)).toBe('👉 https://loja.example/p/panela_inox_5l?a=1&amp;b=*2*')
  })

  it('marcador sem par fica como está', () => {
    expect(whatsappToTelegramHtml('5 * 3 = 15')).toBe('5 * 3 = 15')
    expect(whatsappToTelegramHtml('*começa\ne termina*')).toBe('*começa\ne termina*')
  })

  it('a mensagem real do grupo vira HTML com tags fechadas', () => {
    const body = formatWhatsAppMessage({
      itemName: 'Air fryer',
      title: 'Fritadeira Elétrica <Mondial> 4L & cesto',
      storeName: 'Loja A',
      price: 299.9,
      listPrice: 499.9,
      cardPrice: null,
      pixPrice: null,
      installments: '10x de R$ 29,99',
      flags: ['menor-preco'],
      link: 'https://promoeye.example/ir/abc123?c=tg',
      realDiscountPct: 0.2,
    })
    const html = whatsappToTelegramHtml(body)
    expect(html).toContain('<b>Air fryer</b>')
    expect(html).toContain('<s>R$')
    expect(html).toContain('&lt;Mondial&gt; 4L &amp; cesto')
    expect(html).toContain('https://promoeye.example/ir/abc123?c=tg')
    for (const tag of ['b', 'i', 's']) {
      expect(html.split(`<${tag}>`).length).toBe(html.split(`</${tag}>`).length)
    }
  })
})

// ── Configurações ───────────────────────────────────────────────────────────

describe('configurações do Telegram', () => {
  const base = { autoSend: false, chatId: '', chatTitle: '', withImage: true, maxPerHour: '10', quietHours: true, quietStart: '22', quietEnd: '8' }
  it('aceita id de grupo/canal e @ de canal público; recusa o resto', () => {
    for (const chatId of ['', '-1001234567890', '-4567891234', '@promoeye_ofertas']) {
      expect(telegramSettingsInput.safeParse({ ...base, chatId }).success, chatId).toBe(true)
    }
    for (const chatId of ['120363@g.us', '@ab', 'https://t.me/promoeye', 'promoeye', '-12 34']) {
      expect(telegramSettingsInput.safeParse({ ...base, chatId }).success, chatId).toBe(false)
    }
  })

  it('convite da vitrine: links do Telegram; configuração antiga, sem o campo, continua valendo', () => {
    const app = {
      siteTitle: 'PromoEye',
      publicSite: true,
      allowIndexing: false,
      defaultMinDiscountPct: 10,
      globalExcludes: [],
      trustedSellers: [],
      blockedSellers: [],
      affiliateDisclosure: 'Links de afiliado.',
      whatsapp: { groupInviteUrl: '', autoDraft: true },
      alerts: { enabled: true },
    }
    expect(settingsInput.parse(app).telegram).toEqual({ inviteUrl: '' })
    for (const inviteUrl of [
      '',
      'https://t.me/promoeye_ofertas',
      'https://t.me/+AbCdEf123_-xYz',
      'https://t.me/joinchat/AbCdEf123',
      'https://telegram.me/promoeye/',
    ]) {
      expect(settingsInput.safeParse({ ...app, telegram: { inviteUrl } }).success, inviteUrl).toBe(true)
    }
    for (const inviteUrl of [
      'http://t.me/promoeye',
      'https://t.me/ab',
      'https://evil.example/t.me/promoeye',
      'https://t.me.evil.example/promoeye',
      'https://t.me/promoeye/123',
      'https://t.me/promo"onmouseover="x',
      'javascript:alert(1)',
      'https://chat.whatsapp.com/AbC',
    ]) {
      expect(settingsInput.safeParse({ ...app, telegram: { inviteUrl } }).success, inviteUrl).toBe(false)
    }
  })

  it('máximo por hora de 1 a 60, aceitando texto do formulário', () => {
    expect(telegramSettingsInput.parse({ ...base, maxPerHour: '60' }).maxPerHour).toBe(60)
    expect(telegramSettingsInput.safeParse({ ...base, maxPerHour: '61' }).success).toBe(false)
    expect(telegramSettingsInput.safeParse({ ...base, maxPerHour: '0' }).success).toBe(false)
  })
})

// ── Leitura das respostas ───────────────────────────────────────────────────

describe('grupos onde o bot está (getUpdates)', () => {
  const group = { id: -4001, type: 'group', title: 'Promo Família' }
  const channel = { id: -1002002, type: 'channel', title: 'PromoEye Ofertas', username: 'promoeye_ofertas' }
  const superGroup = { id: -1003003, type: 'supergroup', title: 'Achados' }

  it('grupo, supergrupo e canal entram; conversa privada não; ordem alfabética', () => {
    const chats = parseTelegramChats([
      { update_id: 1, my_chat_member: { chat: group, new_chat_member: { status: 'member' } } },
      { update_id: 2, message: { chat: { id: 55, type: 'private', first_name: 'Ana' }, text: 'oi' } },
      { update_id: 3, channel_post: { chat: channel, text: 'olá' } },
      { update_id: 4, message: { chat: superGroup, text: '/start@promoeye_bot' } },
    ])
    expect(chats).toEqual([
      { id: '-1003003', type: 'supergroup', title: 'Achados', username: null },
      { id: '-4001', type: 'group', title: 'Promo Família', username: null },
      { id: '-1002002', type: 'channel', title: 'PromoEye Ofertas', username: 'promoeye_ofertas' },
    ])
  })

  it('bot removido sai; grupo que virou supergrupo é trocado pelo novo', () => {
    const chats = parseTelegramChats([
      { update_id: 1, my_chat_member: { chat: group, new_chat_member: { status: 'member' } } },
      { update_id: 2, my_chat_member: { chat: channel, new_chat_member: { status: 'administrator' } } },
      { update_id: 3, my_chat_member: { chat: channel, new_chat_member: { status: 'kicked' } } },
      { update_id: 4, message: { chat: group, migrate_to_chat_id: -1004001 } },
      { update_id: 5, message: { chat: { id: -1004001, type: 'supergroup', title: 'Promo Família' }, migrate_from_chat_id: -4001 } },
    ])
    expect(chats.map((c) => c.id)).toEqual(['-1004001'])
  })

  it('resposta estranha não quebra', () => {
    expect(parseTelegramChats(null)).toEqual([])
    expect(parseTelegramChats([null, 1, { update_id: 1 }, { message: { chat: { id: 'x', type: 'group' } } }])).toEqual([])
  })
})

describe('o bot consegue postar?', () => {
  const member = (status: string, extra: Partial<{ canPostMessages: boolean; canSendMessages: boolean }> = {}) => ({
    status,
    canPostMessages: extra.canPostMessages ?? null,
    canSendMessages: extra.canSendMessages ?? null,
  })

  it('no canal, só administrador com permissão de publicar', () => {
    expect(postProblem('channel', member('administrator', { canPostMessages: true }), null)).toBeNull()
    expect(postProblem('channel', member('creator'), null)).toBeNull()
    expect(postProblem('channel', member('administrator', { canPostMessages: false }), null)).toMatch(/administrador/)
    expect(postProblem('channel', member('member'), null)).toMatch(/administrador/)
  })

  it('no grupo, membro basta, a menos que só admins falem', () => {
    expect(postProblem('supergroup', member('member'), true)).toBeNull()
    expect(postProblem('group', member('member'), null)).toBeNull()
    expect(postProblem('supergroup', member('member'), false)).toMatch(/administrador/)
    expect(postProblem('supergroup', member('administrator'), false)).toBeNull()
    expect(postProblem('supergroup', member('restricted', { canSendMessages: false }), true)).toMatch(/restrito/)
    expect(postProblem('group', member('left'), true)).toMatch(/não está/)
    expect(postProblem('group', member('kicked'), true)).toMatch(/não está/)
  })
})

describe('erros do Telegram', () => {
  it('mensagem legível', () => {
    expect(telegramErrorText(401, 'Unauthorized')).toMatch(/token/)
    expect(telegramErrorText(400, 'Bad Request: chat not found')).toMatch(/não encontrado/)
    expect(telegramErrorText(403, 'Forbidden: bot was kicked from the supergroup chat')).toMatch(/removido/)
    expect(telegramErrorText(400, 'Bad Request: message is too long')).toBe('Telegram respondeu 400: Bad Request: message is too long')
  })

  it('o que fazer depois da falha', () => {
    const e = (status: number | null, description: string | null = null, maybeSent = false) =>
      new TelegramError('x', status, maybeSent, null, null, description)
    expect(classifyTelegramError(e(null, null, true))).toBe('maybe-sent')
    expect(classifyTelegramError(e(null))).toBe('transient')
    expect(classifyTelegramError(e(429))).toBe('transient')
    expect(classifyTelegramError(e(502))).toBe('transient')
    expect(classifyTelegramError(e(401))).toBe('config')
    expect(classifyTelegramError(e(403, 'Forbidden: bot is not a member of the channel chat'))).toBe('config')
    expect(classifyTelegramError(e(400, 'Bad Request: chat not found'))).toBe('config')
    expect(classifyTelegramError(e(400, 'Bad Request: not enough rights to send photos to the chat'))).toBe('config')
    expect(classifyTelegramError(e(400, 'Bad Request: message is too long'))).toBe('rejected')
    expect(classifyTelegramError(new Error('banco caiu'))).toBe('transient')
  })

  it('erro de HTML é reconhecido para reenviar como texto puro', () => {
    expect(isParseError(new TelegramError('x', 400, false, null, null, "Bad Request: can't parse entities: unclosed tag"))).toBe(true)
    expect(isParseError(new TelegramError('x', 400, false, null, null, 'Bad Request: chat not found'))).toBe(false)
  })
})

// ── Cliente HTTP com fetch simulado ─────────────────────────────────────────

const TOKEN = '123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-Ms'

type Call = { url: string; body: Record<string, unknown> }

function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {} }
    calls.push(c)
    return handler(c)
  }) as typeof fetch
  return { fn, calls }
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

describe('cliente do Telegram', () => {
  it('envia foto com legenda em HTML no formato da Bot API', async () => {
    const f = fakeFetch(() => json(200, { ok: true, result: { message_id: 42 } }))
    const bot = createTelegram({ token: TOKEN, fetch: f.fn })
    const id = await bot.sendPhoto('-1001', 'https://x/p.jpg', '<b>oi</b>', { html: true })
    expect(id).toBe('42')
    expect(f.calls[0]).toEqual({
      url: `https://api.telegram.org/bot${TOKEN}/sendPhoto`,
      body: { chat_id: '-1001', photo: 'https://x/p.jpg', caption: '<b>oi</b>', parse_mode: 'HTML' },
    })
  })

  it('texto puro vai sem parse_mode; a prévia do link é ligada ou desligada', async () => {
    const f = fakeFetch(() => json(200, { ok: true, result: { message_id: 7 } }))
    const bot = createTelegram({ token: TOKEN, fetch: f.fn })
    await bot.sendMessage('@canal', '*oi*', { html: false, linkPreview: false })
    expect(f.calls[0]!.body).toEqual({ chat_id: '@canal', text: '*oi*', link_preview_options: { is_disabled: true } })
  })

  it('lê o grupo, as permissões e o bot', async () => {
    const f = fakeFetch((c) => {
      if (c.url.endsWith('/getChat'))
        return json(200, { ok: true, result: { id: -1002, type: 'supergroup', title: 'Achados', permissions: { can_send_messages: false } } })
      if (c.url.endsWith('/getChatMember')) return json(200, { ok: true, result: { status: 'administrator', can_post_messages: true } })
      return json(200, { ok: true, result: { id: 987654321, is_bot: true, first_name: 'PromoEye', username: 'promoeye_bot' } })
    })
    const bot = createTelegram({ token: TOKEN, fetch: f.fn })
    expect(await bot.getMe()).toEqual({ id: '987654321', username: 'promoeye_bot', name: 'PromoEye' })
    expect(await bot.getChat('@achados')).toEqual({ id: '-1002', type: 'supergroup', title: 'Achados', username: null, membersCanSend: false })
    expect(await bot.getChatMember('-1002', '987654321')).toEqual({ status: 'administrator', canPostMessages: true, canSendMessages: null })
    expect(f.calls.at(-1)!.body).toEqual({ chat_id: '-1002', user_id: 987654321 })
  })

  it('erro da API vira TelegramError com código, espera do 429 e id novo do supergrupo', async () => {
    const answers = [
      json(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }),
      json(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }),
      json(400, {
        ok: false,
        error_code: 400,
        description: 'Bad Request: group chat was upgraded to a supergroup chat',
        parameters: { migrate_to_chat_id: -1009876543210 },
      }),
    ]
    const f = fakeFetch(() => answers.shift()!)
    const bot = createTelegram({ token: TOKEN, fetch: f.fn })
    await expect(bot.sendMessage('-1', 'a', { html: true, linkPreview: true })).rejects.toMatchObject({
      status: 400,
      description: 'Bad Request: chat not found',
      message: expect.stringMatching(/não encontrado/),
    })
    await expect(bot.sendMessage('-1', 'a', { html: true, linkPreview: true })).rejects.toMatchObject({
      status: 429,
      retryAfterSec: 7,
      message: 'limite do Telegram: esperar 7 s',
    })
    await expect(bot.sendMessage('-1', 'a', { html: true, linkPreview: true })).rejects.toMatchObject({
      status: 400,
      migrateTo: '-1009876543210',
    })
  })

  it('prazo esgotado num envio avisa que pode ter saído; numa leitura, não', async () => {
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    const bot = createTelegram({ token: TOKEN, fetch: hang, timeoutMs: 10 })
    await expect(bot.sendMessage('-1', 'a', { html: true, linkPreview: true })).rejects.toMatchObject({ status: null, maybeSent: true })
    await expect(bot.getMe()).rejects.toMatchObject({ status: null, maybeSent: false })
  })

  it('o token nunca aparece no erro, nem quando a rede o cita', async () => {
    const leaky = (async (input: RequestInfo | URL) => {
      throw new TypeError(`request to ${String(input)} failed, reason: getaddrinfo ENOTFOUND`)
    }) as typeof fetch
    const err = await createTelegram({ token: TOKEN, fetch: leaky })
      .sendMessage('-1', 'a', { html: true, linkPreview: true })
      .catch((e: unknown) => e as TelegramError)
    expect(err).toBeInstanceOf(TelegramError)
    expect(err.message).not.toContain(TOKEN)
    expect(err.message).toContain('<token>')
    expect(err.maybeSent).toBe(false)

    const echo = fakeFetch((c) => json(400, { ok: false, error_code: 400, description: `Bad Request: weird ${c.url}` }))
    const err2 = await createTelegram({ token: TOKEN, fetch: echo.fn }).getMe().catch((e: unknown) => e as TelegramError)
    expect(err2.message).not.toContain(TOKEN)
    expect(err2.description).not.toContain(TOKEN)
  })

  it('resposta sem JSON não quebra', async () => {
    const html = fakeFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    await expect(createTelegram({ token: TOKEN, fetch: html.fn }).getMe()).rejects.toMatchObject({ status: 502 })
  })
})

describe('/ir conta o clique do Telegram', () => {
  it('?c= vira o canal; o resto é site', () => {
    expect(clickChannel('tg')).toBe('telegram')
    expect(clickChannel('wa')).toBe('whatsapp')
    expect(clickChannel('email')).toBe('email')
    expect(clickChannel(undefined)).toBe('site')
    expect(clickChannel('x')).toBe('site')
    expect(clickChannel('constructor')).toBe('site')
    expect(clickChannel('__proto__')).toBe('site')
  })
})
