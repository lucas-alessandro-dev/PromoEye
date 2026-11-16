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
| GET | `/api/admin/messages?status=DRAFT` | — | `MessageDTO[]` (sem `status` = todas, mais novas primeiro, até 200) |
| PATCH | `/api/admin/messages/:id` | `MessageUpdateInput` | `MessageDTO` |

Hoje o envio é manual: copiar o texto, ou abrir `https://wa.me/?text=<texto codificado>` (o WhatsApp pede para escolher o grupo), e marcar como `SENT`.
O campo `whatsapp.provider` das configurações fica reservado para o envio automático (Evolution API, Z-API ou Cloud API).

## Configurações

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/admin/settings` | — | `SettingsDTO` |
| PUT | `/api/admin/settings` | `SettingsInput` | `SettingsDTO` |
