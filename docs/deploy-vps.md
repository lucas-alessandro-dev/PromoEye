# Deploy na VPS

A VPS (Hostinger, `187.53.119.70`, atalho `ssh vps`) hospeda vários projetos. A organização geral dela está em `/srv/README.md`, no próprio servidor. Este arquivo trata só do PromoEye.

## Como fica no servidor

```
/srv/proxy/                          Caddy compartilhado (80/443, HTTPS automático)
/srv/proxy/caddy/sites/promoeye.caddy   gerado a partir do PUBLIC_URL
/srv/apps/promoeye/
├── compose.yml   cópia de ops/vps/compose.yml
├── .env          segredos de produção (só existe aqui)
├── src/          o código, substituído a cada deploy
└── backups/      pg_dump diário às 03:30, guarda 14 dias
```

Containers: `promoeye-app-1`, `promoeye-db-1` e `promoeye-waha-1`. O Postgres fica numa rede interna, sem porta publicada e sem saída para a internet. O app não publica porta: o Caddy chega nele pela rede `proxy`, com o apelido `promoeye-app`.

O WAHA (WhatsApp, imagem `devlikeapro/waha:gows-…`) também não publica porta nem liga painel ou Swagger. Só o app fala com ele, pela rede interna `whatsapp`. Ele sai para a internet pela rede `whatsapp-out` e não enxerga o Postgres. O login do número fica no volume `promoeye_waha-sessions`: reiniciar ou atualizar não pede QR code de novo. A chave `WAHA_API_KEY` está no `.env`. O `up.sh` cria a chave na primeira vez, se faltar.

### Conectar o número do WhatsApp

Depois do deploy, em **Painel › WhatsApp › Conectar WhatsApp**, leia o QR code com o celular do número que vai postar (WhatsApp › Aparelhos conectados › Conectar um aparelho). Pelo celular, use "Conectar com o número de telefone". Escolha o grupo, ligue "Enviar sozinho" e salve.

- Use um número que já está no grupo. Se só admins podem mandar mensagem, ele precisa ser admin. O ideal é um chip só para isso: número comum que manda demais pode ser bloqueado pelo WhatsApp.
- A fila manda uma mensagem por vez, com pelo menos 1 minuto entre elas e até o limite por hora (padrão 10). Das 22h às 8h fica em silêncio (dá para mudar ou desligar).
- Se o WhatsApp cair, o Painel avisa e as mensagens esperam na fila. Depois de 12 h elas são descartadas, porque o preço já pode ter mudado.

## Atualizar (o dia a dia)

No seu computador, no Git Bash, a partir da pasta do projeto:

```bash
bash ops/vps/deploy.sh
```

Ele envia o código da pasta, commitado ou não, respeitando o `.gitignore`, então o `.env` local não sobe. Depois reconstrói a imagem, sobe o container, aplica as migrações (`ops/entrypoint.sh`) e espera o `/healthz` responder.

## Primeira instalação (já feita)

```bash
bash ops/vps/deploy.sh                                   # envia o código (vai falhar no fim: ainda não há Docker nem .env)
ssh vps sh /srv/apps/promoeye/src/ops/vps/bootstrap.sh   # prepara a VPS: Docker, firewall, swap, proxy
ssh vps sh /srv/apps/promoeye/src/ops/vps/new-env.sh https://promoeye.187-53-119-70.sslip.io
ssh vps sh /srv/apps/promoeye/src/ops/vps/up.sh
```

Criar o usuário do painel (a senha é pedida no terminal, sem eco):

```bash
ssh -t vps 'cd /srv/apps/promoeye && docker compose exec app npm run create-admin -- voce@exemplo.com "Seu Nome"'
```

## Trocar para um domínio de verdade

Hoje o endereço é provisório: `promoeye.187-53-119-70.sslip.io`. O sslip.io devolve o IP que está no próprio nome, então funciona sem configurar DNS.

1. No registro do domínio, crie um registro **A** apontando para `187.53.119.70`.
2. `ssh vps nano /srv/apps/promoeye/.env` e troque o `PUBLIC_URL`.
3. `ssh vps sh /srv/apps/promoeye/src/ops/vps/up.sh`. O Caddy é reconfigurado e emite o certificado sozinho.

## Comandos úteis

Todos rodam dentro de `/srv/apps/promoeye` (`ssh vps`, depois `cd /srv/apps/promoeye`):

| Para quê | Comando |
|---|---|
| Estado | `docker compose ps` |
| Logs do app | `docker compose logs -f --tail 100 app` |
| Logs do WhatsApp | `docker compose logs -f --tail 100 waha` (e `… app \| grep whatsapp` para a fila) |
| Coleta manual | `docker compose exec app npm run collect` |
| Abrir o banco | `docker compose exec db psql -U promoeye promoeye` |
| Backup agora | `sh src/ops/vps/backup.sh` |
| Restaurar backup | `docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/ARQUIVO.dump` |
| Reiniciar | `docker compose restart app` |

Os backups ficam no mesmo disco da VPS. Para sobreviver a uma perda da VPS, ative os backups/snapshots da Hostinger ou copie `backups/` para fora de vez em quando: `scp vps:/srv/apps/promoeye/backups/*.dump .`
