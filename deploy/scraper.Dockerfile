# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# services/nike-scraper — serviço PRIVADO (só a api fala com ele via rede interna).
# Contexto de build = RAIZ do monorepo:  docker build -f deploy/scraper.Dockerfile .
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY services/nike-scraper/package.json services/nike-scraper/
# só o workspace do scraper, sem devDependencies
RUN npm ci --omit=dev --workspace services/nike-scraper --include-workspace-root=false
COPY services/nike-scraper services/nike-scraper
RUN mkdir -p /app/services/nike-scraper/data && chown -R node:node /app
USER node
WORKDIR /app/services/nike-scraper
EXPOSE 3001
CMD ["node", "src/server.js"]
