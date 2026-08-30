import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { RESTRICTED_KEY, DEFAULT_RESTRICTED, sanitizeTerms } from "../src/modules/restricted/routes.js";

/**
 * RESTRITOS (/admin/restritos): modelos que nunca aparecem na loja.
 * Bate no banco de dev (settings + admin); o valor original da chave é restaurado no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-restrito-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };

const SKU_MIND = `TM${STAMP % 100000}-001`;
const SKU_JA = `TJ${STAMP % 100000}-002`;
const raw = (styleColor, name) => ({
  id: styleColor, styleColor, name, subtitle: "Men's Basketball Shoes",
  priceUsd: 190, fullPriceUsd: 190, onSale: false, image: null,
  url: `https://www.nike.com/t/x/${styleColor}`, colorDescription: "Black/White"
});
const MIND = raw(SKU_MIND, `Nike Mind 001 Teste ${STAMP}`);
const JA = raw(SKU_JA, `Nike JA 3 Teste ${STAMP}`);

const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 2, products: [MIND, JA] }; },
  async findOne() { return MIND; },
  async getProductDetail(styleColor) {
    const base = styleColor === SKU_MIND ? MIND : JA;
    return { ...base, sizes: [{ nikeSize: "10", localizedSize: "M 10 / W 11.5", available: true, level: "HIGH" }] };
  },
  async rate() { return { pair: "USD-BRL", bid: 4.99, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; }
};
const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };

describe("restritos (modelos bloqueados na loja)", { timeout: 90000 }, () => {
  let app, prisma, adminToken, originalRow;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });
  const searchNames = async (q) => {
    const r = await app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(q)}` });
    expect(r.statusCode).toBe(200);
    return r.json().products.map((p) => p.name);
  };

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET, ADMIN_EMAILS: ADMIN.email
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    originalRow = await prisma.setting.findUnique({ where: { key: RESTRICTED_KEY } });
    await prisma.setting.deleteMany({ where: { key: RESTRICTED_KEY } }); // começa do padrão
    adminToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN })).json().accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.setting.deleteMany({ where: { key: RESTRICTED_KEY } });
      if (originalRow) await prisma.setting.create({ data: { key: RESTRICTED_KEY, value: originalRow.value } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-restrito-" } } });
    }
    await app?.close();
  });

  it("sanitizeTerms: apara, deduplica (sem caixa/acento) e valida", () => {
    expect(sanitizeTerms(["  Nike  Mind 001 ", "nike mind 001", "", "Ja 3"])).toEqual(["Nike Mind 001", "Ja 3"]);
    expect(() => sanitizeTerms("x")).toThrow();
    expect(() => sanitizeTerms(["a".repeat(200)])).toThrow(/longo/);
  });

  it("padrão de fábrica: Nike Mind some da busca; o resto fica", async () => {
    const names = await searchNames(`test-restrito-${STAMP} a`);
    expect(names).toContain(JA.name);
    expect(names).not.toContain(MIND.name);
  });

  it("admin lê o padrão, limpa a lista e os dois voltam NA HORA (filtro é pós-cache)", async () => {
    expect((await asAdmin({ method: "GET", url: "/api/admin/restricted" })).json().terms).toEqual(DEFAULT_RESTRICTED);
    const put = await asAdmin({ method: "PUT", url: "/api/admin/restricted", payload: { terms: [] } });
    expect(put.statusCode).toBe(200);
    // mesma query da busca anterior: o cache guardou a lista cheia, o filtro decide na resposta
    const names = await searchNames(`test-restrito-${STAMP} a`);
    expect(names).toContain(MIND.name);
    expect(names).toContain(JA.name);
  });

  it("bloqueio por nome (contém) e por SKU exato; página do produto responde 404; exige admin", async () => {
    await asAdmin({ method: "PUT", url: "/api/admin/restricted", payload: { terms: ["JA 3", SKU_MIND] } });
    const names = await searchNames(`test-restrito-${STAMP} b`);
    expect(names).toEqual([]); // JA cai pelo nome, MIND pelo SKU
    expect((await app.inject({ method: "GET", url: `/api/product/${SKU_JA}` })).statusCode).toBe(404);
    // sem token / sem admin não mexe
    expect((await app.inject({ method: "PUT", url: "/api/admin/restricted", payload: { terms: [] } })).statusCode).toBe(401);
  });
});
