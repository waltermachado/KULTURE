# Deploy — Railway (api + scraper + Postgres)

Topologia em produção — **tudo no Railway**:

```
Internet ──► kulture-api (Railway, público)  ── serve o front buildado (apps/web/dist) + /api + /media
                 │  rede privada Railway (IPv6)
                 ├► kulture-scraper (Railway, SEM domínio público)  ── fala com a Nike US
                 └► Postgres (Railway plugin)                        ── DATABASE_URL (rede privada)
```

Por que o front sai da própria api: mesma origem → sem CORS, e o cookie httpOnly do refresh
funciona com `SameSite=Lax`. Em dev nada muda (Vite serve o front e faz proxy).

Arquivos: `deploy/api.Dockerfile`, `deploy/scraper.Dockerfile`, `deploy/api-entrypoint.sh`
(roda `prisma migrate deploy` no boot), `deploy/railway.api.json`, `deploy/railway.scraper.json`,
`.dockerignore`, `apps/api/src/plugins/serve-web.js` (SPA fallback).

---

## 1. Antes do primeiro deploy (uma vez)

- [ ] Repo no GitHub atualizado (`origin/main`).
- [ ] Gerar um `JWT_SECRET` novo para produção (≥ 32 chars): `openssl rand -base64 48`
- [ ] Habilitar o **checkout externo** na InfinitePay (necessário para a API de links):
      https://app.infinitepay.io/external-checkout#configuracoes?enabled=true
- [ ] MailerSend: domínio do remetente verificado (SPF/DKIM) para `MAIL_FROM` — em trial só envia para o e-mail do admin.
- [ ] (Recomendado) validar as imagens localmente com Docker rodando:
  ```bash
  docker build -f deploy/scraper.Dockerfile -t kulture-scraper .
  docker build -f deploy/api.Dockerfile     -t kulture-api .
  ```

## 2. Criar o projeto no Railway

1. **New Project → Deploy from GitHub repo** → `KULTURE`. Isso cria o 1º serviço.
2. **+ New → Database → Add PostgreSQL**. Ele expõe as variáveis `DATABASE_URL` (privada, `postgres.railway.internal`)
   e `DATABASE_PUBLIC_URL` (para acessar de fora, ex.: seu Mac em dev).
3. Renomeie o 1º serviço para **`kulture-scraper`**. Em *Settings*:
   - **Config-as-code file path**: `deploy/railway.scraper.json` · **Root Directory**: `/`
   - **Networking**: NÃO gere domínio público (hostname privado fica `kulture-scraper.railway.internal`).
   - **Variables** (de `services/nike-scraper/.env.example`): `NIKE_SEARCH_URL`, `NIKE_CHANNEL_ID`, `NIKE_CALLER_ID`,
     `PRODUCT_CACHE_TTL_MIN=60`, `RATE_CACHE_TTL_MIN=60`, `CORS_ORIGINS=*`. (`PORT=3001` já vem do Dockerfile.)
4. **+ New → GitHub Repo** (mesmo repo) → renomeie para **`kulture-api`**. Em *Settings*:
   - **Config-as-code file path**: `deploy/railway.api.json` · **Root Directory**: `/`
   - **Networking → Generate Domain** (este é o domínio do site).
   - **Volumes → Add volume** montado em `/app/apps/api/storage` (imagens espelhadas persistem; sem volume só re-baixa a cada deploy).
   - **Variables**:

     | Variável | Valor |
     |---|---|
     | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao plugin — rede privada) |
     | `DIRECT_URL` | *(vazio — o entrypoint usa DATABASE_URL)* |
     | `JWT_SECRET` | o novo, ≥ 32 chars |
     | `SCRAPER_URL` | `http://kulture-scraper.railway.internal:3001` |
     | `PUBLIC_WEB_URL` / `PUBLIC_API_URL` | `https://<domínio gerado>` (o mesmo valor nas duas — mesma origem) |
     | `MEDIA_BASE` | `/media/produtos` |
     | `CORS_ORIGINS` | *(vazio)* |
     | `TOP8_TERMS`, `TOP8_WARM=true`, `CACHE_FRESH_MIN=60`, `CACHE_STALE_MIN=1440`, `SIZES_CACHE_MIN=10` | como no `.env.example` |
     | `JWT_EXPIRES_IN=15m`, `REFRESH_EXPIRES_DAYS=7`, `LOG_LEVEL=info` | |
     | `ADMIN_EMAILS` | e-mails (vírgula) que viram **admin do backoffice** ao logar/cadastrar — ex.: `ti@neofolic.com.br,contato@kulturebr.com` |
     | `PASSWORD_RESET_TTL_MIN` | `60` (validade do link "esqueci minha senha") |
     | `PAYMENT_PROVIDER` | `mock` até validar o link real; depois `infinitepay` |
     | `INFINITEPAY_HANDLE` | `kulture-br` |
     | `MAIL_PROVIDER` / `MAILERSEND_API_TOKEN` / `MAIL_FROM` / `MAIL_FROM_NAME` | `mailersend` + token + remetente do domínio verificado |
     | `WHATSAPP_PROVIDER` | `log` (WhatsApp adiado) |
     | `WHATSAPP_CONTACT_PHONE` | WhatsApp de **atendimento** mostrado no site ("não achou? chama a gente"): `5585992578888` (DDI+DDD+número, só dígitos). Vazio = usa o número do rodapé |
     | `TRUST_PROXY=true`, `NODE_ENV=production`, `HOST=0.0.0.0` | já vêm do Dockerfile |

     O Railway injeta `PORT` próprio — a api lê `process.env.PORT`, então funciona.

5. Deploy: o Railway builda os dois Dockerfiles. O `kulture-api` roda `prisma migrate deploy` no boot
   (cria as tabelas no Postgres novo) e só depois sobe — o healthcheck em `/health` segura o tráfego até lá.

## 3. Verificar

```bash
API=https://<dominio>.up.railway.app
curl -s $API/health            # {"ok":true,...,"cache":{"persistent":true}}
curl -s $API/health/deps       # scraper.ok deve ser true (rede privada funcionando)
curl -s "$API/api/products/top8" | head -c 300
open $API                      # site — testar: busca, tamanhos, carrinho, checkout (mock), confirmação
```

Se `/health/deps` mostrar `scraper.ok:false`, a resposta agora diz **para onde** a api tentou falar e **por quê** falhou:

```json
{"ok":false,"deps":{"scraper":{"ok":false,"url":"http://localhost:3001","error":"nike-scraper indisponível","cause":"ECONNREFUSED"}}}
```

| `url` / `cause` | Significa | Correção (Railway → kulture-api → Variables) |
|---|---|---|
| `url: http://localhost:3001` | a variável `SCRAPER_URL` **não está definida** no serviço (caiu no default) | criar `SCRAPER_URL=http://kulture-scraper.railway.internal:3001` e **Deploy** |
| `cause: ENOTFOUND` | hostname privado errado — o nome do serviço no Railway não é `kulture-scraper` | usar `http://<nome-do-serviço-scraper>.railway.internal:3001` (nome em minúsculas, espaços→hífen) |
| `cause: ECONNREFUSED` com url `railway.internal` | scraper não está escutando na 3001 (deploy falhou / porta diferente / crashou) | ver Deployments do scraper; a porta é a `PORT=3001` do Dockerfile — não sobrescrever `PORT` nas variáveis |
| `cause: ETIMEDOUT` / `EHOSTUNREACH` | rede privada desabilitada ou serviços em ambientes diferentes | Project → Settings → Private Networking ligado; os dois serviços no mesmo environment |

A rede privada do Railway é IPv6 — o Express do scraper já escuta em `::`. Depois de mudar variável, o Railway
só aplica quando você clica em **Deploy** (banner roxo no topo).

Backoffice: depois de subir, cadastre-se no site com um e-mail listado em `ADMIN_EMAILS` (ou entre, se já tiver conta)
e abra `https://<dominio>/admin`.

## 4. Dev local apontando para o Postgres do Railway (opcional)

No `apps/api/.env`, use `DATABASE_URL=<DATABASE_PUBLIC_URL do plugin>` (a URL pública, com host `*.proxy.rlwy.net`).
Assim dev e produção compartilham o banco — bom para o início, separar depois.

## 5. Deploys seguintes

Push na `main` → Railway rebuilda os dois serviços. Migrações novas são aplicadas no boot da api
automaticamente (`migrate deploy`). Rollback pelo histórico de deploys do Railway.

## 6. Domínio próprio via Cloudflare (DNS + proxy)

1. Domínio no Cloudflare (nameservers no registrador).
2. Railway → `kulture-api` → *Networking → Custom Domain* → adicione `www.seudominio.com.br` (mostra o CNAME alvo).
3. Cloudflare → DNS → **CNAME** `www` → alvo do Railway, proxied (nuvem laranja); SSL/TLS **Full (strict)**.
4. Atualize `PUBLIC_WEB_URL`/`PUBLIC_API_URL` para `https://www.seudominio.com.br` — isso também liga o
   webhook da InfinitePay (`webhook_url` só é enviado quando `PUBLIC_API_URL` não é localhost).

## 6b. Ativar o pagamento real (InfinitePay)

Contrato (doc oficial, ago/2026): `POST https://api.checkout.infinitepay.io/links` `{handle, order_nsu, redirect_url, webhook_url?, items[{quantity, price(centavos), description}], customer?, address?}` → `{url}`;
depois do pagamento a InfinitePay redireciona para `redirect_url` anexando `?transaction_nsu=&slug=&capture_method=&receipt_url=&order_nsu=`;
`POST …/payment_check {handle, order_nsu, transaction_nsu, slug}` → `{success, paid, amount, paid_amount, installments, capture_method}`
(**`paid` é o que vale; `success` = consulta ok**); webhook `{invoice_slug, amount, paid_amount, installments, capture_method, transaction_nsu, order_nsu, receipt_url, items}`
e a resposta deve ser `200 {"success":true,"message":null}` (400 → eles retentam).

Passos:
1. App InfinitePay → Vendas → Checkout → **Checkout Integrado habilitado**; anote a **InfiniteTag** (ex.: `$kulture-br` → handle `kulture-br`, sem `$`).
2. Railway `kulture-api` → Variables: `PAYMENT_PROVIDER=infinitepay`, `INFINITEPAY_HANDLE=<sua tag sem $>`; `PUBLIC_WEB_URL`/`PUBLIC_API_URL` públicos (o webhook só é enviado quando `PUBLIC_API_URL` não é localhost) → Deploy.
3. Teste de R$1: no site, busque exatamente **`test123test`** (produto virtual de R$ 1,00, só aparece com o nome completo; `TEST_PRODUCT_ENABLED=false` desliga) → escolha o tamanho → checkout → pague Pix, confira: redirect para `/pedido/confirmacao/KLT-…` → "Pagamento confirmado" (payment_check) → e-mail; no `/admin/pedidos/KLT-…` os eventos `payment_confirmed` e/ou `webhook_received`.
4. Se ficar "aguardando": `/admin` → pedido → **Reconsultar pagamento** (informe o transaction_nsu do painel InfinitePay se faltar). Evento `payment_amount_mismatch` = valor da cobrança ≠ total do pedido (a api não marca pago; baixa manual só depois de conferir).
5. Voltar para o mock: `PAYMENT_PROVIDER=mock`.

## 7. Pendências conhecidas antes de vender de verdade

- **`GET /api/orders/:number`**: mascarado para convidado desde o backoffice (sem CPF/e-mail/telefone/endereço).
- **Nike de IP de datacenter**: se o scraper começar a receber 403/429 no Railway, rodar o scraper em outro lugar e só apontar `SCRAPER_URL`.
- Bling (NF) e WhatsApp: adiados (após o Admin).
