/**
 * RESTRITOS — modelos que nunca aparecem na loja (busca ao vivo, top8, vitrine, página do produto).
 * Pedido do dono (29/08): tirar "Nike Mind 001" e "Nike Mind 002" da busca, editável no backoffice.
 *
 *   GET /api/admin/restricted → { terms }
 *   PUT /api/admin/restricted → { terms: string[] }  (substitui a lista inteira)
 *
 * A lista vive na tabela `settings` (key "restricted", value = array de termos) — sobrevive a deploy.
 * Um termo bloqueia por NOME (contém, sem caixa/acento — "Nike Mind 001" pega "Nike Mind 001 'Triple Black'")
 * ou por SKU exato (styleColor, ex. "DZ0000-100"). O filtro é aplicado DEPOIS do cache do catálogo,
 * então salvar no painel vale na hora — sem esperar a 1h do cache.
 * Pronta entrega/hypados não passam por aqui (produto cadastrado pelo dono já é curadoria).
 */
import { AppError } from "../../lib/errors.js";
import { requireAdmin } from "../../lib/guards.js";

export const RESTRICTED_KEY = "restricted";
/** Lista inicial (vale até o primeiro salvamento no painel). */
export const DEFAULT_RESTRICTED = ["Nike Mind 001", "Nike Mind 002"];
const MAX_TERMS = 200;
const MAX_TERM_LEN = 120;
const MEMO_TTL_MS = 30_000; // busca é frequente; a lista muda raramente

/** minúsculas + sem acento, para comparar nome/termo. */
const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Normaliza a lista vinda do painel: só strings, aparadas, sem vazio, sem duplicata (por fold). */
export function sanitizeTerms(input) {
  if (!Array.isArray(input)) throw AppError.badRequest("Envie { terms: [\"Nike Mind 001\", …] }");
  if (input.length > MAX_TERMS) throw AppError.badRequest(`No máximo ${MAX_TERMS} termos`);
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== "string") throw AppError.badRequest("Cada termo deve ser um texto");
    const term = raw.trim().replace(/\s+/g, " ");
    if (!term) continue;
    if (term.length > MAX_TERM_LEN) throw AppError.badRequest(`Termo muito longo (máx. ${MAX_TERM_LEN} caracteres): "${term.slice(0, 40)}…"`);
    const k = fold(term);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(term);
  }
  return out;
}

/**
 * Filtro usado pelo catálogo. `prisma` pode faltar (testes sem banco) — aí vale a lista padrão fixa.
 */
export function createRestrictedFilter({ prisma = null, log = null } = {}) {
  let memo = null;
  let memoAt = 0;

  async function list() {
    if (!prisma) return DEFAULT_RESTRICTED;
    const now = Date.now();
    if (memo && now - memoAt < MEMO_TTL_MS) return memo;
    try {
      const row = await prisma.setting.findUnique({ where: { key: RESTRICTED_KEY } });
      memo = Array.isArray(row?.value) ? row.value.filter((t) => typeof t === "string") : DEFAULT_RESTRICTED;
    } catch (err) {
      log?.warn({ err: err.message }, "restritos: falha ao ler a lista — usando a última conhecida");
      memo = memo ?? DEFAULT_RESTRICTED;
    }
    memoAt = now;
    return memo;
  }

  async function save(input) {
    const terms = sanitizeTerms(input);
    await prisma.setting.upsert({
      where: { key: RESTRICTED_KEY },
      create: { key: RESTRICTED_KEY, value: terms },
      update: { value: terms }
    });
    memo = terms;
    memoAt = Date.now();
    return terms;
  }

  function isBlockedBy(product, terms) {
    if (!product) return false;
    const hay = fold(`${product.name || ""} ${product.subtitle || ""}`);
    const sku = fold(product.styleColor || "");
    return terms.some((t) => {
      const ft = fold(t);
      return ft && (hay.includes(ft) || (sku && sku === ft));
    });
  }

  async function isBlocked(product) {
    return isBlockedBy(product, await list());
  }

  async function filter(products) {
    if (!Array.isArray(products) || !products.length) return products || [];
    const terms = await list();
    if (!terms.length) return products;
    return products.filter((p) => !isBlockedBy(p, terms));
  }

  return { list, save, isBlocked, filter };
}

/** @param {import('fastify').FastifyInstance} app */
export async function restrictedRoutes(app) {
  const restricted = app.restricted;
  const tags = ["admin"];

  app.get("/api/admin/restricted", { onRequest: [requireAdmin], schema: { tags, summary: "Modelos restritos (nunca aparecem na loja)" } }, async () => ({
    terms: await restricted.list()
  }));

  app.put(
    "/api/admin/restricted",
    {
      onRequest: [requireAdmin],
      schema: {
        tags,
        summary: "Substitui a lista de modelos restritos",
        body: {
          type: "object",
          required: ["terms"],
          properties: { terms: { type: "array", maxItems: 300, items: { type: "string", maxLength: 200 } } }
        }
      }
    },
    async (request) => ({ terms: await restricted.save(request.body.terms) })
  );
}
