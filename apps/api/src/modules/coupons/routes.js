/**
 * Cupons de desconto.
 *   Público:  POST /api/coupons/validate { code, subtotalBrl }  → { ok, code, description, discountBrl } | { ok:false, message }
 *   Admin:    GET/POST /api/admin/coupons · PATCH/DELETE /api/admin/coupons/:id
 */
import { requireAdmin } from "../../lib/guards.js";

const COUPON_BODY = {
  type: "object",
  additionalProperties: false,
  properties: {
    code: { type: "string", maxLength: 40 },
    kind: { type: "string", enum: ["percent", "fixed"] },
    value: { anyOf: [{ type: "number" }, { type: "string", maxLength: 20 }] },
    minSubtotalBrl: { anyOf: [{ type: "number" }, { type: "string", maxLength: 20 }, { type: "null" }] },
    maxDiscountBrl: { anyOf: [{ type: "number" }, { type: "string", maxLength: 20 }, { type: "null" }] },
    startsAt: { type: ["string", "null"] },
    endsAt: { type: ["string", "null"] },
    maxUses: { anyOf: [{ type: "integer" }, { type: "string", maxLength: 10 }, { type: "null" }] },
    active: { type: "boolean" },
    note: { type: ["string", "null"], maxLength: 300 }
  }
};

/** @param {import('fastify').FastifyInstance} app */
export async function couponRoutes(app) {
  const coupons = app.coupons;
  const adm = (extra = {}) => ({ onRequest: [requireAdmin], schema: { tags: ["admin"], ...extra } });

  app.post(
    "/api/coupons/validate",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, // ninguém vai ficar chutando código
      schema: { tags: ["orders"], summary: "Confere um cupom e mostra o desconto para o subtotal", body: { type: "object", required: ["code"], properties: { code: { type: "string", maxLength: 40 }, subtotalBrl: { type: "number", minimum: 0 } } } }
    },
    async (request) => coupons.validate(request.body.code, request.body.subtotalBrl ?? 0)
  );

  app.get("/api/admin/coupons", adm({ summary: "Lista de cupons" }), async () => ({ coupons: await coupons.list() }));
  app.post("/api/admin/coupons", adm({ summary: "Cria cupom", body: { ...COUPON_BODY, required: ["code", "kind", "value"] } }), async (request, reply) => reply.code(201).send({ coupon: await coupons.create(request.body, request.admin) }));
  app.patch("/api/admin/coupons/:id", adm({ summary: "Edita cupom", body: COUPON_BODY }), async (request) => ({ coupon: await coupons.update(request.params.id, request.body || {}, request.admin) }));
  app.delete("/api/admin/coupons/:id", adm({ summary: "Remove cupom" }), async (request) => coupons.remove(request.params.id));
}
