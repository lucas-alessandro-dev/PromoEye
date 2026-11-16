#!/bin/sh
# Ordem de subida: migrações → lojas (seed idempotente) → servidor.
# O seed só atualiza nome/domínio/adaptador das lojas; o que foi configurado
# pelo painel (ligada, afiliado, política de vendedor) não é tocado.
set -e
npx prisma migrate deploy
npx tsx prisma/seed.ts
cd apps/server
exec node dist/index.js
