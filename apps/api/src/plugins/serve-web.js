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
import { canonicalWebUrl } from "../lib/site-url.js";
import { pageSeo, seoHtml, PUBLIC_PAGES, escapeHtml } from "@kulture/shared/seo";

const PRODUCT_PAGE_RE = /^\/(?:pronta-entrega|hypados)\/([^/?#]+)\/?(?:[?#].*)?$/;
const baseUrl = app => {
  const url = new URL(canonicalWebUrl(app.env));
  if (app.env.NODE_ENV === "production") url.protocol = "https:";
  return url.origin;
};
export async function productPageHtml(app, request, indexHtml, knownProduct) {
  const pathname = new URL(request.raw.url, baseUrl(app)).pathname;
  const match = PRODUCT_PAGE_RE.exec(pathname);
  let product = knownProduct;
  if (product === undefined && match && app.stock?.getProductByRef) {
    product = await app.stock.getProductByRef(decodeURIComponent(match[1]));
  }
  return seoHtml(indexHtml, pageSeo(pathname, baseUrl(app), product), process.env.GOOGLE_SITE_VERIFICATION);
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

  const indexHtml = fs.readFileSync(indexFile, "utf8").replace("</head>", `<meta name="site-origin" content="${escapeHtml(baseUrl(app))}" /></head>`);

  // Trust only Fastify's configured proxy policy; never reflect an arbitrary Host in redirects.
  app.addHook("onRequest", async (request, reply) => {
    if (app.env.NODE_ENV === "production" && request.protocol === "http" && !request.url.startsWith("/health")) {
      return reply.code(308).redirect(`${baseUrl(app)}${request.raw.url.startsWith("/") ? request.raw.url : "/"}`);
    }
    if (app.env.NODE_ENV === "production" && request.protocol === "https") reply.header("Strict-Transport-Security", "max-age=31536000");
  });
  app.get("/robots.txt", async (_request, reply) => reply.type("text/plain; charset=utf-8").send(`User-agent: *\nAllow: /\nSitemap: ${baseUrl(app)}/sitemap.xml\n`));
  app.get("/sitemap.xml", async (_request, reply) => {
    try {
      const products = (await Promise.all([app.stock.listPublic({ section: "stock" }), app.stock.listPublic({ section: "hypados" })])).flat();
      const paths = [...new Set([...Object.keys(PUBLIC_PAGES), ...products.map(p => p.path)])];
      const xml = paths.map(p => `<url><loc>${escapeHtml(new URL(p, baseUrl(app)).href)}</loc></url>`).join("");
      return reply.header("Cache-Control", "public, max-age=300").type("application/xml; charset=utf-8").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${xml}</urlset>`);
    } catch (err) {
      app.log.error({ err }, "sitemap: catálogo indisponível");
      return reply.code(503).header("Retry-After", "60").send("Sitemap temporariamente indisponível");
    }
  });
  for (const route of Object.keys(PUBLIC_PAGES)) {
    app.get(route, async (request, reply) => reply.header("Cache-Control", "no-cache").type("text/html").send(await productPageHtml(app, request, indexHtml)));
  }

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
      let product;
      if (isProductPage) {
        const match = PRODUCT_PAGE_RE.exec(url);
        let ref;
        try { ref = decodeURIComponent(match[1]); } catch { return reply.code(400).send("URL inválida"); }
        product = await app.stock.getProductByRef(ref);
        if (!product) return reply.code(404).type("text/html").send(await productPageHtml(app, request, indexHtml, null));
        const current = new URL(url, baseUrl(app));
        if (current.pathname !== product.path) return reply.code(301).redirect(product.path + current.search);
      }
      const html = await productPageHtml(app, request, indexHtml, product);
      return reply.code(200).header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
    }
    return reply.code(404).send({ code: "NOT_FOUND", message: `Rota ${request.method} ${url} não encontrada` });
  });

  app.log.info({ dist }, "serve-web: servindo o front (SPA) pela api");
  return true;
}
