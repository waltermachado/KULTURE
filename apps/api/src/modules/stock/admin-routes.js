/**
 * Backoffice — pronta entrega (/api/admin/stock/*). Todas exigem role=admin.
 *
 *   GET    /api/admin/stock?q=&all=1        lista (inclui inativos por padrão)
 *   POST   /api/admin/stock                 cria { name, priceBrl, sizes[], images[], … }
 *   GET    /api/admin/stock/:id             detalhe
 *   PATCH  /api/admin/stock/:id             atualiza (parcial; `sizes`/`images` substituem a lista)
 *   DELETE /api/admin/stock/:id             remove (fotos e tamanhos em cascata)
 *   POST   /api/admin/stock/:id/images      { dataUrl } → grava a foto no banco e anexa ao produto
 */
import { requireAdmin } from "../../lib/guards.js";

const ID_PARAMS = { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 64 } }, required: ["id"] };

/** @param {import('fastify').FastifyInstance} app */
export async function stockAdminRoutes(app) {
  const stock = app.stock;
  app.addHook("onRequest", requireAdmin);
  const tags = ["admin"];

  app.get("/api/admin/stock", {
    schema: { tags, querystring: { type: "object", properties: { q: { type: "string" }, all: { type: "string" } } } }
  }, async (request) => {
    const products = await stock.list({ q: request.query.q || "", includeInactive: request.query.all !== "0" });
    return { total: products.length, products };
  });

  app.post("/api/admin/stock", { schema: { tags } }, async (request, reply) => {
    const product = await stock.create(request.body);
    reply.code(201);
    return product;
  });

  app.get("/api/admin/stock/:id", { schema: { tags, params: ID_PARAMS } }, async (request) => stock.get(request.params.id));

  app.patch("/api/admin/stock/:id", { schema: { tags, params: ID_PARAMS } }, async (request) => stock.update(request.params.id, request.body));

  app.delete("/api/admin/stock/:id", { schema: { tags, params: ID_PARAMS } }, async (request) => stock.remove(request.params.id));

  app.post("/api/admin/stock/:id/images", {
    bodyLimit: 8 * 1024 * 1024, // data URL base64 (~1,37× o binário; a foto já vem redimensionada do painel)
    schema: { tags, params: ID_PARAMS, body: { type: "object", properties: { dataUrl: { type: "string" }, data: { type: "string" }, mime: { type: "string" } } } }
  }, async (request, reply) => {
    const r = await stock.addImage(request.params.id, request.body || {});
    reply.code(201);
    return r;
  });
}
