# Kulture BR — Plano de evolução (Etapa 1: backend robusto)

> Projeto **100% local**. Nenhum serviço externo obrigatório além das fontes de dados já usadas
> (Nike US não-oficial, AwesomeAPI). Integrações comerciais (InfinitePay/CloudWalk, Bling) começam como **mock**.

Decisões tomadas em 2026-08-15:

| # | Decisão | Escolha |
|---|---|---|
| 1 | Frontend que segue | **React/Vite** (origem: `Projetos Trae/BuscadorTenis`), migrando o visual do esboço vanilla |
| 2 | Regra de preço | **30% comissão + frete + imposto**, modular por produto/faixa (ver §4) |
| 3 | Checkout | **Convidado liberado**, carrinho mesclado ao logar |
| 4 | Banco / repo | **Postgres no Supabase** (Prisma); SQLite ficou só como histórico. **Um único repo git** em `~/Desktop/KULTURE` com npm workspaces |
| 5 | `kulture-api/` residual | Apagado na Fase 0 |
| 6 | Gateway | **InfinitePay (CloudWalk)**; "Mercado Pago" sai do site |
| 7 | Bling | **Mock** por enquanto (adapter real atrás de flag quando houver app registrado) |

---

## 1. Arquitetura alvo

```
KULTURE/                         (git, npm workspaces)
├─ apps/
│  ├─ web/                       React + Vite + Tailwind (ex-BuscadorTenis)  :5173  → proxy /api,/media → :3000
│  └─ api/                       "kulture-core": Fastify + Prisma/Postgres(Supabase) :3000
│       src/modules/
│         catalog/               busca, detalhe, filtro tênis, cache SWR, espelho de imagens
│         pricing/               regras de preço modulares (§4)
│         auth/                  register/login/refresh/me
│         cart/                  carrinho guest + usuário
│         orders/                pedidos + máquina de estados + checkout
│         payments/              PaymentGateway → InfinitePayMock | InfinitePay
│         invoices/              InvoiceProvider → BlingMock | Bling
│         jobs/                  fila in-process persistida em SQLite (retry/backoff)
│         admin/                 rotas de operação (role admin)
├─ services/
│  └─ nike-scraper/              ex-"kulture-api 2": SÓ fala com a Nike, devolve USD cru   :3001
├─ packages/
│  └─ shared/                    schemas Zod, tipos, motor de precificação (puro, testado)
└─ docs/                         este plano + referências (site vanilla, esboço, plano antigo)
```

**Por que o scraper continua um processo separado:** é a peça frágil (endpoint não-oficial da Nike, risco de 403 / mudança de formato). Isolado, ele não derruba auth/checkout. Todo o resto é um **monólito modular** com um único banco.

**Fluxo de uma busca:** navegador → `apps/api /api/search?q=` → normaliza query (PT→EN, acentos) → cache SQLite (SWR 1h, stale 24h, single-flight) → `nike-scraper /search` → filtro **só tênis** → precificação (§4) → espelho de imagem → resposta.

---

## 2. Módulos e endpoints

### 2.1 Catálogo (`catalog` + `nike-scraper`)
- `nike-scraper` passa a preservar `productType`, `productSubType`, `gender`, slug e **não converte preço** (só USD).
- Novo endpoint no scraper: `GET /product/:styleColor` → tamanhos (US/BR), disponibilidade por SKU, galeria de imagens.
- **Filtro tênis** (no core, testável): `productType === 'FOOTWEAR'` → allowlist de subtipos → denylist de palavras (`polo`, `sock`, `bag`, `jersey`, `shirt`, `short`, `hoodie`…) → heurística por URL/subtítulo (`-shoes`) só como último recurso.
- **Query normalizer**: minúsculas, sem acento, dicionário PT→EN (`tênis`→`shoes`, `basquete`→`basketball`, `corrida`→`running`, `infantil`→`kids`, `feminino`→`women`…). Categorias do site viram termos fixos.
- Cache: tabelas `product_cache` e `exchange_rate` (SWR + single-flight, sobrevive a restart). Imagens continuam espelhadas em `apps/api/storage/produtos/<styleColor>/` (permanente, fora do git).
- Endpoints: `GET /api/search`, `GET /api/products/top8`, `GET /api/product/:styleColor`, `GET /media/produtos/*`.

### 2.2 Auth
- `POST /api/auth/register|login|refresh|logout`, `GET /api/auth/me`.
- `users` (email único, hash **argon2**, nome, cpf opcional, role `customer|admin`), `refresh_tokens` (rotação + revogação).
- JWT de acesso curto (15 min) + refresh em cookie `httpOnly SameSite=Lax`; CSRF token para mutações; rate limit no login.

### 2.3 Carrinho
- Guest via cookie `cart_id`; **merge** no login. Item = `styleColor + tamanho` (nunca nome).
- Snapshot de preço/câmbio/breakdown no add; recálculo no checkout com aviso se variar acima de `PRICE_DRIFT_ALERT_PCT`.
- `GET/POST /api/cart`, `PATCH/DELETE /api/cart/items/:id`.

### 2.4 Pedidos & checkout
- Estados: `pending_payment → paid → invoicing → invoiced → sourcing → shipped → delivered`; laterais `cancelled`, `refunded`. Cada transição em `order_events`.
- Pedido congela endereço, **CPF** (exigido no checkout, não no cadastro), itens, breakdown, câmbio e regras aplicadas.
- `POST /api/orders` com `Idempotency-Key`; `GET /api/orders`, `GET /api/orders/:id`.

### 2.5 Pagamento — InfinitePay (CloudWalk)
- Interface `PaymentGateway { createCheckout(order), getStatus(id), parseWebhook(req) }`.
- `InfinitePayMockGateway`: gera link para página local `/mock/infinitepay/:id` (Aprovar / Recusar / Expirar) que dispara `POST /api/webhooks/infinitepay`.
- Webhook idempotente (`payment_events.event_id` único) → só enfileira job → job muda status → dispara job de NF.
- Nunca guardamos dado de cartão (checkout hospedado). `PAYMENT_PROVIDER=mock|infinitepay`.

### 2.6 Nota fiscal — Bling API v3
- Interface `InvoiceProvider { issue(order) }`; `BlingMockProvider` agora; `BlingProvider` atrás de `INVOICE_PROVIDER=bling`.
- Fluxo real previsto: OAuth2 authorization code (tokens em `integration_tokens`, criptografados, refresh automático) → upsert contato → upsert produto (SKU/NCM) → pedido de venda → gerar + enviar NF-e → salvar número/chave/PDF em `invoices`.
- Executa como job com retry/backoff (limite ~3 req/s da Bling).
- ⚠️ Definições fiscais com contador (NCM 6403/6404, CFOP, origem da mercadoria, tratamento da comissão) — parametrizáveis no mock.

### 2.7 Transversal
- `.env` validado por Zod na subida; erros `{ code, message, details }`; pino + request-id; `/health`; OpenAPI em `/docs`; vitest + supertest.
- `jobs` (tabela SQLite + worker in-process, `attempts`, `run_at`, backoff exponencial).
- Admin mínimo (role admin): listar pedidos, forçar transição, reprocessar job de NF, editar regras de preço.

---

## 3. Modelo de dados (Prisma / Postgres no Supabase)

`User` · `RefreshToken` · `ProductCache` · `ExchangeRate` · `PricingRule` · `Cart` · `CartItem` · `Address` · `Order` · `OrderItem` · `OrderEvent` · `Payment` · `PaymentEvent` · `Invoice` · `IntegrationToken` · `Job` · `IdempotencyKey`

---

## 4. Motor de precificação (modular)

Regra base (decisão 2): **comissão 30% + frete de redirecionamento (USD) + imposto de importação + taxa de pagamento**, mas cada componente pode ser sobrescrito por escopo. Comissão pode ser **por faixa de preço** (tênis mais caro → comissão menor).

```jsonc
// PricingRule (tabela; também aceito em config/pricing.rules.json para seed)
{
  "id": "default",
  "scope": "global",              // global | brand | category | model | sku
  "match": null,                  // ex.: "Nike" | "basketball" | /kobe/i | "IH1401-100"
  "priority": 0,                  // maior vence; sku > model > category > brand > global
  "commission": {                 // OU "rate": 0.30 fixo
    "tiers": [
      { "upToUsd": 150,  "rate": 0.30 },
      { "upToUsd": 250,  "rate": 0.25 },
      { "upToUsd": null, "rate": 0.20 }
    ]
  },
  "shippingUsd": 15,
  "importDutyRate": 0.60,         // sobre (produto + frete) — ajustar com contador
  "icmsRate": 0.17,
  "paymentFeeRate": 0.0,
  "roundTo": 0.9                  // opcional: R$ x.90 psicológico
}
```

Resolução: coleta todas as regras cujo `match` bate no produto, ordena por `priority`, faz merge campo a campo (a mais específica sobrescreve só o que define). O cálculo é **função pura** em `packages/shared/pricing` (evolução do `calculateFinalPrice` do BuscadorTenis), com testes, e devolve o breakdown completo que a UI mostra (pilar "preço transparente").

Fórmula: `subtotalUsd = produto + frete` → `×câmbio` → `imposto = subtotalBrl × importDuty` → `icms` → `taxa` → `comissão = tier(preçoUsd) × (subtotal + imposto + icms + taxa)` → `final = soma` → `roundTo`.

---

## 5. Fases

| Fase | Entrega | Pronto quando |
|---|---|---|
| **0** | Repo git único, workspaces, `services/nike-scraper`, `apps/api` (Fastify + Prisma/Postgres Supabase) com paridade das rotas do BFF antigo, `apps/web` copiado, `packages/shared`, `.env.example`, `kulture-api/` removido | `npm run dev` sobe web+api+scraper; `/health` ok; rotas antigas respondem |
| **1** | Filtro tênis + query PT→EN + `productType` no scraper + detalhe do produto (tamanhos) + motor de preço modular + cache em SQLite | busca "tênis" só devolve calçado; testes do filtro e do pricing |
| **2** | Auth | registro/login/refresh/me com testes |
| **3** | Carrinho guest + merge, por styleColor+tamanho | fluxo add → login → carrinho preservado |
| **4** | Pedidos + checkout + InfinitePay mock + webhook + jobs | pedido chega a `paid` pela página de simulação |
| **5** | Bling mock; adapter real atrás de flag | job gera NF (mock) após `paid`; retry funciona |
| **6** | Telas React (busca, produto com breakdown, carrinho, checkout, pedidos, login) + admin mínimo | jornada completa no navegador |

---

## 6. Riscos e avisos
- Endpoints da Nike são não-oficiais: manter volume baixo (cache), URL/headers em `.env`, `normalize()` defensivo. Ter fallback documentado (README do scraper).
- Preço final depende de política fiscal real (imposto de importação, ICMS) — hoje parametrizado, validar com contador antes de vender.
- `storage/produtos/` (~130 MB de imagens) fica **fora do git**.
