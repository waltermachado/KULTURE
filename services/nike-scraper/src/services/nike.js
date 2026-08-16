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

  let data = await fetchWall(url);

  // Para termos "conhecidos" (kobe, jordan, lebron…) a busca da Nike não devolve produtos: responde
  // productGroupings=null e analyzer.action = { statusCode: 301, redirectUrl: "https://www.nike.com/w/kobe-pgd6" }.
  // O site nike.com segue esse redirect para a "wall" da categoria — fazemos o mesmo, com o mesmo endpoint
  // e path = pathname do redirect (sem searchTerms).
  const redirect = data?.analyzer?.action?.redirectUrl;
  const hasProducts = (data?.productGroupings ?? []).some((g) => (g?.products ?? []).length);
  if (!hasProducts && redirect) {
    let wallPath = null;
    try {
      const r = new URL(redirect, 'https://www.nike.com');
      wallPath = r.pathname + r.search;
    } catch {
      wallPath = null;
    }
    if (wallPath && wallPath !== `/w?q=${encodeURIComponent(term)}`) {
      const wallUrl = new URL(SEARCH_URL);
      wallUrl.searchParams.set('path', wallPath);
      wallUrl.searchParams.set('queryType', 'PRODUCTS');
      wallUrl.searchParams.set('anchor', String(anchor));
      wallUrl.searchParams.set('count', String(count));
      data = await fetchWall(wallUrl);
      data.__redirectedTo = wallPath;
    }
  }

  const result = {
    term,
    total: data?.pages?.totalResources ?? null,
    products: normalize(data),
    ...(data?.__redirectedTo ? { redirectedTo: data.__redirectedTo } : {}),
  };
  // resultado vazio pode ser transitório (redirect não seguido, Nike instável): cache curto (1 min)
  cacheSet(key, result, result.products.length ? PRODUCT_TTL : 1);
  return { ...result, cached: false };
}

async function fetchWall(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw Object.assign(new Error(`Nike API respondeu ${res.status}`), { status: res.status });
  }
  return res.json();
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

/**
 * Busca detalhes completos de um produto e seus tamanhos na API product_feed v3.
 * Usado para popular a tela de detalhes / carrinho com tamanhos US e disponibilidade.
 */
export async function getProductSizes(styleColor) {
  const channelId = process.env.NIKE_CHANNEL_ID || 'd9a5bc42-4b9c-4976-858a-f159cf99c647';
  const url = `https://api.nike.com/product_feed/threads/v3/?filter=marketplace(US)&filter=language(en)&filter=channelId(${channelId})&filter=productInfo.merchProduct.styleColor(${styleColor})`;

  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw Object.assign(new Error(`Nike Feed API respondeu ${res.status}`), { status: res.status });
  }
  
  const data = await res.json();
  const objects = data?.objects || [];
  
  if (objects.length === 0) {
    throw Object.assign(new Error('Sizes unavailable for this styleColor'), { status: 404, code: 'SIZES_UNAVAILABLE' });
  }

  const obj = objects[0];
  const info = obj.productInfo?.[0];
  if (!info) {
    throw Object.assign(new Error('Product info missing'), { status: 404, code: 'SIZES_UNAVAILABLE' });
  }

  const merch = info.merchProduct || {};
  const content = info.productContent || {};
  const price = info.merchPrice || {};
  
  const availableGtins = info.availableGtins || [];
  // Tolera availableSkus se o formato mudar
  const availableSkus = info.availableSkus || [];
  
  const skus = info.skus || [];
  const sizes = skus.map(sku => {
    // Tenta casar por gtin primeiro, senão por skuId
    const availGtin = availableGtins.find(g => g.gtin === sku.gtin);
    const availSku = availableSkus.find(s => s.skuId === sku.id || s.skuId === sku.stockKeepingUnitId);
    
    const available = availGtin ? availGtin.available : (availSku ? availSku.available : false);
    const level = availGtin ? availGtin.level : (availSku ? availSku.level : 'OOS');
    
    return {
      nikeSize: sku.nikeSize,
      localizedSize: sku.countrySpecifications?.[0]?.localizedSize || null,
      gtin: sku.gtin,
      skuId: sku.id || sku.stockKeepingUnitId,
      available,
      level
    };
  });

  return {
    styleColor: merch.styleColor,
    name: content.title,
    subtitle: content.subtitle,
    colorDescription: content.colorDescription,
    genders: merch.genders || [],
    priceUsd: price.currentPrice,
    fullPriceUsd: price.fullPrice,
    onSale: Boolean(price.discounted),
    sizeChartUrl: info.productUrls?.sizeChartUrl || null,
    isLaunch: Boolean(info.launchView),
    images: info.imageUrls?.productImageUrl ? [info.imageUrls.productImageUrl] : [],
    sizes
  };
}
