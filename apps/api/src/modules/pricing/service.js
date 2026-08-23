/**
 * Acréscimos de preço por tipo de tênis — editáveis em /admin/precos.
 *
 * A fórmula base (dólar turismo, +7% no tênis, frete US$ 65, comissão 30%, arredonda ↑…99) é a regra global do
 * pacote shared (GLOBAL_PRICING_RULE). Aqui ficam só os ACRÉSCIMOS que o dono define, ex.: "LeBron 23 → +R$ 300".
 *
 *  - Guardados em `settings` (chave "pricing_adjustments") como lista simples do painel:
 *      { id, name, scope: model|sku|brand|category, terms: [..], extraFixedBrl, extraRate, active }
 *    model = o nome do tênis CONTÉM algum termo · sku = SKU igual a algum termo · brand/category = igual.
 *  - Sem registro → semente SEED_PRICE_ADJUSTMENTS (o LeBron 23 +R$300 que antes vivia em código).
 *  - `runtime()` devolve as regras no formato do motor + uma VERSÃO (updated_at da configuração). O catálogo
 *    põe a versão no namespace do cache: salvou no painel → chaves novas → preços recalculados na hora.
 */
import { AppError } from "../../lib/errors.js";
import { GLOBAL_PRICING_RULE, SEED_PRICE_ADJUSTMENTS } from "@kulture/shared/pricing";

export const PRICING_KEY = "pricing_adjustments";
export const SCOPES = {
  model: "Nome do tênis contém",
  sku: "SKU exato",
  brand: "Marca",
  category: "Categoria"
};
export const CATEGORY_KEYS = { basketball: "Basquete", lifestyle: "Casual", running: "Corrida" };
const MAX_RULES = 50;
const MAX_FIXED = 10000;
const MEMO_MS = 15_000;

const norm = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "regra";

/** Regra do painel → regra do motor (match por função, acento/caixa-insensível). */
export function toEngineRule(r) {
  const terms = (r.terms || []).map(norm).filter(Boolean);
  const match =
    r.scope === "model" ? (name) => { const n = norm(name); return terms.some((t) => n.includes(t)); }
    : r.scope === "sku" ? (sku) => terms.includes(norm(sku))
    : (v) => terms.includes(norm(v)); // brand | category
  return {
    id: r.id,
    scope: r.scope,
    match,
    ...(Number(r.extraFixedBrl) ? { extraFixedBrl: Number(r.extraFixedBrl) } : {}),
    ...(Number(r.extraRate) ? { extraRate: Number(r.extraRate) } : {})
  };
}

/** Valida/normaliza a lista vinda do painel. Lança 400 com mensagem em português. */
export function normalizeRules(input) {
  if (!Array.isArray(input)) throw AppError.badRequest("Envie a lista de regras");
  if (input.length > MAX_RULES) throw AppError.badRequest(`No máximo ${MAX_RULES} regras`);
  const seen = new Set();
  return input.map((raw, i) => {
    const name = String(raw?.name ?? "").trim();
    const scope = SCOPES[raw?.scope] ? raw.scope : null;
    const termsRaw = Array.isArray(raw?.terms) ? raw.terms : String(raw?.terms ?? "").split(/[|,;\n]/);
    const terms = [...new Set(termsRaw.map((t) => String(t).trim()).filter(Boolean))];
    const extraFixedBrl = raw?.extraFixedBrl == null || raw.extraFixedBrl === "" ? 0 : Number(String(raw.extraFixedBrl).replace(",", "."));
    const pct = raw?.extraPct == null || raw.extraPct === "" ? (raw?.extraRate != null ? Number(raw.extraRate) * 100 : 0) : Number(String(raw.extraPct).replace(",", "."));
    const label = name || `regra ${i + 1}`;
    if (!name) throw AppError.badRequest(`Regra ${i + 1}: dê um nome (ex.: "LeBron 23")`);
    if (!scope) throw AppError.badRequest(`${label}: escolha onde aplicar (nome do tênis, SKU, marca ou categoria)`);
    if (!terms.length) throw AppError.badRequest(`${label}: informe pelo menos um termo (ex.: "LeBron XXIII, LeBron 23")`);
    if (scope === "category") {
      const bad = terms.find((t) => !CATEGORY_KEYS[norm(t)]);
      if (bad) throw AppError.badRequest(`${label}: categoria "${bad}" inválida (use basketball, lifestyle ou running)`);
    }
    if (!Number.isFinite(extraFixedBrl) || extraFixedBrl < 0 || extraFixedBrl > MAX_FIXED) throw AppError.badRequest(`${label}: acréscimo em R$ entre 0 e ${MAX_FIXED}`);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw AppError.badRequest(`${label}: acréscimo em % entre 0 e 100`);
    if (!extraFixedBrl && !pct) throw AppError.badRequest(`${label}: informe um acréscimo em R$ ou em %`);
    let id = String(raw?.id ?? "").trim() || slug(name);
    while (seen.has(id)) id = `${id}-${seen.size + 1}`;
    seen.add(id);
    return {
      id,
      name,
      scope,
      terms: scope === "category" ? terms.map(norm) : terms,
      extraFixedBrl: Math.round(extraFixedBrl * 100) / 100,
      extraRate: Math.round(pct * 100) / 10000, // % → fração com 2 casas
      active: raw?.active !== false
    };
  });
}

export function createPricingService({ prisma, log }) {
  let memo = null; // { at, rules, version, adjustments }

  async function load() {
    const row = await prisma.setting.findUnique({ where: { key: PRICING_KEY } });
    if (row && Array.isArray(row.value?.rules)) {
      return { adjustments: row.value.rules, version: String(row.updatedAt?.getTime?.() ?? 0) };
    }
    // primeira vez: semente com o que antes estava em código (LeBron 23 +R$300), já editável no painel
    const seeded = await prisma.setting.upsert({
      where: { key: PRICING_KEY },
      create: { key: PRICING_KEY, value: { rules: SEED_PRICE_ADJUSTMENTS } },
      update: {}
    });
    log?.info({ count: SEED_PRICE_ADJUSTMENTS.length }, "pricing: acréscimos semeados no banco");
    return { adjustments: seeded.value.rules, version: String(seeded.updatedAt?.getTime?.() ?? 0) };
  }

  /** Regras do motor (global + acréscimos ativos) e a versão para o namespace do cache. Memo de 15s. */
  async function runtime() {
    if (memo && Date.now() - memo.at < MEMO_MS) return memo;
    try {
      const { adjustments, version } = await load();
      const rules = [GLOBAL_PRICING_RULE, ...adjustments.filter((r) => r.active !== false).map(toEngineRule)];
      memo = { at: Date.now(), rules, version, adjustments };
    } catch (err) {
      // banco fora: fórmula base + semente, sem derrubar a busca
      log?.warn({ err: err.message }, "pricing: falha ao ler acréscimos — usando a semente");
      memo = { at: Date.now(), rules: [GLOBAL_PRICING_RULE, ...SEED_PRICE_ADJUSTMENTS.map(toEngineRule)], version: "seed", adjustments: SEED_PRICE_ADJUSTMENTS };
    }
    return memo;
  }

  function invalidate() { memo = null; }

  async function list() {
    const { adjustments, version } = await load();
    return { rules: adjustments, version, base: baseInfo() };
  }

  async function save(input, actor = null) {
    const rules = normalizeRules(input);
    const row = await prisma.setting.upsert({
      where: { key: PRICING_KEY },
      create: { key: PRICING_KEY, value: { rules } },
      update: { value: { rules } }
    });
    invalidate();
    log?.info({ count: rules.length, by: actor?.email }, "pricing: acréscimos salvos");
    return { rules, version: String(row.updatedAt?.getTime?.() ?? 0), base: baseInfo() };
  }

  function baseInfo() {
    return {
      commissionRate: GLOBAL_PRICING_RULE.commission.rate,
      productSurchargeRate: GLOBAL_PRICING_RULE.productSurchargeRate,
      shippingUsd: GLOBAL_PRICING_RULE.shippingUsd,
      roundUpToEnding: GLOBAL_PRICING_RULE.roundUpToEnding
    };
  }

  return { runtime, invalidate, list, save, SCOPES, CATEGORY_KEYS };
}
