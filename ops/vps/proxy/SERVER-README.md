# VPS: como os projetos estão organizados

Cada projeto roda isolado em Docker: containers, banco, rede interna e segredos próprios.
Só o Caddy (proxy) abre portas para a internet (80 e 443) e cuida do HTTPS de todos os sites.

```
/srv
├── README.md              este arquivo
├── proxy/                 Caddy compartilhado
│   ├── compose.yml
│   └── caddy/
│       ├── Caddyfile      importa sites/*.caddy
│       └── sites/
│           └── <projeto>.caddy
└── apps/
    └── <projeto>/
        ├── compose.yml    o stack do projeto
        ├── .env           segredos (chmod 600, nunca no git)
        ├── src/           código (substituído a cada deploy)
        └── backups/
```

## Regras

- **Nenhum projeto publica porta** (`ports:`). O Docker ignora o firewall (ufw) nas portas publicadas, então uma porta publicada fica aberta para a internet.
- O serviço web de cada projeto entra na rede externa `proxy` com um **apelido único** (`<projeto>-app`). Todo projeto terá um serviço chamado `app`, e esse nome sozinho daria conflito na rede compartilhada.
- Banco e serviços internos ficam **só** na rede interna do projeto, nunca na `proxy`.
- Cada projeto tem `name: <projeto>` no compose. Containers, volumes e redes ficam com esse prefixo.

## Adicionar um projeto novo

1. Criar `/srv/apps/<projeto>/` com `compose.yml` e `.env`. Use `/srv/apps/promoeye/compose.yml` como modelo.
2. No compose, colocar o serviço web na rede `proxy`:
   ```yaml
   services:
     app:
       networks:
         default: {}
         proxy:
           aliases: [<projeto>-app]
   networks:
     proxy:
       external: true
   ```
3. Criar `/srv/proxy/caddy/sites/<projeto>.caddy`:
   ```
   meusite.com.br {
   	encode zstd gzip
   	reverse_proxy <projeto>-app:<porta interna>
   }
   ```
4. Apontar o DNS (registro A) do domínio para o IP da VPS.
5. `cd /srv/apps/<projeto> && docker compose up -d --build`
6. `docker compose -f /srv/proxy/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`

## Comandos úteis

| Para quê | Comando |
|---|---|
| Ver tudo que está rodando | `docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'` |
| Uso de CPU e memória por container | `docker stats --no-stream` |
| Logs de um projeto | `cd /srv/apps/<projeto> && docker compose logs -f --tail 100` |
| Logs do proxy (certificados, erros 502) | `docker compose -f /srv/proxy/compose.yml logs -f --tail 100` |
| Espaço em disco do Docker | `docker system df` |
| Limpar imagens velhas | `docker image prune -f` |

## O que já está configurado no servidor

- Docker com rotação de logs (`/etc/docker/daemon.json`), para os logs não encherem o disco.
- Firewall ufw: só 22 (SSH), 80 e 443.
- Swap de 2 GB, fuso America/Sao_Paulo, atualizações de segurança automáticas.
