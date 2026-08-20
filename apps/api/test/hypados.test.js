import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Hypados (seção de estoque próprio) + Vitrine (hero configurável). Bate no banco de dev.
 * Tudo criado aqui tem prefixo "test-hyp-" e é apagado no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-hyp-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail(styleColor) {
    return {
      id: "mock-id", styleColor, name: "Featured Test Sneaker", priceUsd: 100,
      sizes: [{ nikeSize: "10", localizedSize: "10", available: true, level: "HIGH" }], genders: ["MEN"]
    };
  }
};

describe("hypados + vitrine (featured)", { timeout: 60000 }, () => {
  let app, prisma, adminToken, hyp, pe, orderNumber;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET,
      ADMIN_EMAILS: ADMIN.email, PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
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
      if (orderNumber) await prisma.order.deleteMany({ where: { number: orderNumber } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: "test-hyp-" } } });
      await prisma.stockProduct.deleteMany({ where: { name: { startsWith: "test-hyp-" } } });
      await prisma.setting.deleteMany({ where: { key: "featured" } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-hyp-" } } });
    }
    await app?.close();
  });

  it("cria produto na seção hypados → código HY-…; pronta entrega continua PE-…", async () => {
    const h = await asAdmin({
      method: "POST", url: "/api/admin/stock",
      payload: { section: "hypados", name: `test-hyp-Travis ${STAMP}`, category: "lifestyle", gender: "M", priceBrl: 4999, costBrl: 3500, sizes: [{ br: "41", us: "9.5", qty: 2 }], images: ["https://example.com/hy.webp"] }
    });
    expect(h.statusCode).toBe(201);
    hyp = h.json();
    expect(hyp.code).toMatch(/^HY-[A-Z0-9]{6}$/);
    expect(hyp.section).toBe("hypados");
    expect(hyp.sectionLabel).toBe("Hypados");

    const p = await asAdmin({
      method: "POST", url: "/api/admin/stock",
      payload: { name: `test-hyp-Kobe ${STAMP}`, category: "basketball", gender: "M", priceBrl: 1899, sizes: [{ br: "42", us: "10", qty: 1 }] }
    });
    expect(p.statusCode).toBe(201);
    pe = p.json();
    expect(pe.code).toMatch(/^PE-/);
    expect(pe.section).toBe("stock");
  });

  it("GET /api/stock separa as seções; admin filtra por ?section=", async () => {
    const st = await app.inject({ method: "GET", url: "/api/stock" });
    expect(st.json().products.some((x) => x.code === pe.code)).toBe(true);
    expect(st.json().products.some((x) => x.code === hyp.code)).toBe(false);

    const hy = await app.inject({ method: "GET", url: "/api/stock?section=hypados" });
    expect(hy.json().section).toBe("hypados");
    const prod = hy.json().products.find((x) => x.code === hyp.code);
    expect(prod).toBeTruthy();
    expect(prod.section).toBe("hypados");
    expect(prod.price.breakdown).toBeUndefined(); // interno não vaza
    expect(hy.json().products.some((x) => x.code === pe.code)).toBe(false);

    const admList = await asAdmin({ method: "GET", url: "/api/admin/stock?section=hypados" });
    expect(admList.json().products.every((x) => x.section === "hypados")).toBe(true);
  });

  it("catálogo intercepta HY- e o checkout reserva o estoque (mesmo fluxo da pronta entrega)", async () => {
    const det = await app.inject({ method: "GET", url: `/api/product/${hyp.code}` });
    expect(det.statusCode).toBe(200);
    expect(det.json().product.source).toBe("stock");
    expect(det.json().product.section).toBe("hypados");

    const co = await app.inject({
      method: "POST", url: "/api/checkout",
      headers: { "idempotency-key": `test-hyp-${STAMP}` },
      payload: {
        items: [{ styleColor: hyp.code, nikeSize: "9.5", quantity: 1 }],
        customer: { name: "Cliente Hypado", email: `test-hyp-cli-${STAMP}@kulture.test`, cpf: "12345678909" },
        address: { city: "Fortaleza", state: "CE" }
      }
    });
    expect(co.statusCode).toBe(200);
    orderNumber = co.json().orderNumber;
    const size = await prisma.stockSize.findFirst({ where: { productId: hyp.id, br: "41" } });
    expect(size.qty).toBe(1); // 2 → 1
    const order = await prisma.order.findUnique({ where: { number: orderNumber }, include: { items: true } });
    expect(order.items[0].breakdown.section).toBe("hypados");
  });

  it("vitrine: PUT valida seção/tipo e GET /api/featured resolve com fallback para o default", async () => {
    // código de estoque num slot de importados → 400; produto de seção errada → 400
    const badImport = await asAdmin({ method: "PUT", url: "/api/admin/featured", payload: { slots: { "import:default": { ref: hyp.code } } } });
    expect(badImport.statusCode).toBe(400);
    const wrongSection = await asAdmin({ method: "PUT", url: "/api/admin/featured", payload: { slots: { "hypados:default": { ref: pe.code } } } });
    expect(wrongSection.statusCode).toBe(400);
    expect(wrongSection.json().message).toMatch(/seção/);
    const badSlot = await asAdmin({ method: "PUT", url: "/api/admin/featured", payload: { slots: { "outra:coisa": { ref: "X" } } } });
    expect(badSlot.statusCode).toBe(400);

    const ok = await asAdmin({
      method: "PUT", url: "/api/admin/featured",
      payload: { slots: { "import:basketball": { ref: "io3415-100" }, "hypados:default": { ref: hyp.code }, "stock:default": { ref: pe.code }, "stock:running": null } }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().slots["import:basketball"].ref).toBe("IO3415-100"); // normalizado

    // importados: categoria com slot → resolve o SKU na Nike (mock)
    const imp = await app.inject({ method: "GET", url: "/api/featured?section=import&cat=basketball" });
    expect(imp.json().key).toBe("import:basketball");
    expect(imp.json().product.name).toBe("Featured Test Sneaker");
    expect(imp.json().product.price.brl).toBeGreaterThan(0);
    expect(imp.json().product.price.breakdown).toBeUndefined(); // público, sem interno
    expect(imp.json().product.sizes).toBeUndefined(); // hero não precisa dos tamanhos

    // categoria sem slot cai no default; seção sem nada → product null
    const fallback = await app.inject({ method: "GET", url: "/api/featured?section=hypados&cat=running" });
    expect(fallback.json().key).toBe("hypados:default");
    expect(fallback.json().product.code).toBe(hyp.code);
    const none = await app.inject({ method: "GET", url: "/api/featured?section=import" }); // import:default não configurado
    expect(none.json().product).toBeNull();

    // produto desativado → resolve como null (site cai no automático)
    await asAdmin({ method: "PATCH", url: `/api/admin/stock/${hyp.id}`, payload: { active: false } });
    const off = await app.inject({ method: "GET", url: "/api/featured?section=hypados" });
    expect(off.json().product).toBeNull();
    const admView = await asAdmin({ method: "GET", url: "/api/admin/featured" });
    expect(admView.json().resolved["hypados:default"]).toEqual({ ok: false });
    await asAdmin({ method: "PATCH", url: `/api/admin/stock/${hyp.id}`, payload: { active: true } });
  });

  it("rotas da vitrine exigem admin (GET/PUT 401 sem token); pública é aberta", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/featured" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/api/admin/featured", payload: { slots: {} } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/featured?section=stock" })).statusCode).toBe(200);
  });
});
