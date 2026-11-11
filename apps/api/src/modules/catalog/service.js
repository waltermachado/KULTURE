/**
 * Serviço de catálogo: orquestra scraper → precificação → espelho de imagens → cache SWR.
 */
import { isVerifiedAvailable } from './availability.js';
import { normalizeQuery } from "../../lib/normalize-query.js";
import { AppError } from "../../lib/errors.js";
import { cutoutUrls } from "./nike-image.js";
import { toProduct, isByYou, BY_YOU_CUSTOMIZATION } from "./normalize.js";
import { isTestTerm, isTestStyleColor, buildTestProduct } from "./test-product.js";
import { convertUsToBr, parseUsSizes, sizeGroupsOf, standardSizes } from "@kulture/shared/sizes";

const RATE_KEY = "rate:USD-BRL:v2"; // v2 = traz `tourism` (dólar turismo)
const MAX_IMAGES = 8; // galeria do produto: até 8 ângulos (o resto é marketing)
// namespace das chaves de cache do catálogo: mudou o formato das imagens (v2 = recorte) → chaves novas,
// senão cards/busca ficariam até 1h servindo os PNGs opacos antigos.
// v3 só calçados · v4 launch · v5 nova precificação (turismo, 7%, ↑99) · v6 LeBron 23 +R$300 ·
// v7 acréscimos editáveis no painel: o namespace ganha a VERSÃO das regras (salvou → chaves novas → preço recalculado) ·
// v8 escala feminina derivada da masculina (BR único por par físico) · v9 pré-venda com todos os tamanhos liberados
const BASE_NS = "v10"; // exact storefront verification; discard old size caches

/**
 * `stock` (opcional) = serviço de pronta entrega: códigos PE-XXXXXX são respondidos do banco em
 * getProductSizes() — é o único ponto que o seletor de tamanho e o checkout usam, então o produto de
 * estoque passa pelo mesmo fluxo (preço validado no servidor, snapshot no pedido) sem tocar em orders/.
 */
/**
 * `restricted` (opcional) = filtro de modelos restritos (/admin/restritos): aplicado DEPOIS do cache em
 * search/top8/findOne/getProductSizes, então salvar no painel vale na hora (o cache guarda a lista cheia).
 */
export function createCatalogService({ scraper, cache, sizesCache, images, rules, top8Terms = [], testProduct = false, stock = null, restricted = null, local = null, log = null }) {
  const liveRequests = new Map();
  const validRate = (r) => r && typeof r === "object" && Number.isFinite(Number(r.ask)) && Number(r.ask) > 0;
  // `rules` = lista fixa (testes/fallback) ou o serviço de preços ({ runtime() → { rules, version } }) com os
  // acréscimos editáveis em /admin/precos
  const rulesProvider = typeof rules?.runtime === "function" ? rules : { runtime: async () => ({ rules, version: "static" }) };
  const ns = async () => `${BASE_NS}-${(await rulesProvider.runtime()).version}`;

  async function getRate() {
    // câmbio fica no mesmo cache SWR (fresco 1h; stale se o scraper cair)
    const { value } = await cache.getOrFetch(RATE_KEY, () => scraper.rate());
    if (validRate(value)) return value;
    // entrada envenenada no cache (formato antigo/inválido): busca direto e regrava
    log?.warn({ key: RATE_KEY }, "catalog: câmbio em cache inválido — rebuscando");
    const fresh = await scraper.rate();
    if (!validRate(fresh)) throw new Error("Câmbio USD→BRL inválido.");
    await cache.set?.(RATE_KEY, fresh);
    return fresh;
  }

  async function enrich(raw, rate) {
    // galeria (detalhe do produto) ou foto única (busca/top8); todas reescritas para o recorte transparente
    const sources = Array.isArray(raw.images) && raw.images.length ? raw.images : raw.image ? [raw.image] : [];
    const imageSource = cutoutUrls(sources).slice(0, MAX_IMAGES);
    const mirrored = await images.ensureImages(raw.styleColor || raw.id, imageSource);
    const { rules: current } = await rulesProvider.runtime();
    return toProduct(raw, { rate, rules: current, images: mirrored, imageSource });
  }

  async function publishedProduct(raw) {
    if (!raw || isByYou(raw)) return raw;
    try { return await scraper.getProductDetail(raw.styleColor); }
    catch (err) { if (isSizesUnavailable(err)) return null; throw err; }
  }

  async function search(query) {
    const term = normalizeQuery(query);
    if (testProduct && isTestTerm(query)) {
      // produto de teste de pagamento: só com o termo exato, nunca em buscas parciais nem no top8
      const rate = await getRate().catch(() => null);
      return { term, cached: false, stale: false, total: 1, products: [buildTestProduct(rate)] };
    }
    if (local) return browse({ q: query });
    const key = `search:${await ns()}:${term}`;
    const fetchSearch = async () => {
      const [{ products, total }, rate] = await Promise.all([scraper.search(query), getRate()]);
      const verified = (await Promise.all(products.map(publishedProduct))).filter(Boolean);
      const enriched = await Promise.all(verified.map((p) => enrich(p, rate)));
      return { total: total ?? enriched.length, products: enriched };
    };
    let { value, cached, stale } = await cache.getOrFetch(key, fetchSearch);
    // Vazio vindo do cache (Nike/scraper estavam fora quando foi gravado) não pode "colar" por 60 min:
    // rebusca agora e só regrava se vier algo. Um vazio legítimo continua custando uma ida à Nike.
    if (cached && !value.products.length) {
      const fresh = await fetchSearch();
      if (fresh.products.length) await cache.set(key, fresh);
      value = fresh;
      cached = false;
      stale = false;
    }
    const products = restricted ? await restricted.filter(value.products) : value.products;
    return { term, cached, stale, total: products.length, products };
  }

  // The feed rejects anchors above 1000. Until a complete mirror exists, recover
  // queried models through the search endpoint instead of reporting false misses.
  async function recoverQuery(q) {
    const key = `catalog-recovery:v2:${normalizeQuery(q)}`;
    await cache.getOrFetch(key, async () => {
      const candidates = new Map();
      // Match the original live-search page size. A visitor must not wait for an
      // entire category crawl (Nike's total also includes apparel/recommendations).
      const nikeQuery = /\bby\s+you\b/i.test(q) && /\bbasketball\b/i.test(q) ? 'Nike By You' : q;
      const result = await scraper.search(nikeQuery, { count: 50, anchor: 0 });
      for (const raw of result.products) if (raw.styleColor) candidates.set(raw.styleColor, raw);
      const pending = [...candidates.keys()];
      // Bound Nike/detail and database concurrency; dropdown and grid share this
      // single-flight cache entry. By You designs have no SKU detail endpoint.
      let failed = false;
      await Promise.all(Array.from({ length: Math.min(5, pending.length) }, async () => {
        while (pending.length) {
          const sku = pending.shift();
          const existing = await local.get(sku);
          if (existing && (isByYou(existing) || isVerifiedAvailable(existing))) continue;
          try {
            if (isByYou(candidates.get(sku))) {
              await local.upsert(candidates.get(sku));
              continue;
            }
            const raw = await scraper.getProductDetail(sku);
            if (raw.styleColor !== sku || !raw.name || !Number.isFinite(raw.priceUsd) || !Array.isArray(raw.sizes)) throw new Error('Detalhe Nike incompleto');
            await local.upsert(raw);
          } catch (err) {
            if (isSizesUnavailable(err)) { await local.retire(sku); continue; }
            failed = true;
            log?.warn({ err, sku }, 'Falha ao recuperar produto da busca Nike');
          }
        }
      }));
      if (failed) throw AppError.upstream('Não foi possível completar a busca Nike. Tente novamente.');
      return { total: candidates.size };
    });
  }

  async function browse({ q = "", size = "", offset = 0, limit = 48 } = {}) {
    if (testProduct && isTestTerm(q)) return search(q);
    if (!local) return search(q);
    const sync = await local.status();
    let recoveryError;
    if (q.trim() && (/\bby\s+you\b/i.test(q) || !sync.lastSuccessAt || Date.now() - new Date(sync.lastSuccessAt) > 90 * 60_000)) {
      try { await recoverQuery(q); }
      catch (err) { recoveryError = err; log?.warn({ err, q }, 'Busca Nike indisponível; preservando resultados locais'); }
    }
    const { products: raws, sizes } = await local.list({ q, size });
    if (recoveryError && !raws.length) throw recoveryError;
    const page = raws.slice(offset, offset + limit);
    const rate = page.length ? await getRate() : null;
    const products = await Promise.all(page.map(raw => enrich(raw, rate)));
    return { term: normalizeQuery(q), cached: true, stale: !sync.lastSuccessAt || Date.now() - new Date(sync.lastSuccessAt) > 90 * 60_000,
      total: raws.length, products, sizes, offset, limit, updatedAt: sync.lastSuccessAt || null };
  }

  async function findOne(termOrStyleColor) {
    const term = normalizeQuery(termOrStyleColor);
    if (local) {
      const raw = await local.get(String(termOrStyleColor).toUpperCase());
      if (raw && (isByYou(raw) || isVerifiedAvailable(raw)) && (!restricted || !(await restricted.isBlocked(raw)))) return { cached: true, stale: false, product: await enrich(raw, await getRate()) };
    }
    const key = `product:${await ns()}:${term}`;
    const fetchOne = async () => {
      const [raw, rate] = await Promise.all([scraper.findOne(String(termOrStyleColor).replace(/-/g, " ")), getRate()]);
      const verified = await publishedProduct(raw);
      return verified ? await enrich(verified, rate) : null;
    };
    let { value, cached, stale } = await cache.getOrFetch(key, fetchOne);
    // "não achei" vindo do cache (Nike/scraper fora na hora) não pode colar por 60 min: tenta de novo agora
    if (cached && value == null) {
      const fresh = await fetchOne();
      if (fresh) await cache.set(key, fresh);
      value = fresh;
      cached = false;
      stale = false;
    }
    if (value && restricted && (await restricted.isBlocked(value))) value = null; // restrito = não existe para a loja
    return { cached, stale, product: value };
  }

  async function buildTop8() {
    const rate = await getRate();
    const results = await Promise.all(
      top8Terms.map(async (term) => {
        try {
          const raw = await publishedProduct(await scraper.findOne(term));
          return raw ? await enrich(raw, rate) : null;
        } catch (err) {
          log?.warn({ term, err: err.message }, "top8: falha em um termo");
          return null;
        }
      })
    );
    // dedupe por styleColor: dois termos podem cair no mesmo produto
    const seen = new Set();
    return results.filter((p) => {
      if (!p) return false;
      const k = p.styleColor || p.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function top8() {
    if (local) {
      const refs = await local.top8Refs();
      let raws;
      if (refs) raws = (await Promise.all(refs.map(ref => local.get(ref)))).filter(Boolean);
      else {
        const { products } = await local.list();
        const selected = top8Terms.map(term => products.find(p => normalizeQuery(p.name).includes(normalizeQuery(term)))).filter(Boolean);
        raws = [...new Map([...selected, ...products].map(p => [p.styleColor, p])).values()].slice(0, 8);
      }
      raws = raws.filter(raw => isByYou(raw) || isVerifiedAvailable(raw));
      if (restricted) raws = await restricted.filter(raws);
      const rate = raws.length ? await getRate() : null;
      const products = await Promise.all(raws.map(raw => enrich(raw, rate)));
      return { cached: true, stale: false, total: products.length, products };
    }
    const key = `top8:${await ns()}`;
    const { value, cached, stale } = await cache.getOrFetch(key, buildTop8);
    if (Array.isArray(value) && value.length) {
      const products = restricted ? await restricted.filter(value) : value;
      return { cached, stale, total: products.length, products };
    }
    // top8 vazio em cache (scraper/Nike estavam fora quando foi montado): tenta de novo agora,
    // e só grava se vier algo — um vazio nunca deve "colar" por 60 min.
    const fresh = await buildTop8();
    if (fresh.length) await cache.set(key, fresh);
    const products = restricted ? await restricted.filter(fresh) : fresh;
    return { cached: false, stale: false, total: products.length, products };
  }

  async function warmTop8() {
    try {
      const products = await buildTop8();
      if (!products.length) {
        log?.warn("top8: pré-aquecimento voltou vazio — não gravado no cache");
        return;
      }
      await cache.set(`top8:${await ns()}`, products);
      log?.info({ count: products.length }, "top8 pré-aquecido");
    } catch (err) {
      log?.warn({ err: err.message }, "top8: falha ao pré-aquecer");
    }
  }

  async function getProductSizes(styleColor, { fresh = false } = {}) {
    if (testProduct && isTestStyleColor(styleColor)) {
      const rate = await getRate().catch(() => null);
      return { cached: false, stale: false, product: buildTestProduct(rate) };
    }
    if (stock && stock.isStockCode(styleColor)) {
      // pronta entrega: sempre fresco do banco (disponibilidade por tamanho muda a cada venda)
      const product = await stock.getProductByCode(styleColor);
      return { cached: false, stale: false, product };
    }
    const key = `sizes:${await ns()}:${styleColor}`;
    const fetchSizes = async () => {
      let raw;
      try {
        raw = null; // Size selection and checkout always verify Nike, never the local snapshot.
        if (!raw) {
          raw = await scraper.getProductDetail(styleColor);
          if (local && raw.styleColor === styleColor && (!raw.productType || raw.productType === 'FOOTWEAR')) await local.upsert(raw);
        }
        if ((/^[A-Z0-9]{6}-[0-9]{3}$/i.test(styleColor) && raw.styleColor.toUpperCase() !== styleColor.toUpperCase()) || (raw.productType && raw.productType !== 'FOOTWEAR')) throw new Error('Produto Nike inválido');
      } catch (err) {
        if (!isSizesUnavailable(err)) throw err;
        if (/^[A-Z0-9]{6}-[0-9]{3}$/i.test(styleColor)) {
          if (local) await local.retire(styleColor);
          throw AppError.notFound('Este modelo ou cor não está disponível para compra na Nike US');
        }
        // By You designs have no SKU details. Find the item, then verify its
        // exact design ID against Nike's live search before offering it for sale.
        const { product: found } = await findOne(styleColor);
        if (!found?.byYou) { if (local) await local.retire(styleColor); throw err; }
        const live = await scraper.findOne(styleColor);
        if (live?.styleColor !== styleColor || !isByYou(live)) {
          if (local) await local.retire(styleColor);
          throw AppError.notFound('Design Nike By You indisponível');
        }
        if (local) await local.upsert(live);
        const current = await enrich(live, await getRate());
        const sizes = standardSizes();
        return { ...current, sizes, sizeGroups: sizeGroupsOf(sizes), sizesSynthetic: true, customization: BY_YOU_CUSTOMIZATION };
      }
      const rate = await getRate();
      const enriched = await enrich(raw, rate);
      // Converte os tamanhos usando o shared/sizes
      const sizes = (raw.sizes || []).map(s => {
        const { brSize, approximate } = convertUsToBr(s.nikeSize, s.localizedSize, raw.genders || []);
        // escala + números US por gênero ("M 7 / W 8.5") — o seletor separa Masculino × Feminino × Infantil
        const { scale, us } = parseUsSizes(s.nikeSize, s.localizedSize, raw.genders || []);
        return {
          nikeSize: s.nikeSize,
          localizedSize: s.localizedSize,
          brSize,
          brLabel: brSize ? String(brSize) : null,
          available: s.available,
          level: s.level,
          approximate,
          scale,
          us
        };
      });
      return { ...enriched, sizes, sizeGroups: sizeGroupsOf(sizes) };
    };
    // Explicit refresh waits for Nike; an upstream failure must never look like fresh stock.
    const refreshNow = () => {
      if (!liveRequests.has(styleColor)) {
        liveRequests.set(styleColor, fetchSizes().finally(() => liveRequests.delete(styleColor)));
      }
      return liveRequests.get(styleColor);
    };
    // Availability is never served stale, including callers that omit `fresh`.
    const value = await refreshNow();
    const cached = false, stale = false;
    await sizesCache.set(key, value);
    if (value && restricted && (await restricted.isBlocked(value))) return { cached, stale, product: null }; // restrito: página/checkout respondem 404
    return { cached, stale, product: value };
  }

  return { search, browse, findOne, getProductSizes, top8, warmTop8, getRate };
}

/** 404 do scraper em /product/:styleColor ("Sizes unavailable") — produto sem SKU na Nike (By You, descontinuado…). */
function isSizesUnavailable(err) {
  const msg = String(err?.message || "");
  const body = String(err?.details?.body || "");
  return err?.status === 404 || /respondeu 404/.test(msg) || /SIZES_UNAVAILABLE|PRODUCT_UNAVAILABLE/.test(body) || /SIZES_UNAVAILABLE/.test(msg);
}
