import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { AppError } from "../src/lib/errors.js";

/**
 * Nike By You (customizado): a Nike não tem SKU/tamanhos → o catálogo cai na busca pelo id do design e oferece
 * a tabela padrão; o checkout grava a modelagem escolhida e a personalização (texto ≤ 8 + nº 2 dígitos por pé).
 * Bate no banco de dev (checkout), como orders/stock.
 */
const STAMP = Date.now();
const DESIGN = "1685956779";
const byYouRaw = { id: DESIGN, styleColor: DESIGN, name: "Nike Air Force 1 Mid By You", subtitle: "Custom Men's Shoes", productType: "FOOTWEAR", productSubType: "CUSTOMIZED", priceUsd: 145, fullPriceUsd: 145, onSale: false, image: null, url: `https://www.nike.com/u/custom-nike-air-force-1-mid-by-you-10002286/${DESIGN}`, colorDescription: "Multi-Color" };
const fakeScraper = {
  baseUrl: "mock",
  async search(q) { return String(q).includes(DESIGN) ? { total: 1, products: [byYouRaw] } : { total: 0, products: [] }; },
  // o client real implementa findOne em cima da busca (styleColor exato ganha) — aqui simulado direto
  async findOne(term) { return String(term).includes(DESIGN) ? byYouRaw : null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail() { throw AppError.upstream("nike-scraper respondeu 404", { body: '{"error":"Sizes unavailable for this styleColor","code":"SIZES_UNAVAILABLE"}' }); }
};
const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };

describe("Nike By You", { timeout: 60000 }, () => {
  let app, prisma, orderNumber;
  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "", DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: "test-jwt-secret-kulture-32chars-long!!", PAYMENT_PROVIDER: "mock" });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
  });
  afterAll(async () => {
    if (prisma && orderNumber) await prisma.order.deleteMany({ where: { number: orderNumber } });
    if (prisma) await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: "test-byyou-" } } });
    await app?.close();
  });

  it("GET /api/product/:designId → byYou + tabela padrão de tamanhos (M e W)", async () => {
    const r = await app.inject({ method: "GET", url: `/api/product/${DESIGN}` });
    expect(r.statusCode).toBe(200);
    const p = r.json().product;
    expect(p.byYou).toBe(true);
    expect(p.sizesSynthetic).toBe(true);
    expect(p.customization).toMatchObject({ textMax: 8 }); // Nike tirou o número separado — só a gravação de 8 caracteres
    expect(p.customization.fields).toEqual(["textLeft", "textRight"]);
    expect(p.sizeGroups).toEqual(["M", "W"]);
    const s38 = p.sizes.find((s) => s.brLabel === "38");
    expect(s38).toMatchObject({ nikeSize: "7", scale: "M", us: { M: "7", W: "8.5" }, available: true, synthetic: true });
    expect(p.price.brl).toBeGreaterThan(0);
    expect(p.price.breakdown).toBeUndefined();
  });

  it("checkout grava modelagem + personalização; recusa texto > 8", async () => {
    const base = { customer: { name: "Cliente By You", email: `test-byyou-${STAMP}@kulture.test`, cpf: "12345678909" }, address: { cep: "01000-000", city: "SP", state: "SP" } };
    const bad = await app.inject({ method: "POST", url: "/api/checkout", headers: { "idempotency-key": `test-byyou-${STAMP}-bad` }, payload: { ...base, items: [{ styleColor: DESIGN, nikeSize: "7", quantity: 1, customization: { textLeft: "MUITOLONGO9" } }] } });
    expect(bad.statusCode).toBe(400);

    // formato atual: uma gravação por pé (letras e números juntos); numberLeft/Right antigos seguem aceitos por compatibilidade
    const ok = await app.inject({ method: "POST", url: "/api/checkout", headers: { "idempotency-key": `test-byyou-${STAMP}-ok` }, payload: { ...base, items: [{ styleColor: DESIGN, nikeSize: "7", quantity: 1, sizeGender: "W", customization: { textLeft: "KULTURE", textRight: "MAMBA 24" } }] } });
    expect(ok.statusCode).toBe(200);
    orderNumber = ok.json().orderNumber;
    const order = await prisma.order.findUnique({ where: { number: orderNumber }, include: { items: true } });
    expect(order.items[0].sizeLabel).toBe("BR 38 (US W 8.5)");
    expect(order.items[0].customization).toEqual({ textLeft: "KULTURE", numberLeft: "", textRight: "MAMBA 24", numberRight: "" });
    // visão pública do pedido traz o rótulo SÓ em BR (o US não vaza para o cliente) e a personalização
    const pub = await app.inject({ method: "GET", url: `/api/orders/${orderNumber}` });
    expect(pub.json().items[0]).toMatchObject({ sizeLabel: "BR 38", customization: { textLeft: "KULTURE" } });
    expect(pub.json().items[0].nikeSize).toBeUndefined();
  });
});
