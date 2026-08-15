/**
 * Converte o produto cru do scraper no contrato canônico do site, já precificado.
 * O preço NUNCA é calculado no front nem no scraper — só aqui, via @kulture/shared.
 */
import { calculateFinalPrice, DEFAULT_PRICING_RULES } from "@kulture/shared/pricing";

export function inferBrand(name = "") {
  const n = String(name).toLowerCase();
  if (n.includes("jordan")) return "Jordan";
  return "Nike";
}

/** Extrai categoria a partir do subtítulo da Nike ("Men's Basketball Shoes" → "basketball"). */
export function inferCategory(subtitle = "") {
  const s = String(subtitle).toLowerCase();
  const map = [
    ["basketball", "basketball"],
    ["running", "running"],
    ["tennis", "tennis"],
    ["soccer", "soccer"],
    ["football", "football"],
    ["training", "training"],
    ["skate", "skate"],
    ["golf", "golf"],
    ["lifestyle", "lifestyle"],
    ["shoes", "lifestyle"]
  ];
  for (const [needle, cat] of map) if (s.includes(needle)) return cat;
  return null;
}

/**
 * @param raw   produto do scraper: { id, styleColor, name, subtitle, priceUsd, fullPriceUsd, onSale, image, url, colorDescription }
 * @param opts  { rate: {ask, timestamp}, rules?, images: string[] (já espelhadas), imageSource: string[] }
 */
export function toProduct(raw, { rate, rules = DEFAULT_PRICING_RULES, images = [], imageSource = [] }) {
  const brand = inferBrand(raw.name);
  const category = inferCategory(raw.subtitle);
  const base = { brand, category, name: raw.name, styleColor: raw.styleColor };

  const pricing = calculateFinalPrice({ product: { ...base, priceUsd: raw.priceUsd }, exchangeRate: rate.ask, rules });

  let fullPriceBrl = null;
  if (raw.onSale && raw.fullPriceUsd != null && raw.fullPriceUsd > raw.priceUsd) {
    fullPriceBrl = calculateFinalPrice({ product: { ...base, priceUsd: raw.fullPriceUsd }, exchangeRate: rate.ask, rules }).costs
      .finalPriceBrl;
  }

  return {
    id: raw.id ?? raw.styleColor ?? null,
    styleColor: raw.styleColor ?? null,
    name: raw.name,
    subtitle: raw.subtitle ?? null,
    brand,
    category,
    colorDescription: raw.colorDescription ?? null,
    priceUsd: raw.priceUsd,
    fullPriceUsd: raw.fullPriceUsd ?? null,
    onSale: Boolean(raw.onSale),
    price: {
      brl: pricing.costs.finalPriceBrl,
      fullBrl: fullPriceBrl,
      breakdown: pricing.costs,
      rulesApplied: pricing.rulesApplied,
      exchange: { usdToBrl: pricing.exchange.usdToBrl, timestamp: rate.timestamp ?? null }
    },
    images,
    imageSource,
    nikeUrl: raw.url ?? null,
    cachedAt: new Date().toISOString()
  };
}
