import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Cupons de desconto: cadastro no painel, validação pública, desconto aplicado no checkout (recalculado no
 * servidor) e contagem de uso quando o pedido é pago. Bate no banco de dev; prefixo "TESTCPN" e limpeza no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-cpn-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };
const CODE = `TESTCPN${String(STAMP).slice(-6)}`;

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 1, products: [{ id: "p1", styleColor: "TEST-CPN-001", name: "Kobe 6 Protro", brand: "Nike", category: "basketball", priceUsd: 190, image: "https://img/1.png", genders: ["MEN"] }] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail(styleColor) {
    return { id: "p1", styleColor, name: "Kobe 6 Protro", brand: "Nike", category: "basketball", priceUsd: 190, sizes: [{ nikeSize: "10", localizedSize: "10", available: true, level: "HIGH" }], genders: ["MEN"] };
  }
};

describe("cupons de desconto", { timeout: 90000 }, () => {
  let app, prisma, adminToken, couponId, orderNumber;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });
  const validate = (code, subtotalBrl) => app.inject({ method: "POST", url: "/api/coupons/validate", payload: { code, subtotalBrl } });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "", TEST_PRODUCT_ENABLED: "false",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET, ADMIN_EMAILS: ADMIN.email,
      PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    adminToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN })).json().accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { number: orderNumber ?? "x" } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: "test-cpn-" } } });
      await prisma.coupon.deleteMany({ where: { code: { startsWith: "TESTCPN" } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-cpn-" } } });
    }
    await app?.close();
  });

  it("admin cria cupom com validação; código duplicado → 409; cliente comum → 401/403", async () => {
    expect((await app.inject({ method: "POST", url: "/api/admin/coupons", payload: {} })).statusCode).toBe(401);
    const badValue = await asAdmin({ method: "POST", url: "/api/admin/coupons", payload: { code: CODE, kind: "percent", value: 150 } });
    expect(badValue.statusCode).toBe(400);
    expect(badValue.json().message).toMatch(/até 100/);
    expect((await asAdmin({ method: "POST", url: "/api/admin/coupons", payload: { code: "a!", kind: "fixed", value: 10 } })).statusCode).toBe(400);

    const ok = await asAdmin({
      method: "POST", url: "/api/admin/coupons",
      payload: { code: ` ${CODE.toLowerCase()} `, kind: "percent", value: 10, maxDiscountBrl: "150", minSubtotalBrl: 500, maxUses: 2, note: "teste" }
    });
    expect(ok.statusCode).toBe(201);
    couponId = ok.json().coupon.id;
    expect(ok.json().coupon).toMatchObject({ code: CODE, kind: "percent", usedCount: 0, active: true });

    const dup = await asAdmin({ method: "POST", url: "/api/admin/coupons", payload: { code: CODE, kind: "fixed", value: 10 } });
    expect(dup.statusCode).toBe(409);
  });

  it("validação pública: desconto certo, mínimo, teto, inexistente, pausado", async () => {
    const okBig = await validate(CODE, 2000);
    expect(okBig.json()).toMatchObject({ ok: true, code: CODE, discountBrl: 150 }); // 10% de 2000 = 200 → teto 150
    const okSmall = await validate(CODE.toLowerCase(), 1000);
    expect(okSmall.json().discountBrl).toBe(100); // 10% de 1000, sem bater no teto
    expect(okSmall.json().description).toMatch(/10%/);
    const below = await validate(CODE, 300);
    expect(below.json().ok).toBe(false);
    expect(below.json().message).toMatch(/a partir de/);
    expect((await validate("NAOEXISTE", 1000)).json().message).toMatch(/não encontrado/);

    await asAdmin({ method: "PATCH", url: `/api/admin/coupons/${couponId}`, payload: { active: false } });
    expect((await validate(CODE, 1000)).json().message).toMatch(/não está mais ativo/);
    await asAdmin({ method: "PATCH", url: `/api/admin/coupons/${couponId}`, payload: { active: true } });
  });

  it("checkout aplica o desconto no servidor; pedido pago consome 1 uso; cupom inválido → 400", async () => {
    const bad = await app.inject({
      method: "POST", url: "/api/checkout", headers: { "idempotency-key": `test-cpn-${STAMP}-bad` },
      payload: {
        items: [{ styleColor: "TEST-CPN-001", nikeSize: "10", quantity: 1 }],
        customer: { name: "Cliente Cupom", email: `test-cpn-cli-${STAMP}@kulture.test`, cpf: "12345678909" },
        address: { cep: "60000000", city: "Fortaleza", state: "CE" },
        coupon: "NAOEXISTE"
      }
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/Cupom NAOEXISTE/);

    const co = await app.inject({
      method: "POST", url: "/api/checkout", headers: { "idempotency-key": `test-cpn-${STAMP}-ok` },
      payload: {
        items: [{ styleColor: "TEST-CPN-001", nikeSize: "10", quantity: 1 }],
        customer: { name: "Cliente Cupom", email: `test-cpn-cli-${STAMP}@kulture.test`, cpf: "12345678909" },
        address: { cep: "60000000", city: "Fortaleza", state: "CE" },
        coupon: ` ${CODE.toLowerCase()} `
      }
    });
    expect(co.statusCode).toBe(200);
    orderNumber = co.json().orderNumber;
    const order = await prisma.order.findUnique({ where: { number: orderNumber } });
    const subtotal = Number(order.subtotalBrl);
    expect(order.couponCode).toBe(CODE);
    expect(Number(order.discountBrl)).toBe(Math.min(Math.round(subtotal * 0.1 * 100) / 100, 150));
    expect(Number(order.totalBrl)).toBe(subtotal - Number(order.discountBrl));

    // ainda não consumiu (pedido não pago)
    expect((await prisma.coupon.findUnique({ where: { code: CODE } })).usedCount).toBe(0);
    const conf = await app.inject({ method: "POST", url: `/api/orders/${orderNumber}/confirm`, payload: { transaction_nsu: "nsu-cpn", slug: "slug-cpn", capture_method: "pix" } });
    expect(conf.json().paid).toBe(true);
    expect((await prisma.coupon.findUnique({ where: { code: CODE } })).usedCount).toBe(1);
    // reconfirmar não conta de novo
    await app.inject({ method: "POST", url: `/api/orders/${orderNumber}/confirm`, payload: { transaction_nsu: "nsu-cpn", slug: "slug-cpn", capture_method: "pix" } });
    expect((await prisma.coupon.findUnique({ where: { code: CODE } })).usedCount).toBe(1);

    // visão pública traz cupom/desconto para a confirmação
    const pub = await app.inject({ method: "GET", url: `/api/orders/${orderNumber}` });
    expect(pub.json()).toMatchObject({ couponCode: CODE });
    expect(Number(pub.json().discountBrl)).toBeGreaterThan(0);

    // limite de usos: maxUses 2 → com 1 uso ainda vale; baixa para 1 → esgotado
    await asAdmin({ method: "PATCH", url: `/api/admin/coupons/${couponId}`, payload: { maxUses: 1 } });
    expect((await validate(CODE, 1000)).json().message).toMatch(/limite de usos/);
  });

  it("cupom fixo nunca passa do subtotal", async () => {
    const big = await asAdmin({ method: "POST", url: "/api/admin/coupons", payload: { code: `${CODE}F`, kind: "fixed", value: 5000 } });
    expect(big.statusCode).toBe(201);
    const r = await validate(`${CODE}F`, 1799);
    expect(r.json()).toMatchObject({ ok: true, discountBrl: 1799 });
  });
});
