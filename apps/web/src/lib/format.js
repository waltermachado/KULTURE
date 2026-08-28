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
    badge: isStock ? (p.badge || (p.section === "hypados" ? "HYPADOS" : "PRONTA ENTREGA")) : p.isTest ? "TESTE" : p.byYou ? "BY YOU" : p.launch?.comingSoon ? "PRÉ-VENDA" : p.launch?.isLaunch ? "LANÇAMENTO" : p.onSale ? "PROMO" : i === 0 ? "#1 NBA" : "TOP",
    badgeRed: isStock ? Boolean(p.badge) : Boolean(p.isTest) || Boolean(p.onSale) || (i === 0 && !p.launch?.comingSoon),
    stock: isStock,
    section: p.section ?? (isStock ? "stock" : "import"),
    sectionLabel: p.sectionLabel ?? null,
    slug: p.slug ?? null,
    // estoque próprio tem página própria (link compartilhável): o card navega para ela em vez de abrir o modal
    href: isStock ? (p.path || (p.slug ? `${p.section === "hypados" ? "/hypados" : "/pronta-entrega"}/${p.slug}` : null)) : null,
    stockQty: isStock ? (p.stock?.total ?? null) : null,
    // pronta entrega: tamanhos BR com par disponível (filtro "Tamanho" da vitrine)
    sizesAvailable: isStock && Array.isArray(p.sizes) ? p.sizes.filter((s) => s.available).map((s) => String(s.brLabel)) : [],
    description: p.description ?? null,
    byYou: Boolean(p.byYou),
    category: p.category ?? null, // basketball | lifestyle | running (filtro da pronta entrega)
    launch: p.launch ?? null,
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

export const SIZE_GROUP_LABELS = { M: "Masculino", W: "Feminino", K: "Infantil" };

/**
 * Rótulo do tamanho que o CLIENTE vê: só a numeração BR ("BR 38"). O número US (modelagem) é informação interna —
 * fica no `size_label` do pedido para o backoffice comprar na Nike, mas não aparece no seletor, na sacola, no
 * checkout nem em "meus pedidos". Aceita um tamanho do catálogo ({ brLabel }) ou um item de pedido/sacola antiga
 * ({ sizeLabel: "BR 38 (US M 7)" }) — neste caso tira o "(US …)".
 */
export function sizeText(size) {
  if (!size) return "";
  const br = size.brLabel ?? size.brSize;
  if (br != null && String(br).trim() !== "") return `BR ${br}`;
  return String(size.sizeLabel || "").replace(/\s*\(US[^)]*\)/g, "").trim();
}

/** Nike By You: prazo de entrega prometido ao cliente (card e seletor). Sob encomenda na Nike → maior que o de linha. */
export const BY_YOU_DELIVERY_DAYS = 35;

/** É item de hypados? (carrinho antigo pode não ter `section` — o código HY- desempata) */
export const isHypadosItem = (it) => it?.section === "hypados" || String(it?.styleColor || "").toUpperCase().startsWith("HY-");

/** Nike By You: "pé E “KULTURE” nº 08 · pé D “MAMBA” nº 24" (só o preenchido); null se não houver personalização. */
export function customText(c) {
  if (!c || typeof c !== "object") return null;
  const foot = (t, n, lbl) => { const p = []; if (t) p.push(`“${t}”`); if (n) p.push(`nº ${n}`); return p.length ? `pé ${lbl} ${p.join(" ")}` : null; };
  const parts = [foot(c.textLeft, c.numberLeft, "E"), foot(c.textRight, c.numberRight, "D")].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Chave da personalização para o carrinho não juntar dois By You diferentes do mesmo tamanho. */
export function customKey(c) {
  if (!c) return "";
  const v = [c.textLeft, c.numberLeft, c.textRight, c.numberRight].map((x) => String(x || "").trim().toUpperCase());
  return v.some(Boolean) ? `|${v.join("~")}` : "";
}

/** Categorias da loja — mesmas 3 das abas do topo, dos blocos e do cadastro da pronta entrega. */
export const CATEGORIES = [
  { key: "basketball", label: "Basquete", q: "basketball shoes" },
  { key: "lifestyle", label: "Casual", q: "lifestyle shoes" },
  { key: "running", label: "Corrida", q: "running shoes" }
];
