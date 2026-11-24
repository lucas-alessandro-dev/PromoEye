# CLAUDE.md — Contexto do PromoEye

## 1. Produto e posicionamento

- **O que é:** plataforma brasileira de monitoramento, auditoria e comparação de preços. Diferente de comparadores tradicionais (Zoom, Buscapé), que dependem de feeds XML e sofrem viés de comissão, o PromoEye confere o preço nas lojas e separa desconto real de maquiagem ("metade do dobro").
- **Objetivo de negócio:** competir com Zoom, Buscapé, Promobit e Pechincha.ai. O vertical **Casa, Cozinha & Chá de Panela** é só o caso de validação, não o foco.
- **Proposta de valor ("auditor de preços reais"):**
  1. **Veracidade:** desconto calculado contra a **mediana dos últimos 30 dias ponderada pelo tempo** que cada preço durou, registrada pelo próprio PromoEye. Nunca contra o preço "de" da loja.
  2. **Frescor comprovado:** coleta de hora em hora (a cada 20 min no pico) e "preço conferido há X min" na vitrine.
  3. **Comparação exata:** catálogo por código de barras (GTIN/EAN), não por título parecido.
  4. **Distribuição ativa:** vitrine SSR rápida, grupo de WhatsApp e alertas por e-mail.
- **Marco:** Black Friday 2026 (27/11, pico de 26 a 29/11) valida retenção, cliques de afiliado e estabilidade. Depois: escalar catálogo, fontes de dados autorizadas e SEO programático.
- **Mercado:** pt-BR, R$, aviso de afiliado (CONAR) e LGPD.

## 2. Arquitetura

- Monorepo npm workspaces, TypeScript, Node ≥ 22.
  - `apps/server`: Fastify. Vitrine SSR (Nunjucks), API do painel (`/api/admin/*`), redirecionamento rastreado `/ir/<id>`, coletor e agendador (croner), filas do WhatsApp (WAHA) e do Telegram (bot), alertas por e-mail.
  - `apps/admin`: React + Vite em `/painel`.
  - `packages/shared`: contratos zod, selos, formatação, catálogo de lojas, mensagem do WhatsApp, GTIN (`gtin.ts`).
- PostgreSQL + Prisma. Modelos: `Store`, `WatchItem`, `Offer`, `PricePoint`, `ItemSnapshot`, `Product`, `PriceAlert`, `CollectorRun`, `Click`, `OutboundMessage`, `Setting`, `AdminUser`, `AdminSession`.
- Testes: Vitest (`npm test`), só funções puras, sem banco.
- Produção: Docker Compose na VPS Hostinger compartilhada, atrás do Caddy (HTTPS). Deploy: `bash ops/vps/deploy.sh` (envia a pasta, commitada ou não). O `ops/entrypoint.sh` aplica as migrações a cada subida. Domínio `https://promoeye.com.br` (DNS na Hostinger: A `@` → VPS, `www` CNAME). O provisório `promoeye.187-53-119-70.sslip.io` e o `www` respondem 301 com o caminho (`PUBLIC_URL_ALIASES`): não tirar, há links `/ir/` antigos no grupo. Trocar de domínio: `docs/deploy-vps.md`.

## 3. Regras de negócio

### 3.1 Itens e filtro (`WatchItem` + `collector/matcher.ts`)
- Campos: `name`, `query` (o que é buscado), `mustInclude` (palavra inteira, `|` para alternativas), `mustExclude`, `minPrice` (corta acessório), `targetPrice`, `minDiscountPct`, `category`, `storeIds`.
- "Testar busca" no painel simula a coleta e explica cada descarte.
- Unidade que a loja marca como não nova (`RawOffer.notNew`; VTEX: "Outlet" no título ou no agrupamento "Outlet", que na Polishop é produto devolvido com defeito estético) é descartada no `matchOffer`, salvo se a busca pedir a palavra. Não depende das exclusões globais, que ficam salvas no banco.
- Marketplace: só vendedores da lista de confiáveis (política por loja).

### 3.2 Coletor
- Minuto 05 de cada hora (`COLLECT_CRON`). Pico: `PEAK_FROM`, `PEAK_UNTIL`, `PEAK_EVERY_MIN` (no `ops/vps/compose.yml`: 26/11 18h → 29/11 0h, a cada 20 min).
- Adaptadores: 16 lojas VTEX (API pública), Amazon (página de busca), KaBuM! (API do site). Mercado Livre, Magalu e Casas Bahia são **manuais**.
- **Inegociável:** nunca contornar CAPTCHA, WAF ou bloqueio anti-robô. Bloqueou, registra e para naquela loja.

### 3.3 Catálogo (`Product`, `collector/catalog.ts`)
- O produto nasce sozinho quando a loja informa um **EAN válido** (dígito verificador, fora dos prefixos de uso interno 02x/04x/2xx). Título parecido **nunca** junta anúncios.
- Forma canônica do GTIN: 14 dígitos. Para mostrar, use `displayGtin`.
- Ofertas sem EAN (Amazon, KaBuM!, manuais) são ligadas pelo painel. O EAN da loja vence na coleta seguinte.

### 3.4 Preço, Pix e cartão
- `Offer.price` é a base do histórico, da pontuação e das comparações. **Não troque a base** (por exemplo, para o Pix): cria uma "queda" falsa no histórico e dispara promoção falsa no grupo.
- `pixPrice` fica à parte. VTEX, nesta ordem: (1) a linha "Pix" 1x da tabela de parcelas da loja (`Installments`): igual ao `price` e menor que o `Price` → `pixPrice = price` ("Preço no Pix": Polishop, Mondial, iByte); menor que o `price` (catálogo, sem `spotPrice`) → vai à parte; (2) a regra "PercentualDiscount para PaymentMethodId Pix em 1x", sem outra condição, e nunca em cima de um `spotPrice` já descontado. Pix mais de 30% abaixo é ignorado. KaBuM!: o `price` já é o Pix.
- Esgotado guarda o mesmo preço à vista (`min(Price, spotPrice)`) de quando há estoque, para a volta não parecer queda.

### 3.5 Pontuação e selos (`collector/scoring.ts`)
- Positivos: `desconto-real`, `menor-preco`, `abaixo-do-alvo`, `mais-barato`, `caiu-agora`, `oferta-relampago`.
- Proteção: `preco-de-inflado` (o "de" some da vitrine), `subiu-antes` (anula a promoção), `historico-curto`.

### 3.6 Afiliados e `/ir/<id>`
- Prioridade: link colado na oferta → modelo da loja (`tag=...`, rede com `{url}`/`{url_encoded}`/`{id}`, ou loja de afiliado com `{path}`, como `https://www.magazinevoce.com.br/magazinepromoeye{path}`) → URL limpa. A regra fica em `packages/shared/src/affiliate.ts` (servidor e prévia do painel usam a mesma). URL inteira sem marcador é recusada no painel e ignorada no `/ir/`.
- Clique sem IP; canal `site`, `whatsapp` (`?c=wa`), `telegram` (`?c=tg`) ou `email` (`?c=email`). Só redireciona para https.
- Verificação: `npm run check:affiliates [-- --live]` ou Painel › Lojas.

### 3.7 WhatsApp (WAHA, motor GOWS)
- Mensagem só quando a promoção é mais barata que a última avisada do item. **No máximo uma ativa por item**: a nova substitui as que esperavam (`supersedeOlderMessages`).
- Uma por vez, ≥1 min com jitter, teto por hora (padrão 10), silêncio 22h–8h (suspenso em `QUIET_OFF_*`). Antes de enviar, confere preço, estoque e se há mensagem mais nova.
- **Sem mensagens 1:1 automáticas** do número do grupo (risco de bloqueio). Alerta individual é por e-mail.

### 3.8 Telegram (Bot API, `services/telegram/*`)
- Bot oficial (`TELEGRAM_BOT_TOKEN`, criado no @BotFather) posta num grupo ou canal escolhido em Painel › Telegram. Sem token, nada é gerado.
- `OutboundMessage.channel` separa os canais. **Cada canal tem a sua mensagem, fila, limite e regra de repetição**: toda consulta da fila filtra por `channel`. Sem o filtro, a mensagem de um canal "substitui" (descarta) a do outro.
- Mesmas regras do 3.7 (`blockedNow`, `staleReason`), teto de 1 a 60 por hora. Erro de configuração (bot fora do grupo, sem permissão, token recusado) deixa a mensagem esperando na fila; 429 espera o `retry_after`; supergrupo novo troca o `chatId` sozinho.
- O texto fica no formato do WhatsApp e vira HTML na hora de enviar (`whatsappToTelegramHtml`, escapa `< > &`). O token vai na URL: nenhum erro mostra a URL, e o token é trocado por `<token>`.

### 3.9 Alertas por e-mail (`PriceAlert`, `services/alerts/*`)
- Opt-in duplo, consentimento gravado com o texto exato, cancelamento em um clique (RFC 8058), links assinados com HMAC (`/alertas/<id>/<assinatura>`).
- Avisa com preço-alvo atingido ou, sem alvo, com `isDeal`. Máximo 1 e-mail a cada 12 h por alerta, e de novo só se cair mais 2%.
- Ligado só com `SMTP_URL` e `SMTP_FROM`. Sem eles o formulário some.

## 4. UI

- Tokens "stitch": petróleo `#072C2C`, laranja `#FF5F03` (`#E95603` na vitrine, por contraste AA), areia `#EDEADE`, Mona Sans. Kit da taste-skill em `apps/server/public/assets` (não editar); estilos próprios em `apps/server/public/site/site.css`; peças em `views/partials/_macros.njk`.
- Rotas públicas (SSR, **100% sem JavaScript**): `/`, `/ofertas/<slug>` (item), `/produtos/<slug>` (produto por EAN), `/alertas/...`, `/sitemap.xml` (itens + produtos com oferta), `/robots.txt`.
- JSON-LD (`lib/jsonld.ts`): Product + AggregateOffer + BreadcrumbList. Item com 2+ marcas vira ItemList, porque marcar categoria como Product é enganoso. Todo JSON-LD passa por `jsonLdScript`, que escapa `< > &` e os separadores de linha.
- Painel: Painel, Itens, Ofertas, Lojas (com verificação de afiliados), Catálogo, Alertas, WhatsApp, Telegram, Configurações.

## 5. Estado e backlog

### Feito (branch `feat/estrategia-bf-catalogo`, 17/11/2026)
- Janelas de pico e silêncio com testes; KaBuM! 404; responsividade mobile.
- EAN, marca e Pix capturados; migração `20261117200000_catalog_pix_alerts`, só aditiva.
- Catálogo por EAN, página `/produtos/<slug>`, painel Catálogo, ligação manual por EAN.
- JSON-LD, sitemap com produtos, `noindex` em produto sem oferta.
- Alertas por e-mail com painel, CSV e exclusão.
- "Conferido há X min" e o horário real da próxima coleta (inclusive no pico).
- Uma mensagem ativa por item na fila do WhatsApp.
- Verificação de afiliados (CLI e painel); redirecionamento 301 dos domínios antigos no `up.sh`.
- Domínio definitivo `promoeye.com.br` no ar (19/11/2026), com certificado, 301 do sslip e do `www`, e a fila do WhatsApp já com o link novo.
- Envio para grupo/canal do Telegram por bot (22/11/2026): fila própria, página no painel, aviso no Painel, clique `?c=tg`. Sem migração (`channel` já existia).
- Convite do Telegram na vitrine (Configurações › Telegram): faixa da loja, rodapé, perguntas e alerta. O WhatsApp continua sendo o botão da barra; o Telegram só ocupa a barra sem convite do WhatsApp. Sem convite do Telegram, a vitrine fica como antes.
- Polishop revisada (24/11/2026). Já era loja VTEX automática desde o início, com logo, EAN e marca. Agora também: Pix pela tabela de parcelas ("Preço no Pix", vale para todas as VTEX), outlet descartado, preço à vista no esgotado e teste do painel com "airfryer". A loja vende quase só marca própria (Ichef, Polishop): só aparece na vitrine se um item vigiado casar com os títulos dela ("Airfryer", tudo junto).

### Pendente (depende de decisão ou acesso do Lucas)
- Contratar SMTP (Brevo/SES/Resend) e configurar SPF/DKIM no DNS de `promoeye.com.br` (zona na Hostinger).
- Cadastrar e validar os afiliados reais (Amazon `tag`, redes para VTEX). Mercado Livre: modelo `matt_word`/`matt_tool` cadastrado em 19/11. Magalu (Influenciador Magalu): loja `https://www.magazinevoce.com.br/magazinepromoeye/`; o link de afiliado de cada oferta manual é o caminho do produto da Magalu depois desse endereço. Nunca colar uma URL inteira no modelo da loja: sem marcador, ela vira parâmetro e o link sai quebrado.
- Ligar "Deixar o Google indexar" (o domínio definitivo já está no ar).
- Telegram: criar o bot no @BotFather, pôr `TELEGRAM_BOT_TOKEN` no `.env` da VPS, adicionar o bot ao grupo/canal e escolher em Painel › Telegram. Colar o convite (`https://t.me/...`) em Configurações para ele aparecer na vitrine.

### Depois da Black Friday
- Fontes de dados autorizadas para escalar: feeds de redes de afiliados e parcerias (as grandes lojas bloqueiam robô).
- Catálogo além dos itens vigiados: descoberta de produtos por categoria, não só pela busca de cada item.
- Normalizar a comparação Pix × cartão entre lojas sem quebrar o histórico.
- WhatsApp 1:1 só com opt-in iniciado pela pessoa (ela manda a primeira mensagem; webhook do WAHA).

## 6. Diretrizes para alterar este repositório

- **SSR sem JS:** toda página pública renderiza completa no servidor; JavaScript só melhora.
- **Contratos primeiro:** mudança de payload, selo ou regra começa em `packages/shared` (zod) e ganha teste no Vitest.
- **Não quebrar a coleta em produção:** migrações só aditivas; nunca remover rate limits, horário de silêncio, conferência antes do envio ou fallbacks dos adaptadores. O histórico acumulado é o ativo principal.
- **Nunca** contornar bloqueio anti-robô, nem trocar a base do `price`.
- `docker-compose.yml` usa CRLF; `*.sh`, `Dockerfile` e `Caddyfile` precisam de LF (`.gitattributes`).
