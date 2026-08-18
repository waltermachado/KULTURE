import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const RAW = {
  id: "abc",
  styleColor: "CW2288-111",
  name: "Nike Kobe 6 Protro",
  subtitle: "Men's Basketball Shoes",
  priceUsd: 190,
  fullPriceUsd: 190,
  onSale: false,
  image: null,
  url: "https://www.nike.com/t/kobe-6/CW2288-111",
  colorDescription: "White/Black"
};

function fakeScraper({ failSearch = false } = {}) {
  const calls = { search: 0, rate: 0 };
  return {
    calls,
    async search() {
      calls.search++;
      if (failSearch) throw new Error("nike down");
      return { total: 1, products: [RAW] };
    },
    async findOne() {
      return RAW;
    },
    async getProductDetail() {
      return {
        ...RAW,
        sizes: [
          { nikeSize: "10.5", localizedSize: "M 10.5 / W 12", available: true, level: "HIGH" },
          { nikeSize: "11", localizedSize: "M 11 / W 12.5", available: false, level: "OOS" }
        ]
      };
    },
    async rate() {
      calls.rate++;
      return { pair: "USD-BRL", bid: 4.99, ask: 5, timestamp: "2026-08-15 10:00:00" };
    },
    async health() {
      return { ok: true };
    }
  };
}

const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    TOP8_WARM: "false",
    CORS_ORIGINS: "",
    DATABASE_URL: "postgresql://test",
    JWT_SECRET: TEST_SECRET
  });
}

async function makeApp(scraper) {
  const env = testEnv();
  const app = await buildApp({ env, scraper, images: fakeImages, persistCache: false, warmTop8: false, logger: false });
  await app.ready();
  return app;
}

describe("apps/api", () => {
  let app;
  let scraper;

  beforeAll(async () => {
    scraper = fakeScraper();
    app = await makeApp(scraper);
  });
  afterAll(async () => app.close());

  it("GET /health responde ok com stats de cache", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "kulture-api", cache: { persistent: false } });
  });

  it("GET /api/search sem q → 400 padronizado", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/search precifica no core ((USD×1,07+65)×turismo×1,30 ↑99) e cacheia", async () => {
    const first = await app.inject({ method: "GET", url: "/api/search?q=Kobe%206" });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.term).toBe("kobe-6");
    expect(body.cached).toBe(false);
    expect(body.products).toHaveLength(1);
    const p = body.products[0];
    expect(p.brand).toBe("Nike");
    expect(p.category).toBe("basketball");
    // scraper fake dá só o comercial (5) → turismo = 5 + 0,25 (fallback) = 5,25
    // (190×1,07 + 65) = 268,30 × 5,25 = 1408,58 → +30% = 1831,15 → arredonda ↑ até …99 = 1899
    expect(p.price.brl).toBe(1899);
    // regra do negócio: frete/comissão são embutidos — o breakdown NUNCA sai na resposta pública
    expect(p.price.breakdown).toBeUndefined();
    expect(p.price.rulesApplied).toBeUndefined();
    expect(p.price.exchange.usdToBrl).toBe(5.25);
    expect(p.price.exchange.kind).toMatch(/turismo/);
    expect(p.price.pix).toBe(true);
    expect(p.price.installments.label).toMatch(/^em até \d+x no cartão$/);

    const second = await app.inject({ method: "GET", url: "/api/search?q=kobe%206" });
    expect(second.json().cached).toBe(true);
    expect(scraper.calls.search).toBe(1); // segunda chamada veio do cache
  });

  it("GET /api/product/:term devolve o produto", async () => {
    const res = await app.inject({ method: "GET", url: "/api/product/kobe-6" });
    if (res.statusCode !== 200) console.log(res.json());
    expect(res.statusCode).toBe(200);
    expect(res.json().product.styleColor).toBe("CW2288-111");
  });

  it("GET /api/products/top8 monta a lista", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/top8" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThan(0);
  });

  it("GET /docs/json expõe OpenAPI", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths["/api/search"]).toBeDefined();
  });
});

describe("resiliência", () => {
  it("scraper fora + sem cache → 502 UPSTREAM/erro padronizado", async () => {
    const app = await makeApp(fakeScraper({ failSearch: true }));
    const res = await app.inject({ method: "GET", url: "/api/search?q=jordan" });
    expect(res.statusCode).toBe(500); // erro genérico do fake; o cliente real lança AppError 502
    expect(res.json()).toMatchObject({ code: "INTERNAL_ERROR" });
    await app.close();
  });
});
