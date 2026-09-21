import { AppError } from "../../lib/errors.js";
import { stripStockInternal } from "../stock/service.js";

const productSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: ["string", "null"] },
    styleColor: { type: ["string", "null"] },
    name: { type: "string" },
    brand: { type: "string" },
    category: { type: ["string", "null"] },
    priceUsd: { type: "number" },
    price: { type: "object", additionalProperties: true },
    images: { type: "array", items: { type: "string" } }
  }
};

/** @param {import('fastify').FastifyInstance} app */
export async function catalogRoutes(app) {
  const catalog = app.catalog;

  // Helper to remove internal breakdown info from public API
  const stripInternal = (product) => {
    if (!product || !product.price) return product;
    if (product.source === "stock") return stripStockInternal(product); // pronta entrega: tira custo e ids internos
    const { breakdown, rulesApplied, ...publicPrice } = product.price;
    return { ...product, price: publicPrice };
  };

  app.get(
    "/api/search",
    {
      schema: {
        tags: ["catalog"],
        summary: "Busca de tênis (Nike US via scraper), já precificada em BRL",
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", minLength: 1, maxLength: 80 } }
        },
        response: {
          200: {
            type: "object",
            properties: {
              term: { type: "string" },
              cached: { type: "boolean" },
              stale: { type: "boolean" },
              total: { type: "integer" },
              products: { type: "array", items: productSchema }
            }
          }
        }
      }
    },
    async (req) => {
      const q = req.query.q.trim();
      if (!q) throw AppError.badRequest('Parâmetro "q" é obrigatório');
      const result = await catalog.search(q);
      return { ...result, products: result.products.map(stripInternal) };
    }
  );

  app.get('/api/imported', {
    schema: { querystring: { type: 'object', properties: {
      q: { type: 'string', maxLength: 80, default: '' }, size: { type: 'string', maxLength: 6, default: '' },
      offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 96, default: 48 }
    } } }
  }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const result = await catalog.browse(req.query);
    return { ...result, products: result.products.map(stripInternal) };
  });

  app.get(
    "/api/products/top8",
    { schema: { tags: ["catalog"], summary: "Os 8 destaques da home (pré-aquecidos)" } },
    async () => {
      const result = await catalog.top8();
      return { ...result, products: result.products.map(stripInternal) };
    }
  );

  app.get(
    "/api/product/:term",
    {
      schema: {
        tags: ["catalog"],
        summary: "Detalhe de um produto com tamanhos",
        params: { type: "object", properties: { term: { type: "string", minLength: 1 } } }
      }
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      // Usaremos o novo getProductSizes que traz os tamanhos
      const result = await catalog.getProductSizes(req.params.term, { fresh: true });
      if (!result.product) throw AppError.notFound("Produto não encontrado");
      
      // Filtra os indisponíveis a menos que ?all=true
      if (req.query.all !== 'true') {
        result.product = { ...result.product, sizes: result.product.sizes.filter(s => s.available) };
      }
      return { ...result, product: stripInternal(result.product) };
    }
  );

  app.get(
    "/api/rate",
    { schema: { tags: ["catalog"], summary: "Cotação USD-BRL em uso pela precificação" } },
    async () => catalog.getRate()
  );
}
