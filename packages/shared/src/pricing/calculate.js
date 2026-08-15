import { DEFAULT_PRICING_RULES } from "./default-rules.js";
import { commissionRateFor, resolvePricingRules } from "./rules.js";

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

/** Arredonda para cima até o próximo valor terminado em `endingCents` (ex.: 90 → R$ x,90). */
export function applyRoundEnding(value, endingCents) {
  if (endingCents == null) return roundCurrency(value);
  const ending = endingCents / 100;
  const base = Math.floor(value);
  const candidate = base + ending;
  return roundCurrency(candidate >= value ? candidate : candidate + 1);
}

/**
 * Função pura: recebe produto normalizado + câmbio + regras e devolve o breakdown completo.
 *
 * product: { brand?, category?, name?/model?, styleColor?/sku?, priceUsd | basePriceUsd, ... }
 * exchangeRate: USD → BRL (número)
 * rules: array de PricingRule (padrão: DEFAULT_PRICING_RULES)
 */
export function calculateFinalPrice({ product, exchangeRate, rules = DEFAULT_PRICING_RULES }) {
  const productPriceUsd = Number(product?.priceUsd ?? product?.basePriceUsd);
  if (!Number.isFinite(productPriceUsd) || productPriceUsd < 0) {
    throw new Error("Produto sem preço USD válido (priceUsd/basePriceUsd).");
  }
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error("Câmbio USD→BRL inválido.");
  }

  const resolved = resolvePricingRules(product, rules);
  const commissionRate = commissionRateFor(resolved.commission, productPriceUsd);

  const shippingUsd = resolved.shippingUsd;
  const subtotalUsd = productPriceUsd + shippingUsd;

  const productPriceBrl = productPriceUsd * exchangeRate;
  const shippingBrl = shippingUsd * exchangeRate;
  const subtotalBrl = subtotalUsd * exchangeRate;

  const importDutyBrl = subtotalBrl * resolved.importDutyRate;
  const paymentFeeBrl = subtotalBrl * resolved.paymentFeeRate;
  const commissionBase = subtotalBrl + importDutyBrl + paymentFeeBrl;
  const commissionBrl = commissionBase * commissionRate;
  const rawFinalBrl = commissionBase + commissionBrl;
  const finalPriceBrl = applyRoundEnding(rawFinalBrl, resolved.roundEnding);

  return {
    exchange: { usdToBrl: roundCurrency(exchangeRate) },
    costs: {
      productPriceUsd: roundCurrency(productPriceUsd),
      shippingUsd: roundCurrency(shippingUsd),
      subtotalUsd: roundCurrency(subtotalUsd),
      productPriceBrl: roundCurrency(productPriceBrl),
      shippingBrl: roundCurrency(shippingBrl),
      subtotalBrl: roundCurrency(subtotalBrl),
      importDutyBrl: roundCurrency(importDutyBrl),
      paymentFeeBrl: roundCurrency(paymentFeeBrl),
      commissionBrl: roundCurrency(commissionBrl),
      roundingAdjustmentBrl: roundCurrency(finalPriceBrl - rawFinalBrl),
      finalPriceBrl
    },
    rulesApplied: {
      matchedRuleIds: resolved.matchedRuleIds,
      commissionRate,
      commission: resolved.commission,
      shippingUsd: roundCurrency(shippingUsd),
      importDutyRate: resolved.importDutyRate,
      paymentFeeRate: resolved.paymentFeeRate,
      roundEnding: resolved.roundEnding
    }
  };
}
