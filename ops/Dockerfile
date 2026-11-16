# PromoEye — imagem de produção (servidor + painel compilado + coletor agendado).
FROM node:22-bookworm-slim AS build
WORKDIR /app
# openssl: o motor do Prisma precisa dele.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=America/Sao_Paulo
# Repositório inteiro: o servidor lê os templates em apps/server/src/views e o
# entrypoint usa o Prisma CLI (devDependency) para aplicar as migrações.
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["sh", "ops/entrypoint.sh"]
