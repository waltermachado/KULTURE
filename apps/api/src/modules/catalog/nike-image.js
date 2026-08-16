/**
 * URLs de imagem da Nike (static.nike.com) — recorte e tamanho.
 *
 * A Nike serve as fotos de produto por uma CDN com transformações na URL:
 *   https://static.nike.com/a/images/<transformações>/<uuid>/<NOME>.png
 * O catálogo entrega URLs como
 *   t_default/u_9ddf04c7-…,c_scale,fl_relative,w_1.0,h_1.0,fl_layer_apply/<uuid>/NOME.png
 * onde `u_…fl_layer_apply` COMPÕE a foto sobre uma camada de fundo (o branco/cinza) e t_default = 320px.
 * O arquivo-mestre (<uuid>) é um recorte com transparência. Reescrevendo para
 *   w_1000,f_webp,q_auto/<uuid>/NOME.png
 * recebemos o tênis recortado, 1000px, webp com alpha (~60 KB) — verificado lendo os pixels (16/08/2026).
 * Qualquer URL fora desse padrão volta intacta.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cutoutUrl(url, { width = 1000, format = "webp" } = {}) {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (!/(^|\.)static\.nike\.com$/i.test(u.hostname)) return url;
    const parts = u.pathname.split("/").filter(Boolean); // ["a","images", ...transformações, uuid, nome]
    if (parts[0] !== "a" || parts[1] !== "images") return url;
    const idx = parts.findIndex((p) => UUID.test(p));
    if (idx < 2) return url;
    const rest = parts.slice(idx).join("/");
    return `https://static.nike.com/a/images/w_${width},f_${format},q_auto/${rest}`;
  } catch {
    return url;
  }
}

/** Aplica cutoutUrl a uma lista, removendo vazios e duplicatas (preserva a ordem). */
export function cutoutUrls(urls, opts) {
  const seen = new Set();
  const out = [];
  for (const u of Array.isArray(urls) ? urls : []) {
    const c = cutoutUrl(u, opts);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}
