/**
 * Cliente da apps/api (kulture-core). Em dev o Vite faz proxy de /api e /media → :3000.
 * Contrato do produto (ver apps/api/src/modules/catalog/normalize.js):
 *   { id, styleColor, name, subtitle, brand, category, priceUsd, fullPriceUsd, onSale,
 *     price: { brl, fullBrl, breakdown, rulesApplied, exchange }, images[], nikeUrl }
 */
const API_BASE = import.meta.env.VITE_API_BASE || "";

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* sem corpo */
    }
    const err = new Error(body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }
  return res.json();
}

export const api = {
  top8: () => get("/api/products/top8"),
  search: (q) => get(`/api/search?q=${encodeURIComponent(q)}`),
  product: (term) => get(`/api/product/${encodeURIComponent(term)}`),
  rate: () => get("/api/rate"),
  health: () => get("/health"),
  /** estoque próprio: pronta entrega (padrão) ou hypados (cadastrados no backoffice; sem Nike) */
  stock: (section = "stock") => get(`/api/stock${section && section !== "stock" ? `?section=${section}` : ""}`),
  /** um tênis de estoque próprio pelo slug da URL (ou code PE-/HY-) — página própria /pronta-entrega/:ref e /hypados/:ref */
  stockProduct: (ref) => get(`/api/stock/${encodeURIComponent(ref)}`),
  /** tênis em destaque no hero (configurado no backoffice) por seção × categoria; product null = sem config */
  featured: (section, cat) => get(`/api/featured?section=${encodeURIComponent(section)}${cat ? `&cat=${encodeURIComponent(cat)}` : ""}`),
  /** configuração pública: { whatsapp: { phone, url } | null, installments, stock } */
  /** cupom de desconto: { ok, code, description, discountBrl } ou { ok:false, message } */
  validateCoupon: (code, subtotalBrl) =>
    fetch(`${API_BASE}/api/coupons/validate`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ code, subtotalBrl }) }).then((r) => r.json()),
  config: () => get("/api/config")
};

/** Fallback quando a API está fora — a home não fica vazia. */
export const SEED = [
  { styleColor: "seed-kobe6", name: "Kobe 6 Protro", brand: "Nike", price: { brl: 1899.9, fullBrl: null }, onSale: false, images: [] },
  { styleColor: "seed-kobe5", name: "Kobe 5 Protro", brand: "Nike", price: { brl: 1799.9, fullBrl: null }, onSale: false, images: [] },
  { styleColor: "seed-sabrina3", name: "Sabrina 3", brand: "Nike", price: { brl: 1199.9, fullBrl: 1349.9 }, onSale: true, images: [] },
  { styleColor: "seed-kobe4", name: "Kobe 4 Protro", brand: "Nike", price: { brl: 1749.9, fullBrl: null }, onSale: false, images: [] },
  { styleColor: "seed-kd18", name: "KD 18", brand: "Nike", price: { brl: 1399.9, fullBrl: 1549.9 }, onSale: true, images: [] },
  { styleColor: "seed-gtcut3", name: "GT Cut 3", brand: "Nike", price: { brl: 1599.9, fullBrl: null }, onSale: false, images: [] },
  { styleColor: "seed-ja3", name: "Ja 3", brand: "Nike", price: { brl: 1149.9, fullBrl: null }, onSale: false, images: [] },
  { styleColor: "seed-kobe8", name: "Kobe 8 Protro", brand: "Nike", price: { brl: 1699.9, fullBrl: null }, onSale: false, images: [] }
];
