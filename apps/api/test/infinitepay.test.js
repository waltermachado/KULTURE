import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createInfinitePayGateway } from "../src/modules/payments/infinitepay.js";

/**
 * Link de pagamento da InfinitePay: a SOMA dos itens é o que o cliente paga — precisa bater com order.totalBrl.
 * Com cupom o link vira uma linha só com o total (desconto não fecha por item em centavos); sem cupom, item a item
 * com rótulo só em BR (o US não vaza para a página de pagamento). Sem rede: fetch global mockado.
 */
const env = loadEnv({
  NODE_ENV: "test", LOG_LEVEL: "silent", JWT_SECRET: "test-jwt-secret-kulture-32chars-long!!",
  DATABASE_URL: "postgresql://x:y@localhost:5432/z",
  PUBLIC_WEB_URL: "https://loja.test", PUBLIC_API_URL: "https://loja.test",
  PAYMENT_PROVIDER: "infinitepay", INFINITEPAY_HANDLE: "kulture"
});

const baseOrder = {
  number: "KLT-2026-000123",
  customerName: "Cliente Cupom",
  customerEmail: "cli@kulture.test",
  customerPhone: "85999990000",
  address: { cep: "60000-000", street: "Rua A", number: "1" },
  subtotalBrl: 3598,
  items: [
    { name: "Kobe 6 Protro", brLabel: "41", nikeSize: "9", unitPriceBrl: 1799, quantity: 1 },
    { name: "Nike LeBron XXIII", brLabel: "42", nikeSize: "10", unitPriceBrl: 1799, quantity: 1 }
  ]
};

let sentPayload;
beforeEach(() => {
  sentPayload = null;
  vi.stubGlobal("fetch", vi.fn(async (_url, opts) => {
    sentPayload = JSON.parse(opts.body);
    return { ok: true, text: async () => JSON.stringify({ url: "https://pay.test/x?lenc=abc", slug: "slug-1" }) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("infinitepay: link de pagamento", () => {
  it("sem cupom: item a item, soma = totalBrl, descrição só com BR (sem US)", async () => {
    const gw = createInfinitePayGateway(env, null);
    const order = { ...baseOrder, discountBrl: 0, couponCode: null, totalBrl: 3598 };
    const r = await gw.createCheckoutLink(order, { webUrl: "https://loja.test" });
    expect(r.url).toContain("pay.test");
    expect(sentPayload.items).toHaveLength(2);
    const sum = sentPayload.items.reduce((a, i) => a + i.price * i.quantity, 0);
    expect(sum).toBe(359800);
    expect(sentPayload.items[0].description).toBe("Kobe 6 Protro — tam. BR 41");
    expect(JSON.stringify(sentPayload.items)).not.toMatch(/US/);
    expect(sentPayload.redirect_url).toBe("https://loja.test/pedido/confirmacao/KLT-2026-000123");
  });

  it("com cupom: UMA linha com o total já descontado — é o que a InfinitePay cobra", async () => {
    const gw = createInfinitePayGateway(env, null);
    const order = { ...baseOrder, discountBrl: 359.8, couponCode: "KULTURE10", totalBrl: 3238.2 };
    await gw.createCheckoutLink(order, { webUrl: "https://loja.test" });
    expect(sentPayload.items).toHaveLength(1);
    expect(sentPayload.items[0]).toMatchObject({ price: 323820, quantity: 1 });
    expect(sentPayload.items[0].description).toContain("Pedido KLT-2026-000123");
    expect(sentPayload.items[0].description).toContain("cupom KULTURE10");
    expect(sentPayload.items[0].description).toContain("desconto de R$ 359,80");
    const sum = sentPayload.items.reduce((a, i) => a + i.price * i.quantity, 0);
    expect(sum).toBe(Math.round(order.totalBrl * 100)); // bate com o expectedCents do settle
  });

  it("desconto com centavos quebrados: o total do link sai exato mesmo assim", async () => {
    const gw = createInfinitePayGateway(env, null);
    const order = { ...baseOrder, items: [{ name: "Par", brLabel: "40", unitPriceBrl: 1999, quantity: 3 }], subtotalBrl: 5997, discountBrl: 599.7, couponCode: "DEZ", totalBrl: 5397.3 };
    await gw.createCheckoutLink(order, { webUrl: "https://loja.test" });
    expect(sentPayload.items[0].price).toBe(539730);
  });
});

describe("infinitepay: erros seguros (sem rede ou cobranças)", () => {
  it.each([[400, "PAYMENT_DATA_REJECTED"], [422, "PAYMENT_DATA_REJECTED"], [401, "PAYMENT_CONFIGURATION_ERROR"], [403, "PAYMENT_CONFIGURATION_ERROR"], [404, "PAYMENT_CONFIGURATION_ERROR"], [429, "PAYMENT_BUSY"], [500, "PAYMENT_UNAVAILABLE"], [503, "PAYMENT_UNAVAILABLE"]])("traduz HTTP %s sem expor corpo nem repetir POST", async (status, code) => {
    const readBody = vi.fn(async () => '<html>secret customer details</html>');
    fetch.mockResolvedValue({ok:false, status, text:readBody});
    const gw = createInfinitePayGateway(env);
    await expect(gw.createCheckoutLink({...baseOrder,totalBrl:3598})).rejects.toMatchObject({code});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readBody).not.toHaveBeenCalled();
  });
  it.each(["not-json", "null", "[]", '{"success":false}', '{"url":"javascript:alert(1)"}', '{}'])("resposta inválida não vaza: %s", async body => {
    fetch.mockResolvedValue({ok:true,text:async()=>body});
    await expect(createInfinitePayGateway(env).createCheckoutLink({...baseOrder,totalBrl:3598})).rejects.toMatchObject({code:"PAYMENT_INVALID_RESPONSE"});
  });
  it("rede indisponível usa mensagem segura", async () => {
    fetch.mockRejectedValue(new TypeError("sensitive internal URL"));
    await expect(createInfinitePayGateway(env).createCheckoutLink({...baseOrder,totalBrl:3598})).rejects.toMatchObject({code:"PAYMENT_UNAVAILABLE"});
  });
  it("timeout cobre leitura do corpo também", async () => {
    vi.useFakeTimers();
    try {
      fetch.mockImplementation(async (_url, {signal}) => ({ok:true,text:()=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError"))))}));
      const pending = expect(createInfinitePayGateway(env).createCheckoutLink({...baseOrder,totalBrl:3598})).rejects.toMatchObject({code:"PAYMENT_TIMEOUT"});
      await vi.advanceTimersByTimeAsync(10001);
      await pending;
    } finally { vi.useRealTimers(); }
  });
  it("falha de confirmação nunca sugere pagar outra vez", async () => {
    fetch.mockResolvedValue({ok:false,status:422});
    await expect(createInfinitePayGateway(env).confirmPayment({orderNsu:"test"})).rejects.toMatchObject({code:"PAYMENT_CHECK_UNAVAILABLE",message:expect.stringContaining("não pague novamente")});
  });
  it("consulta bem-sucedida não implica pagamento aprovado", async () => {
    fetch.mockResolvedValue({ok:true,text:async()=>JSON.stringify({success:true,paid:false,amount:null})});
    expect(await createInfinitePayGateway(env).confirmPayment({orderNsu:"test"})).toMatchObject({paid:false,amountCents:null});
  });
});
