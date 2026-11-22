# API do painel — `/api/admin/*`

Tipos de entrada e saída: `packages/shared/src/schemas.ts` (importe de `@promoeye/shared`).

Regras gerais:

- Sessão por cookie `pe_admin` (httpOnly, SameSite=Strict). O navegador manda sozinho; use `credentials: 'same-origin'`.
- **Todo método que não é GET precisa do cabeçalho `X-PromoEye: 1`.** Sem ele: 403. (É a proteção contra CSRF: um site de fora não consegue mandar cabeçalho customizado sem preflight.)
- Erros: `{ error: string, issues?: { path: string, message: string }[] }`. 401 = sem sessão → mandar para o login.
- Datas em ISO 8601. Dinheiro em `number` (reais).

## Sessão

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/admin/login` | `LoginInput` | `MeDTO` (seta o cookie) |
| POST | `/api/admin/logout` | — | `204` |
| GET | `/api/admin/me` | — | `MeDTO` ou `401` |

## Painel

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/dashboard` | — | `DashboardDTO` |
| GET | `/api/admin/runs?limit=20` | — | `RunDTO[]` |
| GET | `/api/admin/runs/:id` | — | `RunDTO` |
| POST | `/api/admin/runs` | `{ itemIds?: string[] }` | `202 { runId }` · `409 { error, runId }` se já há coleta |

A coleta leva de 30 s a 2 min. Depois do POST, consulte `GET /api/admin/runs/:id` a cada 3 s até `status !== 'RUNNING'`.

## Itens acompanhados

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/items` | — | `WatchItemDTO[]` |
| GET | `/api/admin/items/:id` | — | `WatchItemDTO` |
| POST | `/api/admin/items` | `WatchItemInput` | `201 WatchItemDTO` |
| PUT | `/api/admin/items/:id` | `WatchItemInput` | `WatchItemDTO` |
| DELETE | `/api/admin/items/:id` | — | `204` |
| POST | `/api/admin/items/preview` | `PreviewInput` | `PreviewResult` (busca ao vivo, não grava nada; ~5–15 s) |
| GET | `/api/admin/items/:id/snapshots?days=30` | — | `{ at: string, minPrice: number \| null, storeId: string \| null }[]` |

## Ofertas

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/offers?itemId=&storeId=&deals=1&hidden=1&fresh=1&q=&limit=50&offset=0` | — | `{ rows: OfferDTO[], total: number }` |
| PATCH | `/api/admin/offers/:id` | `OfferUpdateInput` | `OfferDTO` |
| DELETE | `/api/admin/offers/:id` | — | `204` |
| GET | `/api/admin/offers/:id/history` | — | `PricePointDTO[]` |
| POST | `/api/admin/offers/manual` | `ManualOfferInput` | `201 OfferDTO` |
| POST | `/api/admin/offers/:id/message` | — | `201 MessageDTO` (rascunho de WhatsApp desta oferta) |

`fresh=1` (padrão) = só anúncios vistos nas últimas 3 h ou manuais. `hidden=1` inclui os ocultos.
`outboundUrl` no `OfferDTO` é o link `/ir/:id` público, que aplica o afiliado e conta o clique.

## Lojas

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/stores` | — | `StoreDTO[]` |
| PATCH | `/api/admin/stores/:id` | `StoreUpdateInput` | `StoreDTO` |
| POST | `/api/admin/stores/:id/test` | `{ query: string }` | `{ ok: boolean, count: number, sample: PreviewRow[], message: string \| null, tookMs: number }` |

## WhatsApp (fila de saída)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/messages?status=DRAFT&channel=telegram` | — | `MessageDTO[]` (sem `status` = todas, mais novas primeiro, até 200; `QUEUED` vem na ordem de saída; `channel` é `whatsapp` ou `telegram`, sem ele = os dois; filtro inválido = 400) |
| PATCH | `/api/admin/messages/:id` | `MessageUpdateInput` | `MessageDTO` (`QUEUED` põe na fila e zera tentativas; `DRAFT` tira; 409 se estiver `SENDING`) |
| POST | `/api/admin/messages/:id/send` | — | `MessageDTO`. Manda na hora pelo canal da mensagem (WAHA ou bot do Telegram), sem esperar fila nem horário de silêncio. 409 se o canal não estiver configurado. Em falha: 502 `{ error, message: MessageDTO }` |

Status: `DRAFT` (rascunho) → `QUEUED` (fila do envio automático) → `SENDING` → `SENT`, ou `DISCARDED` / `FAILED` com o motivo em `error`.
O envio manual continua: copiar o texto, ou abrir `https://wa.me/?text=<texto codificado>`, e marcar como `SENT`.

### Envio automático (WAHA)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/whatsapp/status` | — | `WhatsAppStatusDTO` (estado da conexão, número, regras, números da fila) |
| POST | `/api/admin/whatsapp/connect` | — | `WhatsAppStatusDTO`. Cria/inicia a sessão no WAHA; o estado vira `SCAN_QR_CODE` |
| GET | `/api/admin/whatsapp/qr` | — | `{ image: string }` (data URL). 409 fora de `SCAN_QR_CODE` |
| POST | `/api/admin/whatsapp/pair` | `{ phone: string }` | `{ code: string }` (conectar com número de telefone) |
| POST | `/api/admin/whatsapp/logout` | — | `WhatsAppStatusDTO` |
| GET | `/api/admin/whatsapp/groups` | — | `WhatsAppGroupDTO[]` (grupos do número conectado) |
| PUT | `/api/admin/whatsapp/settings` | `SenderSettings` | `WhatsAppStatusDTO`. `autoSend` exige `groupId`; ligar `autoSend` liga `whatsapp.autoDraft` |
| POST | `/api/admin/whatsapp/test` | `{ target: 'me' \| 'group' }` | `{ ok: true }` |
| GET | `/api/admin/telegram/status` | — | `TelegramStatusDTO` (estado do bot, grupo conferido agora com permissão de postar, regras, números da fila) |
| GET | `/api/admin/telegram/chats` | — | `TelegramChatDTO[]` (grupos e canais onde o bot apareceu nas últimas 24 h). 409 sem `TELEGRAM_BOT_TOKEN` |
| PUT | `/api/admin/telegram/settings` | `TelegramSettings` | `TelegramStatusDTO`. `autoSend` exige `chatId`. Grupo novo é conferido no Telegram: guarda o id numérico e o nome de lá; id que o bot não enxerga = 400 |
| POST | `/api/admin/telegram/test` | — | `{ ok: true }` (mensagem de teste no grupo escolhido) |

Erros do WAHA voltam como 502 com a explicação em `error`; sem `WAHA_URL`/`WAHA_API_KEY` no servidor, 409.

## Catálogo (produtos por EAN)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/products?q=&multi=1&limit=60&offset=0` | — | `ProductListDTO`. `q` com 8+ dígitos busca pelo final do EAN; `multi=1` só produtos em 2+ lojas |
| GET | `/api/admin/products/:id` | — | `ProductDetailDTO` (o produto e as ofertas ligadas) |
| POST | `/api/admin/offers/:id/product` | `{ gtin: string | null }` | `OfferDTO`. Liga a oferta ao produto do EAN (cria o produto se for o primeiro); `null` desliga. Se a loja mandar EAN na próxima coleta, o dela vence |

`POST /api/admin/offers/manual` também aceita `gtin` (opcional): a oferta manual já entra no catálogo.

## Links de afiliado

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/affiliates/check?live=0|1` | — | `AffiliateCheckDTO`. Monta o link do `/ir/` para uma oferta real de cada loja e confere https, domínio, parâmetro e tag; `live=1` segue os redirecionamentos (uma requisição por loja) |

O mesmo pelo terminal: `npm run check:affiliates` (`-- --live` para seguir os redirecionamentos). Sai com código 1 se algum link estiver quebrado.

## Alertas de preço (leads da vitrine)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/alerts` | — | `AlertsDTO` (SMTP configurado?, ligado?, contadores e os 500 mais recentes) |
| GET | `/api/admin/alerts.csv` | — | CSV (`;`, UTF-8 com BOM) dos alertas **ativos**. Link comum: o cookie autentica |
| DELETE | `/api/admin/alerts/:id` | — | `204`. Apaga de vez (pedido de exclusão, LGPD) |

Rotas públicas (vitrine, sem sessão, funcionam sem JavaScript): `POST /alertas` (formulário), `GET /alertas/:id/:assinatura` (página do link do e-mail), `POST /alertas/:id/:assinatura/confirmar` e `POST /alertas/:id/:assinatura/cancelar` (também o cancelamento em um clique do Gmail, RFC 8058).

## Configurações

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/settings` | — | `SettingsDTO` |
| PUT | `/api/admin/settings` | `SettingsInput` | `SettingsDTO` |
