#!/bin/sh
set -e
# Postgres do Railway não tem pooler separado: se DIRECT_URL não vier, usa DATABASE_URL.
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
# Aplica migrações pendentes e sobe a api.
echo "[entrypoint] prisma migrate deploy…"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
echo "[entrypoint] iniciando kulture-api"
exec node apps/api/src/server.js
