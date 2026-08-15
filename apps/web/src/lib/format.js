export const brl = (v) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const usd = (v) =>
  v == null ? "—" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });

const PALETTE = ["#e33", "#F6B234", "#FFD167"];

/** Converte o produto da API no modelo do card (badge, cor do placeholder, imagem). */
export function toCard(p, i) {
  const brandLabel = p.brand === "Jordan" ? "Jordan" : p.category === "basketball" ? "Nike Basketball" : p.brand || "Nike";
  return {
    key: p.styleColor || p.id || `${p.name}-${i}`,
    styleColor: p.styleColor ?? null,
    name: p.name,
    brand: brandLabel,
    subtitle: p.subtitle ?? null,
    colorDescription: p.colorDescription ?? null,
    price: p.price?.brl ?? null,
    old: p.price?.fullBrl ?? null,
    priceUsd: p.priceUsd ?? null,
    breakdown: p.price?.breakdown ?? null,
    badge: p.onSale ? "PROMO" : i === 0 ? "#1 NBA" : "TOP",
    badgeRed: Boolean(p.onSale) || i === 0,
    color: PALETTE[i % PALETTE.length],
    img: p.images?.[0] || "",
    nikeUrl: p.nikeUrl ?? null
  };
}
