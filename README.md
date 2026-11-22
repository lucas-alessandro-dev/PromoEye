# PromoEye

Confere de hora em hora o preço dos itens que você escolhe, em lojas confiáveis, e separa promoção de verdade do "metade do dobro" da Black Friday. Vitrine pública com link de afiliado, painel para administrar e envio automático das promoções para um grupo de WhatsApp.

- **Vitrine**: `/`, uma listagem no jeito das grandes lojas (busca, categorias, "só promoções", ordenação, um cartão por item com o menor preço). Cada cartão abre `/ofertas/<slug>`: fotos, caixa de compra, **todas as lojas pesquisadas** com a situação de cada uma (preço, esgotado, não encontrado, não respondeu, manual) e o **histórico** do menor preço em 7, 30 ou 90 dias.
- **Painel**: `/painel`, para itens, ofertas, lojas, afiliados, WhatsApp, Telegram e configurações.
- **Coletor**: roda dentro do servidor, no minuto 5 de cada hora (`COLLECT_CRON`). Na Black Friday, a cada 20 min, e o WhatsApp sem horário de silêncio na virada: [docs/deploy-vps.md](docs/deploy-vps.md#black-friday-26-a-29112026).
- **Redirecionamento**: `/ir/<id>`. Todo clique para a loja passa por aqui, que aplica o afiliado e conta o clique (sem guardar IP).

## Rodar no computador

```bash
cp .env.example .env            # e troque a senha do banco e o SESSION_SECRET
docker compose up -d db         # Postgres na porta 5433
npm install                     # os scripts de instalação aprovados estão em package.json > allowScripts
npx prisma migrate dev
npm run db:seed                 # lojas (SEED_EXAMPLES=1 também cria 3 itens de exemplo)
npm run create-admin -- voce@exemplo.com "Seu Nome"
npm run dev                     # servidor em :3000 e painel (Vite) em :5173/painel/
```

Outros comandos:

| Comando | Para quê |
|---|---|
| `npm run collect` | uma coleta pelo terminal (`-- <slug>` para um item só) |
| `npm run probe -- "air fryer"` | testa a busca em cada loja, sem gravar nada |
| `npm run check:affiliates` | confere o link de afiliado de cada loja (`-- --live` segue os redirecionamentos) |
| `npm test` | testes (filtro, pontuação, afiliado, parsers das lojas, contrato da API, filas do WhatsApp e do Telegram) |
| `npm run build` | compila shared, painel e servidor |
| `node scripts/shoot.mjs <url> <pasta> 1440x900,390x844 --tiles` | capturas da vitrine em Chrome headless |

## Como cadastrar um item

No painel, em **Itens → Novo item**:

- **Busca**: o que é digitado na busca de cada loja (`iphone 16 128gb`).
- **Termos obrigatórios**: todos precisam aparecer no título, como palavra inteira. `16` não casa com `16e`. Use `|` para alternativas: `fryer|fritadeira`. "128 GB" e "128GB" são tratados como iguais.
- **Termos excluídos**: descartam o anúncio (`pro`, `plus`, `max`). Capa, película, usado, vitrine, recondicionado e afins já são excluídos por padrão em **Configurações**.
- **Preço mínimo**: abaixo dele é acessório ou erro.
- **Preço-alvo**: abaixo dele a oferta vira promoção, mesmo sem histórico.
- **Testar busca**: roda ao vivo e mostra o que entraria e o que ficaria de fora, **com o motivo**. Use antes de salvar.

## Lojas

| Como | Lojas |
|---|---|
| Automáticas (API pública VTEX) | Americanas, Carrefour, iByte, Brastemp, Consul, Compra Certa, Electrolux, Motorola, Polishop, Mondial, Philco, Britânia, Multi, Ri Happy, C&A, Vivara |
| Automáticas (outras) | Amazon (página de busca), KaBuM! (API do próprio site) |
| Manuais | Mercado Livre, Magazine Luiza, Casas Bahia |

As manuais bloqueiam robôs: recusaram até um Chrome headless no teste de 16/11/2026. O PromoEye **não tenta contornar bloqueio**. A oferta dessas lojas entra em **Ofertas → Adicionar oferta manual**, já com o link de afiliado gerado no programa da loja.

Vendedores de marketplace só entram se estiverem na lista de **vendedores confiáveis** (Configurações). A política pode ser trocada por loja em **Lojas**.

A Amazon é lida pela página pública de busca, uma vez por hora por item. Se ela pedir captcha, a loja fica fora daquela coleta e o erro aparece no painel. A API oficial (Creators API, que substituiu a PA-API em 2026) exige conta de Associado com vendas; quando você tiver, dá para trocar o adaptador.

## Afiliados

Em ordem de prioridade:

1. **Link na oferta** (Ofertas → Link de afiliado): vence tudo. Use para programas que geram um link diferente por produto.
2. **Modelo da loja** (Lojas → Afiliado), em uma de três formas:
   - parâmetro: `tag=seutag-20` é anexado à URL (Amazon Associados; Mercado Livre com `matt_word=...&matt_tool=...`);
   - modelo de rede: `https://rede.exemplo/click?u={url_encoded}`. Os marcadores são `{url}`, `{url_encoded}` e `{id}`;
   - loja de afiliado: `https://www.magazinevoce.com.br/magazinesualoja{path}` (Influenciador Magalu). O `{path}` é o caminho e a query do produto.

   Um link inteiro sem marcador (por exemplo, só o endereço da sua loja) é recusado: aplicado, sairia quebrado.
3. Sem afiliado, o link vai direto para a página do produto.

O aviso de afiliado (CONAR) fica no rodapé da vitrine e é editável em Configurações.

## Promoção de verdade: os selos

| Selo | Quando |
|---|---|
| Desconto real | preço abaixo do **preço típico dos últimos 30 dias** (mediana ponderada pelo tempo que cada preço durou), na margem mínima do item |
| Menor preço que já vimos | o mais baixo desde que o anúncio é acompanhado (com 2+ dias de histórico) |
| Abaixo do seu preço-alvo | passou do alvo do item |
| Mais barato entre as lojas | nenhuma loja confiável tem mais barato agora |
| Preço "de" inflado | o "de" anunciado está bem acima de tudo que vimos (ou 35% acima da mediana das lojas); o "de" some da vitrine |
| Subiu antes de baixar | subiu 10%+ nas semanas anteriores e a "queda" só devolve o preço de antes; **não** conta como promoção |

Nos primeiros dias o histórico é curto (selo "Acompanhando há pouco tempo"), então quem decide são o preço-alvo e a comparação entre lojas. **Cadastre os itens o quanto antes**: cada hora a mais de histórico deixa o "desconto real" mais confiável na Black Friday (27/11/2026).

## Catálogo: o mesmo produto em todas as lojas (EAN)

O item ("Air fryer 4L") junta tudo o que casou com uma busca. O **produto** (`Product`) é UM modelo, identificado pelo código de barras (GTIN/EAN): `/produtos/<nome>-<ean>` mostra o preço desse EAN em cada loja, o histórico e o JSON-LD com o EAN.

- Nasce sozinho na coleta, quando a loja informa um EAN válido (as 16 lojas VTEX informam). Só junta por EAN com dígito verificador certo e fora dos códigos de uso interno; título parecido **nunca** junta anúncios (`packages/shared/src/gtin.ts`, `apps/server/src/collector/catalog.ts`).
- Amazon e KaBuM! não mostram o EAN na busca, e as lojas manuais não têm busca: ligue a oferta ao EAN em **Ofertas › Mais › Ligar ao EAN**, ou preencha o EAN na oferta manual.
- No painel, **Catálogo** lista os produtos e quantos já estão em 2 lojas ou mais.
- Limitação conhecida: o anúncio VTEX guarda o EAN do SKU mais barato. Se a voltagem mais barata mudar (110 V ↔ 220 V), o anúncio muda de produto.

## Pix e cartão

O preço principal de cada oferta (`price`) é a base do histórico e das comparações, e **não mudou**. O Pix fica num campo à parte (`pixPrice`):

- **VTEX**: lido da regra que a loja publica ("Desconto PGTO Pix - 5%"). Só vale a regra de desconto percentual para Pix em 1x, sem outra condição (cupom, grupo de cliente). Se o `spotPrice` já tiver desconto, não descontamos de novo.
- **KaBuM!**: o preço principal já é o do Pix (`price_with_discount`), e o cartão vai em `cardPrice`.
- A vitrine mostra "R$ X no Pix" e "R$ Y no cartão".

Por que o Pix não virou o preço principal: o histórico foi gravado sem o desconto do Pix. Trocar a base faria os anúncios "caírem 5%" de uma coleta para outra, e o grupo receberia promoções falsas.

## Alertas por e-mail ("me avise quando baixar")

Formulário na página do item e do produto, sem JavaScript. A pessoa deixa o e-mail, um preço-alvo opcional e marca o consentimento.

- **Opt-in duplo**: nada é enviado antes de confirmar pelo link do e-mail. Confirmar e cancelar são botões (POST), porque antivírus de e-mail abrem links sozinhos.
- Avisa quando o menor preço passa do alvo ou, sem alvo, quando vira promoção de verdade (`isDeal`). No máximo um e-mail a cada 12 h por alerta, e de novo só se cair mais 2%.
- **LGPD**: grava o texto exato do consentimento e a data. Cada e-mail traz o link de cancelar e o cabeçalho `List-Unsubscribe` (cancela em um clique no Gmail). No painel, **Alertas** apaga um registro de vez e exporta os ativos em CSV.
- A resposta do formulário é sempre a mesma, exista ou não um alerta: ele não serve para descobrir quem está inscrito. Também tem limite por IP e um campo escondido contra robôs.
- **Para ligar**: `SMTP_URL` e `SMTP_FROM` no `.env` (Brevo, Amazon SES, Resend…, com SPF/DKIM do domínio no provedor). Sem eles o formulário não aparece. Também dá para desligar em Configurações.
- **WhatsApp individual ficou de fora de propósito**: mandar mensagem 1:1 do número do grupo para quem digitou um telefone é o caminho mais curto para o bloqueio. Quem prefere WhatsApp é mandado para o grupo.

## WhatsApp

Quando um item ganha uma promoção nova, mais barata que a última avisada, o PromoEye monta a mensagem. Cada item tem no máximo uma mensagem esperando: a nova (mais barata) substitui a anterior, para a mesma promoção não chegar em cinco cores. O convite do grupo (Configurações) vira um botão na vitrine.

**Envio automático** (Painel → WhatsApp): o PromoEye manda sozinho para o grupo, com a foto do produto e o texto na legenda, pelo [WAHA](https://waha.devlike.pro). O WAHA é gratuito e open source desde a versão 2026.6 e roda como mais um container na VPS (motor GOWS, sem navegador). Conecte o número com o QR code ou com código de pareamento, escolha o grupo na lista e ligue "Enviar sozinho".

- A fila (`OutboundMessage`, status `QUEUED`) manda uma por vez, com pelo menos 1 min de intervalo, até um limite por hora (padrão 10). No horário de silêncio (padrão 22h–8h) nada sai.
- Antes de cada envio ele confere se a mensagem ainda é verdade. Se o preço subiu, se esgotou, se o anúncio sumiu ou se já existe uma mais nova do mesmo item, a mensagem é descartada com o motivo.
- Sem resposta do WAHA, tenta de novo até 3 vezes. Se o pedido esgotar o tempo, não reenvia: a mensagem pode ter saído e repetir no grupo é pior.
- Com o WhatsApp desconectado, o Painel avisa e a fila espera até 12 h.
- Sem o envio automático, as mensagens ficam como rascunho para copiar e colar, abrir no WhatsApp ou mandar com "Enviar agora".

Por que o WAHA: a API oficial da Meta (Cloud API) cobra por mensagem e não serve para grupo comum de promoções. Z-API é paga. O Evolution API também é grátis, mas pede Postgres e Redis próprios. Todos os não oficiais usam um número comum de WhatsApp, que pode ser bloqueado se mandar demais. Por isso o limite por hora, o intervalo e a recomendação de usar um chip só para o grupo.

No computador: `docker compose up -d waha`, depois `WAHA_URL=http://localhost:3100` e uma `WAHA_API_KEY` no `.env` (modelo em `.env.example`).

## Telegram

As mesmas promoções vão para um grupo ou canal do Telegram, postadas por um bot pela [Bot API](https://core.telegram.org/bots/api) oficial: gratuita e sem o risco de bloqueio de um número comum.

1. No Telegram, fale com o **@BotFather**, mande `/newbot` e guarde o token.
2. Ponha `TELEGRAM_BOT_TOKEN=<token>` no `.env` (na VPS, o de `ops/vps`) e suba de novo.
3. Adicione o bot ao grupo. Num canal, ele precisa ser administrador com permissão de publicar.
4. Em Painel → Telegram, clique em **Procurar grupos** (ou digite o id `-100…` ou o `@` de um canal público), salve e ligue "Enviar sozinho".
5. Para o convite aparecer na vitrine, cole o link (`https://t.me/seucanal` ou `https://t.me/+…`) em Configurações → Telegram. Ele entra na faixa da loja, ao lado do WhatsApp, no rodapé, nas perguntas e no formulário de alerta. O botão da barra continua sendo o do WhatsApp; o Telegram só ocupa a barra quando não há convite do WhatsApp.

- Cada canal tem a sua mensagem, com o link `?c=tg` (o clique conta como `telegram`), e a sua regra: só avisa quando ficou mais barato que o último aviso **daquele canal**, e no máximo uma mensagem esperando por item.
- A fila do Telegram é separada da do WhatsApp, com as mesmas regras: uma por vez, pelo menos 1 min de intervalo, teto por hora (padrão 10, até 60), horário de silêncio e a mesma conferência de preço, estoque e mensagem mais nova antes de enviar. O WhatsApp desconectado não segura o Telegram, e vice-versa.
- O texto fica guardado no formato do WhatsApp (`*negrito*`, `~riscado~`) e vira HTML na hora de enviar, com `< > &` escapados.
- Bot removido do grupo, sem permissão ou token recusado: a mensagem espera na fila (até 12 h) e o Painel avisa. Limite do Telegram (429): espera o tempo que ele pede. Grupo que vira supergrupo troca de id: o PromoEye guarda o novo sozinho.
- O token vai na URL das chamadas ao Telegram, então nenhum erro mostra a URL e qualquer texto devolvido tem o token trocado por `<token>`.

## Produção

Roda na VPS da Hostinger, que hospeda outros projetos também, atrás de um Caddy compartilhado que cuida do HTTPS. Para atualizar, no Git Bash:

```bash
bash ops/vps/deploy.sh
```

Na subida, o `ops/entrypoint.sh` aplica as migrações e o seed das lojas. Para trocar de domínio sem quebrar os links já enviados, ponha o endereço antigo em `PUBLIC_URL_ALIASES` no `.env` da VPS: o `up.sh` gera um redirecionamento 301 com o caminho. Organização no servidor, primeira instalação, domínio, backups e comandos: [docs/deploy-vps.md](docs/deploy-vps.md).

Para testar a imagem de produção no seu computador: `docker compose --profile prod up -d --build` (app em `127.0.0.1:${APP_PORT}`).

## Design

- **Tokens**: [awesome-design-skills](https://github.com/bergside/awesome-design-skills), estilo **stitch** (petróleo #072C2C, laranja #FF5F03, superfície #EDEADE). Usados como estão no painel. Na vitrine o laranja foi escurecido para **#E95603**, para passar 3:1 nos dois fundos.
- **Loja e página do item** (desde 16/11/2026): o herói e a "janela do app" da home deram lugar a uma listagem em grade, e a página do item virou página de produto. Peças em `apps/server/src/views/partials/_macros.njk`, estilos em `apps/server/public/site/site.css`, cursor do gráfico e galeria em `apps/server/public/site/shop.js` (melhoria progressiva: tudo funciona sem JavaScript). O "preço típico" só aparece com 1 dia de acompanhamento.
- **Vitrine**: [taste-skill](https://github.com/Leonxlnx/taste-skill) 2.5. Kit em `apps/server/public/assets` (MIT, sem edição). Sorteio: herói `collage`, nav-centre, close-word, footer-dark, faixa de superfície, botões arrow, marca dots, fundo sky, seções steps + tabs-tour, momento `marquee-row`, fonte Mona Sans. O registro completo está no topo de `apps/server/src/views/layout.njk`.
- Os scripts da taste-skill (dealer, `consistency.mjs`, `check.mjs`, `gate.mjs`) **não foram executados** nesta sessão. Os sorteios foram refeitos com as mesmas regras e a verificação foi feita com capturas próprias (`scripts/shoot.mjs`): em 1440×900 e 768×1024 cada seção ocupa exatamente 1 ou 2 telas. Para rodar o portão oficial, clone a skill e rode `node <skill>/scripts/gate.mjs http://localhost:3000/`.

## Estrutura

```
apps/server     Fastify: vitrine (Nunjucks), API do painel, /ir, coletor e agendador
  src/collector   adaptadores das lojas, filtro (matcher), pontuação (scoring), coleta (run)
  src/collector/catalog.ts  liga os anúncios ao produto do mesmo EAN
  src/services/whatsapp  cliente do WAHA e fila de envio automático
  src/services/telegram  cliente da Bot API do Telegram e fila própria
  src/services/alerts    alertas por e-mail: inscrição, regras, envio, links assinados
  src/lib/jsonld.ts      dados estruturados (Product, AggregateOffer, BreadcrumbList)
apps/admin      painel React (Vite), servido em /painel
packages/shared contrato da API (zod), selos, formatação, catálogo de lojas, mensagem do WhatsApp
prisma          schema e migrações
docs/api-admin.md  rotas do painel
```
