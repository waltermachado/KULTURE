/**
 * Serve o build do apps/web (Vite) pela própria api — mesma origem, sem CORS,
 * cookie httpOnly do refresh funciona sem SameSite=None.
 *
 * Em desenvolvimento não faz nada (o Vite serve o front e faz proxy de /api).
 * Em produção (Docker) o build fica em apps/web/dist e é servido daqui:
 *   - /assets/*   → cache longo (nomes com hash)
 *   - /index.html → sem cache
 *   - qualquer rota que não seja /api, /media, /docs, /health → index.html (SPA)
 *
 * Chamado de server.js DEPOIS de buildApp() e ANTES de listen().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";

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

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url || "/";
    const isApi = API_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
    const wantsHtml = (request.headers.accept || "").includes("text/html");
    if (!isApi && (request.method === "GET" || request.method === "HEAD") && wantsHtml) {
      return reply.code(200).header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(indexHtml);
    }
    return reply.code(404).send({ code: "NOT_FOUND", message: `Rota ${request.method} ${url} não encontrada` });
  });

  app.log.info({ dist }, "serve-web: servindo o front (SPA) pela api");
  return true;
}
