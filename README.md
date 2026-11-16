# PromoEye

Confere de hora em hora o preço dos itens que você escolhe, em lojas confiáveis, e separa promoção de verdade do "metade do dobro" da Black Friday. Vitrine pública com link de afiliado, painel para administrar e fila de mensagens para um grupo de WhatsApp.

- **Vitrine**: `/`, uma listagem no jeito das grandes lojas (busca, categorias, "só promoções", ordenação, um cartão por item com o menor preço). Cada cartão abre `/ofertas/<slug>`: fotos, caixa de compra, **todas as lojas pesquisadas** com a situação de cada uma (preço, esgotado, não encontrado, não respondeu, manual) e o **histórico** do menor preço em 7, 30 ou 90 dias.
- **Painel**: `/painel`, para itens, ofertas, lojas, afiliados, WhatsApp e configurações.
- **Coletor**: roda dentro do servidor, no minuto 5 de cada hora (`COLLECT_CRON`).
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
| `npm test` | testes (filtro, pontuação, afiliado, parsers das lojas, contrato da API) |
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

1. **Link na oferta** (Ofertas → Link de afiliado): vence tudo. Use para Mercado Livre, Magalu e qualquer programa que gere um link por produto.
2. **Modelo da loja** (Lojas → Afiliado), em uma de duas formas:
   - parâmetro: `tag=seutag-20` é anexado à URL (Amazon Associados);
   - modelo de rede: `https://rede.exemplo/click?u={url_encoded}`. Os marcadores são `{url}`, `{url_encoded}` e `{id}`.
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

## WhatsApp

Hoje: quando um item ganha uma promoção nova, mais barata que a última avisada, o PromoEye deixa uma mensagem pronta em **Painel → WhatsApp**. Cada item gera no máximo uma mensagem, para a mesma promoção não chegar em cinco cores. Dali você copia e cola no grupo, ou abre direto no WhatsApp, e depois marca como enviada. O convite do grupo (Configurações) vira um botão na vitrine.

Próxima etapa: um provedor consome a mesma fila (`OutboundMessage`, status `DRAFT`). A API oficial da Meta (Cloud API) não envia para grupos comuns. Evolution API e Z-API enviam, mas usam um número comum de WhatsApp, que pode ser bloqueado se mandar demais. Os campos do provedor já existem em Configurações.

## Produção

Roda na VPS da Hostinger, que hospeda outros projetos também, atrás de um Caddy compartilhado que cuida do HTTPS. Para atualizar, no Git Bash:

```bash
bash ops/vps/deploy.sh
```

Na subida, o `ops/entrypoint.sh` aplica as migrações e o seed das lojas. Organização no servidor, primeira instalação, domínio, backups e comandos: [docs/deploy-vps.md](docs/deploy-vps.md).

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
apps/admin      painel React (Vite), servido em /painel
packages/shared contrato da API (zod), selos, formatação, catálogo de lojas, mensagem do WhatsApp
prisma          schema e migrações
docs/api-admin.md  rotas do painel
```
