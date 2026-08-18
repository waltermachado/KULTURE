# Kulture BR — Contexto de handoff (sessões de 16/08 e 17/08/2026)

> Documento para retomar o trabalho em qualquer ferramenta (Claude Code, Antigravity, TRAE) sem depender do
> histórico da conversa. **Sem segredos** — tokens/senhas ficam só nos `.env` (fora do git) e no painel do Railway.
> Substitui o handoff de 15/08.

---

## 1. Produto e regras fixas do dono

**Kulture BR** — loja de tênis Nike US importados. Cliente busca o modelo, escolhe o tamanho em **numeração BR**,
coloca na sacola, paga via **InfinitePay** (link de pagamento) e recebe confirmação. Checkout como convidado ou logado.

Regras que não voltam a ser discutidas:
- **Preço em BRL fechado, frete embutido** — o cliente nunca vê frete como custo (se aparecer, "Grátis").
- **Breakdown de preço** (câmbio, frete, comissão, regras) **nunca sai na API pública** — só `price.brl`, `price.fullBrl`,
  `price.exchange.usdToBrl`, `price.pix`, `price.installments.label`.
- **Bling (NF-e) e WhatsApp: adiados.** WhatsApp fica em `WHATSAPP_PROVIDER=log`.
- E-mail transacional: **MailerSend via API HTTP**. Gateway: **InfinitePay** (`PAYMENT_PROVIDER=infinitepay`).

### Precificação (decidida em 16/08 — implementada, aguardando push; ver §3)

```
Preço Pix = arredondar↑ até …99 ( [ (USD × 1,07 + 65) × dólar TURISMO ] × 1,30 )
```
- 7% incide **só sobre o preço do tênis** (antes do frete); frete US$ 65 por par; comissão 30% sobre o total.
- Arredonda **para cima** até o próximo valor terminado em 99: 1714→1799 · 1880→1899 · 1899 fica · 1900→1999.
- **Dólar turismo** = AwesomeAPI par `USD-BRLT` (ask). Fallback quando faltar: **comercial + R$ 0,25** (`RATE_TOURISM_SPREAD_BRL`).
- Site mostra o preço grande com selo **"no Pix"** e, pequeno, **"ou em até Nx no cartão"** (`MAX_INSTALLMENTS`, padrão 12).
  ⚠️ O dono escreveu "12x" e "até 5 vezes" — **confirmar qual**; se 5, `MAX_INSTALLMENTS=5` no Railway.
- Parcelas/juros reais são **configuração da conta InfinitePay** (a API do link não tem campo). O admin mostra
  "juros repassados ao cliente: +R$ Y" quando `paid_amount > amount` (só aparece em pagamento no cartão parcelado).
- Regras vivem em `packages/shared/src/pricing/default-rules.js` (`productSurchargeRate`, `shippingUsd`, `commission`,
  `roundUpToEnding`); modulares por escopo global/brand/category/model/sku.
- Produto virtual `test123test` (R$ 1,00) fica fora da fórmula.

---

## 2. Código e forma de trabalhar

- **Repo:** `~/Desktop/KULTURE` → GitHub `waltermachado/KULTURE`, branch `main`.
- Monorepo npm workspaces:

```
apps/web               React 19 + Vite, CSS próprio (src/styles/kulture.css + admin.css)     dev :5173
apps/api               Fastify 5 + Prisma 6/Postgres; em prod serve o front (apps/web/dist)   :3000
services/nike-scraper  Express — único que fala com a Nike US (endpoints não-oficiais)        :3001 (privado)
packages/shared        pricing/ (motor de preço) + sizes/ (US→BR por lookup)
deploy/                Dockerfiles (api, scraper), api-entrypoint.sh (prisma migrate deploy), railway.*.json
docs/                  DEPLOY.md (Railway; §6b InfinitePay), CONTEXTO.md (este), PLANO.md
```

- **Fluxo:** Claude Code implementa/audita e **não commita**. O dono cola um prompt no **Antigravity**, que confere
  `git status --short` (sem `.env`/storage/dist), faz `git add -A`, commit com a mensagem dada, `git push origin main`
  e devolve o hash. O dono **testa a UI ele mesmo** — validar por curl, testes automatizados e build; não fazer
  fluxos longos no navegador embutido. Não usar o Chrome do dono.

---

## 3. Estado do git

- Último commit no GitHub: **`632cce4`** — só tênis na busca, pré-venda/lançamento, produto `test123test`.
- **Pendente de commit** (28 arquivos modificados, nenhum novo — incl. este `docs/CONTEXTO.md`): nova precificação
  (turismo, 7%, ↑99), selo "no Pix" + "em até 12x", redirect do pagamento no domínio do cliente, admin com "juros
  repassados", testes atualizados (api 39/39, shared 17/17), build ok. **17/08 (mobile):** barra de busca visível no
  celular (2ª linha do topo, largura total, `font-size:16px` para não dar zoom no iOS; `Header.jsx` — o form virou filho
  direto de `.nav-inner`), hero empilhado mostra **foto antes do nome** (`.hero-stage{order:-1}` em ≤1024px), e fix de
  um TDZ no `CartDrawer.jsx` (`list` usado antes do destructuring — derrubava a página inteira). Mensagem sugerida:

  `feat(pricing): nova fórmula — (USD×1,07 + 65) × dólar turismo × 1,30, arredondado ↑ até …99; preço "no Pix" + "em até 12x no cartão"; fix(payments): redirect_url no domínio usado pelo cliente; feat(web): busca no mobile + hero com foto antes do nome; fix(web): TDZ no CartDrawer`

- **17/08 (noite) — também pendente, NÃO subir ainda (dono pediu para segurar o push):** pronta entrega + WhatsApp (ver §5b).
  Novos arquivos: `apps/api/prisma/migrations/20260817233408_stock_products/`, `apps/api/src/modules/stock/{service,routes,admin-routes}.js`,
  `apps/api/src/modules/config/routes.js`, `apps/api/test/stock.test.js`, `apps/web/src/{pages/Stock.jsx, components/ModeBar.jsx,
  components/WhatsappCta.jsx, hooks/useSiteConfig.js, admin/Stock.jsx, admin/StockForm.jsx}`. Testes: api **48/48** (39 + 9 novos), build ok.
  Mensagem sugerida para esse bloco:

  `feat(stock): pronta entrega — produtos em estoque próprio (BO /admin/estoque com preço/descrição/fotos/tamanhos), página /pronta-entrega, seletor Importados × Pronta entrega, reserva de estoque por tamanho no checkout; feat(web): CTA "não achou? chama no WhatsApp" na busca (/api/config + WHATSAPP_CONTACT_PHONE); feat(web): transição avião EUA ⇄ BR entre as vitrines`

  **Transição de avião EUA ⇄ BR** (opção **C**, aprovada pelo dono em 17/08): implementada em `ModeBar.jsx` (voo do avião
  entre as bandeiras + rastro + bloco amarelo deslizando, `~0,7s`) e `App.jsx` (`switchMode`: a página atual sai para um lado
  e a nova entra do outro, sobe ao topo; wrapper `.page-view`). `prefers-reduced-motion` → troca seca; clique novo cancela o
  anterior (token); numa aba oculta a troca acontece por timeout (o navegador não dispara o "finish" da animação).

---

## 4. Deploy — Railway (projeto "glorious-trust", ambiente production)

```
Internet ──► kulture-api (público)  serve apps/web/dist + /api + /media (mesma origem, sem CORS)
                 │ rede privada IPv6
                 ├► kulture-scraper (sem domínio)  http://kulture-scraper.railway.internal:3001
                 └► Postgres (plugin)               DATABASE_URL
```

- **Site: `https://lojakulture.com.br`** (custom domain OK). `www.lojakulture.com.br` não resolve (falta CNAME +
  custom domain no Railway). O domínio `kulture-api-production.up.railway.app` também responde; o `-9eea` dá 502 (apagar).
- `curl …/health` → `paymentProvider` (mock|infinitepay), `mailProvider`, `storageWritable`; `…/health/deps` → scraper
  `ok/url/cause` (tabela de diagnóstico em `docs/DEPLOY.md` §3).
- Em 16/08: `paymentProvider: infinitepay`, `mailProvider: mailersend`, `storageWritable: false`, scraper ok.
- **Pagamento real de R$ 1 funcionou** (Pix, via `test123test`). O redirect voltou no domínio Railway porque
  `PUBLIC_WEB_URL` apontava para lá → corrigido no código (usa o domínio que o cliente estava usando, com allowlist)
  **e** o dono deve trocar as variáveis (abaixo).
- Câmbio: AwesomeAPI devolve 429 no IP compartilhado do Railway → scraper cai para Frankfurter/open.er-api (só
  comercial) e o turismo vira comercial + 0,25 nesses momentos.
- Rede privada: scraper escuta em `[::]:3001` (log mostra "rede privada: http://…railway.internal:3001").

### Variáveis (`kulture-api`) — mudar e clicar **Deploy**

| Objetivo | Variável |
|---|---|
| Links de e-mail/reset/redirect/webhook no domínio certo | `PUBLIC_WEB_URL=https://lojakulture.com.br` e `PUBLIC_API_URL=https://lojakulture.com.br` |
| Imagens gravadas no volume (hoje vêm da Nike) | `RAILWAY_RUN_UID=0` |
| Frase de parcelamento | `MAX_INSTALLMENTS=12` (ou 5) |
| WhatsApp de atendimento no site ("não achou? chama a gente") | `WHATSAPP_CONTACT_PHONE=5585992578888` (DDI+DDD+número; sem ela usa o do rodapé) |
| Desligar o produto de teste após validar | `TEST_PRODUCT_ENABLED=false` |
| Admins do backoffice | `ADMIN_EMAILS=email1,email2` |
| Limpeza | remover `RAILWAY_PRIVATE_DOMAIN` criada à mão no serviço da api |
| **Segurança** | rotacionar `JWT_SECRET` (`openssl rand -base64 48`, desloga todo mundo) e o token MailerSend — ambos apareceram no chat |

Demais variáveis: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SCRAPER_URL=http://kulture-scraper.railway.internal:3001`,
`INFINITEPAY_HANDLE=<InfiniteTag sem $>`, `MAIL_PROVIDER=mailersend`, `MAILERSEND_API_TOKEN`, `MAIL_FROM`, `MAIL_FROM_NAME`,
`TOP8_TERMS`, `TOP8_WARM=true`, `CACHE_FRESH_MIN=60`, `CACHE_STALE_MIN=1440`, `SIZES_CACHE_MIN=10`, `JWT_EXPIRES_IN=15m`,
`REFRESH_EXPIRES_DAYS=7`, `LOG_LEVEL=info`, `WHATSAPP_PROVIDER=log`, `RATE_TOURISM_SPREAD_BRL=0.25`.
`kulture-scraper`: `NIKE_SEARCH_URL`, `NIKE_CHANNEL_ID`, `NIKE_CALLER_ID`, `PRODUCT_CACHE_TTL_MIN=60`, `RATE_CACHE_TTL_MIN=60`,
`CORS_ORIGINS=*`, `RATE_TOURISM_SPREAD_BRL=0.25` (opcional: `RATE_STALE_MAX_HOURS`, `RATE_FAIL_BACKOFF_SEC`, `RATE_FALLBACK_USD_BRL`).

---

## 5. O que foi construído em 16/08 (tudo no ar, exceto o pendente do §3)

**Backoffice `/admin`** (exige `role=admin`; `ADMIN_EMAILS` promove no login/cadastro, ou `npm run admin:make -w apps/api -- email`):
dashboard financeiro (receita, ticket médio, conversão, custo/margem estimados pelo breakdown dos itens, série diária,
top produtos, pagamentos por método), pedidos (filtros, detalhe com itens/eventos/notificações, transições de status
com rastreio + e-mail ao cliente, notas internas, reconsultar `payment_check`, reenviar e-mail, baixa manual),
entregas (fila com ações inline), clientes (lista com gasto e último acesso; detalhe com edição de cadastro/role,
pedidos incl. convidado por e-mail, link de redefinição de senha, revogar sessões, **acessos** com IP/navegador).

**Conta do cliente:** `/conta` (editar cadastro, trocar senha, meus pedidos com rastreio), "esqueci minha senha" real
(token uso único 60 min → `/redefinir-senha`), botão mostrar/ocultar senha em todos os campos, rastrear pedido no modal,
tabela `login_events` + `users.last_login_at`, pedido de convidado vinculado à conta pelo e-mail (sem alterar perfil).

**Segurança:** `GET /api/orders/:number` mascarado para convidado (sem CPF/e-mail/telefone/endereço); dono/admin veem tudo.

**Catálogo:** busca da Nike segue o redirect (`analyzer.action.redirectUrl` — "kobe" voltava vazio); **só FOOTWEAR**
(roupas/meias fora; pede 50 à Nike); fotos **recortadas** (URL da CDN reescrita para `w_1000,f_webp,q_auto/<id>` —
remove a camada de fundo; espelho `v2-*.webp` em paralelo); **galeria** no seletor de tamanho (até 8 ângulos, setas,
miniaturas, teclado); **pré-venda/lançamento** (`product.launch {isLaunch, comingSoon, date, label, bestSeller, justIn}` a
partir de `badgeAttribute`/`featuredAttributes`/`launchView.startEntryDate` — Kobe 10 lança 23/08/2026 14:00 UTC; selo
PRÉ-VENDA no card/hero, data no seletor, tag na sacola/checkout — fluxo de compra igual); caches nunca guardam resultado
vazio; chaves versionadas (`search/top8/sizes:v5`, `rate:USD-BRL:v2`).

**Robustez:** `SCRAPER_URL` tolerante (aspas/espaços/prefixo) e nunca fatal; storage não gravável degrada (imagens da Nike)
em vez de derrubar a busca; câmbio multi-fonte (AwesomeAPI → Frankfurter → open.er-api) + último conhecido + backoff em 429;
scraper loga o bind real.

**InfinitePay conforme doc oficial:** `paid` só com `paid===true` (`success` = consulta ok), conferência de valor
(`payment_amount_mismatch` não marca pago), webhook responde `{success:true,message:null}` / 400 para retentativa,
`redirect_url` por path (`/pedido/confirmacao/:number`; front aceita `:number`, `?order=`, `?order_nsu=`), `settle()`
único para redirect/webhook/reconsulta, `redirect_url` no domínio que o cliente usou (allowlist `PUBLIC_WEB_HOSTS`).

**Produto virtual `test123test`:** R$ 1,00, foto = logo, "teste gateway", só aparece buscando exatamente o nome, um
tamanho; `TEST_PRODUCT_ENABLED=false` desliga.

Também: favicon (K da marca), `/health` com providers, `/api/rate` devolve `tourism`.

---

## 5b. Pronta entrega + WhatsApp (17/08, noite — pendente de push)

**Duas seções na loja:** `/` = **Importados** (busca ao vivo na Nike US, como sempre) e `/pronta-entrega` = **Pronta entrega**
(estoque próprio no Brasil, sem Nike). Uma barra `ModeBar` (EUA · Importados | BR · Pronta entrega) fica logo abaixo do topo nas
duas páginas (desktop e mobile), com a transição do avião (opção C — ver §3).

**Backoffice `/admin/estoque`** (`Stock.jsx` lista · `StockForm.jsx` cadastro/edição): nome, marca, categoria/subtítulo, colorway,
SKU Nike (informativo), descrição (aparece no seletor de tamanho), selo do card, ordem, **preço Pix**, preço "de" riscado, **custo**
(só BO — alimenta custo/margem do dashboard via `breakdown.subtotalBrl`), ativo, **tamanhos BR com US opcional e quantidade**
(atalhos 34–46), **fotos** por upload (redimensiona no navegador p/ 1400px WebP → `POST /api/admin/stock/:id/images` → gravada no
banco `stock_images`, servida em `/media/estoque/:id` com cache imutável — não depende do volume) ou por URL; primeira foto = capa.

**API:** `GET /api/stock` (público, sem custo/ids internos), `GET /api/product/PE-XXXXXX` (o catálogo intercepta o prefixo `PE-` em
`getProductSizes` → responde do banco: seletor de tamanho e checkout funcionam sem mudanças), `GET /api/config`
(`{ whatsapp:{phone,url}|null, installments, stock }`), admin `GET/POST /api/admin/stock`, `GET/PATCH/DELETE /api/admin/stock/:id`,
`POST /api/admin/stock/:id/images`. `code` PE-XXXXXX é o `styleColor` do item no carrinho/pedido; `nikeSize` = US da caixa
(se informado) senão o BR — e-mails/telas mostram "(US x)" só quando difere do BR.

**Estoque por tamanho (tabela `stock_sizes`):** reservado na **criação do pedido** (decremento condicional `qty >= n` dentro da
transação — dois clientes disputando o último par: só um pedido é criado, o outro recebe erro), **devolvido** quando o pedido vira
`cancelled`/`abandoned` (admin ou job de 30 min; `orders.stock_released_at` evita devolver 2×; evento `stock_released`) e
**re-reservado** se um pedido abandonado acabar pago (`settle()`/baixa manual; sem estoque → evento `stock_oversold` + nota interna
para o dono conferir). Estorno (`refunded`) NÃO devolve sozinho — ajustar a qtd no painel. Preço da pronta entrega é o digitado
(a fórmula de importação não se aplica); a frase "em até Nx" segue `MAX_INSTALLMENTS`.

**WhatsApp "não achou?":** `WhatsappCta.jsx` — banner grande quando a busca dá vazio/erro e faixa compacta abaixo dos resultados
(também na pronta entrega), com mensagem pré-preenchida (inclui o termo buscado). Número vem de `WHATSAPP_CONTACT_PHONE` na api
(`/api/config`); se faltar, usa o do rodapé (`5585992578888`, `useSiteConfig.js`). Obs.: a busca da Nike é "fuzzy" — quase nunca
volta vazia — por isso a faixa abaixo dos resultados é o ponto principal.

Mobile: logado, o botão "Admin" some do topo em ≤640px (cabe logo + nome + Sair + Sacola); o admin chega pelo `/conta` → "ir para o backoffice".

---

## 6. Banco (Prisma / Postgres)

Tabelas: `cache_entries, users, refresh_tokens, password_reset_tokens, login_events, orders (com carrier/tracking_*/shipped_at/
delivered_at/cancelled_at/refunded_at/internal_notes/stock_released_at), order_items, order_events, notifications, idempotency_keys,
stock_products, stock_sizes, stock_images`.
Migrações: `init, auth, orders, user_profile, admin_backoffice, login_events, stock_products` — aplicadas no boot da api (`migrate deploy`).
Dev local: `apps/api/.env` aponta para Supabase (pooler us-east-2), migrado; seed de demonstração
(`*@smoke.kulture.test`, admin `admin@smoke.kulture.test`, pedidos `KLT-2026-9*`).

---

## 7. Pendências (ordem sugerida)

1. Rodar o push pendente (§3) → ajustar variáveis (§4, + `WHATSAPP_CONTACT_PHONE`) → confirmar **12x vs 5x** → fazer um pagamento
   **no cartão parcelado** e conferir "juros repassados" no `/admin`. Cadastrar os primeiros pares em `/admin/estoque`.
2. `www.lojakulture.com.br` (CNAME no Cloudflare + custom domain no Railway) — se quiser.
3. Rotacionar segredos; `TEST_PRODUCT_ENABLED=false` após validar o gateway.
4. Tradução PT→EN na busca ("tênis" → "shoes") — não feita.
5. Admin: regras de preço editáveis (tabela PricingRule) — hoje só em código.
6. Bling (NF-e) → WhatsApp (Evolution API) — adiados.
7. Testes de auth/admin batem no banco real (separar em CI).

---

## 8. Comandos

```bash
npm install && npm run dev            # web :5173, api :3000, scraper :3001
npm test                              # api 39 + shared 17
npm run build -w apps/web
curl -s https://lojakulture.com.br/health
curl -s https://lojakulture.com.br/health/deps
```

Prompt-padrão do Antigravity: conferir `git status --short` (sem `.env`/storage/dist; se aparecer algo inesperado, PARAR),
`git add -A`, commit com a mensagem dada, `git push origin main`, devolver o hash.
