# Kulture BR — Contexto de handoff (consolidado até 23/08/2026, fim do dia)

> Documento para retomar o trabalho em qualquer ferramenta (Claude Code, Antigravity, TRAE) sem depender do
> histórico da conversa. **Sem segredos** — tokens/senhas ficam só nos `.env` (fora do git) e no painel do Railway.
> Substitui os handoffs anteriores (15–18/08) e incorpora as sessões de 19–23/08.

---

## 1. Produto e regras fixas do dono

**Kulture BR** — loja de tênis Nike US em `https://lojakulture.com.br`. **Três seções** (abas nesta ordem):

| Aba | Rota | O que é | Cor/selo |
|---|---|---|---|
| **EUA · Importados** | `/` | busca ao vivo na Nike US, sob encomenda | amarelo |
| **Hypados** 🏀 | `/hypados` | difíceis de achar, **garimpados nos EUA pelos contatos Kulture** e importados sob encomenda (cadastrados no backoffice; NÃO estão no Brasil) | **roxo** `--purple #B58CFF` |
| **BR · Pronta entrega** | `/pronta-entrega` | estoque próprio no Brasil, envio imediato | verde |

Cliente busca/escolhe, seleciona tamanho em **numeração BR**, sacola → cupom (opcional) → **InfinitePay** (link) →
confirmação. Checkout como convidado ou logado (pode criar conta no próprio carrinho).

Regras que não voltam a ser discutidas:
- **Preço em BRL fechado, frete embutido** (se aparecer, "Grátis").
- **Breakdown de preço nunca sai na API pública** — só `price.brl`, `fullBrl`, `exchange.usdToBrl`, `pix`, `installments.label`.
- **O número US NUNCA aparece para o cliente** (decisão 23/08): seletor/sacola/checkout/e-mails/API pública só com
  `BR 38`. O US fica no `order_items.size_label` interno ("BR 38 (US W 8.5)") para o dono comprar na Nike.
- **Escala feminina derivada da masculina** (23/08, opção B do dono): W = M + 1,5 → tabela masculina; mesmo par físico
  = mesmo BR (o feminino não sai mais 0,5 acima do 41; W 5 = 34). Pedidos antigos mantêm o rótulo da época.
- E-mail: **MailerSend** (`MAIL_PROVIDER=mailersend`, token de API; provedor `smtp` também existe). Gateway: **InfinitePay**.
- WhatsApp de notificação (Evolution): adiado (`WHATSAPP_PROVIDER=log`). O WhatsApp de **atendimento** está em toda parte (§5.9).
- Claude Code **não commita nem faz push**; o dono libera cada push via prompt no Antigravity. O dono **testa a UI ele mesmo**.

### Precificação dos importados (no ar; acréscimos editáveis no painel desde 23/08)

```
Preço Pix = arredondar↑ até …99 ( [ (USD × 1,07 + 65) × dólar TURISMO ] × 1,30  + acréscimos )
```
- Fórmula base em código (`GLOBAL_PRICING_RULE`, packages/shared/src/pricing): 7% sobre o tênis, frete US$ 65,
  comissão 30%, dólar turismo (AwesomeAPI `USD-BRLT` ask; fallback comercial + R$ 0,25), arredonda ↑…99.
- **Acréscimos por tipo de tênis: editáveis em `/admin/precos`** (settings `pricing_adjustments`; semente =
  LeBron 23 +R$300, que saiu do código). Escopos: nome-contém / SKU exato / marca / categoria; **+R$ e/ou +%**
  (acréscimos de regras diferentes SOMAM; ficam fora da comissão, dentro do ↑…99 — usar múltiplos de 100 mantém o …99).
  "Testar com um tênis" busca ao vivo e mostra o que bateu. **Salvou → vale na hora**: o namespace do cache do
  catálogo é `v8-<versão das regras>` (versão = updated_at do settings) → chaves novas, preço recalculado.
- Pronta entrega/hypados NÃO usam a fórmula (preço digitado no cadastro). `test123test` (R$ 1,00) fora de tudo.
- Site mostra o preço grande **sem selo "no Pix"** (selo removido em 27/08 — card, seletor, hero, página do tênis,
  título/OG/compartilhar) + a frase **"ou em até Nx no cartão com juros"** em destaque maior (`MAX_INSTALLMENTS`, hoje 12).
  "Total no Pix" segue na sacola/checkout e o backoffice continua pedindo o "preço no Pix".

---

## 2. Código e forma de trabalhar

- **Repo:** `~/Desktop/KULTURE` → GitHub `waltermachado/KULTURE`, branch `main`.
- Monorepo npm workspaces:

```
apps/web               React 19 + Vite (kulture.css + admin.css)                              dev :5173
apps/api               Fastify 5 + Prisma 6/Postgres; em prod serve o front (apps/web/dist)   :3000
services/nike-scraper  Express — único que fala com a Nike US                                  :3001 (privado)
packages/shared        pricing/ (motor + regra global + semente LeBron) · sizes/ (US↔BR)
deploy/  docs/         Dockerfiles, DEPLOY.md (Railway; §6b InfinitePay; §6c e-mail), CONTEXTO.md (este), MAPA-2026-08-23.md
```

- **Fluxo:** Claude Code implementa/valida (curl, testes, build; nada de fluxos longos no navegador embutido; nunca o
  Chrome do dono) e entrega um prompt para o **Antigravity**: conferir `git status --short` (sem `.env`/storage/dist;
  inesperado → PARAR), `git add -A`, commit com a mensagem dada, `git push origin main`, devolver o hash.
- Módulos da api (`apps/api/src/modules`): `catalog`, `stock`, `orders` (+ `orders/status.js` = fonte única de status),
  `admin`, `auth`, `mail`, `marketing`, `invoices` (NF-e manual), `bling` (OAuth), `pricing` (acréscimos), `coupons`,
  `featured` (vitrine), `payments`, `config`, `health`, `jobs`, `notifications`. Libs: `lib/site-url.js` (URLs públicas).

## 3. Estado do git (27/08)

- **No GitHub: `8dbb4ba`** (23/08; produção no Railway rodando a partir dele).
- **Pendente de push (27/08)** — bloco "sem no Pix + parcelamento com juros em destaque": rótulo da api vira
  `em até Nx no cartão com juros` (normalize/config + testes), selo "no Pix" removido do card, seletor, hero,
  página da pronta entrega, título da aba/compartilhar e Open Graph (`serve-web.js`), frase do parcelamento maior
  (card 15px, seletor `.sp-inst`, página 16px, hero 15px, sacola 0.95rem), campo `pix` morto removido do `toCard`.
  Validado: app 7/7 e stock 11/11 isolados, shared 32/32, build ok.
- Testes: **shared 32/32** · **api: 17 arquivos** (app, swr-cache, auth, orders, admin, stock, byyou, hypados,
  manual-order, marketing, site-url, order-stages, invoices, pricing, coupons, bling, infinitepay) — todos verdes na
  última execução. A suíte completa da api leva ~8 min (banco de dev remoto; `fileParallelism: false`) e ocasionalmente
  um arquivo falha por instabilidade do pooler do Supabase — rodar o arquivo isolado confirma.
- `npm run build -w apps/web` ok.

## 4. Deploy — Railway (projeto "glorious-trust", production)

```
Internet ──► kulture-api (público, lojakulture.com.br)  serve apps/web/dist + /api + /media
                 ├► kulture-scraper (rede privada)  http://kulture-scraper.railway.internal:3001
                 └► Postgres (plugin)               DATABASE_URL
```

- **`PUBLIC_WEB_URL`/`PUBLIC_API_URL` = `https://lojakulture.com.br` (corrigidos em 23/08)** — `/health` confirma
  `siteUrl` e `publicWebUrlMisconfigured:false`. Mesmo se errarem de novo, `lib/site-url.js` garante que **nenhum link
  para o cliente sai com o domínio `*.railway.app`** (reset de senha, redirect de pagamento, e-mails, descadastro, OG).
- **E-mail ativo**: `MAIL_PROVIDER=mailersend` + `MAILERSEND_API_TOKEN` + `MAIL_FROM=contato@lojakulture.com.br`
  (domínio verificado) + `MAIL_FROM_NAME=Kulture BR` (`MAIL_REPLY_TO` opcional). Alternativa `smtp` (`SMTP_*`) existe.
- **Bling**: `BLING_CLIENT_ID`/`BLING_CLIENT_SECRET` no Railway; o app no Bling precisa do link de redirecionamento
  **exatamente** `https://lojakulture.com.br/api/bling/callback` e escopos de NF-e (+ Contatos/Produtos).
- Demais variáveis como antes: `SCRAPER_URL` interno, `INFINITEPAY_HANDLE`, `TOP8_TERMS`, caches, JWT, `ADMIN_EMAILS`,
  `WHATSAPP_CONTACT_PHONE`, `RATE_TOURISM_SPREAD_BRL=0.25`; scraper com `NIKE_*` e caches próprios.
- Diagnóstico: `curl …/health` (providers, siteUrl, storageWritable) e `…/health/deps` (scraper). Migrações rodam no boot.

## 5. O que existe hoje (por área)

### 5.1 Catálogo e seções
- Importados: busca ao vivo (só FOOTWEAR), fotos recortadas + galeria, pré-venda/lançamento, caches SWR versionados
  (**namespace `v8-<versão das regras de preço>`**), câmbio multi-fonte com fallback.
- **Página própria do tênis** (pronta entrega e hypados): `/pronta-entrega/<slug>` e `/hypados/<slug>` — o link que o
  dono cola no Instagram. Sem modal: galeria, preço, tamanhos BR com quantidade, **Comprar agora** / Adicionar à sacola,
  compartilhar, estados esgotado/404. Slug **não muda ao renomear**; code `PE-`/`HY-` na URL redireciona ao slug.
  `GET /api/stock/:ref`. Preview de link (WhatsApp/DM): api serve o index.html com title/canonical/**Open Graph** do par
  (`plugins/serve-web.js#productPageHtml`). Admin: URL com botão **Copiar** no cadastro; "página ↗" na lista.
- Vitrines com filtros que respeitam a seção: categoria (`?cat=basketball|lifestyle|running`) e **tamanho**
  (`?tam=41` — chips com os BR disponíveis e contagem). Importados: card abre o modal (SizePicker) como sempre.
- **Vitrine configurável** (`/admin/vitrine`): tênis do hero por seção × categoria (tabela settings, `GET /api/featured`).
- Hypados: identidade **roxa**, hero "garimpando direto dos EUA", sem promessa de prazo em texto (decisão: só a
  etiqueta; prazo específico via selo livre do cadastro). Sacola/checkout: selo "Hypados" roxo (nunca "Pronta entrega").

### 5.2 Tamanhos (BR-only para o cliente)
- `packages/shared/src/sizes`: tabela masculina oficial + aproximações; **feminina derivada** (W−1,5→masculina);
  infantil própria; `sizeLabelBr` ("BR 38") para tudo que o cliente vê; `sizeLabel` interno com US para o backoffice.
- Seletor sem abas de modelagem, chips só BR (pronta entrega mostra qtd: "último"/"N un."). Tamanho sem BR não entra.
- Cadastro da pronta entrega: chips BR→US por modelagem (feminino também derivado do masculino).

### 5.3 Nike By You
- Card com selo BY YOU + "35 dias para entrega" (`BY_YOU_DELIVERY_DAYS`); tabela padrão de tamanhos (`standardSizes`).
- **Personalização = UMA gravação por pé, ≤ 8 caracteres, letras e números juntos** (ex.: "MAMBA 24") — a Nike tirou o
  campo de número separado (23/08). `customization.fields = [textLeft, textRight]`; números antigos seguem exibidos/aceitos.

### 5.4 Checkout, cupons e pagamento
- **Cupons** (`/admin/cupons` + campo na sacola antes de finalizar): código, % (com teto) ou R$ fixo, mínimo de compra,
  validade, limite de usos, pausar/editar/remover. `POST /api/coupons/validate` (público) só confere; **o checkout
  revalida e recalcula no servidor** (`coupons.applyForCheckout` → 400 com motivo). `orders.coupon_code/discount_brl`;
  uso conta **só quando o pedido é pago** (settle, idempotente). Desconto aparece na sacola, checkout, pedido, painel e e-mails.
- **InfinitePay**: com cupom o link vai numa **linha única com o totalBrl exato** (desconto não fecha por item em
  centavos); sem cupom item a item, rótulo só BR. `settle` confere valor; `payment_amount_mismatch` não marca pago;
  webhook/redirect/reconsulta/baixa manual num `settle()` só. Juros de parcelado: `paid_amount > amount` vira
  "juros repassados" no painel.
- Reserva de estoque por tamanho na criação do pedido (transacional); devolve em cancelado/abandonado; re-reserva se
  abandonado for pago (`stock_oversold` alerta). Convidado pode criar conta no carrinho.

### 5.5 Rastreio (etapas) e e-mails
- Status: `pending_payment → paid → sourcing → in_transit → arrived_br → shipped → delivered`
  (+ abandoned/cancelled/refunded). Rótulos do cliente: **Pagamento aprovado → Pedido comprado → Em trânsito
  internacional → Chegou no Brasil → Enviado pro seu endereço → Entregue**. Fonte única `orders/status.js`.
- `order.international`: importado OU hypado (garimpo) → linha do tempo completa; pronta entrega pura → 3 etapas.
  `components/OrderTimeline.jsx` no "Rastrear pedido" e em "Meus pedidos".
- **E-mail em cada etapa** (sourcing = "garimpado" quando há hypado), enviado/entregue/cancelado, pedido registrado
  (venda externa), reset de senha, nota fiscal — todos na **moldura preta/amarela** única (`emailLayout`), com
  `notifyCustomer:false` e reenvio por etapa no painel. Fila de entregas com botão da próxima etapa.

### 5.6 Marketing por e-mail (`/admin/marketing`)
- Campanhas: assunto, parágrafos, imagem/botão opcionais, público (todos = contas opt-in ∪ compradores incl. convidado ·
  só compradores · só contas) com contagem; prévia real; teste para o admin; disparo em 2º plano com progresso e
  **falhas por destinatário** ("X falha(s) — ver quem"); `MAIL_PROVIDER=log` **bloqueia** disparo.
- Descadastro assinado (HMAC) `GET/POST /api/marketing/unsubscribe` + `List-Unsubscribe` (one-click); caixa opt-in em
  `/conta` (`users.marketing_opt_in`, padrão LIGADO — confirmar com o dono); `marketing_unsubscribes` cobre convidados.
- Card "E-mail": provedor, remetente, teste de conexão/token, siteUrl e aviso de PUBLIC_WEB_URL errada.

### 5.7 Nota fiscal (manual) + Bling (conexão pronta, emissão pendente)
- **Manual (no ar)**: detalhe do pedido → card **Nota fiscal**: anexar PDF (DANFE) + XML + número/série/chave/emissão;
  **Enviar ao cliente por e-mail** (anexos; evento `email_invoice`; `sentAt/sentTo`); baixar; substituir; remover.
  Cliente baixa o PDF em "Meus pedidos" (`GET /api/orders/:number/invoice.pdf`, dono por id/e-mail). Tabela
  `order_invoices` (PDF/XML no banco; `source` manual|bling). Mailer com `attachments` (smtp e API).
- **Bling (`/admin/bling`)**: OAuth v3 completo — Conectar (state assinado 15 min) → callback público → tokens em
  settings com renovação automática (refresh rotaciona); `bling.apiFetch(path)`; status testa **acesso a NF-e**
  (selo "conectado · NF-e ok"; Empresas sem escopo = aviso opcional; sem NF-e = instrução de marcar o módulo no app e
  RECONECTAR — escopo novo exige token novo); desconectar; checklist fiscal na tela.
- **Falta para emitir** (aguardando o dono): certificado A1 no Bling, série/numeração (começar em homologação),
  natureza de operação (CFOP) e NCM/origem com o contador, e o gatilho (pago × enviado). Aí entra:
  criar contato → `POST /nfe` → `/nfe/{id}/enviar` → DANFE/XML no card + e-mail. Gancho: `invoices.issueAutomatically`.
  ⚠️ Pergunta "atualize as informações de venda do Bling para venda de calçado normal" ficou SEM resposta do dono
  (três leituras possíveis foram apresentadas; nada foi feito).

### 5.8 Backoffice (`/admin`, role=admin)
Abas: **Dashboard** (KPIs, custo/margem, canais site×externa) · **Pedidos** (+ venda externa `/admin/pedidos/nova`) ·
**Entregas** (fila com etapas) · **Clientes** · **Pronta entrega** · **Hypados** · **Vitrine** · **Marketing** ·
**Preços** (acréscimos) · **Cupons** · **Bling**. Venda externa: canais WhatsApp/Instagram/presencial/outro, itens de
estoque/Nike/livres, desconto, e-mail "pedido registrado".

### 5.9 WhatsApp de atendimento (3 pontos)
- **Botão flutuante verde** (canto inferior direito, todas as páginas da loja; desktop com "Fale com a gente").
- **Botão no cabeçalho da seção** (versão B escolhida em 23/08): "NÃO ACHOU? CHAMA NO WHATSAPP" ao lado do título.
- Faixa no fim da grade + banner em busca vazia/erro. Número: `WHATSAPP_CONTACT_PHONE` → fallback rodapé.

### 5.10 Mobile
- Busca na 2ª linha do topo; ModeBar com 3 abas SEM cortar (colunas 1/3 exatas, bandeira sobre o nome); hero foto→nome;
  admin some do topo ≤640px (via /conta).

## 6. Banco (Prisma/Postgres)

Tabelas: `cache_entries, users (+marketing_opt_in), refresh_tokens, password_reset_tokens, login_events,
orders (+coupon_code, discount_brl, channel, rastreio/timestamps, stock_released_at), order_items (+size_label,
customization), order_events, notifications, idempotency_keys, stock_products (+category, gender, section, slug),
stock_sizes, stock_images, settings (featured · pricing_adjustments · bling), marketing_unsubscribes,
marketing_campaigns (+errors, provider), order_invoices, coupons`. Enum OrderStatus com `in_transit, arrived_br`.

Migrações (rodam no boot): `init, auth, orders, user_profile, admin_backoffice, login_events, stock_products,
stock_category, size_genders, by_you_customization, order_channel, stock_section_settings, marketing,
marketing_errors, order_stages, order_invoices, coupons`.

Dev: `apps/api/.env` → Supabase (pooler us-east-2; `DIRECT_URL` para migrar), tudo migrado; seed `*@smoke.kulture.test`.

## 7. Pendências (ordem sugerida)

1. **Segurança — rotacionar TUDO que passou pelo chat**: 2 senhas SMTP MailerSend, token de API `mlsn.…`,
   `BLING_CLIENT_SECRET`, e o `JWT_SECRET` antigo (pendência de 16/08). Gerar novos e trocar no Railway.
2. **Bling**: dono responde a pergunta pendente (§5.7) + completa o checklist fiscal → implementar a emissão.
3. Dono: apagar/corrigir o selo livre "ENCOMENDA 15-20 DIAS" do Kobe 5 em `/admin/hypados`.
4. Confirmar o padrão de **opt-in de marketing** (hoje: ligado para todos, com descadastro fácil).
5. Decidir se a faixa de WhatsApp do FIM da grade sai (agora há o botão no cabeçalho + flutuante).
6. `www.lojakulture.com.br` (CNAME Cloudflare + custom domain no Railway); `TEST_PRODUCT_ENABLED=false` após validar.
7. Fazer um pagamento real **no cartão parcelado** e conferir "juros repassados" no painel.
8. Tradução PT→EN na busca ("tênis"→"shoes"); busca "Buscar modelo" filtrando o estoque quando estiver numa seção de estoque.
9. Testes batem no banco de dev real — separar em CI.

## 8. Comandos

```bash
npm install && npm run dev            # web :5173, api :3000, scraper :3001
npm test                              # shared + api (api precisa do DATABASE_URL de dev; ~8 min)
npm run build -w apps/web
curl -s https://lojakulture.com.br/health          # providers, siteUrl, publicWebUrlMisconfigured
curl -s https://lojakulture.com.br/health/deps     # scraper
curl -s https://lojakulture.com.br/api/config      # whatsapp/installments/stock
```

Prompt-padrão do Antigravity: conferir `git status --short` (sem `.env`/storage/dist; inesperado → PARAR),
`git add -A`, commit com a mensagem dada, `git push origin main`, devolver `git rev-parse --short HEAD`.
