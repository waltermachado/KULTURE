import { DEFAULT_PRICING_RULES } from "./default-rules.js";
import { commissionRateFor, resolvePricingRules } from "./rules.js";

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Arredonda PARA CIMA até o próximo valor inteiro terminado em `ending` (reais).
 * ending=99: 1714→1799 · 1880→1899 · 1899→1899 · 1900→1999 · 50→99.
 * Só arredonda se o valor já não terminar exatamente em `ending`.
 */
export function roundUpToEnding(value, ending) {
  if (ending == null) return roundCurrency(value);
  const e = Number(ending);
  const step = 10 ** String(Math.trunc(e)).length; // 99 → 100, 9 → 10
  const candidate = Math.floor(value / step) * step + e;
  return candidate >= value ? candidate : candidate + step;
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

  // custo extra sobre o tênis (7%), ANTES do frete
  const surchargeRate = resolved.productSurchargeRate;
  const surchargeUsd = productPriceUsd * surchargeRate;
  const adjustedProductUsd = productPriceUsd + surchargeUsd;
  const shippingUsd = resolved.shippingUsd;
  const subtotalUsd = adjustedProductUsd + shippingUsd;

  const productPriceBrl = productPriceUsd * exchangeRate;
  const surchargeBrl = surchargeUsd * exchangeRate;
  const shippingBrl = shippingUsd * exchangeRate;
  const subtotalBrl = subtotalUsd * exchangeRate;

  const importDutyBrl = subtotalBrl * resolved.importDutyRate;
  const paymentFeeBrl = subtotalBrl * resolved.paymentFeeRate;
  const commissionBase = subtotalBrl + importDutyBrl + paymentFeeBrl;
  const commissionBrl = commissionBase * commissionRate;
  // acréscimo fixo por regra (ex.: LeBron 23 +R$300) — fora da base da comissão, dentro do arredondamento
  const extraFixedBrl = Number(resolved.extraFixedBrl) || 0;
  const rawFinalBrl = commissionBase + commissionBrl + extraFixedBrl;
  const finalPriceBrl =
    resolved.roundUpToEnding != null ? roundUpToEnding(rawFinalBrl, resolved.roundUpToEnding) : applyRoundEnding(rawFinalBrl, resolved.roundEnding);

  return {
    exchange: { usdToBrl: roundCurrency(exchangeRate) },
    costs: {
      productPriceUsd: roundCurrency(productPriceUsd),
      surchargeUsd: roundCurrency(surchargeUsd),
      adjustedProductUsd: roundCurrency(adjustedProductUsd),
      shippingUsd: roundCurrency(shippingUsd),
      subtotalUsd: roundCurrency(subtotalUsd),
      productPriceBrl: roundCurrency(productPriceBrl),
      surchargeBrl: roundCurrency(surchargeBrl),
      shippingBrl: roundCurrency(shippingBrl),
      subtotalBrl: roundCurrency(subtotalBrl),
      importDutyBrl: roundCurrency(importDutyBrl),
      paymentFeeBrl: roundCurrency(paymentFeeBrl),
      commissionBrl: roundCurrency(commissionBrl),
      extraFixedBrl: roundCurrency(extraFixedBrl),
      roundingAdjustmentBrl: roundCurrency(finalPriceBrl - rawFinalBrl),
      finalPriceBrl
    },
    rulesApplied: {
      matchedRuleIds: resolved.matchedRuleIds,
      commissionRate,
      commission: resolved.commission,
      productSurchargeRate: surchargeRate,
      shippingUsd: roundCurrency(shippingUsd),
      importDutyRate: resolved.importDutyRate,
      paymentFeeRate: resolved.paymentFeeRate,
      extraFixedBrl: roundCurrency(extraFixedBrl),
      roundUpToEnding: resolved.roundUpToEnding,
      roundEnding: resolved.roundEnding
    }
  };
}
