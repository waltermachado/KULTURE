/**
 * Bling — conexão OAuth (a emissão de NF-e usa esta conexão).
 *   GET  /api/bling/callback           (público) volta do OAuth: valida state, troca o code, guarda os tokens
 *   GET  /api/admin/bling/status       conectado? empresa? validade do token? (com erro cru quando a API recusa)
 *   POST /api/admin/bling/connect      devolve a URL de autorização (o painel abre em nova aba)
 *   POST /api/admin/bling/disconnect   apaga os tokens
 */
import { requireAdmin } from "../../lib/guards.js";
import { canonicalWebUrl } from "../../lib/site-url.js";
import { callbackPage } from "./service.js";

/** @param {import('fastify').FastifyInstance} app */
export async function blingRoutes(app) {
  const bling = app.bling;
  const adm = (extra = {}) => ({ onRequest: [requireAdmin], schema: { tags: ["admin"], ...extra } });

  app.get("/api/bling/callback", {
    schema: { tags: ["admin"], summary: "Retorno do OAuth do Bling", querystring: { type: "object", properties: { code: { type: "string", maxLength: 200 }, state: { type: "string", maxLength: 120 }, error: { type: "string", maxLength: 200 } } } }
  }, async (request, reply) => {
    let ok = false, message = "";
    try {
      if (request.query.error) throw new Error(`o Bling recusou a autorização (${request.query.error})`);
      await bling.handleCallback({ code: request.query.code, state: request.query.state });
      ok = true;
    } catch (err) {
      message = err.message;
      app.log.warn({ err: err.message }, "bling: callback falhou");
    }
    return reply.code(ok ? 200 : 400).header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(callbackPage({ ok, message, siteUrl: canonicalWebUrl(app.env) }));
  });

  app.get("/api/admin/bling/status", adm({ summary: "Estado da conexão com o Bling" }), async () => bling.status());
  app.post("/api/admin/bling/connect", adm({ summary: "URL de autorização OAuth" }), async () => bling.authorizeUrl());
  app.post("/api/admin/bling/disconnect", adm({ summary: "Desconecta (apaga os tokens)" }), async () => bling.disconnect());
}
