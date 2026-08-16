# Kulture BR — Contexto completo do projeto (sessão de 15/08/2026)

> Documento de handoff: tudo o que foi decidido, construído, testado e o que falta. Serve para retomar o trabalho
> em qualquer ferramenta (Claude Code, Antigravity, TRAE) sem depender do histórico da conversa.
> **Não contém segredos.** Tokens/senhas ficam só nos `.env` (fora do git) e no painel do Railway.

---

## 1. O que é o produto

**Kulture BR** — loja de tênis importados originais (Nike US), foco em basquete/casual/corrida.
Cliente busca o modelo, escolhe o **tamanho em numeração brasileira**, coloca na sacola, paga via **InfinitePay
(CloudWalk)** por link de pagamento e recebe confirmação. O preço em BRL já embute frete internacional e comissão —
o cliente **nunca vê frete como custo** (checkout mostra "Frete: Grátis").

Regras de negócio fixadas pelo dono (não voltar a perguntar):
- **Preço** = (USD do produto + US$65 de frete por par) × câmbio × (1 + 30% comissão) [+ imposto/taxa parametrizáveis, hoje 0].
  Regras são modulares por escopo (global/brand/category/model/sku) e comissão pode ser por faixa de preço.
- **Frete é valor embutido**, por par. Nunca aparece como linha de custo; se aparecer, "Grátis". Assunto encerrado.
- **Checkout como convidado** liberado; se logado, pedido fica vinculado ao usuário e o perfil é atualizado.
- **Breakdown interno** (frete/comissão/câmbio/regras) **nunca sai na API pública** — só `price.brl`, `price.fullBrl`, `price.exchange.usdToBrl`.
- **Bling (NF-e) e WhatsApp: adiados** (após o painel Admin). WhatsApp fica em `WHATSAPP_PROVIDER=log`.
- E-mail transacional: **MailerSend via API HTTP** (não SMTP).
- Gateway: **InfinitePay** (não "Cloudwalk" no env — o valor aceito é `infinitepay`).

---

## 2. Onde está o código

- **Repo:** `~/Desktop/KULTURE` → GitHub `waltermachado/KULTURE`, branch `main`.
- Landing antiga (clara, Tailwind) em `~/Desktop/Projetos Trae/BuscadorTenis` é **só origem histórica** — não editar.
- Monorepo npm workspaces:

```
apps/web               React 19 + Vite (SEM Tailwind; CSS próprio em src/styles/kulture.css)     dev :5173/5174
apps/api               "kulture-core": Fastify 5 + Prisma 6 / Postgres                          :3000 (serve o front em prod)
services/nike-scraper  Express — único que fala com a Nike US (endpoints não-oficiais)          :3001 (privado)
packages/shared        motor de preço (pricing/) + conversão de tamanhos US→BR (sizes/)
deploy/                Dockerfiles (api, scraper), entrypoint, railway.*.json
docs/                  PLANO.md (fases), DEPLOY.md (Railway), CONTEXTO.md (este), reference/ (site vanilla antigo, esboço)
```

Ferramentas: o dono usa **Antigravity** para commit/push (e às vezes implementar fases por prompt); Claude Code
implementa/audita e **não commita** (regra do dono). Antigravity commita como `waltermachado@users.noreply.github.com`.

---

## 3. Arquitetura (produção)

```
Internet ──► kulture-api (Railway, público)  ── serve apps/web/dist + /api + /media  (mesma origem, sem CORS)
                 │ rede privada IPv6
                 ├► kulture-scraper (Railway, sem domínio)  ── Nike US product_wall + threads/v3
                 └► Postgres (plugin Railway)               ── DATABASE_URL (Supabase foi abandonado)
```

- Front servido pela api via `apps/api/src/plugins/serve-web.js` (SPA fallback; `/assets` cache 1 ano; `index.html` no-cache).
- `deploy/api-entrypoint.sh`: `prisma migrate deploy` (usa `DIRECT_URL` ou cai em `DATABASE_URL`) → `node apps/api/src/server.js`.
- `TRUST_PROXY=true` no Dockerfile (rate limit por IP real atrás do proxy).
- Cloudflare: **só DNS + proxy** na frente do Railway quando houver domínio (`www.lojakulture.com.br` → CNAME). **Não** hospedar o front no Cloudflare/Pages/Workers nem a api no Supabase Edge (quebra mesma origem/cookies; api precisa de Node com fs, argon2, processo vivo).

---

## 4. Fluxos implementados

### Catálogo
- `GET /api/search?q=` · `GET /api/products/top8` · `GET /api/product/:styleColor` (com `sizes[]`) · `GET /api/rate` · `/media/produtos/*` (imagens espelhadas em `apps/api/storage/produtos/<styleColor>/`, fora do git; volume no Railway).
- Scraper: `GET /search?q=&count=` (Nike só aceita `count` 24|50|100 — normalizado), `GET /product/:styleColor` (threads/v3 com `filter=channelId(...)`; disponibilidade em **`availableGtins`** por `gtin`; SKU ausente = indisponível), `GET /rate` (AwesomeAPI). Preserva `productType` (FOOTWEAR/APPAREL) — base do filtro só-tênis (ainda não aplicado).
- Cache SWR (fresco 60 min, stale 24 h, single-flight) persistido na tabela `cache_entries`; tamanhos com TTL curto `SIZES_CACHE_MIN=10`.
- Conversão US→BR por **lookup** (`packages/shared/src/sizes/`), tabelas oficiais Nike Brasil (masc/fem/infantil) + tabela "aproximados" com flag `approximate` (US 13.5+, alguns infantis). Escala pelo prefixo de `localizedSize` ("M "/"W ").
- Top8: `TOP8_TERMS` (Nike US usa numerais romanos: Kobe IX, LeBron XXIII); `findOne` pontua por tokens e dedupe por styleColor.

### Auth (própria, não Supabase Auth)
- `POST /api/auth/register|login|refresh|logout`, `GET /api/auth/me`. argon2, JWT 15 min (`sub` = id), refresh em cookie httpOnly `kulture_refresh` (path `/api/auth`) com **rotação** e detecção de reuso por `family`; refresh gravado como sha256. Rate limit 10/min em login/register. E-mail normalizado (trim+lower).
- `User` tem `phone` e `address` (JSON); cadastro envia telefone/endereço; checkout pré-preenche do perfil e **atualiza o perfil** ao finalizar.

### Sacola / Checkout / Pedido
- Carrinho local (`localStorage kulture:cart:v2`), chave `styleColor|nikeSize`, item guarda `sizeInfo` (BR/US/approximate).
- `POST /api/checkout` (Idempotency-Key obrigatório; reprecifica no servidor; convidado ou logado via Bearer) → cria `Order(pending_payment)` + itens + evento → gateway cria link → responde `{orderNumber, checkoutUrl, totalBrl, shipping:"free"}`.
- Gateway `PAYMENT_PROVIDER=mock|infinitepay`. Mock redireciona para página local `/mock/infinitepay/:number` (Aprovar Pix/Cartão/Voltar). Real: `POST https://api.checkout.infinitepay.io/links` (handle `kulture-br`, price em centavos, customer+address, redirect_url `/pedido/confirmacao?order=`, webhook_url só se `PUBLIC_API_URL` não for localhost); confirmação por `POST .../payment_check`.
- `/pedido/confirmacao` lê `transaction_nsu/slug/capture_method/receipt_url` da URL, chama `POST /api/orders/:number/confirm` (payment_check) e faz polling de `GET /api/orders/:number`. Webhook `POST /api/webhooks/infinitepay` idempotente.
- Job de checkout abandonado (`ABANDON_AFTER_MIN`) e notificações (`notifications` table; provider `log`).
- E-mail de "pedido pago" ao cliente via MailerSend (`MAIL_PROVIDER=mailersend`, `MAIL_FROM` precisa de domínio verificado; falha nunca derruba o fluxo).

### Front (tema atual = Claude Design do cliente, arquivo `~/Downloads/KultureBR.dc.html`)
- Archivo 800 caixa-alta; `#0B0B0B/#FFD31F/#F4F2ED`; hairlines; cantos retos.
- Nav (logo PNG em `apps/web/public/logo.png`, abas Início/Basquete/Casual/Corrida, busca, Entrar, Sacola) · Hero editorial com o 1º produto do top8 e o par flutuando · ticker · grid 3 col com hover amarelo e "Escolher tamanho →" · categorias · poster "Garantia Kulture" · rodapé com contato do cliente ((85) 99257-8888, contato@kulturebr.com, CNPJ 64.579.440/0001-28).
- SizePicker: modal largo, foto do tênis, BR grande com US embaixo, "Aprox." sinalizado.
- Copy que **não** foi usada (promessas que hoje não cumprimos): Sedex 2–4 dias, desconto Pix, NF no CPF, troca 7 dias.

### Backoffice `/admin` (sessão 16/08/2026)
- **Acesso**: `User.role = admin`. Bootstrap por `ADMIN_EMAILS=a@x.com,b@y.com` (promove no login/cadastro/refresh) ou
  `npm run admin:make -w apps/api -- email` (`--revoke` rebaixa). Guard `requireAdmin` (`apps/api/src/lib/guards.js`) confere o role **no banco** a cada chamada.
- **API** `apps/api/src/modules/admin/` (`routes.js` + `service.js`): `GET /api/admin/me|dashboard?days|orders|orders/:number|customers|customers/:id`,
  `PATCH /api/admin/orders/:number` (status/rastreio/notas → `OrderEvent` com autor + e-mail ao cliente), `POST …/recheck` (payment_check de novo),
  `POST …/resend-email`, `PATCH /api/admin/customers/:id` (cadastro/role), `POST …/password-reset` (gera link + e-mail; devolve o link para repassar por WhatsApp),
  `POST …/revoke-sessions`.
- **Transições** (`ORDER_TRANSITIONS`): pending_payment→paid (baixa manual)|cancelled|abandoned · abandoned→paid|cancelled · paid→sourcing|shipped|cancelled|refunded ·
  sourcing→shipped|cancelled|refunded · shipped→delivered|refunded · delivered→refunded. "Enviado" exige rastreio (ou `allowNoTracking`).
- **Dashboard financeiro**: receita = pedidos em `paid|sourcing|shipped|delivered` (por `paidAt`), ticket médio, conversão, série diária, top produtos,
  forma de pagamento, **custo estimado + margem estimada** a partir do `breakdown` salvo em cada `OrderItem` (produto+frete US+taxas vs comissão).
- **Front** `apps/web/src/admin/` (`AdminApp` layout+guard, `Dashboard`, `Orders`, `OrderDetail`, `Deliveries` (fila com ações inline), `Customers`,
  `CustomerDetail`, `ui.jsx` helpers) + `apps/web/src/styles/admin.css`. Header da loja mostra botão **Admin** para role admin.
- **Cliente**: `/conta` (editar cadastro `PATCH /api/auth/me`, trocar senha `POST /api/auth/password`, meus pedidos `GET /api/orders/mine` com rastreio),
  "Esqueci minha senha" real (`POST /api/auth/forgot` → e-mail com link `/redefinir-senha?token=` → `POST /api/auth/reset`, uso único, 60 min, derruba sessões),
  "Rastrear pedido" no modal usa a visão pública mascarada.
- **Segurança**: `GET /api/orders/:number` para convidado agora devolve só status/itens/total/rastreio/primeiro nome (`scope:"public"`); dono ou admin recebem `scope:"full"`.

---

## 5. Banco (Prisma, Postgres)
Tabelas: `cache_entries`, `users`, `refresh_tokens`, `password_reset_tokens`, `orders` (+ `carrier`, `tracking_code`, `tracking_url`, `shipped_at`, `delivered_at`, `cancelled_at`, `refunded_at`, `internal_notes`), `order_items`, `order_events`, `notifications`, `idempotency_keys`.
Migrações: `init`, `auth`, `orders`, `user_profile`, `admin_backoffice`. Aplicadas no boot da api (`migrate deploy`).

---

## 6. Variáveis de ambiente (produção — Railway `kulture-api`)
Sem aspas, sem `<< >>`. Referência completa em `docs/DEPLOY.md`.

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<32+ chars aleatórios>
SCRAPER_URL=http://kulture-scraper.railway.internal:3001
PUBLIC_WEB_URL=https://kulture-api-production.up.railway.app   (se faltar/errar, a api usa RAILWAY_PUBLIC_DOMAIN)
PUBLIC_API_URL=https://kulture-api-production.up.railway.app
MEDIA_BASE=/media/produtos
TOP8_TERMS=Kobe 10 Protro,Kobe IX Elite Low EM Protro,Kobe III Protro,Sabrina 3,LeBron XXIII,Book 2,Air Jordan 1 Low OG,G.T. Cut 3
TOP8_WARM=true  CACHE_FRESH_MIN=60  CACHE_STALE_MIN=1440  SIZES_CACHE_MIN=10
JWT_EXPIRES_IN=15m  REFRESH_EXPIRES_DAYS=7  LOG_LEVEL=info
ADMIN_EMAILS=ti@neofolic.com.br            (quem pode abrir /admin; vírgula para vários)  PASSWORD_RESET_TTL_MIN=60
PAYMENT_PROVIDER=mock            (→ infinitepay após teste real)
INFINITEPAY_HANDLE=kulture-br
MAIL_PROVIDER=mailersend  MAILERSEND_API_TOKEN=<token>  MAIL_FROM=no-reply@lojakulture.com.br  MAIL_FROM_NAME=Kulture
WHATSAPP_PROVIDER=log
```
`kulture-scraper`: `NIKE_SEARCH_URL`, `NIKE_CHANNEL_ID=d9a5bc42-4b9c-4976-858a-f159cf99c647`, `NIKE_CALLER_ID`, `PRODUCT_CACHE_TTL_MIN=60`, `RATE_CACHE_TTL_MIN=60`, `CORS_ORIGINS=*`.

⚠️ Segredos que apareceram no chat e devem ser **rotacionados** depois que o site estabilizar: token MailerSend e o JWT_SECRET gerado na conversa.

---

## 7. Estado do deploy (atualizado 16/08/2026)
- **`https://kulture-api-production.up.railway.app` está NO AR** (health 200, front servido). O domínio `-9eea` dá 502 (target port errado — pode apagar).
- **Problema atual: a api não fala com o scraper** (`/health/deps` → `scraper.ok:false, fetch failed`) → catálogo/busca/cotação falham e o site parece "sem backend".
  Não é local/Docker: é o `kulture-api` do Railway sem alcançar `kulture-scraper`. Hipótese principal: `SCRAPER_URL` ausente/errada no serviço (default `localhost:3001`).
  Depois deste deploy o `/health/deps` mostra `url` + `cause` (ECONNREFUSED/ENOTFOUND…) — tabela de correção em `docs/DEPLOY.md` §3.
- Histórico: 1º 502 era `PUBLIC_*_URL` com placeholder → corrigido (fallback `RAILWAY_PUBLIC_DOMAIN`).
- Cloudflare Workers Builds tentado pelo dono → erro esperado ("workspace root"); **não usar** — o front sai da api.
- InfinitePay: conta com **checkout externo habilitado**; link de R$1 gerado pelo dono; pagamento real ainda **não** testado. Response do `POST /links` assumido como `data.url` (confirmar).

---

## 8. Bugs relevantes encontrados e corrigidos (para não regredir)
- `node-fetch` importado sem estar no package (funcionava só por um `~/node_modules` solto do Mac) → removido, fetch nativo.
- SizePicker chamava `api.get` (inexistente) → `api.product`.
- Checkout usava `cart.items/unitPriceBrl` (contrato errado) → tela em branco; URLs `localhost:3000` fixas; `auth.token` (é `getToken()`).
- Confirmação não chamava `/confirm` (ficaria "aguardando" para sempre sem webhook público).
- Rota de checkout lia `req.user.id` (JWT usa `sub`) → pedidos logados salvos como convidado.
- Auth: refresh/logout com `Content-Type` sem body (400), e-mail case-sensitive, rate limit com allowList 127.0.0.1.
- Nike: `count` só 24|50|100; top8 com termos que não existem mais na Nike US.
- Teste `app.test.js` desatualizado após remoção do breakdown público.
- (16/08) `AppError.forbidden/conflict` eram usados sem existir → 500 silencioso; criados. Câmbio inválido gravado no cache SWR
  (mock antigo devolvia número) envenenava o checkout por 24h → `getRate` valida o formato e rebusca. Testes da api rodavam
  arquivos em paralelo no mesmo banco e `orders.test` apagava os pedidos dos outros → `vitest.config.js` serializa (`fileParallelism:false`).

---

## 9. Pendências (ordem sugerida)
1. **Railway: ligar api → scraper** (`SCRAPER_URL` no `kulture-api`; ver `docs/DEPLOY.md` §3 com o novo `/health/deps`) → validar fluxo completo na URL pública → mandar link ao cliente.
2. Definir `ADMIN_EMAILS` no Railway → cadastrar/entrar → abrir `/admin`.
3. Testar pagamento real de R$1 → `PAYMENT_PROVIDER=infinitepay` → confirmar `payment_check` + e-mail.
4. Domínio próprio via Cloudflare DNS (CNAME → Railway) → `PUBLIC_*_URL` para o domínio (liga o webhook e os links de e-mail).
5. Rotacionar segredos expostos (MailerSend token, JWT_SECRET).
6. Filtro só-tênis + tradução PT→EN na busca ("tênis" ainda traz polo).
7. Bling (NF-e) → depois WhatsApp (Evolution API). Backoffice v2: exportar CSV, filtros por data no dashboard, editar endereço do pedido, cupons.
8. Testes de auth/admin batem no banco real (separar em CI com Postgres efêmero).
9. Imagens da Nike vêm com fundo branco (design pede recorte) — avaliar tratamento.

---

## 10. Comandos úteis
```bash
npm install && npm run dev            # web :5173, api :3000, scraper :3001
npm test                              # 54 testes (api 39 + shared 15) — api serializada, ~2 min no banco remoto
npm run admin:make -w apps/api -- seu@email.com   # promove a admin (ou ADMIN_EMAILS no .env)
npm run build -w apps/web
docker build -f deploy/api.Dockerfile -t kulture-api .        # validado localmente
docker build -f deploy/scraper.Dockerfile -t kulture-scraper .
curl -s https://kulture-api-production.up.railway.app/health/deps
```
Prompt-padrão para o Antigravity commitar (nunca alterar arquivos): conferir `git status` sem `.env`/storage/dist,
`git add -A`, commit com mensagem dada, `git push origin main`, devolver hash.
