import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Pronta entrega (estoque próprio). Bate no banco de dev (DATABASE_URL), como orders/admin.
 * Tudo criado aqui tem prefixo "test-stock-" e é apagado no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-stock-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail() { throw new Error("não deveria consultar a Nike para produto de estoque"); }
};
// 1×1 PNG transparente
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("pronta entrega (estoque próprio)", { timeout: 60000 }, () => {
  let app, prisma, adminToken, product, orderNumber, orderNumber2;
  const auth = () => ({ authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET,
      ADMIN_EMAILS: ADMIN.email, PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test",
      WHATSAPP_CONTACT_PHONE: "+55 (11) 99999-8888", MAX_INSTALLMENTS: "10"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    const a = await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN });
    expect(a.statusCode).toBe(201);
    adminToken = a.json().accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { number: { in: [orderNumber, orderNumber2].filter(Boolean) } } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: "test-stock-" } } });
      await prisma.stockProduct.deleteMany({ where: { name: { startsWith: "test-stock-" } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-stock-" } } });
    }
    await app?.close();
  });

  it("GET /api/config expõe WhatsApp normalizado e parcelas", async () => {
    const r = await app.inject({ method: "GET", url: "/api/config" });
    expect(r.statusCode).toBe(200);
    expect(r.json().whatsapp).toEqual({ phone: "5511999998888", url: "https://wa.me/5511999998888" });
    expect(r.json().installments.max).toBe(10);
    expect(r.json().stock.enabled).toBe(true);
  });

  it("admin: exige role=admin", async () => {
    const r = await app.inject({ method: "GET", url: "/api/admin/stock" });
    expect(r.statusCode).toBe(401);
  });

  it("admin: cria produto com tamanhos; valida entrada", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/admin/stock", headers: auth(), payload: { name: "x", priceBrl: -1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("BAD_REQUEST");

    const r = await app.inject({
      method: "POST", url: "/api/admin/stock", headers: auth(),
      payload: {
        name: `test-stock-Kobe 6 Protro ${STAMP}`, subtitle: "Basketball shoes", colorDescription: "Grinch",
        description: "Par novo na caixa, pronta entrega.", priceBrl: "1899,00".replace(",", "."), fullPriceBrl: 2199, costBrl: 1200, badge: "último par",
        sizes: [{ br: "41", us: "9", qty: 1 }, { br: "42", us: "10", qty: 2 }, { br: "43", qty: 0 }],
        images: ["https://example.com/foto.webp", "not a url"]
      }
    });
    expect(r.statusCode).toBe(400); // "not a url" recusada
    const ok = await app.inject({
      method: "POST", url: "/api/admin/stock", headers: auth(),
      payload: {
        name: `test-stock-Kobe 6 Protro ${STAMP}`, subtitle: "Basketball shoes", colorDescription: "Grinch",
        description: "Par novo na caixa, pronta entrega.", priceBrl: 1899, fullPriceBrl: 2199, costBrl: 1200, badge: "último par",
        sizes: [{ br: "41", us: "9", qty: 1 }, { br: "42", us: "10", qty: 2 }, { br: "43", qty: 0 }],
        images: ["https://example.com/foto.webp"]
      }
    });
    expect(ok.statusCode).toBe(201);
    product = ok.json();
    expect(product.code).toMatch(/^PE-[A-Z2-9]{6}$/);
    expect(product.slug).toMatch(/^test-stock-kobe-6-protro/);
    expect(product.sizes).toHaveLength(3);
    expect(product.totalQty).toBe(3);
    expect(product.costBrl).toBe(1200);
  });

  it("admin: upload de foto vai para o banco e é servida em /media/estoque/:id", async () => {
    const up = await app.inject({ method: "POST", url: `/api/admin/stock/${product.id}/images`, headers: auth(), payload: { dataUrl: PNG_1PX } });
    expect(up.statusCode).toBe(201);
    expect(up.json().url).toMatch(/^\/media\/estoque\//);
    expect(up.json().images).toHaveLength(2);
    const img = await app.inject({ method: "GET", url: up.json().url });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toContain("immutable");
    expect(img.rawPayload.length).toBeGreaterThan(50);

    // remover a foto do array apaga o blob
    const upd = await app.inject({ method: "PATCH", url: `/api/admin/stock/${product.id}`, headers: auth(), payload: { images: ["https://example.com/foto.webp"] } });
    expect(upd.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: up.json().url });
    expect(gone.statusCode).toBe(404);
  });

  it("público: /api/stock lista sem custo/ids internos; /api/product/:code traz tamanhos", async () => {
    const r = await app.inject({ method: "GET", url: "/api/stock" });
    expect(r.statusCode).toBe(200);
    const p = r.json().products.find((x) => x.styleColor === product.code);
    expect(p).toBeTruthy();
    expect(p.source).toBe("stock");
    expect(p.price.brl).toBe(1899);
    expect(p.price.fullBrl).toBe(2199);
    expect(p.price.breakdown).toBeUndefined();
    expect(p.stockProductId).toBeUndefined();
    expect(p.description).toBe("Par novo na caixa, pronta entrega.");
    expect(p.sizes.find((s) => s.brLabel === "41").stockSizeId).toBeUndefined();

    const d = await app.inject({ method: "GET", url: `/api/product/${product.code}` });
    expect(d.statusCode).toBe(200);
    // sem ?all → só disponíveis (43 tem qty 0)
    expect(d.json().product.sizes.map((s) => s.brLabel)).toEqual(["41", "42"]);
    expect(d.json().product.sizes[0]).toMatchObject({ nikeSize: "9", brLabel: "41", usSize: "9", available: true, qty: 1 });
    expect(d.json().product.price.breakdown).toBeUndefined();
  });

  it("checkout reserva o estoque na transação; segundo pedido do último par é recusado", async () => {
    const payload = (n) => ({
      items: [{ styleColor: product.code, nikeSize: "9", quantity: 1 }],
      customer: { name: "Cliente Estoque", email: `test-stock-cli-${STAMP}-${n}@kulture.test`, cpf: "12345678909" },
      address: { cep: "01000-000", city: "São Paulo", state: "SP" }
    });
    const r1 = await app.inject({ method: "POST", url: "/api/checkout", headers: { "idempotency-key": `test-stock-${STAMP}-1` }, payload: payload(1) });
    expect(r1.statusCode).toBe(200);
    orderNumber = r1.json().orderNumber;
    expect(r1.json().totalBrl).toBe(1899);

    const size41 = await prisma.stockSize.findFirst({ where: { productId: product.id, br: "41" } });
    expect(size41.qty).toBe(0);

    const order = await prisma.order.findUnique({ where: { number: orderNumber }, include: { items: true } });
    expect(order.items[0].breakdown).toMatchObject({ source: "stock", stockSizeId: size41.id, subtotalBrl: 1200 });
    expect(Number(order.items[0].unitPriceUsd)).toBe(0);

    const r2 = await app.inject({ method: "POST", url: "/api/checkout", headers: { "idempotency-key": `test-stock-${STAMP}-2` }, payload: payload(2) });
    expect(r2.statusCode).toBe(400); // tamanho não está mais disponível
  });

  it("cancelar no admin devolve ao estoque (uma vez só); baixa manual re-reserva", async () => {
    const c = await app.inject({ method: "PATCH", url: `/api/admin/orders/${orderNumber}`, headers: auth(), payload: { status: "cancelled", notifyCustomer: false } });
    expect(c.statusCode).toBe(200);
    let size41 = await prisma.stockSize.findFirst({ where: { productId: product.id, br: "41" } });
    expect(size41.qty).toBe(1);
    const o = await prisma.order.findUnique({ where: { number: orderNumber }, include: { events: true } });
    expect(o.stockReleasedAt).toBeTruthy();
    expect(o.events.some((e) => e.type === "stock_released")).toBe(true);

    // segundo pedido agora passa (par voltou) — e abandonar/pagar exercita release + re-reserva
    const r2 = await app.inject({
      method: "POST", url: "/api/checkout", headers: { "idempotency-key": `test-stock-${STAMP}-3` },
      payload: { items: [{ styleColor: product.code, nikeSize: "9", quantity: 1 }], customer: { name: "Cliente 2", email: `test-stock-cli2-${STAMP}@kulture.test`, cpf: "12345678909" }, address: { cep: "01000-000", city: "SP", state: "SP" } }
    });
    expect(r2.statusCode).toBe(200);
    orderNumber2 = r2.json().orderNumber;
    size41 = await prisma.stockSize.findFirst({ where: { productId: product.id, br: "41" } });
    expect(size41.qty).toBe(0);

    const ab = await app.inject({ method: "PATCH", url: `/api/admin/orders/${orderNumber2}`, headers: auth(), payload: { status: "abandoned" } });
    expect(ab.statusCode).toBe(200);
    size41 = await prisma.stockSize.findFirst({ where: { productId: product.id, br: "41" } });
    expect(size41.qty).toBe(1);

    const paid = await app.inject({ method: "PATCH", url: `/api/admin/orders/${orderNumber2}`, headers: auth(), payload: { status: "paid", paymentMethod: "pix" } });
    expect(paid.statusCode).toBe(200);
    size41 = await prisma.stockSize.findFirst({ where: { productId: product.id, br: "41" } });
    expect(size41.qty).toBe(0);
    const o2 = await prisma.order.findUnique({ where: { number: orderNumber2 }, include: { events: true } });
    expect(o2.stockReleasedAt).toBeNull();
    expect(o2.events.some((e) => e.type === "stock_reserved_again")).toBe(true);
  });

  it("admin: atualizar tamanhos mantém ids existentes, remove os que saíram; inativo some do público", async () => {
    const before = await prisma.stockSize.findFirst({ where: { productId: product.id, br: "42" } });
    const r = await app.inject({ method: "PATCH", url: `/api/admin/stock/${product.id}`, headers: auth(), payload: { sizes: [{ br: "42", us: "10", qty: 5 }, { br: "44", qty: 1 }], active: false } });
    expect(r.statusCode).toBe(200);
    expect(r.json().sizes.map((s) => s.br)).toEqual(["42", "44"]);
    const after = await prisma.stockSize.findFirst({ where: { productId: product.id, br: "42" } });
    expect(after.id).toBe(before.id);
    expect(after.qty).toBe(5);

    const pub = await app.inject({ method: "GET", url: "/api/stock" });
    expect(pub.json().products.some((x) => x.styleColor === product.code)).toBe(false);
    const det = await app.inject({ method: "GET", url: `/api/product/${product.code}` });
    expect(det.statusCode).toBe(404);
  });

  it("admin: DELETE remove produto, tamanhos e fotos", async () => {
    const r = await app.inject({ method: "DELETE", url: `/api/admin/stock/${product.id}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(await prisma.stockSize.count({ where: { productId: product.id } })).toBe(0);
    expect(await prisma.stockImage.count({ where: { productId: product.id } })).toBe(0);
  });
});
