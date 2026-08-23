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
//   extraFixedBrl:   acréscimo FIXO em R$ no preço final (depois da comissão, antes do arredondamento ↑99);
//                    a comissão NÃO incide sobre ele — é margem pura do modelo
//   extraRate:       acréscimo PERCENTUAL sobre o preço já com comissão (ex.: 0.10 = +10%), antes do
//                    acréscimo fixo e do arredondamento — também margem pura do modelo
//   roundUpToEnding: null | reais inteiros (ex.: 99 → arredonda PARA CIMA até o próximo valor terminado em 99:
//                    1714→1799, 1880→1899, 1899→1899, 1900→1999)
//   roundEnding:     null | centavos (legado: 90 → arredonda para cima até R$ x,90) — ignorado se roundUpToEnding estiver definido
//
// Fórmula (decisão do dono, 16/08/2026):
//   Pix = arredondar↑99( [(USD × (1+7%) + 65) × dólar TURISMO] × (1+30%) )
//
// Em produção a regra global fica aqui e os ACRÉSCIMOS por tipo de tênis vivem no banco (settings
// "pricing_adjustments", editáveis em /admin/precos) — SEED_PRICE_ADJUSTMENTS é a semente (LeBron 23).
// DEFAULT_PRICING_RULES (global + LeBron) continua como fallback/uso direto do pacote.

export const DEFAULT_SCOPE_PRIORITY = {
  global: 0,
  brand: 10,
  category: 20,
  model: 30,
  sku: 40
};

export const GLOBAL_PRICING_RULE = Object.freeze({
  id: "default",
  scope: "global",
  match: null,
  commission: { rate: 0.3 },
  productSurchargeRate: 0.07,
  shippingUsd: 65.0,
  importDutyRate: 0.0,
  paymentFeeRate: 0.0,
  roundUpToEnding: 99,
  roundEnding: null
});

/** Acréscimos por tipo de tênis que o admin edita — formato do painel (termos no nome, R$ e/ou %). */
export const SEED_PRICE_ADJUSTMENTS = [
  { id: "lebron-23-acrescimo", name: "LeBron 23", scope: "model", terms: ["LeBron XXIII", "LeBron 23"], extraFixedBrl: 300, extraRate: 0, active: true }
];

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
  },
  // Decisão do dono (19/08/2026): todo LeBron XXIII (23) sai R$ 300 mais caro que a fórmula.
  // O nome vem da Nike como "LeBron XXIII …"; o "23" cobre variações. Como 300 é múltiplo de 100,
  // o preço continua terminando em …99 (ex.: 1899 → 2199).
  {
    id: "lebron-23-acrescimo",
    scope: "model",
    match: /\blebron\s*(xxiii|23)\b/i,
    extraFixedBrl: 300
  }
];

export const CURRENCY = {
  source: "USD",
  target: "BRL"
};
