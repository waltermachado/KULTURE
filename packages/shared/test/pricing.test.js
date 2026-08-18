import { describe, expect, it } from "vitest";
import {
  applyRoundEnding,
  roundUpToEnding,
  calculateFinalPrice,
  commissionRateFor,
  resolvePricingRules,
  DEFAULT_PRICING_RULES
} from "../src/pricing/index.js";

const product = { brand: "Nike", name: "Nike Kobe 6 Protro", styleColor: "CW2288-111", priceUsd: 190 };

describe("calculateFinalPrice (regra padrão)", () => {
  it("fórmula do dono: (USD×1,07 + 65) × câmbio × 1,30, arredondado ↑ até …99", () => {
    const r = calculateFinalPrice({ product, exchangeRate: 5 });
    // 190 × 1,07 = 203,30 (+13,30 de sobretaxa) + 65 = 268,30 USD → ×5 = 1341,50 BRL → +30% = 1743,95 → ↑99 = 1799
    expect(r.costs.surchargeUsd).toBe(13.3);
    expect(r.costs.adjustedProductUsd).toBe(203.3);
    expect(r.costs.shippingUsd).toBe(65);
    expect(r.costs.subtotalUsd).toBe(268.3);
    expect(r.costs.subtotalBrl).toBe(1341.5);
    expect(r.costs.importDutyBrl).toBe(0);
    expect(r.costs.commissionBrl).toBe(402.45);
    expect(r.costs.finalPriceBrl).toBe(1799);
    expect(r.costs.roundingAdjustmentBrl).toBe(55.05);
    expect(r.rulesApplied.commissionRate).toBe(0.3);
    expect(r.rulesApplied.productSurchargeRate).toBe(0.07);
    expect(r.rulesApplied.roundUpToEnding).toBe(99);
    expect(r.rulesApplied.matchedRuleIds).toEqual(["default"]);
  });

  it("Kobe 10 (US$190) com dólar turismo 5,58938 → R$ 1.999 no Pix", () => {
    const r = calculateFinalPrice({ product, exchangeRate: 5.58938 });
    expect(r.costs.finalPriceBrl).toBe(1999);
    expect(r.exchange.usdToBrl).toBe(5.59);
  });

  it("rejeita preço/câmbio inválidos", () => {
    expect(() => calculateFinalPrice({ product: {}, exchangeRate: 5 })).toThrow(/preço USD/);
    expect(() => calculateFinalPrice({ product, exchangeRate: 0 })).toThrow(/Câmbio/);
  });
});

describe("regras modulares", () => {
  const rules = [
    ...DEFAULT_PRICING_RULES,
    {
      id: "nike-tiers",
      scope: "brand",
      match: "nike",
      commission: {
        tiers: [
          { upToUsd: 150, rate: 0.3 },
          { upToUsd: 250, rate: 0.25 },
          { upToUsd: null, rate: 0.2 }
        ]
      }
    },
    { id: "kobe-frete", scope: "model", match: /kobe/i, shippingUsd: 20 },
    // roundUpToEnding: null desliga o arredondamento ↑99 da regra global para este sku (usa x,90 em centavos)
    { id: "sku-especial", scope: "sku", match: "CW2288-111", commission: { rate: 0.1 }, roundUpToEnding: null, roundEnding: 90 }
  ];

  it("comissão por faixa: tênis mais caro paga menos comissão", () => {
    const cheap = calculateFinalPrice({ product: { brand: "Nike", name: "Dunk", priceUsd: 110 }, exchangeRate: 5, rules });
    const mid = calculateFinalPrice({ product: { brand: "Nike", name: "Dunk", priceUsd: 200 }, exchangeRate: 5, rules });
    const pricey = calculateFinalPrice({ product: { brand: "Nike", name: "Dunk", priceUsd: 300 }, exchangeRate: 5, rules });
    expect(cheap.rulesApplied.commissionRate).toBe(0.3);
    expect(mid.rulesApplied.commissionRate).toBe(0.25);
    expect(pricey.rulesApplied.commissionRate).toBe(0.2);
  });

  it("mescla por especificidade: sku > model > brand > global", () => {
    const r = calculateFinalPrice({ product, exchangeRate: 5, rules });
    expect(r.rulesApplied.matchedRuleIds).toEqual(["default", "nike-tiers", "kobe-frete", "sku-especial"]);
    expect(r.rulesApplied.shippingUsd).toBe(20); // veio da regra de modelo
    expect(r.rulesApplied.commissionRate).toBe(0.1); // sku sobrescreveu os tiers
    expect(String(r.costs.finalPriceBrl).endsWith(".9")).toBe(true);
  });

  it("regra de marca não bate em outra marca", () => {
    const resolved = resolvePricingRules({ brand: "Adidas", priceUsd: 300 }, rules);
    expect(resolved.matchedRuleIds).toEqual(["default"]);
  });

  it("valida escopo desconhecido", () => {
    expect(() => resolvePricingRules(product, [{ id: "x", scope: "loja" }])).toThrow(/Escopo/);
  });
});

describe("helpers", () => {
  it("commissionRateFor respeita tiers fora de ordem", () => {
    const c = { tiers: [{ upToUsd: null, rate: 0.1 }, { upToUsd: 100, rate: 0.5 }] };
    expect(commissionRateFor(c, 50)).toBe(0.5);
    expect(commissionRateFor(c, 100)).toBe(0.5);
    expect(commissionRateFor(c, 101)).toBe(0.1);
  });

  it("roundUpToEnding arredonda para cima até o próximo …99 (reais)", () => {
    expect(roundUpToEnding(1714, 99)).toBe(1799);
    expect(roundUpToEnding(1880, 99)).toBe(1899);
    expect(roundUpToEnding(1899, 99)).toBe(1899);
    expect(roundUpToEnding(1900, 99)).toBe(1999);
    expect(roundUpToEnding(1949.52, 99)).toBe(1999);
    expect(roundUpToEnding(50, 99)).toBe(99);
    expect(roundUpToEnding(1332.567, null)).toBe(1332.57);
  });

  it("applyRoundEnding arredonda para cima até x,90", () => {
    expect(applyRoundEnding(1332.5, 90)).toBe(1332.9);
    expect(applyRoundEnding(1332.95, 90)).toBe(1333.9);
    expect(applyRoundEnding(1332.9, 90)).toBe(1332.9);
    expect(applyRoundEnding(1332.567, null)).toBe(1332.57);
  });
});
