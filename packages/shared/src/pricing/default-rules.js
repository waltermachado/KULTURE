// Regras de precificação padrão (decisão 2: 30% comissão + frete + imposto, modular).
//
// Cada regra tem um ESCOPO e um MATCH. Na resolução, todas as regras que batem no
// produto são mescladas por prioridade (a mais específica sobrescreve só o que define).
// Especificidade padrão: global < brand < category < model < sku.
//
// Campos possíveis em uma regra:
//   commission: { rate: 0.30 }                       comissão fixa
//            ou { tiers: [{ upToUsd: 150, rate: 0.30 }, { upToUsd: null, rate: 0.20 }] }
//               → comissão por faixa do preço USD do produto (tênis caro → comissão menor)
//   productSurchargeRate: custo extra sobre o preço do TÊNIS em USD, antes do frete (ex.: 0.07 = 7%)
//   shippingUsd:     frete de redirecionamento EUA → BR (USD)
//   importDutyRate:  imposto de importação sobre (produto + frete) em BRL
//   paymentFeeRate:  taxa do meio de pagamento sobre (produto + frete) em BRL
//   roundUpToEnding: null | reais inteiros (ex.: 99 → arredonda PARA CIMA até o próximo valor terminado em 99:
//                    1714→1799, 1880→1899, 1899→1899, 1900→1999)
//   roundEnding:     null | centavos (legado: 90 → arredonda para cima até R$ x,90) — ignorado se roundUpToEnding estiver definido
//
// Fórmula (decisão do dono, 16/08/2026):
//   Pix = arredondar↑99( [(USD × (1+7%) + 65) × dólar TURISMO] × (1+30%) )
//
// Em produção estas regras vivem na tabela PricingRule (editável no admin);
// este arquivo é o seed/fallback.

export const DEFAULT_SCOPE_PRIORITY = {
  global: 0,
  brand: 10,
  category: 20,
  model: 30,
  sku: 40
};

export const DEFAULT_PRICING_RULES = [
  {
    id: "default",
    scope: "global",
    match: null,
    commission: { rate: 0.3 },
    productSurchargeRate: 0.07,
    shippingUsd: 65.0,
    // ⚠️ valor de partida — ajustar com o contador (regime de importação real do negócio).
    importDutyRate: 0.0,
    paymentFeeRate: 0.0,
    roundUpToEnding: 99,
    roundEnding: null
  }
];

export const CURRENCY = {
  source: "USD",
  target: "BRL"
};
