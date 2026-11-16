#!/bin/sh
# Backup do banco do PromoEye. O cron (/etc/cron.d/promoeye) roda todo dia às 03:30.
# Guarda 14 dias em /srv/apps/promoeye/backups.
#
# Restaurar um backup:
#   cd /srv/apps/promoeye
#   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/ARQUIVO.dump
set -eu
# O dump tem os hashes de senha do painel: só o root lê.
umask 077
cd "$(dirname "$0")/../../.."   # /srv/apps/promoeye
mkdir -p backups
chmod 700 backups
f="backups/promoeye-$(date +%Y-%m-%d_%H%M).dump"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$f.tmp"
mv "$f.tmp" "$f"
find backups -name 'promoeye-*.dump' -mtime +14 -delete
echo "$(date '+%F %T') backup ok: $f ($(du -h "$f" | cut -f1))"
