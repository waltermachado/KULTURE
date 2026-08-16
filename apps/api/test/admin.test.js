import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Backoffice + reset de senha. Bate no banco de dev (DATABASE_URL), como os outros testes.
 * Usuários/pedidos criados aqui têm prefixo "test-admin-" e são apagados no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };
const CUSTOMER = { email: `test-admin-cli-${STAMP}@kulture.test`, password: "Senh@Cli12345", name: "Cliente Teste Silva", phone: "85999990000" };

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail(styleColor) {
    return {
      id: "mock-id", styleColor, name: "Admin Test Sneaker", priceUsd: 100,
      sizes: [{ nikeSize: "10", localizedSize: "10", available: true, level: "HIGH" }], genders: ["MEN"]
    };
  }
};

/** mailer fake: guarda o último e-mail para inspecionar o link de reset */
const sentMails = [];
const fakeMailer = { provider: "fake", async send(msg) { sentMails.push(msg); return { ok: true, provider: "fake" }; } };

describe("backoffice (admin) + reset de senha", { timeout: 60000 }, () => {
  let app, prisma, adminToken, customerToken, customerId, orderNumber;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET,
      ADMIN_EMAILS: ` ${ADMIN.email.toUpperCase()} , outro@x.com`, // testa trim + case-insensitive
      PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, mailer: fakeMailer, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;

    // admin (promovido via ADMIN_EMAILS no cadastro) e cliente comum
    const a = await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN });
    expect(a.statusCode).toBe(201);
    expect(a.json().user.role).toBe("admin");
    adminToken = a.json().accessToken;

    const c = await app.inject({ method: "POST", url: "/api/auth/register", payload: CUSTOMER });
    expect(c.statusCode).toBe(201);
    expect(c.json().user.role).toBe("customer");
    customerToken = c.json().accessToken;
    customerId = c.json().user.id;

    // pedido do cliente (logado) + confirmação mock → paid
    const co = await app.inject({
      method: "POST", url: "/api/checkout",
      headers: { "idempotency-key": `test-admin-${STAMP}`, authorization: `Bearer ${customerToken}` },
      payload: {
        items: [{ styleColor: "TEST-ADMIN-001", nikeSize: "10", quantity: 2 }],
        customer: { name: CUSTOMER.name, email: CUSTOMER.email, cpf: "12345678909", phone: CUSTOMER.phone },
        address: { cep: "60000000", street: "Rua A", number: "1", city: "Fortaleza", state: "CE" }
      }
    });
    expect(co.statusCode).toBe(200);
    orderNumber = co.json().orderNumber;
    const conf = await app.inject({ method: "POST", url: `/api/orders/${orderNumber}/confirm`, payload: { transaction_nsu: "nsu-1", slug: "slug-1", capture_method: "pix" } });
    expect(conf.json().paid).toBe(true);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { number: orderNumber } });
      await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: "test-admin-" } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-admin-" } } });
    }
    await app.close();
  });

  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });

  // ── acesso ─────────────────────────────────────────────────────────────

  it("bloqueia sem token (401) e cliente comum (403)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/dashboard" })).statusCode).toBe(401);
    const r = await app.inject({ method: "GET", url: "/api/admin/dashboard", headers: { authorization: `Bearer ${customerToken}` } });
    expect(r.statusCode).toBe(403);
  });

  it("GET /api/admin/me confirma o admin e devolve labels/transições", async () => {
    const r = await asAdmin({ method: "GET", url: "/api/admin/me" });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.email).toBe(ADMIN.email);
    expect(r.json().transitions.paid).toContain("shipped");
  });

  // ── dashboard ──────────────────────────────────────────────────────────

  it("GET /api/admin/dashboard traz receita, série diária e top produtos", async () => {
    const r = await asAdmin({ method: "GET", url: "/api/admin/dashboard?days=7" });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.period.days).toBe(7);
    expect(d.series).toHaveLength(7);
    expect(d.totals.revenueBrl).toBeGreaterThan(0);
    expect(d.totals.paidOrders).toBeGreaterThanOrEqual(1);
    expect(d.totals.customersTotal).toBeGreaterThanOrEqual(2);
    expect(d.topProducts.some((p) => p.styleColor === "TEST-ADMIN-001")).toBe(true);
    // margem estimada vem do breakdown salvo no item (produto+frete vs comissão)
    expect(d.totals.estimatedMarginBrl).toBeGreaterThan(0);
    expect(d.totals.estimatedCostBrl).toBeGreaterThan(0);
  });

  // ── pedidos ────────────────────────────────────────────────────────────

  it("GET /api/admin/orders filtra por status e busca; detalhe traz itens/eventos/economics", async () => {
    const list = await asAdmin({ method: "GET", url: `/api/admin/orders?status=paid&q=${encodeURIComponent(CUSTOMER.email)}` });
    expect(list.statusCode).toBe(200);
    expect(list.json().orders.some((o) => o.number === orderNumber)).toBe(true);

    const det = await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}` });
    expect(det.statusCode).toBe(200);
    const o = det.json();
    expect(o.items).toHaveLength(1);
    expect(o.items[0].breakdown).toBeDefined(); // painel do dono vê o interno
    expect(o.events.map((e) => e.type)).toContain("payment_confirmed");
    expect(o.allowedTransitions).toContain("shipped");
    expect(o.economics.marginBrl).toBeGreaterThan(0);
    expect(o.user.id).toBe(customerId);
  });

  it("PATCH pedido: transição inválida → 409; enviado sem rastreio → 400; enviado com rastreio → e-mail", async () => {
    const bad = await asAdmin({ method: "PATCH", url: `/api/admin/orders/${orderNumber}`, payload: { status: "delivered" } });
    expect(bad.statusCode).toBe(409);

    const noTrack = await asAdmin({ method: "PATCH", url: `/api/admin/orders/${orderNumber}`, payload: { status: "shipped" } });
    expect(noTrack.statusCode).toBe(400);

    const before = sentMails.length;
    const ok = await asAdmin({
      method: "PATCH", url: `/api/admin/orders/${orderNumber}`,
      payload: { status: "shipped", carrier: "Correios", trackingCode: "NL123456789BR", note: "saiu hoje" }
    });
    expect(ok.statusCode).toBe(200);
    const o = ok.json();
    expect(o.status).toBe("shipped");
    expect(o.trackingCode).toBe("NL123456789BR");
    expect(o.shippedAt).toBeTruthy();
    const types = o.events.map((e) => e.type);
    expect(types).toContain("tracking_updated");
    expect(types).toContain("status_changed");
    expect(types).toContain("email_shipped");
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1).subject).toMatch(/enviado/);
    expect(sentMails.at(-1).text).toContain("NL123456789BR");
  });

  it("cliente vê o rastreio em GET /api/orders/mine e na visão pública mascarada", async () => {
    const mine = await app.inject({ method: "GET", url: "/api/orders/mine", headers: { authorization: `Bearer ${customerToken}` } });
    expect(mine.statusCode).toBe(200);
    const mineOrder = mine.json().orders.find((o) => o.number === orderNumber);
    expect(mineOrder.trackingCode).toBe("NL123456789BR");

    const pub = await app.inject({ method: "GET", url: `/api/orders/${orderNumber}` });
    expect(pub.json().scope).toBe("public");
    expect(pub.json().trackingCode).toBe("NL123456789BR");
    expect(pub.json().customerCpf).toBeUndefined();

    const own = await app.inject({ method: "GET", url: `/api/orders/${orderNumber}`, headers: { authorization: `Bearer ${customerToken}` } });
    expect(own.json().scope).toBe("full");
    expect(own.json().customerCpf).toBe("12345678909");
    expect(own.json().internalNotes).toBeUndefined();
  });

  // ── clientes ───────────────────────────────────────────────────────────

  it("GET /api/admin/customers lista com gasto; detalhe traz pedidos", async () => {
    const list = await asAdmin({ method: "GET", url: `/api/admin/customers?q=${encodeURIComponent("Cliente Teste")}` });
    expect(list.statusCode).toBe(200);
    const c = list.json().customers.find((u) => u.id === customerId);
    expect(c).toBeTruthy();
    expect(c.paidOrders).toBe(1);
    expect(c.spentBrl).toBeGreaterThan(0);

    const det = await asAdmin({ method: "GET", url: `/api/admin/customers/${customerId}` });
    expect(det.statusCode).toBe(200);
    expect(det.json().orders[0].number).toBe(orderNumber);
    expect(det.json().stats.paidOrders).toBe(1);
  });

  it("PATCH /api/admin/customers/:id edita cadastro e impede e-mail duplicado / auto-rebaixamento", async () => {
    const ok = await asAdmin({
      method: "PATCH", url: `/api/admin/customers/${customerId}`,
      payload: { name: "Cliente Editado", phone: "(85) 9 8888-7777", address: { cep: "60000-000", city: "Fortaleza", state: "CE" } }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe("Cliente Editado");
    expect(ok.json().phone).toBe("85988887777");

    const dup = await asAdmin({ method: "PATCH", url: `/api/admin/customers/${customerId}`, payload: { email: ADMIN.email } });
    expect(dup.statusCode).toBe(409);

    const me = await asAdmin({ method: "GET", url: "/api/admin/me" });
    const self = await asAdmin({ method: "PATCH", url: `/api/admin/customers/${me.json().user.id}`, payload: { role: "customer" } });
    expect(self.statusCode).toBe(400);
  });

  it("admin gera link de reset → cliente redefine senha → sessões antigas caem", async () => {
    const r = await asAdmin({ method: "POST", url: `/api/admin/customers/${customerId}/password-reset` });
    expect(r.statusCode).toBe(200);
    expect(r.json().link).toMatch(/^https:\/\/loja\.test\/redefinir-senha\?token=/);
    expect(r.json().mailed).toBe(true);
    const token = new URL(r.json().link).searchParams.get("token");

    const reset = await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "NovaSenha!2026" } });
    expect(reset.statusCode).toBe(200);

    // token é de uso único
    const again = await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "Outra!2026xx" } });
    expect(again.statusCode).toBe(400);

    // login antigo falha, novo funciona
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: CUSTOMER.email, password: CUSTOMER.password } })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: CUSTOMER.email, password: "NovaSenha!2026" } });
    expect(login.statusCode).toBe(200);
    customerToken = login.json().accessToken;
  });

  it("POST /api/auth/forgot responde 200 sempre e manda e-mail só se existir", async () => {
    const before = sentMails.length;
    const nope = await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: `nao-existe-${STAMP}@kulture.test` } });
    expect(nope.statusCode).toBe(200);
    const yes = await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { email: CUSTOMER.email.toUpperCase() } });
    expect(yes.statusCode).toBe(200);
    // envio é fire-and-forget: dá um tick
    await new Promise((r) => setTimeout(r, 200));
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1).to).toBe(CUSTOMER.email);
  });

  it("cliente edita o próprio cadastro (PATCH /api/auth/me) e troca a senha", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/api/auth/me", headers: { authorization: `Bearer ${customerToken}` },
      payload: { name: "Cliente Auto Editado", cpf: "123.456.789-09" }
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.name).toBe("Cliente Auto Editado");
    expect(r.json().user.cpf).toBe("12345678909");

    const wrong = await app.inject({ method: "POST", url: "/api/auth/password", headers: { authorization: `Bearer ${customerToken}` }, payload: { currentPassword: "errada123", newPassword: "MaisNova!2026" } });
    expect(wrong.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/auth/password", headers: { authorization: `Bearer ${customerToken}` }, payload: { currentPassword: "NovaSenha!2026", newPassword: "MaisNova!2026" } });
    expect(ok.statusCode).toBe(200);
  });
});
