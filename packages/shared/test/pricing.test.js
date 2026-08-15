import { describe, expect, it } from "vitest";
import {
  applyRoundEnding,
  calculateFinalPrice,
  commissionRateFor,
  resolvePricingRules,
  DEFAULT_PRICING_RULES
} from "../src/pricing/index.js";

const product = { brand: "Nike", name: "Nike Kobe 6 Protro", styleColor: "CW2288-111", priceUsd: 190 };

describe("calculateFinalPrice (regra padrão)", () => {
  it("aplica 30% de comissão + frete de US$15 sem imposto", () => {
    const r = calculateFinalPrice({ product, exchangeRate: 5 });
    expect(r.costs.subtotalUsd).toBe(205);
    expect(r.costs.subtotalBrl).toBe(1025);
    expect(r.costs.importDutyBrl).toBe(0);
    expect(r.costs.commissionBrl).toBe(307.5);
    expect(r.costs.finalPriceBrl).toBe(1332.5);
    expect(r.rulesApplied.commissionRate).toBe(0.3);
    expect(r.rulesApplied.matchedRuleIds).toEqual(["default"]);
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
    { id: "sku-especial", scope: "sku", match: "CW2288-111", commission: { rate: 0.1 }, roundEnding: 90 }
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

  it("applyRoundEnding arredonda para cima até x,90", () => {
    expect(applyRoundEnding(1332.5, 90)).toBe(1332.9);
    expect(applyRoundEnding(1332.95, 90)).toBe(1333.9);
    expect(applyRoundEnding(1332.9, 90)).toBe(1332.9);
    expect(applyRoundEnding(1332.567, null)).toBe(1332.57);
  });
});
