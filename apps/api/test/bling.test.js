import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { BLING_KEY } from "../src/modules/bling/service.js";

/**
 * Conexão OAuth com o Bling: URL de autorização com state assinado, callback (troca do code por tokens com um
 * fetch falso), renovação automática e status. Bate no banco de dev; limpa a chave "bling" no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-bling-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail() { throw new Error("sem Nike"); }
};

// fetch falso do Bling: registra as chamadas e devolve tokens/da empresa
const calls = [];
let tokenCount = 0;
const fakeBlingFetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  const body = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
  if (String(url).includes("/oauth/token")) {
    const params = new URLSearchParams(String(opts.body));
    if (!String(opts.headers?.Authorization || "").startsWith("Basic ")) return body({ error: "invalid_client" }, 401);
    if (params.get("grant_type") === "authorization_code" && params.get("code") !== "CODE-OK") return body({ error_description: "code inválido" }, 400);
    tokenCount += 1;
    return body({ access_token: `AT-${tokenCount}`, refresh_token: `RT-${tokenCount}`, expires_in: 21600, token_type: "Bearer", scope: "nfe contatos" });
  }
  if (String(url).includes("/empresas/me/dados-basicos")) {
    if (String(opts.headers?.Authorization || "") !== `Bearer AT-${tokenCount}`) return body({ error: { description: "token inválido" } }, 401);
    return body({ data: { nome: "Kulture BR LTDA" } });
  }
  return body({ error: { description: "endpoint desconhecido" } }, 404);
};

describe("bling: conexão OAuth", { timeout: 60000 }, () => {
  let app, prisma, adminToken, bling;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET, ADMIN_EMAILS: ADMIN.email,
      PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test",
      BLING_CLIENT_ID: "client-id-teste", BLING_CLIENT_SECRET: "client-secret-teste"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    await prisma.setting.deleteMany({ where: { key: BLING_KEY } });
    // injeta o fetch falso recriando o serviço com a mesma assinatura do app
    const { createBlingService } = await import("../src/modules/bling/service.js");
    bling = createBlingService({ prisma, env, log: null, fetchImpl: fakeBlingFetch });
    app.bling.handleCallback = bling.handleCallback; // callback público usa o fake
    app.bling.status = bling.status;
    app.bling.apiFetch = bling.apiFetch;
    adminToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN })).json().accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.setting.deleteMany({ where: { key: BLING_KEY } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-bling-" } } });
    }
    await app?.close();
  });

  it("status desconectado + URL de autorização com state assinado e callback certo", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/bling/status" })).statusCode).toBe(401);
    const st = await asAdmin({ method: "GET", url: "/api/admin/bling/status" });
    expect(st.json()).toMatchObject({ configured: true, connected: false, callbackUrl: "https://loja.test/api/bling/callback" });

    const c = await asAdmin({ method: "POST", url: "/api/admin/bling/connect" });
    expect(c.statusCode).toBe(200);
    const url = new URL(c.json().url);
    expect(url.origin + url.pathname).toBe("https://www.bling.com.br/Api/v3/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id-teste");
    expect(url.searchParams.get("state")).toMatch(/^\d+\./);
  });

  it("callback: state forjado → 400; code errado → 400; code certo conecta e o status mostra a empresa", async () => {
    const forged = await app.inject({ method: "GET", url: "/api/bling/callback?code=CODE-OK&state=123.abc" });
    expect(forged.statusCode).toBe(400);
    expect(forged.body).toContain("Não deu para conectar");

    const { url } = (await asAdmin({ method: "POST", url: "/api/admin/bling/connect" })).json();
    const state = new URL(url).searchParams.get("state");
    const bad = await app.inject({ method: "GET", url: `/api/bling/callback?code=NOPE&state=${encodeURIComponent(state)}` });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("code inválido");

    const state2 = new URL((await asAdmin({ method: "POST", url: "/api/admin/bling/connect" })).json().url).searchParams.get("state");
    const ok = await app.inject({ method: "GET", url: `/api/bling/callback?code=CODE-OK&state=${encodeURIComponent(state2)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain("Bling conectado");
    const saved = await prisma.setting.findUnique({ where: { key: BLING_KEY } });
    expect(saved.value.accessToken).toBe(`AT-${tokenCount}`);
    expect(saved.value.refreshToken).toBe(`RT-${tokenCount}`);

    const st = await bling.status();
    expect(st).toMatchObject({ connected: true, ok: true, company: "Kulture BR LTDA" });
  });

  it("token vencendo → renova com o refresh (rotaciona) antes da chamada; desconectar apaga tudo", async () => {
    // força o vencimento
    const row = await prisma.setting.findUnique({ where: { key: BLING_KEY } });
    await prisma.setting.update({ where: { key: BLING_KEY }, data: { value: { ...row.value, expiresAt: Date.now() - 1000 } } });
    const before = tokenCount;
    const company = await bling.apiFetch("/empresas/me/dados-basicos");
    expect(company.data.nome).toBe("Kulture BR LTDA");
    expect(tokenCount).toBe(before + 1); // usou o refresh
    expect((await prisma.setting.findUnique({ where: { key: BLING_KEY } })).value.refreshToken).toBe(`RT-${tokenCount}`);

    const off = await asAdmin({ method: "POST", url: "/api/admin/bling/disconnect" });
    expect(off.statusCode).toBe(200);
    expect(await prisma.setting.findUnique({ where: { key: BLING_KEY } })).toBeNull();
    await expect(bling.apiFetch("/empresas/me/dados-basicos")).rejects.toThrow(/não conectado/);
  });
});
