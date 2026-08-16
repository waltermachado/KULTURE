/**
 * Produto de TESTE de pagamento — "test123test", R$ 1,00.
 *
 * Não existe na Nike nem no banco: é virtual, montado aqui. Regras:
 *  - só aparece quando a busca é EXATAMENTE "test123test" (não entra no top8, nem em buscas parciais);
 *  - preço fixo R$ 1,00 (ignora câmbio/frete/comissão) → link InfinitePay de 100 centavos;
 *  - um tamanho único disponível; passa pelo checkout/pedido/e-mail como qualquer produto;
 *  - liga/desliga por TEST_PRODUCT_ENABLED (padrão ligado; desligue depois de validar o pagamento real).
 */
export const TEST_STYLE_COLOR = "TEST123TEST";
const TEST_TERM = "test123test";

export function isTestTerm(query) {
  return String(query ?? "").trim().toLowerCase() === TEST_TERM;
}

export function isTestStyleColor(styleColor) {
  return String(styleColor ?? "").trim().toUpperCase() === TEST_STYLE_COLOR;
}

/** Produto no mesmo formato do toProduct() (normalize.js), já com `sizes`. */
export function buildTestProduct(rate) {
  const usdToBrl = Number(rate?.ask) > 0 ? Number(rate.ask) : 5;
  return {
    id: TEST_STYLE_COLOR,
    styleColor: TEST_STYLE_COLOR,
    name: "test123test",
    subtitle: "teste gateway",
    brand: "Kulture",
    category: "test",
    colorDescription: "teste gateway — R$ 1,00",
    priceUsd: Math.round((1 / usdToBrl) * 100) / 100,
    fullPriceUsd: null,
    onSale: false,
    price: {
      brl: 1,
      fullBrl: null,
      breakdown: {}, // sem economics: não distorce custo/margem no dashboard
      rulesApplied: { test: true },
      exchange: { usdToBrl: Math.round(usdToBrl * 100) / 100, timestamp: rate?.timestamp ?? null }
    },
    // foto = logo da marca (servida pelo front em /logo.png)
    images: ["/logo.png"],
    imageSource: ["/logo.png"],
    nikeUrl: null,
    genders: ["MEN"],
    isTest: true,
    cachedAt: new Date().toISOString(),
    sizes: [
      { nikeSize: "9", localizedSize: "M 9", brSize: 41, brLabel: "41", available: true, level: "HIGH", approximate: false }
    ]
  };
}
