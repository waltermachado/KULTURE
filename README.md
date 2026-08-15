# Kulture BR — monorepo

Tênis importados originais. Backend com **Postgres no Supabase** (Prisma ORM).
Plano completo em [`docs/PLANO.md`](docs/PLANO.md).

```
apps/web               React + Vite + Tailwind           http://localhost:5173  (proxy /api,/media → :3000)
apps/api               kulture-core: Fastify + Prisma    http://localhost:3000  (docs em /docs)
services/nike-scraper  busca Nike US + câmbio (isolado)  http://localhost:3001
packages/shared        motor de precificação, contratos
docs/                  plano + referências (site vanilla antigo, esboço, BFF antigo)
```

## Rodar

```bash
npm install                                    # instala todos os workspaces
cp services/nike-scraper/.env.example services/nike-scraper/.env
cp apps/api/.env.example apps/api/.env         # preencha DATABASE_URL e DIRECT_URL (Supabase)
npm run db:migrate                             # aplica migrações no Postgres (Supabase)
npm run dev                                    # sobe web + api + scraper juntos
```

Rotas úteis: `GET :3000/health` · `GET :3000/health/deps` · `GET :3000/api/search?q=kobe 6` · `GET :3000/api/products/top8` · `GET :3000/docs`

## Testes

```bash
npm test
```

## Onde mexer

| Quero… | Onde |
|---|---|
| mudar regra de preço (comissão por faixa, frete, imposto) | `packages/shared/src/pricing/default-rules.js` (Fase 1: tabela `PricingRule` + admin) |
| ajustar endpoint/headers da Nike | `services/nike-scraper/.env` + `src/services/nike.js` |
| tempo de cache, top8, porta | `apps/api/.env` |
| imagens espelhadas | `apps/api/storage/produtos/<styleColor>/` (fora do git) |
