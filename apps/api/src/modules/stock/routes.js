/**
 * Pronta entrega — rotas públicas.
 *   GET /api/stock              lista os produtos ativos (mesmo contrato do catálogo + sizes/description)
 *   GET /media/estoque/:id      foto enviada pelo backoffice (guardada no banco)
 * O detalhe com tamanhos continua em GET /api/product/:code (o catálogo intercepta o prefixo PE-).
 */
import { AppError } from "../../lib/errors.js";
import { stripStockInternal } from "./service.js";

/** @param {import('fastify').FastifyInstance} app */
export async function stockRoutes(app) {
  const stock = app.stock;

  app.get(
    "/api/stock",
    {
      schema: {
        tags: ["catalog"],
        summary: "Estoque próprio — pronta entrega (padrão) ou hypados (?section=hypados), sem consulta à Nike",
        querystring: { type: "object", properties: { section: { type: "string", enum: ["stock", "hypados"] } } }
      }
    },
    async (req) => {
      const section = req.query.section || "stock";
      const products = (await stock.listPublic({ section })).map(stripStockInternal);
      return { total: products.length, products, source: "stock", section };
    }
  );

  app.get(
    "/media/estoque/:id",
    {
      config: { rateLimit: false }, // fotos são baratas e imutáveis — não podem consumir o limite da API
      schema: { tags: ["catalog"], summary: "Foto de produto de pronta entrega", params: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 64 } } } }
    },
    async (req, reply) => {
      const img = await stock.getImage(req.params.id);
      if (!img) throw AppError.notFound("Imagem não encontrada");
      reply
        .header("Content-Type", img.mime)
        .header("Content-Length", String(img.bytes))
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("X-Content-Type-Options", "nosniff");
      return reply.send(Buffer.from(img.data));
    }
  );
}
