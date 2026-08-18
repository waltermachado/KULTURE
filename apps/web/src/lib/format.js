export const brl = (v) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const usd = (v) =>
  v == null ? "—" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });

const PALETTE = ["#e33", "#F6B234", "#FFD167"];

/** Converte o produto da API no modelo do card (badge, cor do placeholder, imagem). */
export function toCard(p, i) {
  const brandLabel = p.brand === "Jordan" ? "Jordan" : p.category === "basketball" ? "Nike Basketball" : p.brand || "Nike";
  const isStock = p.source === "stock"; // pronta entrega (estoque próprio no Brasil)
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
    badge: isStock ? (p.badge || "PRONTA ENTREGA") : p.isTest ? "TESTE" : p.launch?.comingSoon ? "PRÉ-VENDA" : p.launch?.isLaunch ? "LANÇAMENTO" : p.onSale ? "PROMO" : i === 0 ? "#1 NBA" : "TOP",
    badgeRed: isStock ? Boolean(p.badge) : Boolean(p.isTest) || Boolean(p.onSale) || (i === 0 && !p.launch?.comingSoon),
    stock: isStock,
    stockQty: isStock ? (p.stock?.total ?? null) : null,
    description: p.description ?? null,
    launch: p.launch ?? null,
    pix: p.price?.pix !== false,
    installmentsLabel: p.price?.installments?.label || null,
    color: PALETTE[i % PALETTE.length],
    img: p.images?.[0] || "",
    nikeUrl: p.nikeUrl ?? null
  };
}

/** "23/08 às 11:00" (fuso do navegador) para a data de lançamento; null se não houver. */
export function launchDateLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " às");
}
