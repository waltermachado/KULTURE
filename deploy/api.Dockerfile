# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# apps/api (kulture-core) + front buildado (apps/web/dist) servido pela própria api.
# Contexto de build = RAIZ do monorepo:  docker build -f deploy/api.Dockerfile .
# ------------------------------------------------------------------------------

# ---- base: node + openssl (Prisma precisa de libssl para escolher o engine certo)
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- deps: instala TODOS os workspaces a partir do lockfile (cache de camada por package.json)
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY services/nike-scraper/package.json services/nike-scraper/
RUN npm ci

# ---- build: front (Vite) + Prisma Client
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/api apps/api
RUN npm run build -w apps/web \
 && npx prisma generate --schema apps/api/prisma/schema.prisma

# ---- runtime
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    TRUST_PROXY=true \
    PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY deploy/api-entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh \
 && mkdir -p /app/apps/api/storage/produtos \
 && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["./entrypoint.sh"]
