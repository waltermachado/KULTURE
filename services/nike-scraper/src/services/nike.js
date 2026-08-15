// Busca de produtos na Nike US via endpoints JSON não-oficiais (os mesmos que o site nike.com usa).
// ATENÇÃO: por serem não-oficiais, a Nike pode mudar o formato. O normalizador abaixo é
// defensivo e as URLs/headers ficam no .env para ajuste rápido sem tocar no código.
import { cacheGet, cacheSet } from '../cache.js';

const SEARCH_URL =
  process.env.NIKE_SEARCH_URL ||
  'https://api.nike.com/discover/product_wall/v1/marketplace/US/language/en/consumerChannelId/d9a5bc42-4b9c-4976-858a-f159cf99c647';
const CALLER_ID = process.env.NIKE_CALLER_ID || 'nike:dotcom:browse:wall.client:2.0';
const PRODUCT_TTL = Number(process.env.PRODUCT_CACHE_TTL_MIN || 60);
// A Nike só aceita estes valores de `count` (INCORRECT_COUNT_VALUE caso contrário).
const ALLOWED_COUNTS = [24, 50, 100];
export function normalizeCount(count) {
  const n = Number(count) || 24;
  return ALLOWED_COUNTS.find((c) => c >= n) ?? ALLOWED_COUNTS[ALLOWED_COUNTS.length - 1];
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'nike-api-caller-id': CALLER_ID,
};

/**
 * Busca produtos por termo (ex.: "jordan", "air max 90").
 * Usa cache para não repetir requisições à Nike.
 */
export async function searchProducts(term, { count = 24, anchor = 0 } = {}) {
  count = normalizeCount(count);
  const key = `nike:search:${term.toLowerCase()}:${count}:${anchor}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const url = new URL(SEARCH_URL);
  url.searchParams.set('path', `/w?q=${encodeURIComponent(term)}`);
  url.searchParams.set('searchTerms', term);
  url.searchParams.set('queryType', 'PRODUCTS');
  url.searchParams.set('anchor', String(anchor));
  url.searchParams.set('count', String(count));

  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw Object.assign(new Error(`Nike API respondeu ${res.status}`), { status: res.status });
  }
  const data = await res.json();
  const result = {
    term,
    total: data?.pages?.totalResources ?? null,
    products: normalize(data),
  };
  cacheSet(key, result, PRODUCT_TTL);
  return { ...result, cached: false };
}

/**
 * Normaliza a resposta da Nike para o formato usado pelo site Kulture.
 * Defensivo: tolera campos ausentes e os dois formatos conhecidos
 * (product_wall "productGroupings" e o legado "objects").
 */
function normalize(data) {
  const items = [];

  // Formato atual: productGroupings -> products[]
  const groupings = data?.productGroupings ?? [];
  for (const group of groupings) {
    for (const p of group?.products ?? []) {
      items.push({
        id: p?.globalProductId ?? p?.productCode ?? null,
        styleColor: p?.productCode ?? null,
        name: p?.copy?.title ?? null,
        subtitle: p?.copy?.subTitle ?? null,
        productType: p?.productType ?? null,       // FOOTWEAR | APPAREL | EQUIPMENT ...
        productSubType: p?.productSubType ?? null,
        priceUsd: p?.prices?.currentPrice ?? null,
        fullPriceUsd: p?.prices?.initialPrice ?? null,
        onSale: Boolean(p?.prices?.discounted),
        image: p?.colorwayImages?.portraitURL ?? p?.colorwayImages?.squarishURL ?? null,
        url: p?.pdpUrl?.url ?? null,
        colorDescription: p?.displayColors?.colorDescription ?? null,
        raw: undefined,
      });
    }
  }

  // Formato legado: objects[] -> productInfo[]
  if (items.length === 0 && Array.isArray(data?.objects)) {
    for (const obj of data.objects) {
      const info = obj?.productInfo?.[0];
      if (!info) continue;
      items.push({
        id: info?.merchProduct?.id ?? null,
        styleColor: info?.merchProduct?.styleColor ?? null,
        name: info?.productContent?.title ?? null,
        subtitle: info?.productContent?.subtitle ?? null,
        priceUsd: info?.merchPrice?.currentPrice ?? null,
        fullPriceUsd: info?.merchPrice?.fullPrice ?? null,
        onSale: Boolean(info?.merchPrice?.discounted),
        image: info?.imageUrls?.productImageUrl ?? null,
        url: info?.productContent?.slug
          ? `https://www.nike.com/t/${info.productContent.slug}`
          : null,
        colorDescription: info?.productContent?.colorDescription ?? null,
      });
    }
  }

  return items.filter((i) => i.name && i.priceUsd != null);
}
