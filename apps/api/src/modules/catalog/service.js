/**
 * Serviço de catálogo: orquestra scraper → precificação → espelho de imagens → cache SWR.
 */
import { normalizeQuery } from "../../lib/normalize-query.js";
import { toProduct } from "./normalize.js";
import { convertUsToBr } from "@kulture/shared/sizes";

const RATE_KEY = "rate:USD-BRL";

export function createCatalogService({ scraper, cache, sizesCache, images, rules, top8Terms = [], log = null }) {
  const validRate = (r) => r && typeof r === "object" && Number.isFinite(Number(r.ask)) && Number(r.ask) > 0;

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
    const imageSource = raw.image ? [raw.image] : [];
    const mirrored = await images.ensureImages(raw.styleColor || raw.id, imageSource);
    return toProduct(raw, { rate, rules, images: mirrored, imageSource });
  }

  async function search(query) {
    const term = normalizeQuery(query);
    const key = `search:${term}`;
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
    const { value, cached, stale } = await cache.getOrFetch(`product:${term}`, async () => {
      const [raw, rate] = await Promise.all([scraper.findOne(String(termOrStyleColor).replace(/-/g, " ")), getRate()]);
      return raw ? await enrich(raw, rate) : null;
    });
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
    const { value, cached, stale } = await cache.getOrFetch("top8", buildTop8);
    if (Array.isArray(value) && value.length) return { cached, stale, total: value.length, products: value };
    // top8 vazio em cache (scraper/Nike estavam fora quando foi montado): tenta de novo agora,
    // e só grava se vier algo — um vazio nunca deve "colar" por 60 min.
    const fresh = await buildTop8();
    if (fresh.length) await cache.set("top8", fresh);
    return { cached: false, stale: false, total: fresh.length, products: fresh };
  }

  async function warmTop8() {
    try {
      const products = await buildTop8();
      if (!products.length) {
        log?.warn("top8: pré-aquecimento voltou vazio — não gravado no cache");
        return;
      }
      await cache.set("top8", products);
      log?.info({ count: products.length }, "top8 pré-aquecido");
    } catch (err) {
      log?.warn({ err: err.message }, "top8: falha ao pré-aquecer");
    }
  }

  async function getProductSizes(styleColor) {
    const { value, cached, stale } = await sizesCache.getOrFetch(`sizes:${styleColor}`, async () => {
      const [raw, rate] = await Promise.all([scraper.getProductDetail(styleColor), getRate()]);
      const enriched = await enrich(raw, rate);
      // Converte os tamanhos usando o shared/sizes
      const sizes = (raw.sizes || []).map(s => {
        const { brSize, approximate } = convertUsToBr(s.nikeSize, s.localizedSize, raw.genders || []);
        return {
          nikeSize: s.nikeSize,
          localizedSize: s.localizedSize,
          brSize,
          brLabel: brSize ? String(brSize) : null,
          available: s.available,
          level: s.level,
          approximate
        };
      });
      return { ...enriched, sizes };
    });
    return { cached, stale, product: value };
  }

  return { search, findOne, getProductSizes, top8, warmTop8, getRate };
}
