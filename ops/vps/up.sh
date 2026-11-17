#!/bin/sh
# Sobe ou atualiza o PromoEye nesta VPS. Roda NA VPS:
#   sh /srv/apps/promoeye/src/ops/vps/up.sh
# O deploy.sh (no seu computador) envia o código e chama este script.
set -eu
cd "$(dirname "$0")/../../.."   # /srv/apps/promoeye
PROJECT_DIR=$(pwd)

if [ ! -f .env ]; then
  echo "Falta $PROJECT_DIR/.env. Crie com: sh src/ops/vps/new-env.sh https://seu.dominio" >&2
  exit 1
fi

# Arquivos vindos do Windows podem chegar com CRLF, que quebra o sh.
find src -name '*.sh' -exec sed -i 's/\r$//' {} +

# Chave do WAHA (envio pelo WhatsApp). Instalações anteriores não têm: cria uma vez.
if ! grep -q '^WAHA_API_KEY=' .env; then
  printf '\n# WAHA (WhatsApp). Mesma chave no app e no container do WAHA.\nWAHA_API_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
  echo "→ WAHA_API_KEY criada em $PROJECT_DIR/.env"
fi

cp src/ops/vps/compose.yml compose.yml
mkdir -p backups

echo "→ construindo a imagem e subindo os containers"
docker compose up -d --build --remove-orphans

# O endereço do site vem do PUBLIC_URL: trocar o domínio é mudar só o .env.
host=$(sed -n 's/^PUBLIC_URL=//p' .env | tr -d "\"' " | sed -E 's#^[a-z]+://##; s#[/:].*$##')
if [ -z "$host" ]; then
  echo "PUBLIC_URL vazio no .env" >&2
  exit 1
fi
cat > /srv/proxy/caddy/sites/promoeye.caddy <<EOF
# Gerado por $PROJECT_DIR/src/ops/vps/up.sh a partir do PUBLIC_URL. Não edite aqui.
$host {
	encode zstd gzip
	reverse_proxy promoeye-app:3000
}
EOF
docker compose -f /srv/proxy/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile

# Backup diário do banco às 03:30 (horário de Brasília).
cat > /etc/cron.d/promoeye <<EOF
30 3 * * * root sh $PROJECT_DIR/src/ops/vps/backup.sh >> $PROJECT_DIR/backups/backup.log 2>&1
EOF

docker image prune -f >/dev/null

echo "→ aguardando o app ficar saudável"
cid=$(docker compose ps -q app)
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" = healthy ]; do
  i=$((i + 1))
  if [ "$i" -gt 36 ]; then
    echo "O app não ficou saudável em 3 minutos. Últimas linhas do log:" >&2
    docker compose logs --tail 80 app >&2
    exit 1
  fi
  sleep 5
done
echo "PromoEye no ar: https://$host"
