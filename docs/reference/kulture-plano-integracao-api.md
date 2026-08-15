# Plano de Integração — Kulture-site ↔ Kulture-api

## Visão geral

O Kulture-site nunca fala direto com a Nike US. Toda busca passa pelo backend do site, que consulta a Kulture-api (scraper) e guarda o resultado em cache por 1 hora, por tênis.

```
[Navegador]
    │  GET /api/products/top8
    │  GET /api/search?q=kobe+6
    ▼
[Kulture-site backend (BFF)]
    │  1. normaliza a query ("Kobe 6 " → "kobe-6")
    │  2. consulta o cache (Redis)
    │      ├─ HIT (< 1h)  → responde na hora, sem tocar na API
    │      └─ MISS        → chama a Kulture-api ao vivo
    ▼
[Kulture-api (scraper Nike US)]
    │  busca ao vivo → retorna JSON normalizado
    ▼
[Cache Redis]  SET kulture:product:<slug>  TTL 3600s
```

## Endpoints

### Kulture-api (já existente, consumida pelo backend)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/search?q={termo}` | Busca ao vivo na Nike US, retorna lista de produtos |
| GET | `/product/{styleId}` | Detalhe de um produto (tamanhos, preço, imagens) |

### Kulture-site backend (novo, consumido pelo navegador)
| Método | Rota | Cache | Descrição |
|---|---|---|---|
| GET | `/api/products/top8` | 1h (chave fixa `top8`) | Os 8 da home |
| GET | `/api/search?q=` | 1h por termo normalizado | Busca do usuário |
| GET | `/api/product/:slug` | 1h por tênis | Página de produto |

## Estratégia de cache (1h por tênis)

- **Armazenamento**: Redis (Upstash tem plano grátis e dispensa infra própria). Para o MVP local, um `Map` em memória com timestamps resolve.
- **Chaves**: `kulture:search:<termo-normalizado>` e `kulture:product:<slug>`, ambas com `TTL 3600`.
- **Normalização da query**: minúsculas, sem acentos, espaços → hífen. "Kobe 6 Protro" e "kobe 6  protro" caem na mesma chave — sem isso o cache quase nunca acerta.
- **Stale-while-revalidate**: além do TTL de 1h, manter uma cópia "stale" por 24h. Se a Kulture-api estiver fora do ar num MISS, o backend serve a cópia velha com um aviso `"cached": true` em vez de quebrar a página.
- **Lock anti-estouro**: se 10 usuários buscarem "kobe 6" no mesmo segundo num MISS, só a primeira chamada vai à API; as outras aguardam o resultado (single-flight). Evita rajadas no scraper.

## Imagens dos produtos

O endpoint **sempre devolve** as fotos. Como o scraper lê a página da Nike US, ele captura as URLs das imagens (que já são públicas, padrão `static.nike.com/.../<styleId>.png`) junto com nome e preço, e retorna no campo `imagens[]`.

**Espelhamento + cache permanente de imagem** (regra pedida: a imagem fica salva mesmo depois de 1h):

- Há **dois caches separados, com validades diferentes**:
  - **Dados do produto (preço, disponibilidade, tamanhos)** → cache de **1h**. É o que muda com frequência.
  - **Arquivo de imagem** → salvo no storage de forma **permanente** (sem TTL). A foto de um tênis não muda; não faz sentido re-baixar.
- Na primeira vez que um tênis aparece, o backend baixa cada imagem uma vez e grava em `storage/produtos/<styleId>/<n>.webp` (Cloudflare R2 ou Supabase Storage, ambos grátis). O banco guarda só o caminho local.
- Nas próximas vezes, mesmo que os dados tenham expirado e o backend vá à API buscar preço novo, **a imagem NÃO é baixada de novo** — ele reaproveita o arquivo já salvo. Só baixa uma imagem nova se o `styleId` mudar ou a foto ainda não existir no storage.
- **Resiliência**: se um dia a Nike tirar a foto do ar, o site continua exibindo a cópia salva. A imagem nunca "some" por causa do cache de 1h.
- Reprocessamento opcional: converter para `.webp` e gerar uma versão menor (thumb) no momento do salvamento, para os cards carregarem leves.

## Top 8 da home

- Lista fixa de 8 slugs configurada no backend (hoje: Kobe 6 Protro, Kobe 5 Protro, Sabrina 3, Kobe 4 Protro, KD 18, GT Cut 3, Ja 3, Kobe 8 Protro — os 8 mais usados na NBA 2025-26).
- Um **cron a cada 1h** (`node-cron`) pré-aquece o cache dos 8: a home nunca espera scraping, sempre responde do cache.
- Os slugs ficam em config/env para trocarmos os destaques sem deploy.

## Contrato de resposta (backend → site)

```json
{
  "slug": "kobe-6-protro",
  "nome": "Kobe 6 Protro",
  "marca": "Nike Basketball",
  "precoUSD": 190.00,
  "precoBRL": 1899.90,
  "styleId": "CW2288-111",
  "imagens": [
    "https://cdn.kulture.com.br/produtos/CW2288-111/0.webp",
    "https://cdn.kulture.com.br/produtos/CW2288-111/1.webp"
  ],
  "imagemOrigem": ["https://static.nike.com/.../CW2288-111.png"],
  "tamanhosUS": ["8", "8.5", "9"],
  "disponivel": true,
  "cachedAt": "2026-07-23T13:00:00Z",
  "cached": true
}
```

> As URLs em `imagens[]` já apontam para o **seu** storage (espelhadas e permanentes). `imagemOrigem[]` guarda a URL original da Nike só para referência/re-sync manual.

- **Conversão USD→BRL** feita no backend: `precoBRL = precoUSD × câmbio × fator` (fator cobre impostos de importação + margem; definir juntos). O câmbio também fica em cache (1h, API do BC ou awesomeapi).

## Fallbacks

1. Cache fresco → responde direto (caso normal, ~10ms).
2. Cache vencido + API ok → busca ao vivo, atualiza cache.
3. Cache vencido + API fora → serve cópia stale de até 24h + flag `cached`.
4. Sem cache nenhum + API fora → home mostra os cards placeholder atuais; busca retorna "tente novamente em instantes".

## Ordem de implementação

1. Backend do site (Express/Node) com as 3 rotas + cache em memória.
2. Ligar a Kulture-api nas rotas + normalização de query.
3. Trocar o array `produtos` do front por `fetch('/api/products/top8')`.
4. Busca no header do site chamando `/api/search`.
5. Migrar cache para Redis + cron de pré-aquecimento + single-flight.
6. Conversão de câmbio e regra de preço.
