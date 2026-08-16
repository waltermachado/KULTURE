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
/**
 * Lançamento / pré-venda a partir dos sinais da Nike:
 *  - busca: badgeAttribute "SNKRS_COMING_SOON" | "SNKRS", featuredAttributes [COMING_SOON, LAUNCH, JUST_IN, BEST_SELLER, …]
 *  - detalhe: launchView.startEntryDate (abertura da venda), publishType "LAUNCH"
 * Só sinalização visual no site — o fluxo de compra é o mesmo (compramos assim que a Nike libera).
 */
export function launchInfo(raw) {
  const attrs = new Set(
    [...(Array.isArray(raw.featuredAttributes) ? raw.featuredAttributes : []), raw.badgeAttribute]
      .filter(Boolean)
      .map((a) => String(a).toUpperCase())
  );
  const date = raw.launch?.startEntryDate ?? null;
  const dateInFuture = date ? new Date(date).getTime() > Date.now() : false;
  const comingSoon = attrs.has("COMING_SOON") || attrs.has("SNKRS_COMING_SOON") || dateInFuture;
  const isLaunch = comingSoon || raw.isLaunch === true || raw.publishType === "LAUNCH" || attrs.has("LAUNCH") || attrs.has("SNKRS");
  if (!isLaunch && !attrs.has("BEST_SELLER") && !attrs.has("JUST_IN")) return null;
  return {
    isLaunch,
    comingSoon, // pré-venda: ainda não abriu na Nike US
    date, // ISO UTC ou null (só o detalhe do produto traz)
    label: raw.badgeLabel ?? null,
    bestSeller: attrs.has("BEST_SELLER"),
    justIn: attrs.has("JUST_IN")
  };
}

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
    launch: launchInfo(raw),
    nikeUrl: raw.url ?? null,
    cachedAt: new Date().toISOString()
  };
}
