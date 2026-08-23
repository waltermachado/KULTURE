import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Venda externa (registrada no painel — POST /api/admin/orders). Bate no banco de dev, como os outros.
 * Tudo criado aqui tem prefixo "test-manual-" e é apagado no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-manual-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };
const CUSTOMER = { email: `test-manual-cli-${STAMP}@kulture.test`, password: "Senh@Cli12345", name: "Cliente Externo Silva", phone: "85999990000" };
const GUEST_EMAIL = `test-manual-guest-${STAMP}@kulture.test`;

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail(styleColor) {
    return {
      id: "mock-id", styleColor, name: "Manual Test Sneaker", priceUsd: 100,
      sizes: [{ nikeSize: "9.5", localizedSize: "M 9.5 / W 11", available: true, level: "HIGH" }], genders: ["MEN", "WOMEN"]
    };
  }
};
const sentMails = [];
const fakeMailer = { provider: "fake", async send(msg) { sentMails.push(msg); return { ok: true, provider: "fake" }; } };

describe("venda externa (registrada no painel)", { timeout: 60000 }, () => {
  let app, prisma, adminToken, customerToken, customerId, product, size41, size42;
  const created = [];
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET,
      ADMIN_EMAILS: ADMIN.email, PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, mailer: fakeMailer, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;

    const a = await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN });
    expect(a.statusCode).toBe(201);
    adminToken = a.json().accessToken;
    const c = await app.inject({ method: "POST", url: "/api/auth/register", payload: CUSTOMER });
    expect(c.statusCode).toBe(201);
    customerToken = c.json().accessToken;
    customerId = c.json().user.id;

    // produto de pronta entrega com 2 pares no 41 e 1 no 42
    const p = await asAdmin({
      method: "POST", url: "/api/admin/stock",
      payload: {
        name: `test-manual-Kobe 6 ${STAMP}`, category: "basketball", gender: "U", colorDescription: "Grinch",
        priceBrl: 1899, costBrl: 1200, sizes: [{ br: "41", us: "9", qty: 2 }, { br: "42", us: "10", qty: 1 }],
        images: ["https://example.com/kobe.webp"]
      }
    });
    expect(p.statusCode).toBe(201);
    product = p.json();
    size41 = product.sizes.find((s) => s.br === "41");
    size42 = product.sizes.find((s) => s.br === "42");
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { number: { in: created } } });
      await prisma.stockProduct.deleteMany({ where: { name: { startsWith: "test-manual-" } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-manual-" } } });
    }
    await app?.close();
  });

  it("exige admin e valida o mínimo (cliente com e-mail, pelo menos um item)", async () => {
    expect((await app.inject({ method: "POST", url: "/api/admin/orders", payload: {} })).statusCode).toBe(401);
    const noEmail = await asAdmin({ method: "POST", url: "/api/admin/orders", payload: { customer: { name: "Fulano", email: "nao-e-email" }, items: [{ name: "X", brLabel: "41", unitPriceBrl: 10 }] } });
    expect(noEmail.statusCode).toBe(400);
    expect(noEmail.json().message).toMatch(/e-mail/i);
    const noItems = await asAdmin({ method: "POST", url: "/api/admin/orders", payload: { customer: { name: "Fulano", email: GUEST_EMAIL }, items: [] } });
    expect(noItems.statusCode).toBe(400);
    const badItem = await asAdmin({ method: "POST", url: "/api/admin/orders", payload: { customer: { name: "Fulano", email: GUEST_EMAIL }, items: [{ name: "Sem tamanho", unitPriceBrl: 10 }] } });
    expect(badItem.statusCode).toBe(400);
    expect(badItem.json().message).toMatch(/tamanho/);
  });

  it("registra venda (WhatsApp) com item de estoque + importado + livre: pedido pago, estoque baixado, e-mail enviado", async () => {
    const before = sentMails.length;
    const r = await asAdmin({
      method: "POST", url: "/api/admin/orders",
      payload: {
        customer: { name: CUSTOMER.name, email: CUSTOMER.email.toUpperCase(), phone: "(85) 99999-0000", cpf: "123.456.789-09" },
        address: { cep: "60000-000", city: "Fortaleza", state: "ce" },
        channel: "whatsapp",
        items: [
          { kind: "stock", code: product.code, brLabel: "41", sizeGender: "W", quantity: 1 },
          { kind: "import", styleColor: "CW2190-300", name: "Kobe 6 Protro Grinch", brLabel: "42", usSize: "10", sizeGender: "M", unitPriceBrl: "2.199,00", unitCostBrl: 1500, unitPriceUsd: 190, quantity: 1 },
          { kind: "manual", name: "Meia Nike Elite", brLabel: "M", unitPriceBrl: 99.9, quantity: 2 }
        ],
        discountBrl: 100,
        payment: { method: "credit_card", installments: 3, reference: "NSU-EXT-1", receiptUrl: "https://example.com/comprovante.pdf" },
        note: "fechado no WhatsApp",
        internalNotes: "cliente antigo"
      }
    });
    expect(r.statusCode).toBe(201);
    const o = r.json();
    created.push(o.number);
    expect(o.number).toMatch(/^KLT-\d{4}-\d{6}$/);
    expect(o.status).toBe("paid");
    expect(o.channel).toBe("whatsapp");
    expect(o.external).toBe(true);
    expect(o.paymentProvider).toBe("manual");
    expect(o.paymentMethod).toBe("credit_card");
    expect(o.installments).toBe(3);
    expect(o.transactionNsu).toBe("NSU-EXT-1");
    expect(o.paidAt).toBeTruthy();
    expect(o.customerEmail).toBe(CUSTOMER.email); // normalizado
    expect(o.customerCpf).toBe("12345678909");
    expect(o.customerPhone).toBe("85999990000");
    expect(o.address).toEqual({ cep: "60000000", city: "Fortaleza", state: "CE" });
    expect(o.user?.id).toBe(customerId); // vinculado à conta pelo e-mail
    expect(o.items).toHaveLength(3);
    // subtotal 1899 + 2199 + 2×99.9 = 4297.8 − 100 desconto
    expect(Number(o.subtotalBrl)).toBeCloseTo(4297.8, 2);
    expect(Number(o.totalBrl)).toBeCloseTo(4197.8, 2);
    expect(Number(o.paidAmountBrl)).toBeCloseTo(4197.8, 2);
    expect(o.pricingSnapshot.discountBrl).toBe(100);

    const stockItem = o.items.find((i) => i.styleColor === product.code);
    expect(stockItem.sizeLabel).toBe("BR 41 (US W 10.5)"); // unissex: W = M 9 + 1,5
    expect(Number(stockItem.unitPriceBrl)).toBe(1899);
    expect(stockItem.breakdown.source).toBe("stock");
    expect(stockItem.breakdown.subtotalBrl).toBe(1200); // custo do cadastro → margem no dashboard
    expect(stockItem.breakdown.stockDeducted).toBe(true);
    const importItem = o.items.find((i) => i.styleColor === "CW2190-300");
    expect(importItem.sizeLabel).toBe("BR 42 (US M 10)");
    expect(Number(importItem.unitPriceBrl)).toBe(2199);
    expect(importItem.breakdown).toMatchObject({ source: "import", subtotalBrl: 1500 });
    const manualItem = o.items.find((i) => i.name === "Meia Nike Elite");
    expect(manualItem.sizeLabel).toBe("BR M");
    expect(manualItem.quantity).toBe(2);
    expect(o.economics.costBrl).toBe(2700);

    const types = o.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["created", "payment_registered", "stock_reserved", "note", "email_registered"]));
    expect(o.events.find((e) => e.type === "created").payload).toMatchObject({ manual: true, channel: "whatsapp", userLink: "email", adminEmail: ADMIN.email });
    expect(o.allowedTransitions).toContain("shipped");

    // estoque do 41 baixou de 2 → 1
    const s = await prisma.stockSize.findUnique({ where: { id: size41.id } });
    expect(s.qty).toBe(1);

    // e-mail "pedido registrado"
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1).to).toBe(CUSTOMER.email);
    expect(sentMails.at(-1).subject).toMatch(/registrado/);
    expect(sentMails.at(-1).text).toContain(o.number);
    expect(sentMails.at(-1).text).toContain("tam. BR 41 ×"); // cliente vê só o BR — o US fica no backoffice
    expect(sentMails.at(-1).text).not.toMatch(/US W|US M/);
    expect(sentMails.at(-1).text).toContain("https://loja.test/conta");
  });

  it("cliente vê a venda externa em /api/orders/mine; visão pública por número funciona (mascarada)", async () => {
    const mine = await app.inject({ method: "GET", url: "/api/orders/mine", headers: { authorization: `Bearer ${customerToken}` } });
    expect(mine.statusCode).toBe(200);
    const o = mine.json().orders.find((x) => x.number === created[0]);
    expect(o).toBeTruthy();
    expect(o.status).toBe("paid");
    expect(o.items.some((i) => i.sizeLabel === "BR 41")).toBe(true); // só o BR para o cliente
    expect(o.items.every((i) => i.nikeSize === undefined && !/US/.test(i.sizeLabel))).toBe(true);

    const pub = await app.inject({ method: "GET", url: `/api/orders/${created[0]}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().scope).toBe("public");
    expect(pub.json().customerName).toBe("Cliente");
    expect(pub.json().customerCpf).toBeUndefined();
  });

  it("aparece na lista com filtro channel=external (e some em channel=site); dashboard separa por canal", async () => {
    const ext = await asAdmin({ method: "GET", url: `/api/admin/orders?channel=external&q=${encodeURIComponent(CUSTOMER.email)}` });
    expect(ext.statusCode).toBe(200);
    const row = ext.json().orders.find((o) => o.number === created[0]);
    expect(row).toBeTruthy();
    expect(row.external).toBe(true);
    expect(row.channelLabel).toBe("WhatsApp");
    const site = await asAdmin({ method: "GET", url: `/api/admin/orders?channel=site&q=${encodeURIComponent(CUSTOMER.email)}` });
    expect(site.json().orders.some((o) => o.number === created[0])).toBe(false);
    const wa = await asAdmin({ method: "GET", url: `/api/admin/orders?channel=whatsapp,instagram&q=${encodeURIComponent(CUSTOMER.email)}` });
    expect(wa.json().orders.some((o) => o.number === created[0])).toBe(true);

    const d = await asAdmin({ method: "GET", url: "/api/admin/dashboard?days=7" });
    expect(d.statusCode).toBe(200);
    const wch = d.json().byChannel.find((c) => c.channel === "whatsapp");
    expect(wch).toBeTruthy();
    expect(wch.label).toBe("WhatsApp");
    expect(wch.revenueBrl).toBeGreaterThanOrEqual(4197.8);
    expect(d.json().totals.externalOrders).toBeGreaterThanOrEqual(1);
    expect(d.json().totals.externalRevenueBrl).toBeGreaterThanOrEqual(4197.8);
    expect(d.json().byPaymentMethod.credit_card).toBeGreaterThanOrEqual(4197.8);
    expect(d.json().paymentMethodLabels.cash).toBe("Dinheiro");
  });

  it("sem estoque → 409 STOCK_OUT; com deductStock=false registra sem baixar", async () => {
    const body = (extra) => ({
      customer: { name: "Convidado Externo", email: GUEST_EMAIL },
      channel: "instagram",
      items: [{ kind: "stock", code: product.code, brLabel: "42", quantity: 2, ...extra }],
      payment: { method: "pix" },
      notifyCustomer: false
    });
    const out = await asAdmin({ method: "POST", url: "/api/admin/orders", payload: body({}) });
    expect(out.statusCode).toBe(409);
    expect(out.json().details.code).toBe("STOCK_OUT");
    expect(out.json().message).toMatch(/baixar do estoque/);
    expect((await prisma.stockSize.findUnique({ where: { id: size42.id } })).qty).toBe(1); // intacto

    const before = sentMails.length;
    const ok = await asAdmin({ method: "POST", url: "/api/admin/orders", payload: body({ deductStock: false, unitPriceBrl: 1700 }) });
    expect(ok.statusCode).toBe(201);
    created.push(ok.json().number);
    expect(ok.json().items[0].breakdown.stockDeducted).toBe(false);
    expect(Number(ok.json().items[0].unitPriceBrl)).toBe(1700);
    expect(Number(ok.json().totalBrl)).toBe(3400);
    expect(ok.json().user).toBeNull(); // convidado: aparece em /conta quando criar a conta com esse e-mail
    expect(ok.json().events.some((e) => e.type === "email_registered")).toBe(false);
    expect(sentMails.length).toBe(before);
    expect((await prisma.stockSize.findUnique({ where: { id: size42.id } })).qty).toBe(1);
  });

  it("venda antiga já entregue: status/datas/rastreio registrados; reenvio usa o e-mail de 'pedido registrado'", async () => {
    const paidAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const r = await asAdmin({
      method: "POST", url: "/api/admin/orders",
      payload: {
        customer: { name: "Cliente Antigo", email: GUEST_EMAIL },
        channel: "presencial", status: "delivered",
        items: [{ kind: "manual", name: "Air Force 1", brLabel: "40", usSize: "8", sizeGender: "M", unitPriceBrl: 899 }],
        payment: { method: "cash", paidAt },
        shipping: { carrier: "Correios", trackingCode: "NL000111222BR" },
        notifyCustomer: false
      }
    });
    expect(r.statusCode).toBe(201);
    const o = r.json();
    created.push(o.number);
    expect(o.status).toBe("delivered");
    expect(new Date(o.paidAt).toISOString()).toBe(paidAt);
    expect(o.shippedAt).toBeTruthy();
    expect(o.deliveredAt).toBeTruthy();
    expect(o.trackingCode).toBe("NL000111222BR");
    expect(o.paymentMethod).toBe("cash");
    expect(o.installments).toBeNull();
    expect(o.items[0].sizeLabel).toBe("BR 40 (US M 8)");
    const types = o.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["status_changed", "tracking_updated"]));
    expect(o.allowedTransitions).toEqual(["refunded"]);

    const before = sentMails.length;
    const re = await asAdmin({ method: "POST", url: `/api/admin/orders/${o.number}/resend-email`, payload: { kind: "paid" } });
    expect(re.statusCode).toBe(200);
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1).subject).toMatch(/registrado/);
    expect(sentMails.at(-1).text).toContain("Consta como entregue");
    expect(sentMails.at(-1).text).toContain("Dinheiro");

    // cancelar uma venda externa de estoque devolve o par (mesmo fluxo do site)
    const stockOrder = created[0];
    const cancel = await asAdmin({ method: "PATCH", url: `/api/admin/orders/${stockOrder}`, payload: { status: "cancelled", notifyCustomer: false } });
    expect(cancel.statusCode).toBe(200);
    expect((await prisma.stockSize.findUnique({ where: { id: size41.id } })).qty).toBe(2);
  });

  it("GET /api/admin/catalog/:term devolve o produto Nike com breakdown e todos os tamanhos (pré-preenchimento)", async () => {
    const r = await asAdmin({ method: "GET", url: "/api/admin/catalog/CW2190-300" });
    expect(r.statusCode).toBe(200);
    const p = r.json().product;
    expect(p.name).toBe("Manual Test Sneaker");
    expect(p.price.breakdown.subtotalBrl).toBeGreaterThan(0);
    expect(p.sizes[0]).toMatchObject({ nikeSize: "9.5", brLabel: "41", us: { M: "9.5", W: "11" } });
    // mesma rota sem admin: 401
    expect((await app.inject({ method: "GET", url: "/api/admin/catalog/CW2190-300" })).statusCode).toBe(401);
  });
});
