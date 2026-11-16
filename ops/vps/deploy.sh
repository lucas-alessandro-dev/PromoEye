#!/usr/bin/env bash
# Envia o código deste computador para a VPS e atualiza o PromoEye.
#   bash ops/vps/deploy.sh          (Git Bash no Windows, ou Linux/macOS)
#
# Vai o que está na pasta, commitado ou não, respeitando o .gitignore:
# o .env local e o node_modules nunca sobem. O .env de produção fica só na VPS.
set -euo pipefail
VPS="${VPS:-root@187.53.119.70}"
DIR=/srv/apps/promoeye

cd "$(git rev-parse --show-toplevel)"

echo "→ enviando o código para $VPS:$DIR/src"
git ls-files -z --cached --others --exclude-standard \
  | tar --null -T - -czf - \
  | ssh "$VPS" "set -e; mkdir -p $DIR; cd $DIR; rm -rf src.new; mkdir src.new; tar -xzf - --no-same-owner -C src.new; rm -rf src; mv src.new src"

ssh "$VPS" "sh $DIR/src/ops/vps/up.sh"
