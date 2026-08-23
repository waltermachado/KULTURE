/**
 * Serviço de catálogo: orquestra scraper → precificação → espelho de imagens → cache SWR.
 */
import { normalizeQuery } from "../../lib/normalize-query.js";
import { cutoutUrls } from "./nike-image.js";
import { toProduct, BY_YOU_CUSTOMIZATION } from "./normalize.js";
import { isTestTerm, isTestStyleColor, buildTestProduct } from "./test-product.js";
import { convertUsToBr, parseUsSizes, sizeGroupsOf, standardSizes } from "@kulture/shared/sizes";

const RATE_KEY = "rate:USD-BRL:v2"; // v2 = traz `tourism` (dólar turismo)
const MAX_IMAGES = 8; // galeria do produto: até 8 ângulos (o resto é marketing)
// namespace das chaves de cache do catálogo: mudou o formato das imagens (v2 = recorte) → chaves novas,
// senão cards/busca ficariam até 1h servindo os PNGs opacos antigos.
// v3 só calçados · v4 launch · v5 nova precificação (turismo, 7%, ↑99) · v6 LeBron 23 +R$300 ·
// v7 acréscimos editáveis no painel: o namespace ganha a VERSÃO das regras (salvou → chaves novas → preço recalculado) ·
// v8 escala feminina derivada da masculina (BR único por par físico)
const BASE_NS = "v8";

/**
 * `stock` (opcional) = serviço de pronta entrega: códigos PE-XXXXXX são respondidos do banco em
 * getProductSizes() — é o único ponto que o seletor de tamanho e o checkout usam, então o produto de
 * estoque passa pelo mesmo fluxo (preço validado no servidor, snapshot no pedido) sem tocar em orders/.
 */
export function createCatalogService({ scraper, cache, sizesCache, images, rules, top8Terms = [], testProduct = false, stock = null, log = null }) {
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

  async function search(query) {
    const term = normalizeQuery(query);
    if (testProduct && isTestTerm(query)) {
      // produto de teste de pagamento: só com o termo exato, nunca em buscas parciais nem no top8
      const rate = await getRate().catch(() => null);
      return { term, cached: false, stale: false, total: 1, products: [buildTestProduct(rate)] };
    }
    const key = `search:${await ns()}:${term}`;
    const fetchSearch = async () => {
      const [{ products, total }, rate] = await Promise.all([scraper.search(query), getRate()]);
      const enriched = await Promise.all(products.map((p) => enrich(p, rate)));
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
    return { term, cached, stale, total: value.products.length, products: value.products };
  }

  async function findOne(termOrStyleColor) {
    const term = normalizeQuery(termOrStyleColor);
    const key = `product:${await ns()}:${term}`;
    const fetchOne = async () => {
      const [raw, rate] = await Promise.all([scraper.findOne(String(termOrStyleColor).replace(/-/g, " ")), getRate()]);
      return raw ? await enrich(raw, rate) : null;
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
    return { cached, stale, product: value };
  }

  async function buildTop8() {
    const rate = await getRate();
    const results = await Promise.all(
      top8Terms.map(async (term) => {
        try {
          const raw = await scraper.findOne(term);
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
    const key = `top8:${await ns()}`;
    const { value, cached, stale } = await cache.getOrFetch(key, buildTop8);
    if (Array.isArray(value) && value.length) return { cached, stale, total: value.length, products: value };
    // top8 vazio em cache (scraper/Nike estavam fora quando foi montado): tenta de novo agora,
    // e só grava se vier algo — um vazio nunca deve "colar" por 60 min.
    const fresh = await buildTop8();
    if (fresh.length) await cache.set(key, fresh);
    return { cached: false, stale: false, total: fresh.length, products: fresh };
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

  async function getProductSizes(styleColor) {
    if (testProduct && isTestStyleColor(styleColor)) {
      const rate = await getRate().catch(() => null);
      return { cached: false, stale: false, product: buildTestProduct(rate) };
    }
    if (stock && stock.isStockCode(styleColor)) {
      // pronta entrega: sempre fresco do banco (disponibilidade por tamanho muda a cada venda)
      const product = await stock.getProductByCode(styleColor);
      return { cached: false, stale: false, product };
    }
    const { value, cached, stale } = await sizesCache.getOrFetch(`sizes:${await ns()}:${styleColor}`, async () => {
      let raw;
      try {
        raw = await scraper.getProductDetail(styleColor);
      } catch (err) {
        if (!isSizesUnavailable(err)) throw err;
        // Nike By You (customizado): não existe SKU/tamanhos na API da Nike. O id do design é pesquisável na
        // busca → pega o produto (nome, preço) por lá e oferece a tabela padrão de tamanhos; o cliente escolhe o
        // seu número e personaliza (texto/número por pé); o dono confirma na Nike By You antes de comprar.
        const { product: found } = await findOne(styleColor);
        if (!found?.byYou) throw err;
        const sizes = standardSizes();
        return { ...found, sizes, sizeGroups: sizeGroupsOf(sizes), sizesSynthetic: true, customization: BY_YOU_CUSTOMIZATION };
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
    });
    return { cached, stale, product: value };
  }

  return { search, findOne, getProductSizes, top8, warmTop8, getRate };
}

/** 404 do scraper em /product/:styleColor ("Sizes unavailable") — produto sem SKU na Nike (By You, descontinuado…). */
function isSizesUnavailable(err) {
  const msg = String(err?.message || "");
  const body = String(err?.details?.body || "");
  return err?.status === 404 || /respondeu 404/.test(msg) || /SIZES_UNAVAILABLE/.test(body) || /SIZES_UNAVAILABLE/.test(msg);
}
