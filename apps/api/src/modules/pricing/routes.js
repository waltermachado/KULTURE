/**
 * Acréscimos de preço por tipo de tênis (backoffice, role=admin).
 *   GET /api/admin/pricing           { rules, version, base, scopes, categories }
 *   PUT /api/admin/pricing           { rules: [...] } → salva a lista inteira (valida) e invalida o cache do catálogo
 *   GET /api/admin/pricing/test?q=   busca na Nike com as regras ATUAIS e mostra preço + quais acréscimos bateram
 */
import { AppError } from "../../lib/errors.js";
import { requireAdmin } from "../../lib/guards.js";
import { SCOPES, CATEGORY_KEYS } from "./service.js";

const RULE = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: ["string", "null"], maxLength: 60 },
    name: { type: "string", maxLength: 80 },
    scope: { type: "string", enum: Object.keys(SCOPES) },
    terms: { anyOf: [{ type: "array", items: { type: "string", maxLength: 80 }, maxItems: 30 }, { type: "string", maxLength: 600 }] },
    extraFixedBrl: { anyOf: [{ type: "number" }, { type: "string", maxLength: 20 }, { type: "null" }] },
    extraPct: { anyOf: [{ type: "number" }, { type: "string", maxLength: 20 }, { type: "null" }] },
    extraRate: { type: ["number", "null"] },
    active: { type: "boolean" }
  }
};

/** @param {import('fastify').FastifyInstance} app */
export async function pricingRoutes(app) {
  const pricing = app.pricing;
  const adm = (extra = {}) => ({ onRequest: [requireAdmin], schema: { tags: ["admin"], ...extra } });
  const meta = () => ({ scopes: SCOPES, categories: CATEGORY_KEYS });

  app.get("/api/admin/pricing", adm({ summary: "Acréscimos de preço por tipo de tênis" }), async () => ({ ...(await pricing.list()), ...meta() }));

  app.put("/api/admin/pricing", adm({ summary: "Salva a lista de acréscimos", body: { type: "object", required: ["rules"], properties: { rules: { type: "array", items: RULE, maxItems: 50 } } } }), async (request) => ({
    ...(await pricing.save(request.body.rules, request.admin)),
    ...meta()
  }));

  app.get("/api/admin/pricing/test", adm({ summary: "Testa as regras com um tênis (busca na Nike)", querystring: { type: "object", required: ["q"], properties: { q: { type: "string", minLength: 2, maxLength: 80 } } } }), async (request) => {
    const { rules } = await pricing.list();
    const names = Object.fromEntries(rules.map((r) => [r.id, r.name]));
    let result;
    try {
      result = await app.catalog.search(request.query.q);
    } catch (err) {
      throw AppError.badRequest(`Não deu para buscar na Nike agora: ${err.message}`);
    }
    const products = (result.products || []).slice(0, 8).map((p) => {
      const applied = p.price?.rulesApplied || {};
      const matched = (applied.matchedRuleIds || []).filter((id) => id !== "default");
      return {
        name: p.name,
        styleColor: p.styleColor,
        brand: p.brand,
        category: p.category,
        priceUsd: p.priceUsd,
        priceBrl: p.price?.brl ?? null,
        extraFixedBrl: applied.extraFixedBrl ?? 0,
        extraRate: applied.extraRate ?? 0,
        matched: matched.map((id) => names[id] || id)
      };
    });
    return { q: request.query.q, total: products.length, cached: Boolean(result.cached), products };
  });
}
