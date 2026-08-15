/**
 * Serviço de catálogo: orquestra scraper → precificação → espelho de imagens → cache SWR.
 */
import { normalizeQuery } from "../../lib/normalize-query.js";
import { toProduct } from "./normalize.js";

const RATE_KEY = "rate:USD-BRL";

export function createCatalogService({ scraper, cache, images, rules, top8Terms = [], log = null }) {
  async function getRate() {
    // câmbio fica no mesmo cache SWR (fresco 1h; stale se o scraper cair)
    const { value } = await cache.getOrFetch(RATE_KEY, () => scraper.rate());
    return value;
  }

  async function enrich(raw, rate) {
    const imageSource = raw.image ? [raw.image] : [];
    const mirrored = await images.ensureImages(raw.styleColor || raw.id, imageSource);
    return toProduct(raw, { rate, rules, images: mirrored, imageSource });
  }

  async function search(query) {
    const term = normalizeQuery(query);
    const { value, cached, stale } = await cache.getOrFetch(`search:${term}`, async () => {
      const [{ products, total }, rate] = await Promise.all([scraper.search(query), getRate()]);
      const enriched = await Promise.all(products.map((p) => enrich(p, rate)));
      return { total: total ?? enriched.length, products: enriched };
    });
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
    return { cached, stale, total: value.length, products: value };
  }

  async function warmTop8() {
    try {
      const products = await buildTop8();
      await cache.set("top8", products);
      log?.info({ count: products.length }, "top8 pré-aquecido");
    } catch (err) {
      log?.warn({ err: err.message }, "top8: falha ao pré-aquecer");
    }
  }

  return { search, findOne, top8, warmTop8, getRate };
}
