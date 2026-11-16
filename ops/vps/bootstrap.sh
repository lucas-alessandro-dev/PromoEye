#!/bin/sh
# Prepara a VPS para hospedar vários projetos em Docker. Roda uma vez, como root,
# NA VPS. Pode rodar de novo sem estragar nada: cada passo confere antes de agir.
#   sh /srv/apps/promoeye/src/ops/vps/bootstrap.sh
#
# Instala: Docker, firewall (22/80/443), swap, fuso horário, e o proxy Caddy
# compartilhado em /srv/proxy. Não toca em nenhum projeto.
set -eu
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
here=$(cd "$(dirname "$0")" && pwd)

echo "== pacotes básicos"
apt-get update -q
apt-get install -y -q ca-certificates curl openssl ufw cron unattended-upgrades

echo "== Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
if [ ! -f /etc/docker/daemon.json ]; then
  # Sem rotação, o log de um container falante enche o disco de todo mundo.
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null
docker compose version

echo "== fuso horário"
timedatectl set-timezone America/Sao_Paulo
systemctl restart cron

echo "== swap"
if [ -z "$(swapon --show)" ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show

echo "== firewall"
ssh_port=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')
ufw allow "${ssh_port:-22}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status

echo "== proxy compartilhado (/srv/proxy)"
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
mkdir -p /srv/apps /srv/proxy/caddy/sites
[ -f /srv/proxy/compose.yml ] || cp "$here/proxy/compose.yml" /srv/proxy/compose.yml
[ -f /srv/proxy/caddy/Caddyfile ] || cp "$here/proxy/Caddyfile" /srv/proxy/caddy/Caddyfile
cp "$here/proxy/SERVER-README.md" /srv/README.md
docker compose -f /srv/proxy/compose.yml up -d

echo "Pronto. Organização da VPS: /srv/README.md"
