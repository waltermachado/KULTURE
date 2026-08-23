import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { PRICING_KEY, normalizeRules, toEngineRule } from "../src/modules/pricing/service.js";
import { ruleApplies } from "@kulture/shared/pricing";

/**
 * Acréscimos de preço por tipo de tênis, editáveis em /admin/precos: semente (LeBron 23 +R$300), salvar, validar,
 * efeito imediato na busca (cache versionado) e o endpoint de teste. Bate no banco de dev; limpa a chave no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-prc-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const PRODUCTS = [
  { id: "p1", styleColor: "HQ3417-100", name: "Nike LeBron XXIII", brand: "Nike", category: "basketball", priceUsd: 190, image: "https://img/1.png", genders: ["MEN"] },
  { id: "p2", styleColor: "CW2190-300", name: "Kobe 6 Protro", brand: "Nike", category: "basketball", priceUsd: 190, image: "https://img/2.png", genders: ["MEN"] },
  { id: "p3", styleColor: "DZ5485-612", name: "Air Jordan 1 Retro High OG", brand: "Jordan", category: "lifestyle", priceUsd: 190, image: "https://img/3.png", genders: ["MEN"] }
];
const fakeScraper = {
  baseUrl: "mock",
  async search(q) { const t = String(q).toLowerCase(); return { total: 3, products: PRODUCTS.filter((p) => t === "todos" || p.name.toLowerCase().includes(t)) }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail() { throw new Error("sem tamanhos aqui"); }
};

describe("acréscimos de preço editáveis (/admin/precos)", { timeout: 90000 }, () => {
  let app, prisma, adminToken;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });
  const priceOf = async (term) => {
    const r = await app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(term)}` });
    expect(r.statusCode).toBe(200);
    return r.json().products[0];
  };

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "", TEST_PRODUCT_ENABLED: "false",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET, ADMIN_EMAILS: ADMIN.email,
      PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    await prisma.setting.deleteMany({ where: { key: PRICING_KEY } }); // começa do zero → semente
    app.pricing.invalidate();
    adminToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN })).json().accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.setting.deleteMany({ where: { key: PRICING_KEY } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-prc-" } } });
    }
    await app?.close();
  });

  it("regra do painel → motor: termos sem acento/caixa, SKU exato, marca e categoria", () => {
    const model = toEngineRule({ id: "lb", scope: "model", terms: ["LeBron XXIII", "lebron 23"], extraFixedBrl: 300 });
    expect(ruleApplies(model, { name: "Nike LeBron XXIII “Tuxedo”" })).toBe(true);
    expect(ruleApplies(model, { name: "NIKE LEBRON 23 LOW" })).toBe(true);
    expect(ruleApplies(model, { name: "Nike LeBron XXI" })).toBe(false);
    expect(ruleApplies(toEngineRule({ scope: "sku", terms: ["HQ3417-100"], extraFixedBrl: 50 }), { styleColor: "hq3417-100" })).toBe(true);
    expect(ruleApplies(toEngineRule({ scope: "sku", terms: ["HQ3417-100"], extraFixedBrl: 50 }), { styleColor: "HQ3417-001" })).toBe(false);
    expect(ruleApplies(toEngineRule({ scope: "brand", terms: ["Jordan"], extraRate: 0.1 }), { brand: "jordan" })).toBe(true);
    expect(ruleApplies(toEngineRule({ scope: "category", terms: ["basketball"], extraRate: 0.1 }), { category: "basketball" })).toBe(true);
    expect(toEngineRule({ scope: "model", terms: ["x"], extraFixedBrl: "0", extraRate: 0 })).not.toHaveProperty("extraFixedBrl");
  });

  it("validação: nome, termos, valores; % vira fração; termos aceitam vírgula/| ; ids únicos", () => {
    expect(() => normalizeRules([{ scope: "model", terms: "x", extraFixedBrl: 10 }])).toThrow(/nome/);
    expect(() => normalizeRules([{ name: "A", scope: "model", terms: "", extraFixedBrl: 10 }])).toThrow(/termo/);
    expect(() => normalizeRules([{ name: "A", scope: "model", terms: "x" }])).toThrow(/acréscimo/);
    expect(() => normalizeRules([{ name: "A", scope: "model", terms: "x", extraFixedBrl: -1 }])).toThrow(/entre 0/);
    expect(() => normalizeRules([{ name: "A", scope: "model", terms: "x", extraPct: 150 }])).toThrow(/entre 0 e 100/);
    expect(() => normalizeRules([{ name: "A", scope: "category", terms: "skate", extraFixedBrl: 10 }])).toThrow(/categoria/);
    const ok = normalizeRules([
      { name: "LeBron 23", scope: "model", terms: "LeBron XXIII, LeBron 23 | lebron 23", extraFixedBrl: "300,00", extraPct: "" },
      { name: "LeBron 23", scope: "brand", terms: ["Jordan"], extraPct: "12,5", active: false }
    ]);
    expect(ok[0]).toMatchObject({ id: "lebron-23", terms: ["LeBron XXIII", "LeBron 23", "lebron 23"], extraFixedBrl: 300, extraRate: 0, active: true });
    expect(ok[1]).toMatchObject({ id: "lebron-23-2", extraRate: 0.125, active: false });
  });

  it("semente: LeBron 23 +R$300 já está no banco e no preço; Kobe e Jordan sem acréscimo", async () => {
    const list = await asAdmin({ method: "GET", url: "/api/admin/pricing" });
    expect(list.statusCode).toBe(200);
    expect(list.json().rules).toHaveLength(1);
    expect(list.json().rules[0]).toMatchObject({ id: "lebron-23-acrescimo", name: "LeBron 23", scope: "model", extraFixedBrl: 300, active: true });
    expect(list.json().base).toMatchObject({ commissionRate: 0.3, shippingUsd: 65, roundUpToEnding: 99 });
    expect(list.json().scopes.model).toBeTruthy();

    const kobe = await priceOf("kobe");
    const lebron = await priceOf("lebron");
    // mesma fórmula (US$190 × … ) — LeBron é o Kobe + 300 (múltiplo de 100 mantém o …99)
    expect(lebron.price.brl).toBe(kobe.price.brl + 300);
    expect(kobe.price.brl % 100).toBe(99);
    expect(lebron.price.breakdown).toBeUndefined(); // API pública continua sem breakdown
  });

  it("salvar no painel vale na hora (cache versionado): LeBron +500 e Jordan +10%; pausar tira o acréscimo", async () => {
    const kobe = await priceOf("kobe");
    const before = await priceOf("lebron");
    expect(before.price.brl).toBe(kobe.price.brl + 300);
    const list0Version = (await asAdmin({ method: "GET", url: "/api/admin/pricing" })).json().version;

    const put = await asAdmin({
      method: "PUT", url: "/api/admin/pricing",
      payload: { rules: [
        { id: "lebron-23-acrescimo", name: "LeBron 23", scope: "model", terms: "LeBron XXIII, LeBron 23", extraFixedBrl: 500, active: true },
        { name: "Jordan +10%", scope: "brand", terms: "Jordan", extraPct: 10, active: true }
      ] }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().rules).toHaveLength(2);
    expect(put.json().version).not.toBe(list0Version);

    const after = await priceOf("lebron");
    expect(after.price.brl).toBe(kobe.price.brl + 500); // sem esperar o cache de 60 min expirar
    const jordan = await priceOf("jordan");
    expect(jordan.price.brl).toBeGreaterThan(kobe.price.brl); // +10% sobre o preço com comissão, arredondado ↑99
    expect(jordan.price.brl % 100).toBe(99);

    // endpoint de teste do painel mostra o que bateu
    const t = await asAdmin({ method: "GET", url: "/api/admin/pricing/test?q=todos" });
    expect(t.statusCode).toBe(200);
    const byName = Object.fromEntries(t.json().products.map((p) => [p.styleColor, p]));
    expect(byName["HQ3417-100"]).toMatchObject({ priceBrl: after.price.brl, extraFixedBrl: 500, matched: ["LeBron 23"] });
    expect(byName["DZ5485-612"]).toMatchObject({ extraRate: 0.1, matched: ["Jordan +10%"] });
    expect(byName["CW2190-300"].matched).toEqual([]);

    // pausar a regra do LeBron → volta ao preço base
    const pause = await asAdmin({
      method: "PUT", url: "/api/admin/pricing",
      payload: { rules: [{ id: "lebron-23-acrescimo", name: "LeBron 23", scope: "model", terms: "LeBron XXIII, LeBron 23", extraFixedBrl: 500, active: false }] }
    });
    expect(pause.statusCode).toBe(200);
    expect((await priceOf("lebron")).price.brl).toBe(kobe.price.brl);

    // erro de validação vem em português e nada é salvo
    const bad = await asAdmin({ method: "PUT", url: "/api/admin/pricing", payload: { rules: [{ name: "", scope: "model", terms: "x", extraFixedBrl: 10 }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/nome/);
    expect((await asAdmin({ method: "GET", url: "/api/admin/pricing" })).json().rules).toHaveLength(1);
    // cliente comum não entra
    expect((await app.inject({ method: "GET", url: "/api/admin/pricing" })).statusCode).toBe(401);
  });
});
