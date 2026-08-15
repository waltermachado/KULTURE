import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { getPrisma, disconnectPrisma } from "../src/lib/prisma.js";

const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    TOP8_WARM: "false",
    CORS_ORIGINS: "",
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: TEST_SECRET
  });
}

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; }
};

describe("auth (Fase 2)", { timeout: 30000 }, () => {
  let app;
  let prisma;

  const USER = {
    email: `test-${Date.now()}@kulture.test`,
    password: "Senh@Forte123",
    name: "Teste Kulture"
  };

  beforeAll(async () => {
    const env = testEnv();
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, warmTop8: false, logger: false });
    await app.ready();
    prisma = app.prisma;
  });

  afterAll(async () => {
    // Cleanup: remove test users
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-" } } });
    }
    await app.close();
  });

  // ── register ────────────────────────────────────────────────────────

  it("POST /api/auth/register cria usuário e retorna accessToken + cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: USER
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(USER.email);
    expect(body.user.name).toBe(USER.name);
    expect(body.user.role).toBe("customer");
    expect(body.accessToken).toBeDefined();
    expect(body.user.passwordHash).toBeUndefined(); // não expõe hash

    // Cookie httpOnly com refresh token
    const cookies = res.cookies;
    const refresh = cookies.find(c => c.name === "kulture_refresh");
    expect(refresh).toBeDefined();
    expect(refresh.httpOnly).toBe(true);
    expect(refresh.path).toBe("/api/auth");
  });

  it("POST /api/auth/register com email duplicado → 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: USER
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("EMAIL_TAKEN");
  });

  it("POST /api/auth/register sem campos obrigatórios → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "bad" }
    });
    expect(res.statusCode).toBe(400);
  });

  // ── login ───────────────────────────────────────────────────────────

  it("POST /api/auth/login com credenciais válidas → 200 + accessToken + cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: USER.email, password: USER.password }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(USER.email);
    expect(body.accessToken).toBeDefined();
    const refresh = res.cookies.find(c => c.name === "kulture_refresh");
    expect(refresh).toBeDefined();
  });

  it("POST /api/auth/login com senha errada → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: USER.email, password: "wrong" }
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_CREDENTIALS");
  });

  it("POST /api/auth/login com email inexistente → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nope@x.com", password: "whatever1" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/auth/login normaliza email (case insensitive)", async () => {
    // Registra com maiúsculas
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "Upper@TEST.com", password: "Password123", name: "Upper" }
    });
    // Loga com minúsculas
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "upper@test.com", password: "Password123" }
    });
    expect(login.statusCode).toBe(200);

    // Tentar registrar minúsculas -> 409
    const regAgain = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "upper@test.com", password: "Password123", name: "Upper" }
    });
    expect(regAgain.statusCode).toBe(409);
  });

  it("POST /api/auth/login limita a 10 tentativas por minuto (429)", async () => {
    const promises = Array.from({ length: 10 }).map(() =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "spam@test.com", password: "bad" },
        remoteAddress: "192.168.1.100"
      })
    );
    const results = await Promise.all(promises);
    results.forEach(res => expect(res.statusCode).toBe(401));

    // A 11ª tentativa deve ser 429
    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "spam@test.com", password: "bad" },
      remoteAddress: "192.168.1.100"
    });
    expect(limited.statusCode).toBe(429);
  });

  // ── me ──────────────────────────────────────────────────────────────

  it("GET /api/auth/me com token válido → 200 user", async () => {
    // Login para obter accessToken
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: USER.email, password: USER.password }
    });
    const { accessToken } = login.json();

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(USER.email);
  });

  it("GET /api/auth/me sem token → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me"
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHORIZED");
  });

  // ── refresh ─────────────────────────────────────────────────────────

  it("POST /api/auth/refresh rotaciona token e retorna novo accessToken", async () => {
    // Login para obter o refresh cookie
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: USER.email, password: USER.password }
    });
    const refreshCookie = login.cookies.find(c => c.name === "kulture_refresh");

    // Refresh
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { kulture_refresh: refreshCookie.value }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.user.email).toBe(USER.email);

    // Novo cookie de refresh diferente do anterior
    const newRefresh = res.cookies.find(c => c.name === "kulture_refresh");
    expect(newRefresh).toBeDefined();
    expect(newRefresh.value).not.toBe(refreshCookie.value);
  });

  it("POST /api/auth/refresh com token já usado (reuso) → 401 + revoga family", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: USER.email, password: USER.password }
    });
    const cookie = login.cookies.find(c => c.name === "kulture_refresh");

    // Primeiro refresh: ok
    await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { kulture_refresh: cookie.value }
    });

    // Segundo refresh com o mesmo token (reuso): deve falhar
    const reuse = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { kulture_refresh: cookie.value }
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe("TOKEN_REUSE");
  });

  it("POST /api/auth/refresh sem cookie → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh"
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("NO_REFRESH_TOKEN");
  });

  // ── logout ──────────────────────────────────────────────────────────

  it("POST /api/auth/logout revoga tokens e limpa cookie", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: USER.email, password: USER.password }
    });
    const cookie = login.cookies.find(c => c.name === "kulture_refresh");

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { kulture_refresh: cookie.value }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Tentar refresh depois de logout → falha
    const afterLogout = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { kulture_refresh: cookie.value }
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
