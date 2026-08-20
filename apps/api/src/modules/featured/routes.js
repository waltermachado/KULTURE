/**
 * Vitrine — o tênis exibido no hero de cada seção, configurável no backoffice por seção × categoria.
 *
 *   GET /api/featured?section=import|stock|hypados&cat=basketball|lifestyle|running
 *       → { section, cat, key, product|null }  (produto no mesmo contrato dos cards; sem breakdown/ids internos)
 *       Sem `cat` (ou categoria sem destaque próprio) cai no slot "default" da seção. Sem config → null
 *       e o front usa o comportamento antigo (1º produto da lista).
 *
 *   GET /api/admin/featured   → { slots, resolved } (config crua + prévia por slot)
 *   PUT /api/admin/featured   → { slots: { "import:basketball": { ref, name?, image? } | null, … } }
 *       O tipo é implícito pela seção: import = SKU Nike (busca ao vivo); stock/hypados = código PE-/HY-
 *       de produto cadastrado NA MESMA seção (validado no save).
 *
 * Config vive na tabela `settings` (key "featured", value = mapa de slots) — sobrevive a deploy e não
 * depende de env. Falha na resolução (SKU sumiu da Nike, produto desativado) nunca derruba a página:
 * devolve product null e o front usa o fallback.
 */
import { AppError } from "../../lib/errors.js";
import { requireAdmin } from "../../lib/guards.js";
import { isStockCode } from "../stock/service.js";

export const FEATURED_KEY = "featured";
export const FEATURED_SECTIONS = ["import", "stock", "hypados"];
export const FEATURED_CATS = ["default", "basketball", "lifestyle", "running"];

const slotKey = (section, cat) => `${section}:${cat}`;
const validSlot = (k) => {
  const [section, cat] = String(k).split(":");
  return FEATURED_SECTIONS.includes(section) && FEATURED_CATS.includes(cat);
};

/** Tira tudo que é interno antes de responder ao público (mesma regra do catálogo) e enxuga para o hero. */
function toPublicCard(product) {
  if (!product) return null;
  const { sizes, stockProductId, cachedAt, ...rest } = product;
  const out = { ...rest };
  if (out.price) {
    const { breakdown, rulesApplied, ...publicPrice } = out.price;
    out.price = publicPrice;
  }
  return out;
}

/** @param {import('fastify').FastifyInstance} app */
export async function featuredRoutes(app) {
  const { prisma, catalog, stock } = app;

  async function loadSlots() {
    const row = await prisma.setting.findUnique({ where: { key: FEATURED_KEY } }).catch(() => null);
    const value = row?.value;
    return value && typeof value === "object" ? value : {};
  }

  /** Resolve um slot em produto público (ou null). Nunca lança — hero tem fallback no front. */
  async function resolveSlot(section, slot) {
    const ref = slot?.ref;
    if (!ref) return null;
    try {
      if (section === "import") {
        const { product } = await catalog.getProductSizes(ref);
        return product && !product.byYou ? toPublicCard(product) : null;
      }
      const product = await stock.getProductByCode(ref); // só ativos
      if (!product || product.section !== section) return null;
      return toPublicCard(product);
    } catch {
      return null;
    }
  }

  app.get(
    "/api/featured",
    {
      schema: {
        tags: ["catalog"],
        summary: "Tênis em destaque no hero (configurado no backoffice), por seção × categoria",
        querystring: {
          type: "object",
          properties: {
            section: { type: "string", enum: FEATURED_SECTIONS },
            cat: { type: "string", enum: ["basketball", "lifestyle", "running"] }
          }
        }
      }
    },
    async (req) => {
      const section = req.query.section || "import";
      const cat = req.query.cat || null;
      const slots = await loadSlots();
      // categoria sem destaque próprio cai no default da seção
      const key = cat && slots[slotKey(section, cat)]?.ref ? slotKey(section, cat) : slotKey(section, "default");
      const product = await resolveSlot(section, slots[key]);
      return { section, cat, key, product };
    }
  );

  // ─── backoffice ─────────────────────────────────────────────────────────

  app.get("/api/admin/featured", { onRequest: [requireAdmin], schema: { tags: ["admin"] } }, async () => {
    const slots = await loadSlots();
    const resolved = {};
    await Promise.all(
      FEATURED_SECTIONS.flatMap((section) =>
        FEATURED_CATS.map(async (cat) => {
          const key = slotKey(section, cat);
          if (!slots[key]?.ref) return;
          const p = await resolveSlot(section, slots[key]);
          resolved[key] = p
            ? { ok: true, name: p.name, image: p.images?.[0] || null, priceBrl: p.price?.brl ?? null, colorDescription: p.colorDescription || null }
            : { ok: false }; // ref guardada mas não resolve mais (SKU saiu da Nike / produto desativado)
        })
      )
    );
    return { slots, resolved, sections: FEATURED_SECTIONS, cats: FEATURED_CATS };
  });

  app.put("/api/admin/featured", {
    onRequest: [requireAdmin],
    schema: {
      tags: ["admin"],
      body: {
        type: "object",
        required: ["slots"],
        properties: { slots: { type: "object", additionalProperties: { type: ["object", "null"] } } }
      }
    }
  }, async (request) => {
    const input = request.body.slots || {};
    const clean = {};
    for (const [key, val] of Object.entries(input)) {
      if (!validSlot(key)) throw AppError.badRequest(`Slot inválido: ${key}`);
      if (val == null || !val.ref) continue; // null/sem ref = limpa o slot
      const [section] = key.split(":");
      const ref = String(val.ref).trim();
      if (!ref || ref.length > 60) throw AppError.badRequest(`Referência inválida em ${key}`);
      if (section === "import") {
        if (isStockCode(ref)) throw AppError.badRequest(`${key}: em Importados o destaque é um SKU da Nike (ex.: IO3415-100), não um código de estoque`);
      } else {
        if (!isStockCode(ref)) throw AppError.badRequest(`${key}: use o código do produto cadastrado (PE-/HY-)`);
        const p = await stock.getProductByCode(ref, { includeInactive: true });
        if (!p) throw AppError.badRequest(`${key}: produto ${ref} não encontrado`);
        if (p.section !== section) throw AppError.badRequest(`${key}: ${ref} é da seção "${p.sectionLabel}" — escolha um produto cadastrado nessa aba`);
      }
      clean[key] = {
        ref: section === "import" ? ref.toUpperCase() : ref.toUpperCase(),
        name: val.name ? String(val.name).slice(0, 120) : null,
        image: val.image && /^(https?:\/\/|\/)/.test(String(val.image)) ? String(val.image).slice(0, 2000) : null
      };
    }
    await prisma.setting.upsert({
      where: { key: FEATURED_KEY },
      create: { key: FEATURED_KEY, value: clean },
      update: { value: clean }
    });
    app.log.info({ admin: request.admin.email, slots: Object.keys(clean) }, "admin: vitrine (featured) atualizada");
    return { ok: true, slots: clean };
  });
}
