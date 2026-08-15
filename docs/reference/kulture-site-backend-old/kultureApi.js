/**
 * kultureApi.js
 * ------------------------------------------------------------
 * Cliente da kulture-api REAL (o scraper Nike US + cotação).
 * A API roda como serviço separado (padrão porta 3001) e expõe:
 *   GET /search?q=&count=&anchor=&convert=
 *   GET /rate
 *   GET /health
 *
 * Cada produto retornado pela API tem (ver README da kulture-api):
 *   { id, styleColor, name, subtitle, priceUsd, fullPriceUsd,
 *     onSale, image, url, colorDescription,
 *     price: { usd, brl, brlWithMargin, marginPercent, rateUsed } }
 *
 * Config via .env:
 *   KULTURE_API_URL=http://localhost:3001
 * ------------------------------------------------------------
 */

const BASE = (process.env.KULTURE_API_URL || 'http://localhost:3001').replace(/\/$/, '');

async function apiGet(pathAndQuery){
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok){
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`kulture-api ${res.status}: ${body.slice(0,200)}`), { status: res.status });
  }
  return res.json();
}

/**
 * Busca produtos por termo. Retorna a lista crua da kulture-api.
 * (a conversão de preço já vem pronta da própria API)
 */
export async function searchLive(termo, { count = 24 } = {}){
  const data = await apiGet(`/search?q=${encodeURIComponent(termo)}&count=${count}`);
  return Array.isArray(data.products) ? data.products : [];
}

/**
 * A kulture-api não tem rota de produto individual — buscamos pelo termo
 * e pegamos a melhor correspondência (nome ou styleColor).
 */
export async function productLive(termo){
  const produtos = await searchLive(termo, { count: 5 });
  if (!produtos.length) return null;
  const alvo = termo.toLowerCase();
  return produtos.find(p =>
    (p.name || '').toLowerCase().includes(alvo) ||
    (p.styleColor || '').toLowerCase().includes(alvo)
  ) || produtos[0];
}

// Termos de busca dos 8 destaques da home (mais usados na NBA 2025-26).
// Como a API busca por texto, usamos o nome do modelo como termo.
export const TOP8_SLUGS = [
  'Kobe 6 Protro',
  'Kobe 5 Protro',
  'Sabrina 3',
  'Kobe 4 Protro',
  'KD 18',
  'GT Cut 3',
  'Ja 3',
  'Kobe 8 Protro',
];
