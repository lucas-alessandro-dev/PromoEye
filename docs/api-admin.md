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
| GET | `/api/admin/messages?status=DRAFT` | — | `MessageDTO[]` (sem `status` = todas, mais novas primeiro, até 200; `QUEUED` vem na ordem de saída) |
| PATCH | `/api/admin/messages/:id` | `MessageUpdateInput` | `MessageDTO` (`QUEUED` põe na fila e zera tentativas; `DRAFT` tira; 409 se estiver `SENDING`) |
| POST | `/api/admin/messages/:id/send` | — | `MessageDTO`. Manda na hora pelo WAHA, sem esperar fila nem horário de silêncio. Em falha: 502 `{ error, message: MessageDTO }` |

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

Erros do WAHA voltam como 502 com a explicação em `error`; sem `WAHA_URL`/`WAHA_API_KEY` no servidor, 409.

## Configurações

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/settings` | — | `SettingsDTO` |
| PUT | `/api/admin/settings` | `SettingsInput` | `SettingsDTO` |
