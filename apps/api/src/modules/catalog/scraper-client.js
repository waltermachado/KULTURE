/**
 * Cliente HTTP do services/nike-scraper (único componente que fala com a Nike).
 * Contrato do scraper (README dele):
 *   GET /search?q=&count=&anchor=&convert=false → { term, total, products[], cached }
 *   GET /rate                                   → { pair, bid, ask, timestamp, ... }
 *   GET /health
 *
 * Pedimos SEMPRE convert=false: a precificação é responsabilidade do core (@kulture/shared).
 */
import { AppError } from "../../lib/errors.js";

export function createScraperClient({ baseUrl, timeoutMs = 20_000, fetchImpl = fetch }) {
  const base = String(baseUrl).replace(/\/$/, "");

  async function get(pathAndQuery) {
    let res;
    try {
      res = await fetchImpl(`${base}${pathAndQuery}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      // undici esconde o motivo real em err.cause (ECONNREFUSED, ENOTFOUND, ETIMEDOUT…)
      const cause = err.cause?.code || err.cause?.message || err.message;
      throw AppError.upstream("nike-scraper indisponível", { cause, target: base });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw AppError.upstream(`nike-scraper respondeu ${res.status}`, { body: body.slice(0, 200) });
    }
    return res.json();
  }

  /** Busca por termo; devolve produtos crus (USD) do scraper. */
  async function search(term, { count = 24, anchor = 0 } = {}) {
    const qs = new URLSearchParams({ q: term, count: String(count), anchor: String(anchor), convert: "false" });
    const data = await get(`/search?${qs}`);
    return {
      total: data?.total ?? null,
      products: Array.isArray(data?.products) ? data.products : []
    };
  }

  /**
   * O scraper (ainda) não tem rota de produto individual — busca pelo termo e escolhe
   * a melhor correspondência. Fase 1 troca por /product/:styleColor.
   * Pontuação: styleColor exato > todos os tokens do termo no nome > mais tokens > 1º resultado.
   */
  async function findOne(term) {
    const { products } = await search(term, { count: 24 }); // Nike só aceita 24|50|100
    if (!products.length) return null;
    const alvo = String(term).toLowerCase().trim();
    const tokens = alvo.split(/\s+/).filter(Boolean);
    let best = null;
    let bestScore = -1;
    for (const p of products) {
      const name = String(p.name || "").toLowerCase();
      let score = 0;
      if ((p.styleColor || "").toLowerCase() === alvo) score = 1000;
      else {
        const hits = tokens.filter((t) => name.split(/[^a-z0-9]+/).includes(t)).length;
        score = hits === tokens.length ? 100 + hits : hits;
      }
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return best ?? products[0];
  }

  async function rate() {
    const data = await get("/rate");
    if (!Number.isFinite(Number(data?.ask))) throw AppError.upstream("cotação inválida do scraper");
    return {
      pair: data.pair ?? "USD-BRL",
      bid: Number(data.bid),
      ask: Number(data.ask),
      timestamp: data.timestamp ?? null,
      source: data.source ?? "nike-scraper"
    };
  }

  async function getProductDetail(styleColor) {
    return get(`/product/${encodeURIComponent(styleColor)}`);
  }

  async function health() {
    return get("/health");
  }

  return { search, findOne, rate, getProductDetail, health, baseUrl: base };
}
