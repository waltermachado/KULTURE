# Kulture BR — Contexto de handoff (sessões de 16 a 20/08/2026)

> Documento para retomar o trabalho em qualquer ferramenta (Claude Code, Antigravity, TRAE) sem depender do
> histórico da conversa. **Sem segredos** — tokens/senhas ficam só nos `.env` (fora do git) e no painel do Railway.
> Consolida os handoffs de 15/08 e 16/08 com tudo o que foi feito em 17–20/08.

---

## 1. Produto e regras fixas do dono

**Kulture BR** — loja de tênis Nike US. Duas seções: **Importados** (`/`, busca ao vivo na Nike US, sob encomenda) e
**Pronta entrega** (`/pronta-entrega`, estoque próprio no Brasil, cadastrado no backoffice). Cliente busca/escolhe o modelo,
escolhe o tamanho em **numeração BR**, coloca na sacola, paga via **InfinitePay** (link de pagamento) e recebe confirmação.
Checkout como convidado ou logado.

Regras que não voltam a ser discutidas:
- **Preço em BRL fechado, frete embutido** — o cliente nunca vê frete como custo (se aparecer, "Grátis").
- **Breakdown de preço** (câmbio, frete, comissão, custo, regras) **nunca sai na API pública** — só `price.brl`, `price.fullBrl`,
  `price.exchange.usdToBrl`, `price.pix`, `price.installments.label`.
- **Bling (NF-e) e WhatsApp de notificação: adiados.** `WHATSAPP_PROVIDER=log`. (O WhatsApp de **atendimento** — botão
  "não achou? chama a gente" — está no ar; ver §5.)
- E-mail transacional: **MailerSend via API HTTP**. Gateway: **InfinitePay** (`PAYMENT_PROVIDER=infinitepay`).
- Claude Code **não commita nem faz push**; o dono libera cada push (Antigravity). O dono **testa a UI ele mesmo**.

### Precificação dos importados (decidida em 16/08 — no ar desde `702da55`)

```
Preço Pix = arredondar↑ até …99 ( [ (USD × 1,07 + 65) × dólar TURISMO ] × 1,30 )
```
- 7% incide **só sobre o preço do tênis** (antes do frete); frete US$ 65 por par; comissão 30% sobre o total.
- Arredonda **para cima** até o próximo valor terminado em 99: 1714→1799 · 1880→1899 · 1899 fica · 1900→1999.
- **Dólar turismo** = AwesomeAPI par `USD-BRLT` (ask). Fallback quando faltar: **comercial + R$ 0,25** (`RATE_TOURISM_SPREAD_BRL`).
- Site mostra o preço grande com selo **"no Pix"** e, pequeno, **"ou em até Nx no cartão"** (`MAX_INSTALLMENTS`, padrão 12).
  ⚠️ O dono escreveu "12x" e "até 5 vezes" — **confirmar qual**; se 5, `MAX_INSTALLMENTS=5` no Railway.
- Parcelas/juros reais são **configuração da conta InfinitePay** (a API do link não tem campo). O admin mostra
  "juros repassados ao cliente: +R$ Y" quando `paid_amount > amount` (só em cartão parcelado).
- Regras em `packages/shared/src/pricing/default-rules.js` (`productSurchargeRate`, `shippingUsd`, `commission`,
  `roundUpToEnding`, `extraFixedBrl`); modulares por escopo global/brand/category/model/sku.
- **LeBron XXIII (23): +R$ 300 no preço final** (decisão 19/08) — regra `lebron-23-acrescimo` (escopo model,
  regex `lebron xxiii|23`), campo novo `extraFixedBrl`: soma depois da comissão (os 30% NÃO incidem sobre ele) e antes
  do ↑99 (como 300 é múltiplo de 100, continua terminando em 99 — ex.: 1799 → 2099). Não pega LeBron XX/XXI/Witness/NXXT.
  Vale só para importados; na pronta entrega o preço segue sendo o digitado no cadastro.
- **Pronta entrega NÃO usa a fórmula**: o preço é o digitado no cadastro. Produto virtual `test123test` (R$ 1,00) também fica fora.

---

## 2. Código e forma de trabalhar

- **Repo:** `~/Desktop/KULTURE` → GitHub `waltermachado/KULTURE`, branch `main`.
- Monorepo npm workspaces:

```
apps/web               React 19 + Vite, CSS próprio (src/styles/kulture.css + admin.css)     dev :5173
apps/api               Fastify 5 + Prisma 6/Postgres; em prod serve o front (apps/web/dist)   :3000
services/nike-scraper  Express — único que fala com a Nike US (endpoints não-oficiais)        :3001 (privado)
packages/shared        pricing/ (motor de preço) + sizes/ (US↔BR, modelagem, tabela padrão)
deploy/                Dockerfiles (api, scraper), api-entrypoint.sh (prisma migrate deploy), railway.*.json
docs/                  DEPLOY.md (Railway; §6b InfinitePay), CONTEXTO.md (este), PLANO.md
```

- **Fluxo:** Claude Code implementa/audita e **não commita**. O dono cola um prompt no **Antigravity**, que confere
  `git status --short` (sem `.env`/storage/dist; se aparecer algo inesperado, PARAR), faz `git add -A`, commit com a mensagem
  dada, `git push origin main` e devolve o hash. Validação por curl, testes automatizados e build; nada de fluxos longos no
  navegador embutido. Não usar o Chrome do dono. Quando o dono pede para "segurar", nenhum comando de push é entregue.
- Módulos da api (`apps/api/src/modules`): `catalog` (busca/preço/imagens/tamanhos), `stock` (pronta entrega), `orders`
  (checkout/pagamento), `admin` (backoffice), `auth`, `mail`, `config` (`/api/config`), `health`, `jobs` (checkout abandonado),
  `notifications`, `payments`.

---

## 3. Estado do git (20/08, fim da sessão)

- **No GitHub: `c228704`** (18/08) — categoria na pronta entrega, tamanhos por modelagem, Nike By You, filtros por seção,
  fix do cache do `findOne` (bloco que estava "segurado" em 18/08 já subiu). Antes dele: `702da55` (precificação nova,
  pronta entrega, transição avião, CTA WhatsApp).
- **Pendente de push (19–20/08)** — cinco blocos:
  1. **Venda externa** (§5.7): venda feita fora do site registrada no painel como pedido pago.
     Arquivos: `apps/api/prisma/schema.prisma` (+ migração `20260819212330_order_channel`), `apps/api/src/modules/admin/{service,routes}.js`,
     `orders/service.js` (`newOrderNumber`), `stock/service.js` (`getProductByCode(code,{includeInactive})`), `mail/mailer.js`
     (`buildOrderRegisteredEmail`, `PAYMENT_METHOD_LABELS`), `apps/api/test/manual-order.test.js` (novo), `apps/web/src/admin/ManualOrder.jsx`
     (novo), `AdminApp/Orders/OrderDetail/Dashboard/Deliveries/CustomerDetail/ui.jsx`, `styles/admin.css`.
  2. **LeBron 23 +R$300** (§1): `packages/shared/src/pricing/{default-rules,rules,calculate}.js` (campo `extraFixedBrl` +
     regra `lebron-23-acrescimo`), `packages/shared/test/pricing.test.js` (+2 testes), `apps/api/src/modules/catalog/service.js`
     (cache NS v5 → v6 para o preço novo valer na hora).
  3. **HYPADOS + Vitrine** (§5.8, 20/08): terceira seção da loja (`/hypados`, estoque próprio como a pronta
     entrega — coluna `stock_products.section`, código HY-…), aba no ModeBar com logo de bola de basquete amarela
     no fundo preto e transição de BOLA QUICANDO entre qualquer aba e o Hypados (avião continua só EUA ⇄ BR);
     backoffice `/admin/hypados` (mesmas telas da pronta entrega, parametrizadas) e `/admin/vitrine` — o tênis do
     HERO agora é configurável por seção (Importados/Pronta entrega/Hypados) × categoria (Início/Basquete/Casual/
     Corrida), guardado na nova tabela `settings` (key "featured"). Migração `20260820035255_stock_section_settings`.
     Testes: `apps/api/test/hypados.test.js` (5).
  4. **Conta no checkout** (20/08): convidado pode criar a conta DENTRO do carrinho — caixa "Criar minha conta
     com esses dados" (marcada por padrão) com senha + confirmação em `pages/Checkout.jsx`; registra via
     `POST /api/auth/register` ANTES do pedido e o checkout segue autenticado (pedido nasce vinculado, sem depender
     do vínculo por e-mail). E-mail já cadastrado → aviso inline com botão "Entrar" (abre o modal de login) ou
     desmarcar e comprar como convidado (comportamento antigo intacto). Zero mudança no backend — só compõe
     register + checkout com Bearer. Logado não vê a caixa.
  5. **Fix: feminino acima de W 12 repetia o número no seletor** (§5.4): a tabela oficial feminina vai só até W 12 e
     `WOMENS_APPROX` estava vazia → `brSize: null` e o chip mostrava "12.5 · US W 12.5" (parecia BR; no checkout viraria
     "BR ?"). Reproduzido no Air Jordan 1 Mid SE feminino (IO0760-001, até W 15.5). `packages/shared/src/sizes/index.js`:
     `WOMENS_APPROX` preenchida (W 4–4.5 e W 12.5–16 → BR 32,5–33 e 43,5–48, `approximate: true`, sequência contínua sem
     repetir BR); `apps/web/src/components/SizePicker.jsx`: chip sem BR na tabela mostra o US uma vez só (defesa para
     lacunas futuras); `packages/shared/test/sizes.test.js` (+3 testes).

  Mensagem de commit sugerida (um commit só):

  `feat(admin): venda externa — POST /api/admin/orders registra venda feita fora do site (WhatsApp/Instagram/presencial/outro) como pedido já pago (paymentProvider=manual, orders.channel), itens de pronta entrega (baixa estoque, opcional), Nike (GET /api/admin/catalog/:term pré-preenche nome/foto/preço/custo/tamanhos) ou livres, desconto, forma de pagamento (pix/cartão/débito/dinheiro/transferência/outro), status inicial pago/comprando/enviado/entregue com rastreio, e-mail "pedido registrado" ao cliente; tela /admin/pedidos/nova; filtro de canal e selo "externa" em Pedidos/Entregas/Clientes; dashboard com receita por canal (site × fora do site); feat(pricing): LeBron XXIII/23 +R$300 no preço final — campo extraFixedBrl (fixo, fora da comissão, antes do ↑99) + regra model lebron-23-acrescimo; cache do catálogo v6; fix(sizes): feminino acima de W 12 (e abaixo de W 5) ganha BR aproximado — WOMENS_APPROX preenchida (43,5–48 sem repetir), chip do seletor não repete mais o número quando faltar BR na tabela; feat(checkout): convidado cria conta no próprio carrinho (checkbox marcado por padrão + senha; registra antes do pedido e finaliza autenticado; e-mail já usado → entrar ou seguir sem conta); feat(hypados): terceira seção da loja /hypados (estoque próprio, stock_products.section, código HY-, aba com bola de basquete amarela Kulture e transição de bola quicando; avião fica só EUA⇄BR), backoffice /admin/hypados; feat(vitrine): tênis do hero configurável por seção × categoria (/admin/vitrine, tabela settings, GET /api/featured com fallback automático)`

- Testes no fim da sessão: **api 62/62** (9 arquivos; manual-order 7, hypados 5), **shared 27/27**, `npm run build -w apps/web` ok.
  As migrações `order_channel` e `stock_section_settings` já estão aplicadas no banco de dev (Supabase); em produção rodam
  sozinhas no boot (`migrate deploy`).

---

## 4. Deploy — Railway (projeto "glorious-trust", ambiente production)

```
Internet ──► kulture-api (público)  serve apps/web/dist + /api + /media (mesma origem, sem CORS)
                 │ rede privada IPv6
                 ├► kulture-scraper (sem domínio)  http://kulture-scraper.railway.internal:3001
                 └► Postgres (plugin)               DATABASE_URL
```

- **Site: `https://lojakulture.com.br`** (custom domain OK). `www.lojakulture.com.br` não resolve (falta CNAME + custom domain
  no Railway). `kulture-api-production.up.railway.app` também responde; o `-9eea` dá 502 (apagar).
- `curl …/health` → `paymentProvider`, `mailProvider`, `storageWritable`; `…/health/deps` → scraper `ok/url/cause`
  (tabela de diagnóstico em `docs/DEPLOY.md` §3). Em 16/08: infinitepay + mailersend, `storageWritable: false`, scraper ok.
- **Pagamento real de R$ 1 funcionou** (Pix, via `test123test`). O redirect voltava no domínio Railway porque `PUBLIC_WEB_URL`
  apontava para lá → corrigido no código (usa o domínio que o cliente estava usando, com allowlist `PUBLIC_WEB_HOSTS`) **e** o
  dono deve trocar as variáveis abaixo.
- Câmbio: AwesomeAPI devolve 429 no IP compartilhado do Railway → scraper cai para Frankfurter/open.er-api (só comercial) e o
  turismo vira comercial + 0,25 nesses momentos.

### Variáveis (`kulture-api`) — mudar e clicar **Deploy**

| Objetivo | Variável |
|---|---|
| Links de e-mail/reset/redirect/webhook no domínio certo | `PUBLIC_WEB_URL=https://lojakulture.com.br` e `PUBLIC_API_URL=https://lojakulture.com.br` |
| Imagens gravadas no volume (hoje vêm da Nike) | `RAILWAY_RUN_UID=0` |
| Frase de parcelamento | `MAX_INSTALLMENTS=12` (ou 5) |
| WhatsApp de atendimento no site ("não achou? chama a gente") | `WHATSAPP_CONTACT_PHONE=5585992578888` (DDI+DDD+número; sem ela o site usa o do rodapé) |
| Desligar o produto de teste após validar | `TEST_PRODUCT_ENABLED=false` |
| Admins do backoffice | `ADMIN_EMAILS=email1,email2` |
| Limpeza | remover `RAILWAY_PRIVATE_DOMAIN` criada à mão no serviço da api |
| **Segurança** | rotacionar `JWT_SECRET` (`openssl rand -base64 48`, desloga todo mundo) e o token MailerSend — ambos apareceram no chat em 16/08 |

Demais variáveis: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SCRAPER_URL=http://kulture-scraper.railway.internal:3001`,
`INFINITEPAY_HANDLE=<InfiniteTag sem $>`, `MAIL_PROVIDER=mailersend`, `MAILERSEND_API_TOKEN`, `MAIL_FROM`, `MAIL_FROM_NAME`,
`TOP8_TERMS`, `TOP8_WARM=true`, `CACHE_FRESH_MIN=60`, `CACHE_STALE_MIN=1440`, `SIZES_CACHE_MIN=10`, `JWT_EXPIRES_IN=15m`,
`REFRESH_EXPIRES_DAYS=7`, `LOG_LEVEL=info`, `WHATSAPP_PROVIDER=log`, `RATE_TOURISM_SPREAD_BRL=0.25`.
`kulture-scraper`: `NIKE_SEARCH_URL`, `NIKE_CHANNEL_ID`, `NIKE_CALLER_ID`, `PRODUCT_CACHE_TTL_MIN=60`, `RATE_CACHE_TTL_MIN=60`,
`CORS_ORIGINS=*`, `RATE_TOURISM_SPREAD_BRL=0.25` (opcional: `RATE_STALE_MAX_HOURS`, `RATE_FAIL_BACKOFF_SEC`, `RATE_FALLBACK_USD_BRL`).

---

## 5. O que existe hoje (por área)

### 5.1 Base construída em 16/08 (no ar)

**Backoffice `/admin`** (exige `role=admin`; `ADMIN_EMAILS` promove no login/cadastro, ou `npm run admin:make -w apps/api -- email`):
dashboard financeiro (receita, ticket médio, conversão, custo/margem estimados pelo breakdown dos itens, série diária, top
produtos, pagamentos por método), pedidos (filtros, detalhe com itens/eventos/notificações, transições de status com rastreio +
e-mail ao cliente, notas internas, reconsultar `payment_check`, reenviar e-mail, baixa manual), entregas (fila), clientes
(gasto, último acesso, edição de cadastro/role, pedidos incl. convidado por e-mail, link de redefinição de senha, revogar sessões,
acessos com IP/navegador), **pronta entrega** (§5.2).

**Conta do cliente:** `/conta` (cadastro, senha, meus pedidos com rastreio); no checkout, convidado pode criar a
conta na hora (20/08 — caixa com senha, marcada por padrão; ver §3 bloco 4); "esqueci minha senha" real (token 60 min →
`/redefinir-senha`), mostrar/ocultar senha, rastrear pedido, `login_events` + `users.last_login_at`, pedido de convidado vinculado
à conta pelo e-mail. `GET /api/orders/:number` mascarado para convidado (sem CPF/e-mail/telefone/endereço).

**Catálogo (importados):** busca da Nike segue o redirect; **só FOOTWEAR**; fotos **recortadas** (`w_1000,f_webp,q_auto/<id>`,
espelho `v2-*.webp`); **galeria** no seletor (até 8 ângulos); **pré-venda/lançamento** (`product.launch`; Kobe 10 lança
23/08/2026 14:00 UTC — selo PRÉ-VENDA no card/hero, data no seletor, tag na sacola); caches nunca guardam resultado vazio;
chaves versionadas (`search/top8/sizes:v6`, `rate:USD-BRL:v2`, `product:v6:<termo>` — v6 = LeBron 23 +R$300).

**Robustez:** `SCRAPER_URL` tolerante e nunca fatal; storage não gravável degrada (imagens da Nike) em vez de derrubar a busca;
câmbio multi-fonte + último conhecido + backoff em 429.

**InfinitePay conforme doc oficial:** `paid` só com `paid===true`, conferência de valor (`payment_amount_mismatch` não marca pago),
webhook `{success:true,message:null}` / 400 para retentativa, `redirect_url` por path (`/pedido/confirmacao/:number`), `settle()`
único para redirect/webhook/reconsulta/baixa manual.

**Produto virtual `test123test`:** R$ 1,00, só aparece buscando exatamente o nome; `TEST_PRODUCT_ENABLED=false` desliga.
Também: favicon, `/health` com providers, `/api/rate` devolve `tourism`.

**Mobile (17/08):** barra de busca visível no celular (2ª linha do topo, largura total, `font-size:16px` para não dar zoom no iOS);
hero empilhado mostra **foto antes do nome**; logado em ≤640px o botão "Admin" some do topo (o admin chega por `/conta`).

### 5.2 Pronta entrega — estoque próprio no Brasil (17–18/08)

**Página `/pronta-entrega`** (`pages/Stock.jsx`): mesmos componentes da home (Hero variante "stock", Marquee, grid, blocos de
categoria); lê `GET /api/stock` uma vez; sem Nike. Card com selo **PRONTA ENTREGA** (ou selo livre, ex. "ÚLTIMO PAR"), rodapé
"em estoque no Brasil · envio imediato · frete grátis"; esgotado fica visível sem botão.

**Seletor de seção** (`components/ModeBar.jsx`): barra **EUA · Importados | BR · Pronta entrega** logo abaixo do topo, nas duas
vitrines, desktop e mobile, com a **transição do avião** (opção C aprovada em 17/08): o aviãozinho decola da bandeira ativa,
cruza a barra com rastro tracejado e pousa na outra (~0,7s), o bloco amarelo desliza junto; em paralelo `App.jsx#switchMode` faz
a página sair para um lado e a nova entrar pelo outro (EUA→BR desliza para a esquerda; BR→EUA para a direita), sobe ao topo.
`prefers-reduced-motion` → troca seca; clique novo cancela o anterior (token); numa aba oculta a troca acontece por timeout
(o navegador não dispara o "finish" da animação). No mobile é o mesmo voo, mais curto e com avião menor.

**Backoffice `/admin/estoque`** (`admin/Stock.jsx` lista · `admin/StockForm.jsx` cadastro/edição): nome, marca, **categoria**
(seletor Basquete / Casual / Corrida — obrigatória; coluna `category` = basketball|lifestyle|running; o rótulo vira o subtítulo
do card/hero), **modelagem** (Masculino / Feminino / Unissex / Infantil GS — coluna `gender` M|W|U|K), colorway, SKU Nike
(informativo), descrição (aparece no seletor de tamanho), selo do card, ordem, **preço Pix**, preço "de" riscado, **custo**
(só BO — alimenta custo/margem do dashboard via `breakdown.subtotalBrl`), ativo, **tamanhos BR + US da caixa + quantidade**
(chips de BR e US preenchidos pela tabela oficial Nike BR da modelagem escolhida; unissex: digita o US masc., o fem. sai +1,5),
**fotos** por upload (redimensiona no navegador p/ 1400px WebP → `POST /api/admin/stock/:id/images` → gravada no banco
`stock_images`, servida em `/media/estoque/:id` com cache imutável — não depende do volume) ou por URL; 1ª foto = capa.
Criar primeiro, enviar fotos depois (precisa do id).

**API:** `GET /api/stock` (público; sem custo/ids internos), `GET /api/product/PE-XXXXXX` (o catálogo intercepta o prefixo `PE-`
em `getProductSizes` e responde do banco → seletor e checkout funcionam sem mudanças), `GET /api/config`
(`{ whatsapp:{phone,url}|null, installments, stock, testProduct }`), admin `GET/POST /api/admin/stock`,
`GET/PATCH/DELETE /api/admin/stock/:id`, `POST /api/admin/stock/:id/images` (`{ dataUrl }`, bodyLimit 8 MB, JPEG/PNG/WebP ≤ 4 MB,
máx. 12 fotos). `code` PE-XXXXXX é o `styleColor` do item no carrinho/pedido; `nikeSize` = US da caixa (se informado) senão o BR.

**Estoque por tamanho (`stock_sizes`):** reservado na **criação do pedido** (decremento condicional `qty >= n` dentro da
transação — dois clientes disputando o último par: só um pedido é criado), **devolvido** quando o pedido vira `cancelled`/`abandoned`
(admin ou job de 30 min; `orders.stock_released_at` evita devolver 2×; evento `stock_released`) e **re-reservado** se um pedido
abandonado acabar pago (`settle()`/baixa manual; sem estoque → evento `stock_oversold` + nota interna para conferir). Estorno
(`refunded`) NÃO devolve sozinho — ajustar a qtd no painel. A frase "em até Nx" segue `MAX_INSTALLMENTS`.

### 5.2b Página própria do tênis de estoque — link para o Instagram (23/08)

Na **pronta entrega e nos hypados** clicar num par não abre mais o modal: vai para uma URL própria,
`/pronta-entrega/<slug>` ou `/hypados/<slug>` (ex. `lojakulture.com.br/pronta-entrega/nike-dunk-low-panda`). É o link que o
dono cola no Instagram. Importados continuam no modal (não têm página).
- **Slug** = coluna `stock_products.slug` (já existia, única). **Não muda ao renomear** o produto (antes mudava) — link publicado
  continua valendo. O code `PE-XXXXXX`/`HY-XXXXXX` também funciona na mesma posição e é redirecionado (replace) para o slug; se a
  seção da URL estiver errada (`/pronta-entrega/` num hypado) a URL é corrigida.
- **API:** `GET /api/stock/:ref` (slug ou code; só ativos; todos os tamanhos com `qty`/`available`; 404 "não está mais
  disponível"). `toPublic`/`toAdmin` ganharam `path` (`/pronta-entrega/<slug>`); `stockProductPath(p)` no service.
- **Preview do link (WhatsApp/DM):** `plugins/serve-web.js#productPageHtml` serve o `index.html` com `<title>`, `description`,
  `canonical` e Open Graph (`og:title` "Nome — R$ X no Pix | Kulture", `og:description`, `og:image` = 1ª foto absoluta,
  `og:url`, `product:price:*`) para essas URLs — responde HTML mesmo sem `Accept: text/html` (bots). Base da URL =
  `resolveWebUrl` (host do pedido na allowlist, senão `PUBLIC_WEB_URL`). Erro → index puro.
- **Front:** `pages/StockProduct.jsx` (rotas em `App.jsx`; a ModeBar some nessa página): breadcrumb, galeria (setas/thumbs),
  nome, preço Pix + parcelas + "de", descrição, grade de tamanhos só BR com quantidade ("último"/"N un."/"esgotado"),
  **Comprar agora** (sacola + checkout) e **Adicionar à sacola** (abre a sacola), Compartilhar/Copiar link (Web Share ou
  clipboard), faixa WhatsApp; esgotado/404 com estado próprio. `toCard` traz `href`; o card da vitrine vira `<a href>` "Ver o
  par" (Cmd/Ctrl-clique abre em nova aba) e o hero "Ver o par" navega. Admin: `/admin/estoque/:id` mostra a URL completa com
  botão **Copiar**; a lista tem "página ↗".
- Teste: `stock.test.js` (endpoint por slug/code, slug estável no rename, metas OG via `productPageHtml`).

### 5.3 WhatsApp "não achou? chama a gente" (17/08)

`components/WhatsappCta.jsx` — banner grande quando a busca dá vazio/erro e faixa compacta abaixo dos resultados (também na
pronta entrega), com mensagem pré-preenchida (inclui o termo buscado). Número vem de `WHATSAPP_CONTACT_PHONE` na api via
`/api/config` (`hooks/useSiteConfig.js`); se faltar, usa o do rodapé (`5585992578888`). A busca da Nike é "fuzzy" — quase nunca
volta vazia — por isso a faixa abaixo dos resultados é o ponto principal.

### 5.4 Tamanhos por modelagem — Masculino / Feminino / Infantil (18/08)

Antes o seletor mostrava "38 · US 7" sem dizer de quem era o US (nos unissex da Nike o mesmo par é `M 7 / W 8.5`; num feminino
"US 8" é W 8 = BR 37,5). O **BR não muda** com a modelagem — é a mesma numeração física; muda só o número US mostrado.
- `packages/shared/src/sizes`: `detectScale`, `parseUsSizes(nikeSize, localizedSize, genders)` → `{ scale: M|W|K, us: { M, W, K } }`
  (unissex sem W explícito: W = M + 1,5), `sizeGroupsOf`, `sizeLabel(size, group)` → `"BR 38 (US M 7)"` / `"BR 36 (US 5Y)"`,
  `standardSizes()` (tabela padrão, By You), tabelas oficiais Nike BR (M/W/K). Feminino fora da tabela oficial (W 4–4.5 e
  W 12.5–16) usa `WOMENS_APPROX` (19/08): BR aproximado contínuo (43,5–48), com selo "Aprox." no seletor.
- Catálogo: cada tamanho ganha `scale` + `us`; o produto ganha `sizeGroups` (Kobe/LeBron unissex → `["M","W"]`; Sabrina GS → `["K"]`).
- Seletor (`components/SizePicker.jsx`): **abas** Masculino / Feminino / Infantil quando há mais de uma modelagem (uma só →
  rótulo); botão mostra `US M 7` / `US W 8.5` / `US 5Y`; confirmar mostra o rótulo completo. Vai para a sacola
  `sizeInfo.pickedGender` + `sizeInfo.sizeLabel`.
- Checkout envia `sizeGender`; a api valida (só se o tamanho tem esse US) e grava `order_items.size_label`; sacola, checkout,
  `/conta`, confirmação, e-mails, WhatsApp e admin usam o rótulo (pedidos antigos caem no formato antigo "BR 41 (US 8.5)").
- Pronta entrega: modelagem no cadastro (§5.2); `usMapOf(gender, us)` no `stock/service.js` gera o mesmo formato.
- **23/08 (opção B do dono): escala feminina DERIVADA da masculina** (W = M + 1,5 → tabela masculina; `WOMENS_TABLE/APPROX`
  geradas de `MENS_*`). Motivo: as tabelas oficiais divergiam ±0,5 nas pontas e o mesmo par físico mostrava BR diferente
  conforme a Nike listava em M ou W (do 41 pra cima o feminino saía 0,5 acima — reclamação do dono). Agora W 10.5 = M 9 =
  BR 40,5 sempre; W 5 = 34; aproximado só de W 15 (M 13.5) em diante. Também no BR→US do cadastro (`StockForm`).
  Cache do catálogo virou `v8-*`. Pedidos antigos mantêm o rótulo da época.

**23/08 — o US não vaza mais para o cliente.** Regra do dono: o cliente só vê **numeração BR**; o US (modelagem) é informação
interna para comprar na Nike.
- Seletor: chips só com o BR (sem "US M 7" embaixo, sem selo "Aprox."), **sem abas** Masculino/Feminino (com BR-only as duas
  mostrariam a mesma grade); cabeçalho "Numeração BR"; confirmar mostra `BR 38`. Tamanho sem BR na tabela não entra na grade.
  O checkout não manda mais `sizeGender` → a api grava `size_label` pela escala do próprio SKU (`"BR 38 (US W 8.5)"` numa
  Sabrina, que a Nike lista em W) — continua com US para o backoffice.
- `sizeLabelBr(item)` (shared) → `"BR 38"`: usado na sacola/checkout/`/conta` (`format.js#sizeText`), nos e-mails ao cliente
  (`mailer.js`), no WhatsApp ao cliente (`formatMsg`; com `WHATSAPP_TO` = dono continua com US), no job de abandono e em
  `GET /api/orders/:number` e `/api/orders/mine` para não-admin (`clientOrderItem`: sem `nikeSize`, `sizeLabel` só BR).
  Admin (`/api/admin/*`, venda externa) segue com o rótulo completo.
- Tabelas: `WOMENS_APPROX` vai até W 19,5 (48,5–51,5, masculino + 0,5) e `MENS_APPROX` ganha os meios (14,5–17,5) — os
  "US M 15 / 17 / 18" da Sabrina 4 (W 16,5 / 18,5 / 19,5) agora têm BR. `standardSizes()` (By You) acima de 14 só inteiros.

### 5.5 Nike By You — customizados (18/08)

Produtos `productSubType: CUSTOMIZED` (URL `/u/custom-…`; "styleColor" = id numérico do design, ex. `1685956779`) não têm
SKU/tamanhos na API da Nike (`/product/:id` → 404 SIZES_UNAVAILABLE). Tratamento:
- `catalog/normalize.js`: `byYou: true` (`isByYou(raw)`); card com selo **BY YOU**. As fotos são o molde branco da Nike (a API
  não devolve a arte de cada design).
- `catalog.getProductSizes`: no 404, busca o produto pelo id do design (`findOne` — a busca da Nike acha por id) e devolve
  `sizes = standardSizes()` (tabela masculina completa + W = +1,5; `synthetic: true`, todos disponíveis), `sizeGroups: ["M","W"]`,
  `sizesSynthetic: true`, `customization: { textMax: 8, numberDigits: 2 }`. Preço = o da busca (mesma fórmula).
- Seletor: aviso "modelo customizável — escolha o seu número", abas M/W, e o box **Nike By You · personalize**: pé esquerdo e pé
  direito, cada um com **texto ≤ 8 caracteres** (letras, números, espaço e `. , ' & ! ? # -`; contador n/8) e **número de 2
  dígitos**. Opcional. Texto avisa que é sob encomenda na Nike (prazo maior) e que confirmamos tamanho e gravação antes de comprar.
- Checkout: `items[].customization = { textLeft, numberLeft, textRight, numberRight }` (validado na api; só em produto By You;
  texto > 8 → 400) → `order_items.customization` (Json). A sacola separa linhas por personalização (chave inclui os campos).
  E-mail/WhatsApp/admin mostram `By You · pé E “KULTURE” nº 08 · pé D “MAMBA” nº 24`; o admin mostra também o US para
  configurar na Nike.
- Prazo (23/08): **35 dias para entrega** (`format.js#BY_YOU_DELIVERY_DAYS`) — no card, logo abaixo do balão BY YOU
  (`.card-eta`), e no seletor (aviso do topo + nota do box de personalização). Sem limite de quantidade.

### 5.6b E-mail por SMTP + Marketing (23/08)

- **SMTP (nodemailer)**: `MAIL_PROVIDER=smtp` + `SMTP_HOST/PORT/SECURE/USER/PASS`, `MAIL_FROM(_NAME)`, `MAIL_REPLY_TO`
  (`mail/mailer.js#viaSmtp`, pool de 2 conexões, STARTTLS em 587). `mailer.verify()` faz o login real;
  `mailer.close()` no shutdown. Todos os e-mails (reset de senha, pago/enviado/entregue/cancelado, venda externa, campanhas)
  saem pelo mesmo `mailer.send`. Moldura HTML única preta/amarela (`emailLayout`), links clicáveis (`asHtml`).
  Receita em `docs/DEPLOY.md` §6c. A senha SMTP colada no chat em 23/08 deve ser **regenerada** no painel.
- **Marketing** (`modules/marketing`, tela `/admin/marketing`): campanha = assunto + mensagem em parágrafos + imagem e botão
  opcionais + público (`all` = contas com opt-in ∪ quem já comprou, incl. convidado · `buyers` · `accounts`) menos
  `marketing_unsubscribes`. Prévia (HTML real em iframe), "Enviar teste para mim", disparo com confirmação e progresso
  (`marketing_campaigns`: total/sent/failed/lastError; envio em segundo plano, 2 por vez; erro de autenticação aborta).
  Todo e-mail leva link de descadastro assinado (HMAC `JWT_SECRET`) `GET/POST /api/marketing/unsubscribe?e&t` (página HTML /
  one-click RFC 8058, `List-Unsubscribe` no cabeçalho) → grava o descadastro e desliga `users.marketing_opt_in`.
  `/conta` tem a caixa "quero receber novidades" (`PATCH /api/auth/me { marketingOptIn }`). Padrão: **opt-in ligado**
  (decisão a confirmar com o dono; LGPD exige o descadastro fácil, que existe).
  Endpoints admin: `GET /api/admin/mail/status`, `POST /api/admin/mail/test`, `GET /api/admin/marketing/audience`,
  `GET/POST /api/admin/marketing/campaigns`, `GET /…/campaigns/:id`, `POST /…/campaigns/:id/send`, `POST /…/preview`, `POST /…/test`.
  Migração `marketing` (users.marketing_opt_in, marketing_unsubscribes, marketing_campaigns). Teste: `marketing.test.js`.

### 5.6c Links públicos nunca com o domínio do Railway (23/08)

O e-mail de "esqueci minha senha" saiu com `https://kulture-api-production.up.railway.app/redefinir-senha?token=…` porque
`PUBLIC_WEB_URL` no Railway ainda apontava para o domínio gerado. Agora o código se defende (`lib/site-url.js`):
- `canonicalWebUrl(env)`: `PUBLIC_WEB_URL`, **exceto** se em produção for `*.railway.app`/localhost — aí usa o 1º host de
  `PUBLIC_WEB_HOSTS` (padrão `lojakulture.com.br`) com https. `publicWebUrlMisconfigured(env)` expõe o problema em
  `/health` (`siteUrl`, `publicWebUrlMisconfigured`), no log de boot e no card de e-mail de `/admin/marketing`.
- `resolveWebUrl(env, origin)`: origem do request (Origin/X-Forwarded-Host) só se estiver na allowlist; `*.railway.app`
  → canônica; `localhost` só se for exatamente o host:porta de `PUBLIC_WEB_URL` (em dev a api :3000 ≠ site :5173).
- Usado em: reset de senha (cliente e painel), redirect do pagamento, e-mail de pedido pago, venda externa, campanhas,
  descadastro, OG da página do tênis. Teste: `site-url.test.js`. **Mesmo assim, corrigir `PUBLIC_WEB_URL` no Railway.**

### 5.6d Rodada de 23/08 (tarde): ModeBar mobile, preços no painel, filtro por tamanho, cupons

- **ModeBar no celular**: com 3 abas, "IMPORTADOS" estourava a coluna (grid `1fr` não encolhe abaixo do conteúdo) e a
  faixa amarela cortava. Agora `repeat(3, minmax(0,1fr))` + no ≤640px bandeira em cima e nome embaixo (centralizado);
  breakpoint intermediário ≤900px. Conferido em 360/375/700px, transição avião/bola intacta.
- **Preços — `/admin/precos`** (pedido: "LeBron +300 virar feature"): acréscimos por tipo de tênis editáveis.
  Regras em `settings` "pricing_adjustments" (semente = LeBron 23 +R$300, que saiu do código); escopos
  nome-contém/SKU/marca/categoria, acréscimo em R$ e/ou % (novo `extraRate` no motor; acréscimos de regras
  diferentes SOMAM); regra global (fórmula) continua em `GLOBAL_PRICING_RULE`. O catálogo recebe as regras de um
  provider e o namespace do cache vira `v7-<versão das regras>` → salvar no painel vale NA HORA (sem esperar 60 min).
  Tela: fórmula explicada, lista de regras (ativa/nome/onde/termos/R$/%), "Testar com um tênis" (busca ao vivo mostrando
  o preço e quais regras bateram). API: GET/PUT `/api/admin/pricing`, GET `/api/admin/pricing/test?q=`.
  Módulo `modules/pricing`; testes `pricing.test.js` + shared.
- **Filtro por tamanho na pronta entrega/hypados**: chips "Tamanho BR" (só números com par disponível na categoria,
  com contagem no title), `?tam=41` na URL junto do `?cat=`; clicar de novo limpa; vazio → aviso + WhatsApp.
  Client-side (o `GET /api/stock` já traz sizes); `toCard` ganhou `sizesAvailable`.
- **Cupons de desconto**: tabela `coupons` + `orders.coupon_code/discount_brl` (migração `coupons`). Painel
  `/admin/cupons`: código, % (com teto) ou R$ fixo, mínimo de compra, validade, limite de usos, pausar/editar/remover.
  Sacola: campo "Cupom de desconto" antes de finalizar (valida em `POST /api/coupons/validate`, mostra desconto e novo
  total; revalida quando o total muda); checkout manda `coupon` e o SERVIDOR recalcula (`applyForCheckout` → 400 com
  motivo se não valer); `usedCount` só sobe quando o pedido é PAGO (settle; idempotente). Desconto aparece no checkout,
  na visão pública, no admin (Pagamento) e nos e-mails (pago/registrado). Módulo `modules/coupons`; teste `coupons.test.js`.

### 5.7 Etapas de rastreio do pedido (23/08)

Status novos `in_transit` e `arrived_br` (migração `order_stages`). Fonte única: `modules/orders/status.js`
(`ORDER_STATUS_LABELS`, `ORDER_STAGES`, `ORDER_TRANSITIONS`, `PAID_STATUSES`, `TO_SHIP_STATUSES`, `isInternationalOrder`).
- Importado: **Pagamento aprovado → Pedido comprado → Em trânsito internacional → Chegou no Brasil → Enviado pro seu
  endereço → Entregue**. Pronta entrega/hypados (`order.international === false`, calculado pelos itens): só
  Pagamento aprovado → Enviado → Entregue. Pode pular etapas para a frente; nunca voltar; entregue só depois de enviado.
- Cada etapa intermediária manda e-mail (`buildOrderStageEmail`: comprado 🛒 / em trânsito ✈️ / chegou 🇧🇷), com
  `notifyCustomer:false` para silenciar; reenvio em `/resend-email` com `kind` = etapa.
- Front: `components/OrderTimeline.jsx` (Rastrear pedido no AuthModal + "Meus pedidos", versão compacta); painel: rótulos
  em `admin/ui.jsx` (`TO_SHIP`, `NEXT_STAGE`), fila de entregas com botão da próxima etapa, dashboard, venda externa.
  Teste: `order-stages.test.js`.

### 5.8 Nota fiscal do pedido — manual hoje, Bling depois (23/08)

Tabela `order_invoices` (1 por pedido; PDF/XML no banco; `source` manual|bling; número/série/chave/emissão; `sentAt/sentTo`).
- Painel → detalhe do pedido → card **Nota fiscal**: anexar PDF (DANFE) + XML opcional + dados; **Enviar ao cliente por
  e-mail** (PDF/XML anexos, `buildInvoiceEmail`, evento `email_invoice`, resultado honesto do provedor); baixar; substituir;
  remover. Rotas em `modules/invoices/routes.js` (`/api/admin/orders/:number/invoice[.pdf|.xml|/send]`).
- Cliente: "Meus pedidos" mostra "Nota fiscal nº X · Baixar PDF" (`GET /api/orders/:number/invoice.pdf`, dono do pedido
  por id ou e-mail, ou admin; convidado não vê). Mailer ganhou `attachments` (SMTP e API da MailerSend).
- **Bling (automático)**: gancho `invoices.issueAutomatically(order)` + env `BLING_CLIENT_ID/SECRET` (vazios = manual).
  Falta: app no Bling (OAuth2 authorization code + refresh), cadastro do contato/produto, `POST /nfe` + `/nfe/{id}/enviar`,
  consulta de status (autorizada/rejeitada), download do DANFE/XML, disparo após `paid` (settle) e tela de erros.
  Teste do manual: `invoices.test.js`.

### 5.6 Filtros por categoria respeitam a seção (18/08)

Basquete / Casual / Corrida (abas do topo, blocos de categoria, links do rodapé): **na pronta entrega filtram o estoque**
(`/pronta-entrega?cat=basketball|lifestyle|running`) e a página não muda; **nos importados buscam na Nike** e ficam em `/`.
"Início" na pronta entrega limpa o filtro (fica na seção). Chips "Todos · Basquete · Casual · Corrida" (com contagem) acima da
lista, também no mobile; título/kicker seguem o filtro; categoria sem par mostra aviso + WhatsApp. Centralizado em
`App.jsx#pickCategory`; `CATEGORIES` em `lib/format.js` (mesmas 3 chaves do cadastro); a aba ativa do topo segue a URL.
A caixa de busca "Buscar modelo" continua indo para os importados (é busca na Nike) — possível melhoria: filtrar o estoque por
nome quando estiver na pronta entrega.

### 5.7 Venda externa — venda feita fora do site registrada no painel (19/08)

Vendas fechadas no WhatsApp/Instagram/presencialmente entram como **pedido normal, já pago**, na mesma tabela `orders`:
o cliente acompanha em `/conta` → "Meus pedidos" (vinculado pelo e-mail — se já tem conta, `userId`; se não, aparece quando
criar a conta com o mesmo e-mail, porque `listMine` casa por `customerEmail`) e em "Rastrear pedido" pelo número; o admin vê
em Pedidos / Entregas / Clientes; a receita entra no dashboard (separada por canal).

- **Tela `/admin/pedidos/nova`** (`admin/ManualOrder.jsx`; botão "+ Venda externa" em Pedidos e no Dashboard): cliente (busca
  cliente cadastrado → preenche; ou digita; **e-mail obrigatório**, CPF opcional; CEP via ViaCEP), itens (abas **Pronta entrega**
  — produto + tamanho do estoque, preço/custo do cadastro, checkbox "baixar do estoque"; **Nike (importado)** — busca por SKU/nome
  em `GET /api/admin/catalog/:term` (admin-only, devolve o produto COM breakdown e todos os tamanhos) e preenche nome/foto/preço
  do site/custo estimado/tamanhos por modelagem; **Outro** — tudo à mão), qtd/preço/custo editáveis na linha, desconto, forma de
  pagamento (Pix / cartão crédito c/ parcelas / débito / dinheiro / transferência / outro), valor recebido (padrão = total), data do
  pagamento, referência (NSU/ID Pix) e link do comprovante, canal (WhatsApp / Instagram / Presencial / Outro), situação inicial
  (Pago / Comprando nos EUA / Enviado / Entregue — com transportadora/rastreio), observação (histórico), notas internas, checkbox
  "avisar o cliente por e-mail". Resumo com total/custo/margem. Ao registrar, abre o detalhe do pedido.
- **API:** `POST /api/admin/orders` → `admin.createManualOrder(body, admin)` (201 + detalhe). Grava `paymentProvider="manual"`,
  `channel` (nova coluna `orders.channel`, default `site`), `paidAt`, `paidAmountBrl` (entra na receita), `installments` (só cartão),
  `transactionNsu`=referência, `receiptUrl`, `pricingSnapshot={manual,channel,discountBrl,registeredBy}`, `exchangeRate` só
  informativo (0 se o câmbio falhar). Itens de estoque: `breakdown={source:"stock",manual:true,stockProductId,stockSizeId,
  stockDeducted,subtotalBrl=custo}` e reserva via `stock.reserve()` na mesma transação (sem estoque → **409 STOCK_OUT** com
  mensagem para ajustar a qtd ou desmarcar "baixar do estoque"); cancelar/estornar depois segue o fluxo normal (cancelado devolve
  o par). Importado/livre: `breakdown={source:"import"|"manual",manual:true,subtotalBrl=custo}` — custo alimenta custo/margem do
  dashboard como no checkout. Rótulo do tamanho pelo `sizeLabel` do shared (`BR 41 (US W 10.5)` etc.). Eventos: `created`
  (`manual:true`, canal, admin), `payment_registered`, `stock_reserved`, `status_changed`/`tracking_updated` quando já entra
  enviado/entregue, `note`, `email_registered`. Inativos da pronta entrega também podem ser vendidos
  (`getProductByCode(code,{includeInactive:true})`).
- **E-mail** `buildOrderRegisteredEmail` ("Pedido … registrado — Kulture"): itens, total, forma, situação, rastreio e como
  acompanhar (`/conta` com o mesmo e-mail ou Rastrear pedido). "Reenviar e-mail" no detalhe usa esse modelo em venda externa
  (`kind=registered`, ou `paid` quando `paymentProvider=manual`). "Reconsultar pagamento" → 400 em venda externa.
- **Lista/detalhe/dashboard:** `GET /api/admin/orders?channel=site|external|whatsapp,…`; linhas com selo **externa · Canal**
  (`ChannelPill`, `pill.external`); filtro "Canal: Todos · Site · Vendas externas"; detalhe mostra canal/quem registrou, desconto,
  "Referência" no lugar de NSU, sem slug, câmbio oculto quando 0. Dashboard: `byChannel` (receita e nº por canal), tile "Pedidos
  pagos" com "N pelo site · M externa(s) (R$)", `totals.externalRevenueBrl/externalOrders/siteRevenueBrl/siteOrders`,
  `byPaymentMethod` com as formas novas (`paymentMethodLabels`). `/api/admin/me` expõe `channelLabels`, `manualChannels`,
  `manualPaymentMethods`, `manualInitialStatuses`, `paymentMethodLabels`.
- Testes: `apps/api/test/manual-order.test.js` (7) — validação, venda com estoque+importado+livre (baixa, e-mail, vínculo por
  e-mail, cliente vê em /mine e no público), filtros/dashboard por canal, 409 STOCK_OUT e `deductStock:false`, venda antiga já
  entregue + reenvio, catálogo admin.

### 5.8 HYPADOS + Vitrine (hero configurável) — 20/08

**HYPADOS** — terceira seção da loja, para os drops mais quentes. Funciona EXATAMENTE como a pronta entrega
(estoque próprio no Brasil, reserva por tamanho, fotos no banco, checkout igual): é o mesmo módulo `stock` com a
coluna `stock_products.section` (`stock` | `hypados`); códigos ganham prefixo **HY-** (o catálogo/checkout/venda
externa interceptam `PE-|HY-` — `STOCK_CODE_RE`). `GET /api/stock?section=hypados` (público),
`GET /api/admin/stock?section=` (painel), POST aceita `section`. `breakdown.section` no item do pedido → o admin
mostra "HYPADOS" em vez de "PRONTA ENTREGA"; card usa selo padrão "HYPADOS"; SizePicker "Hypados · pronta entrega".

- **Página `/hypados`**: mesma `pages/Stock.jsx` parametrizada (`section`), textos próprios ("HYPADOS", "os drops
  mais quentes"), filtros por categoria (?cat=) iguais aos da pronta entrega.
- **ModeBar** (3 abas): EUA · Importados | BR · Pronta entrega | 🏀 Hypados. Logo do Hypados = **bola de basquete
  amarela Kulture em chip preto** (SVG inline, `mode-flag.ballchip`). Transição: **bola quicando** da aba ativa até
  a de destino sempre que entra/sai do Hypados (3 quiques decrescentes, girando, squash no contato, ~850ms, WAAPI);
  EUA ⇄ BR continua com o avião + rastro. Deslize da página segue a ordem das abas (leste/oeste);
  `prefers-reduced-motion` → troca seca. No mobile o subtítulo das abas some (3 abas em ~375px).
- **Backoffice `/admin/hypados`**: `admin/Stock.jsx` + `StockForm.jsx` parametrizados por `section`
  (`SECTION_UI`) — mesma tela da pronta entrega com nome/links do Hypados; cadastro grava `section: "hypados"`.
- **Vitrine (`/admin/vitrine`, `admin/Featured.jsx`)** — o tênis do HERO é configurável por seção × categoria
  (12 slots: import|stock|hypados × Início/Basquete/Casual/Corrida). Importados: SKU Nike com busca/validação
  (`GET /api/admin/catalog/:term`); Pronta entrega/Hypados: select de produto cadastrado NA MESMA seção (validado
  no save). Config na tabela **`settings`** (key `featured`). `GET /api/featured?section=&cat=` resolve ao vivo
  (categoria sem slot cai no "Início" da seção; produto sumido/desativado → `product: null` e o site usa o
  automático = 1º da lista, comportamento antigo). Na home dos importados, as abas Basquete/Casual/Corrida (busca
  "basketball shoes" etc.) mostram o destaque da categoria; busca livre continua sem hero de produto.
- Testes: `apps/api/test/hypados.test.js` (5) — HY- no CRUD/checkout/reserva, separação das seções no público,
  validações da vitrine e resolução com fallback.

---

## 6. Banco (Prisma / Postgres)

Tabelas: `cache_entries, users (+ marketing_opt_in), refresh_tokens, password_reset_tokens, login_events, orders (com carrier/tracking_*/shipped_at/
delivered_at/cancelled_at/refunded_at/internal_notes/stock_released_at/channel), order_items (+ size_label, customization),
order_events, notifications, idempotency_keys, stock_products (+ category, gender, section), stock_sizes, stock_images,
settings (key→JSON; hoje "featured" = vitrine), marketing_unsubscribes, marketing_campaigns (+ errors, provider), order_invoices`.
Enum `OrderStatus` ganhou `in_transit` e `arrived_br`.
Migrações: `init, auth, orders, user_profile, admin_backoffice, login_events, stock_products, stock_category, size_genders,
by_you_customization, order_channel, stock_section_settings, marketing, marketing_errors, order_stages, order_invoices` —
aplicadas no boot da api (`migrate deploy`).
Dev local: `apps/api/.env` aponta para Supabase (pooler us-east-2; `DIRECT_URL` para migrar), já migrado; seed de demonstração
(`*@smoke.kulture.test`, admin `admin@smoke.kulture.test`, pedidos `KLT-2026-9*`). Os produtos de pronta entrega criados para
teste nesta sessão foram removidos — o estoque de dev está vazio.

---

## 7. Pendências (ordem sugerida)

1. Liberar o push pendente (§3 — venda externa) → ajustar variáveis (§4, incl. `WHATSAPP_CONTACT_PHONE`) → confirmar **12x vs 5x**
   → cadastrar os primeiros pares em `/admin/estoque` (categoria + modelagem) → fazer um pagamento **no cartão parcelado** e
   conferir "juros repassados" no `/admin` → registrar uma **venda externa** de teste em `/admin/pedidos/nova` e conferir no
   `/conta` do cliente e no dashboard.
2. Se quiser: busca "Buscar modelo" filtrando o estoque quando estiver na pronta entrega; aviso "arte ilustrativa" nos cards By You;
   prazo específico no texto do By You; gesto de arrastar (swipe) entre as seções no celular; na venda externa, editar itens
   depois de registrada (hoje só status/rastreio/notas — para corrigir, cancelar e registrar de novo).
3. `www.lojakulture.com.br` (CNAME no Cloudflare + custom domain no Railway) — se quiser.
4. Rotacionar segredos; `TEST_PRODUCT_ENABLED=false` após validar o gateway.
5. Tradução PT→EN na busca ("tênis" → "shoes") — não feita.
6. Admin: regras de preço editáveis (tabela PricingRule) — hoje só em código.
7. Bling (NF-e) → WhatsApp de notificação (Evolution API) — adiados.
8. Testes de auth/admin/orders/stock/byyou batem no banco real (separar em CI).

---

## 8. Comandos

```bash
npm install && npm run dev            # web :5173, api :3000, scraper :3001
npm test                              # api 62 + shared 27 (api precisa do DATABASE_URL de dev)
npm run build -w apps/web
curl -s https://lojakulture.com.br/health
curl -s https://lojakulture.com.br/health/deps
curl -s https://lojakulture.com.br/api/config     # whatsapp/installments/stock
curl -s https://lojakulture.com.br/api/stock      # pronta entrega (público); ?section=hypados = hypados
curl -s "https://lojakulture.com.br/api/featured?section=import"   # vitrine (hero configurado; null = automático)
```

Prompt-padrão do Antigravity: conferir `git status --short` (sem `.env`/storage/dist; se aparecer algo inesperado, PARAR),
`git add -A`, commit com a mensagem dada, `git push origin main`, devolver `git rev-parse --short HEAD`.
