#!/bin/sh
# Cria o .env de produção com segredos aleatórios. Uma vez só: não sobrescreve.
#   sh /srv/apps/promoeye/src/ops/vps/new-env.sh https://promoeye.seudominio.com.br
#
# Atenção: o POSTGRES_PASSWORD vale só na criação do banco. Trocá-lo depois no
# .env não muda a senha que o Postgres já guardou no volume.
set -eu
cd "$(dirname "$0")/../../.."   # /srv/apps/promoeye
url="${1:?uso: new-env.sh https://dominio}"
if [ -e .env ]; then
  echo "$(pwd)/.env já existe; edite à mão." >&2
  exit 1
fi
umask 077
cat > .env <<EOF
# PromoEye — produção nesta VPS. Gerado em $(date +%F). Não versionar.
PUBLIC_URL=$url
POSTGRES_USER=promoeye
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=promoeye
SESSION_SECRET=$(openssl rand -hex 48)
SESSION_TTL_HOURS=24
COLLECT_CRON="5 * * * *"
COLLECT_ENABLED=true
COLLECT_STORE_DELAY_MS=1500
COLLECT_TIMEOUT_MS=15000
EOF
echo "Criado $(pwd)/.env"
