import { DEFAULT_SCOPE_PRIORITY } from "./default-rules.js";

const SCOPES = new Set(Object.keys(DEFAULT_SCOPE_PRIORITY));

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function matches(matcher, value, { substring = false } = {}) {
  if (matcher == null) return true;
  if (typeof matcher === "function") return Boolean(matcher(value));
  if (matcher instanceof RegExp) return matcher.test(String(value ?? ""));
  const a = normalizeText(matcher);
  const b = normalizeText(value);
  if (!a) return true;
  return substring ? b.includes(a) : a === b;
}

/**
 * Diz se uma regra se aplica a um produto.
 * product: { brand?, category?, categories?[], model?/name?, styleColor?/sku? }
 */
export function ruleApplies(rule, product = {}) {
  switch (rule.scope) {
    case "global":
      return true;
    case "brand":
      return matches(rule.match, product.brand);
    case "category": {
      const cats = [product.category, ...(product.categories ?? [])].filter(Boolean);
      return cats.some((c) => matches(rule.match, c));
    }
    case "model":
      return matches(rule.match, product.model ?? product.name, { substring: true });
    case "sku":
      return matches(rule.match, product.styleColor ?? product.sku);
    default:
      return false;
  }
}

function priorityOf(rule) {
  if (typeof rule.priority === "number") return rule.priority;
  return DEFAULT_SCOPE_PRIORITY[rule.scope] ?? 0;
}

/**
 * Resolve o conjunto efetivo de parâmetros para um produto:
 * mescla, em ordem crescente de prioridade, todas as regras que batem.
 * Campos `undefined` numa regra não sobrescrevem a anterior.
 */
export function resolvePricingRules(product, rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error("Nenhuma regra de precificação fornecida.");
  }
  for (const r of rules) {
    if (!SCOPES.has(r.scope)) {
      throw new Error(`Escopo de regra inválido: "${r.scope}" (regra ${r.id ?? "?"}).`);
    }
  }

  const applicable = rules
    .filter((r) => ruleApplies(r, product))
    .sort((a, b) => priorityOf(a) - priorityOf(b));

  const merged = { matchedRuleIds: [] };
  for (const rule of applicable) {
    merged.matchedRuleIds.push(rule.id ?? "(sem id)");
    for (const key of ["commission", "shippingUsd", "importDutyRate", "paymentFeeRate", "roundEnding"]) {
      if (rule[key] !== undefined) merged[key] = rule[key];
    }
  }

  if (!merged.commission) throw new Error("Regras resolvidas sem comissão definida.");
  if (typeof merged.shippingUsd !== "number") throw new Error("Regras resolvidas sem shippingUsd.");
  merged.importDutyRate ??= 0;
  merged.paymentFeeRate ??= 0;
  merged.roundEnding ??= null;
  return merged;
}

/**
 * Comissão efetiva para um preço USD, dado `commission: {rate}` ou `{tiers}`.
 * Tiers: ordenados por upToUsd crescente; `upToUsd: null` = sem teto (última faixa).
 */
export function commissionRateFor(commission, priceUsd) {
  if (typeof commission?.rate === "number") return commission.rate;
  const tiers = commission?.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error("commission precisa de `rate` ou `tiers` não vazio.");
  }
  const sorted = [...tiers].sort((a, b) => {
    if (a.upToUsd == null) return 1;
    if (b.upToUsd == null) return -1;
    return a.upToUsd - b.upToUsd;
  });
  for (const tier of sorted) {
    if (tier.upToUsd == null || priceUsd <= tier.upToUsd) return tier.rate;
  }
  return sorted[sorted.length - 1].rate;
}
