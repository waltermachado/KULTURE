import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { ORDER_STAGES, ORDER_TRANSITIONS, isInternationalOrder } from "../src/modules/orders/status.js";

/**
 * Etapas de rastreio do importado: Pagamento aprovado → Pedido comprado → Em trânsito internacional → Chegou no Brasil
 * → Enviado pro seu endereço → Entregue. Cada etapa manda e-mail ao cliente; a visão pública traz `international`.
 * Bate no banco de dev; tudo com prefixo "test-stages-" e apagado no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-stages-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };
const CUSTOMER = { email: `test-stages-cli-${STAMP}@kulture.test`, password: "Senh@Cli12345", name: "Cliente Etapas", phone: "85999990000" };

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail(styleColor) {
    return { id: "mock-id", styleColor, name: "Stages Test Sneaker", priceUsd: 100, sizes: [{ nikeSize: "10", localizedSize: "10", available: true, level: "HIGH" }], genders: ["MEN"] };
  }
};
const sentMails = [];
const fakeMailer = { provider: "fake", async send(msg) { sentMails.push(msg); return { ok: true, provider: "fake" }; } };

describe("etapas de rastreio do pedido", { timeout: 90000 }, () => {
  let app, prisma, adminToken, customerToken, orderNumber;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });
  const patch = (payload) => asAdmin({ method: "PATCH", url: `/api/admin/orders/${orderNumber}`, payload });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET, ADMIN_EMAILS: ADMIN.email,
      PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, mailer: fakeMailer, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    adminToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN })).json().accessToken;
    customerToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: CUSTOMER })).json().accessToken;
    const co = await app.inject({
      method: "POST", url: "/api/checkout",
      headers: { "idempotency-key": `test-stages-${STAMP}`, authorization: `Bearer ${customerToken}` },
      payload: {
        items: [{ styleColor: "TEST-STAGES-001", nikeSize: "10", quantity: 1 }],
        customer: { name: CUSTOMER.name, email: CUSTOMER.email, cpf: "12345678909", phone: CUSTOMER.phone },
        address: { cep: "60000000", street: "Rua A", number: "1", city: "Fortaleza", state: "CE" }
      }
    });
    expect(co.statusCode).toBe(200);
    orderNumber = co.json().orderNumber;
    const conf = await app.inject({ method: "POST", url: `/api/orders/${orderNumber}/confirm`, payload: { transaction_nsu: "nsu-st", slug: "slug-st", capture_method: "pix" } });
    expect(conf.json().paid).toBe(true);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { number: orderNumber } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: "test-stages-" } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-stages-" } } });
    }
    await app?.close();
  });

  it("máquina de status: etapas em ordem, pode pular para a frente, nunca voltar", () => {
    expect(ORDER_STAGES).toEqual(["paid", "sourcing", "in_transit", "arrived_br", "shipped", "delivered"]);
    expect(ORDER_TRANSITIONS.paid).toEqual(expect.arrayContaining(["sourcing", "in_transit", "arrived_br", "shipped"]));
    expect(ORDER_TRANSITIONS.in_transit).not.toContain("sourcing");
    expect(ORDER_TRANSITIONS.arrived_br).not.toContain("delivered"); // entregue só depois de enviado
    expect(isInternationalOrder({ items: [{ breakdown: { source: "stock", section: "stock" } }] })).toBe(false);
    // hypado não está no Brasil (garimpado nos EUA) → rastreio internacional
    expect(isInternationalOrder({ items: [{ breakdown: { source: "stock", section: "hypados" } }] })).toBe(true);
    expect(isInternationalOrder({ items: [{ breakdown: { source: "stock" } }, { breakdown: { source: "nike" } }] })).toBe(true);
    expect(isInternationalOrder({ items: [{ breakdown: {} }] })).toBe(true);
  });

  it("paid → sourcing → in_transit → arrived_br → shipped → delivered, com e-mail em cada etapa; rastreio público traz international", async () => {
    const pub0 = await app.inject({ method: "GET", url: `/api/orders/${orderNumber}` });
    expect(pub0.json()).toMatchObject({ status: "paid", international: true });

    // pular direto para entregue não pode (precisa passar por enviado)
    expect((await patch({ status: "delivered" })).statusCode).toBe(409);

    const before = sentMails.length;
    expect((await patch({ status: "sourcing" })).json().status).toBe("sourcing");
    expect(sentMails.at(-1).subject).toMatch(/compramos o seu par/);
    expect(sentMails.at(-1).text).toContain("comprado na loja oficial nos EUA");
    expect(sentMails.at(-1).text).not.toContain("railway");

    expect((await patch({ status: "in_transit" })).json().status).toBe("in_transit");
    expect(sentMails.at(-1).subject).toMatch(/em trânsito internacional/);

    // voltar não pode
    expect((await patch({ status: "sourcing" })).statusCode).toBe(409);

    expect((await patch({ status: "arrived_br" })).json().status).toBe("arrived_br");
    expect(sentMails.at(-1).subject).toMatch(/chegou no Brasil/);
    expect(sentMails.length).toBe(before + 3);

    // etapa sem e-mail quando notifyCustomer=false — mas o evento fica registrado
    const shipped = await patch({ status: "shipped", carrier: "Correios", trackingCode: "NL000111222BR", notifyCustomer: false });
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json().status).toBe("shipped");
    expect(sentMails.length).toBe(before + 3);
    expect(shipped.json().events.filter((e) => e.type === "status_changed").map((e) => e.payload.to)).toEqual(["sourcing", "in_transit", "arrived_br", "shipped"]);

    // reenviar o e-mail de uma etapa intermediária
    const resend = await asAdmin({ method: "POST", url: `/api/admin/orders/${orderNumber}/resend-email`, payload: { kind: "arrived_br" } });
    expect(resend.statusCode).toBe(200);
    expect(sentMails.at(-1).subject).toMatch(/chegou no Brasil/);

    expect((await patch({ status: "delivered" })).json().status).toBe("delivered");
    expect(sentMails.at(-1).subject).toMatch(/entregue/);

    // "meus pedidos" do cliente: status final + flag para a linha do tempo
    const mine = await app.inject({ method: "GET", url: "/api/orders/mine", headers: { authorization: `Bearer ${customerToken}` } });
    const o = mine.json().orders.find((x) => x.number === orderNumber);
    expect(o).toMatchObject({ status: "delivered", international: true, trackingCode: "NL000111222BR" });
    expect(o.items[0].breakdown).toBeUndefined();
    expect(o.items[0].nikeSize).toBeUndefined();

    // fila "para enviar" aceita a lista de status nova
    const queue = await asAdmin({ method: "GET", url: "/api/admin/orders?status=paid,sourcing,in_transit,arrived_br&pageSize=5" });
    expect(queue.statusCode).toBe(200);
  });
});
