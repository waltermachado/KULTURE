# @kulture/nike-scraper (ex-kulture-api)

Serviço **isolado** de busca de tênis na **Nike US** + cotação **USD-BRL**.
É a única peça do monorepo que fala com a Nike; a `apps/api` (kulture-core) consome este serviço.
Roda como processo separado de propósito: se a Nike bloquear/mudar formato, só ele cai.

## Como rodar

```bash
# na raiz do monorepo
npm install
cp services/nike-scraper/.env.example services/nike-scraper/.env
npm run dev:scraper
```

API sobe em `http://localhost:3001`.

## Endpoints

| Rota | Descrição |
|---|---|
| `GET /health` | Status da API e do cache |
| `GET /rate` | Cotação USD-BRL (AwesomeAPI, cache de 1h) |

### 2. Buscar Produtos
**`GET /search?q=jordan&count=24&anchor=0`**

Retorna resultados da Nike normalizados:
```json
{
  "term": "jordan",
  "total": 142,
  "products": [ ... ],
  "cached": false
}
```

### 3. Detalhes e Tamanhos de um Produto
**`GET /product/:styleColor`**

Bate no feed de produto da Nike (ex.: `IO3415-100`) para buscar as imagens, dados do produto e lista de tamanhos (`sizes`) com as disponibilidades precisas:
```json
{
  "styleColor": "IO3415-100",
  "name": "Kobe 10 Protro",
  "price": { "usd": 180, "brl": 972.0, "brlWithMargin": 1312.2, "marginPercent": 35, "rateUsed": 5.4 },
  "image": "https://...",
  "url": "https://www.nike.com/t/...",
  "sizes": [
    { "nikeSize": "10.5", "localizedSize": "M 10.5 / W 12", "available": true, "level": "HIGH" }
  ]
}
```

## Cache Interno
O scraper possui um cache em memória ultra-rápido (`lru-cache`) para os endpoints de busca: 60 min. Cotação: 60 min. Configurável no `.env`. Se escalar, trocar por Redis é só substituir `src/cache.js`.

## Fontes de dados

- **Nike US**: endpoints JSON não-oficiais do próprio nike.com (gratuitos, sem chave). Por serem não-oficiais, podem mudar sem aviso — por isso URL e header ficam no `.env`.
- **Cotação**: [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas) — gratuita, sem chave.

## Se a busca da Nike parar de funcionar

1. Abra `nike.com` no Chrome → DevTools → aba **Network** → filtre por `api.nike.com`.
2. Faça uma busca no site e copie a URL da requisição que retorna os produtos.
3. Atualize `NIKE_SEARCH_URL` e o header `nike-api-caller-id` (visível na requisição) no `.env`.
4. Se o formato do JSON mudou, ajuste o `normalize()` em `src/services/nike.js`.

Alternativa: a lib open source [sneaks-api](https://github.com/druv5319/Sneaks-API) (StockX/GOAT/Flight Club) pode servir de fallback para comparação de preços.

## Cache

Em memória com TTL + persistência em `data/cache.json` (sobrevive a restarts). Buscas: 60 min. Cotação: 60 min. Configurável no `.env`. Se escalar, trocar por Redis é só substituir `src/cache.js`.

## Avisos

- Scraping/uso de endpoints não-oficiais pode violar os termos de uso da Nike — mantenha volume baixo (o cache ajuda) e avalie o risco comercial.
- O preço em BRL usa cotação + margem; impostos de importação e frete não estão incluídos no cálculo.
