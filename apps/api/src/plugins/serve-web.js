/**
 * Serve o build do apps/web (Vite) pela própria api — mesma origem, sem CORS,
 * cookie httpOnly do refresh funciona sem SameSite=None.
 *
 * Em desenvolvimento não faz nada (o Vite serve o front e faz proxy de /api).
 * Em produção (Docker) o build fica em apps/web/dist e é servido daqui:
 *   - /assets/*   → cache longo (nomes com hash)
 *   - /index.html → sem cache
 *   - qualquer rota que não seja /api, /media, /docs, /health → index.html (SPA)
 *   - /pronta-entrega/:ref e /hypados/:ref → index.html com <title> e Open Graph do tênis (nome, preço, foto),
 *     para o link colado no Instagram/WhatsApp mostrar o par no preview. A página em si é a SPA.
 *
 * Chamado de server.js DEPOIS de buildApp() e ANTES de listen().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { resolveWebUrl } from "../lib/site-url.js";

const PRODUCT_PAGE_RE = /^\/(?:pronta-entrega|hypados)\/([^/?#]+)\/?(?:[?#].*)?$/;
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** index.html com as metas do tênis (ou o index puro se a URL não for de produto / o produto não existir). */
export async function productPageHtml(app, request, indexHtml) {
  const m = PRODUCT_PAGE_RE.exec(request.raw.url || "");
  if (!m || !app.stock?.getProductByRef) return indexHtml;
  try {
    let ref = m[1];
    try { ref = decodeURIComponent(ref); } catch { /* mantém cru */ }
    const product = await app.stock.getProductByRef(ref);
    if (!product) return indexHtml;
    const base = resolveWebUrl(app.env, `${request.protocol}://${request.host}`);
    const url = new URL(product.path, base).href;
    const image = product.images?.[0] ? new URL(product.images[0], base).href : null;
    const price = product.price?.brl != null ? brl(product.price.brl) : null;
    const title = `${product.name}${price ? ` — ${price} no Pix` : ""} | Kulture`;
    const soldOut = !(product.stock?.total > 0);
    const availability = soldOut
      ? " · esgotado"
      : product.section === "hypados"
        ? " · garimpado nos EUA · importamos pra você · frete grátis"
        : " · em estoque no Brasil · envio imediato · frete grátis";
    const description = [
      `${product.sectionLabel || "Pronta entrega"}${availability}`,
      product.description
    ].filter(Boolean).join(" — ").replace(/\s+/g, " ").slice(0, 300);
    const tags = [
      ["property", "og:type", "product"],
      ["property", "og:site_name", "Kulture"],
      ["property", "og:title", title],
      ["property", "og:description", description],
      ["property", "og:url", url],
      image ? ["property", "og:image", image] : null,
      ["name", "twitter:card", image ? "summary_large_image" : "summary"],
      ["name", "twitter:title", title],
      ["name", "twitter:description", description],
      image ? ["name", "twitter:image", image] : null,
      product.price?.brl != null ? ["property", "product:price:amount", String(product.price.brl)] : null,
      product.price?.brl != null ? ["property", "product:price:currency", "BRL"] : null
    ].filter(Boolean).map(([k, name, content]) => `<meta ${k}="${esc(name)}" content="${esc(content)}" />`);
    return indexHtml
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(description)}" />`)
      .replace("</head>", `    <link rel="canonical" href="${esc(url)}" />\n    ${tags.join("\n    ")}\n  </head>`);
  } catch (err) {
    app.log?.warn({ err: err.message, url: request.raw.url }, "serve-web: falha ao montar metas do produto");
    return indexHtml;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.resolve(__dirname, "../../../web/dist");
const API_PREFIXES = ["/api", "/media", "/docs", "/health"];

export async function serveWeb(app, { dist = process.env.WEB_DIST || DEFAULT_DIST } = {}) {
  const indexFile = path.join(dist, "index.html");
  if (!fs.existsSync(indexFile)) {
    app.log.info({ dist }, "serve-web: build do front não encontrado — pulando (dev usa o Vite)");
    return false;
  }

  const indexHtml = fs.readFileSync(indexFile, "utf8");

  await app.register(fastifyStatic, {
    root: dist,
    prefix: "/",
    wildcard: false, // registra só os arquivos existentes; o fallback SPA fica no 404 handler
    index: false,
    decorateReply: false,
    // @fastify/static v10: fn(reply, filePath, stat) — `reply` é o Reply do Fastify
    setHeaders(reply, filePath) {
      if (filePath.endsWith("index.html")) {
        reply.header("Cache-Control", "no-cache");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
      }
    }
  });

  app.setNotFoundHandler(async (request, reply) => {
    const url = request.raw.url || "/";
    const isApi = API_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
    const wantsHtml = (request.headers.accept || "").includes("text/html");
    // bots de preview (WhatsApp/Instagram/Telegram) nem sempre mandam Accept: text/html — página de produto responde HTML mesmo assim
    const isProductPage = PRODUCT_PAGE_RE.test(url);
    if (!isApi && (request.method === "GET" || request.method === "HEAD") && (wantsHtml || isProductPage)) {
      const html = isProductPage ? await productPageHtml(app, request, indexHtml) : indexHtml;
      return reply.code(200).header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
    }
    return reply.code(404).send({ code: "NOT_FOUND", message: `Rota ${request.method} ${url} não encontrada` });
  });

  app.log.info({ dist }, "serve-web: servindo o front (SPA) pela api");
  return true;
}
