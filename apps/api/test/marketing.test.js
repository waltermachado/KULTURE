import { afterAll, beforeAll, describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createMailer, buildMarketingEmail } from "../src/modules/mail/mailer.js";

/**
 * E-mail por SMTP (provedor `smtp`, nodemailer) + marketing (campanhas do backoffice, público, descadastro).
 * O SMTP é testado com o jsonTransport do nodemailer (sem rede); o resto bate no banco de dev com um mailer falso.
 * Tudo criado aqui tem prefixo "test-mkt-" e é apagado no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-mkt-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };
const CUSTOMER = { email: `test-mkt-cli-${STAMP}@kulture.test`, password: "Senh@Cli12345", name: "Cliente Marketing Silva" };
const GUEST_EMAIL = `test-mkt-guest-${STAMP}@kulture.test`;

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail() { throw new Error("sem Nike aqui"); }
};
const sentMails = [];
const fakeMailer = {
  provider: "fake",
  async send(msg) {
    sentMails.push(msg);
    if (/falha@/.test(msg.to)) return { ok: false, error: "mailbox unavailable" };
    return { ok: true, provider: "fake" };
  },
  async verify() { return { ok: true, provider: "fake" }; }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("mailer: provedor smtp (nodemailer)", () => {
  it("envia pelo transporter com from/reply-to/List-Unsubscribe; sem credencial o erro é reportado, não lançado", async () => {
    const raw = {
      NODE_ENV: "test", LOG_LEVEL: "silent", JWT_SECRET: TEST_SECRET, DATABASE_URL: "postgresql://x:y@localhost:5432/z",
      MAIL_PROVIDER: "smtp", SMTP_USER: "MS_user", SMTP_PASS: "segredo", SMTP_PORT: "587", MAIL_FROM: "no-reply@test.mlsender.net", MAIL_FROM_NAME: "Kulture", MAIL_REPLY_TO: "oi@kulture.test"
    };
    const env = loadEnv(raw);
    expect(env.SMTP_HOST).toBe("smtp.mailersend.net");
    expect(env.SMTP_SECURE).toBe(false);
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const mailer = createMailer(env, null, { transport });
    expect(mailer.provider).toBe("smtp");
    const r = await mailer.send({ to: "cliente@kulture.test", toName: "Cliente", subject: "Oi", text: "corpo", html: "<b>corpo</b>", unsubscribeUrl: "https://loja.test/api/marketing/unsubscribe?e=x&t=y" });
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("smtp");
    expect(r.messageId).toBeTruthy();
    expect(await mailer.verify()).toMatchObject({ ok: true, provider: "smtp", host: "smtp.mailersend.net", port: 587, user: "MS_user" });

    // sem usuário/senha: send devolve ok:false (nunca lança — checkout não pode cair por e-mail)
    const bare = createMailer(loadEnv({ ...raw, SMTP_USER: "", SMTP_PASS: "" }), null);
    const miss = await bare.send({ to: "a@b.c", subject: "x", text: "y" });
    expect(miss.ok).toBe(false);
    expect(miss.error).toMatch(/SMTP_USER/);
    expect((await bare.verify()).ok).toBe(false);
  });

  it("buildMarketingEmail: parágrafos, botão, imagem e link de descadastro (html e texto)", () => {
    const m = buildMarketingEmail({
      subject: "Drop da semana", body: "Chegou o Kobe 6.\n\nSó 3 pares <em estoque>.", ctaLabel: "Ver o par", ctaUrl: "https://loja.test/hypados/kobe-6",
      imageUrl: "https://loja.test/media/estoque/abc", unsubscribeUrl: "https://loja.test/api/marketing/unsubscribe?e=e&t=t", siteUrl: "https://loja.test", name: "Walter"
    });
    expect(m.subject).toBe("Drop da semana");
    expect(m.text).toContain("Olá, Walter!");
    expect(m.text).toContain("Ver o par: https://loja.test/hypados/kobe-6");
    expect(m.text).toContain("Descadastre-se: https://loja.test/api/marketing/unsubscribe?e=e&t=t");
    expect(m.html).toContain("&lt;em estoque&gt;"); // escapado
    expect(m.html).toContain('href="https://loja.test/hypados/kobe-6"');
    expect(m.html).toContain('src="https://loja.test/media/estoque/abc"');
    expect(m.html).toContain("Não quero mais receber novidades");
    expect(m.html).toMatch(/<p[^>]*>Chegou o Kobe 6\.<\/p>/);
  });
});

describe("marketing (campanhas do backoffice)", { timeout: 90000 }, () => {
  let app, prisma, adminToken, customerToken, marketing;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET,
      ADMIN_EMAILS: ADMIN.email, PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, mailer: fakeMailer, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    marketing = app.marketing;
    const a = await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN });
    expect(a.statusCode).toBe(201);
    adminToken = a.json().accessToken;
    const c = await app.inject({ method: "POST", url: "/api/auth/register", payload: CUSTOMER });
    expect(c.statusCode).toBe(201);
    customerToken = c.json().accessToken;
    // convidado que já comprou (venda externa registrada no painel), para entrar no público "quem já comprou"
    const o = await asAdmin({ method: "POST", url: "/api/admin/orders", payload: { customer: { name: "Convidado Comprador", email: GUEST_EMAIL }, items: [{ kind: "manual", name: "Meia", brLabel: "M", unitPriceBrl: 50 }], notifyCustomer: false } });
    expect(o.statusCode).toBe(201);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { customerEmail: { startsWith: "test-mkt-" } } });
      await prisma.marketingCampaign.deleteMany({ where: { subject: { startsWith: "test-mkt-" } } });
      await prisma.marketingUnsubscribe.deleteMany({ where: { email: { startsWith: "test-mkt-" } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-mkt-" } } });
    }
    await app?.close();
  });

  it("exige admin; status do e-mail e teste simples", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/marketing/audience" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/admin/marketing/audience", headers: { authorization: `Bearer ${customerToken}` } })).statusCode).toBe(403);
    const st = await asAdmin({ method: "GET", url: "/api/admin/mail/status" });
    expect(st.statusCode).toBe(200);
    expect(st.json()).toMatchObject({ ok: true, provider: "fake" });
    const before = sentMails.length;
    const t = await asAdmin({ method: "POST", url: "/api/admin/mail/test" });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ ok: true, to: ADMIN.email });
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1).subject).toMatch(/Teste de e-mail/);
  });

  it("público: conta com opt-in + quem comprou (convidado), sem duplicar; descadastro tira da lista", async () => {
    const emails = (list) => list.map((r) => r.email);
    const all = await marketing.audience("all");
    expect(emails(all)).toEqual(expect.arrayContaining([ADMIN.email, CUSTOMER.email, GUEST_EMAIL]));
    expect(new Set(emails(all)).size).toBe(all.length); // sem repetição
    expect(emails(await marketing.audience("accounts"))).not.toContain(GUEST_EMAIL);
    expect(emails(await marketing.audience("buyers"))).toContain(GUEST_EMAIL);
    expect(emails(await marketing.audience("buyers"))).not.toContain(CUSTOMER.email); // nunca comprou

    // link de descadastro assinado: clique (GET) → página HTML; e-mail some do público; conta fica com opt-in false
    const url = new URL(marketing.unsubscribeUrl(CUSTOMER.email));
    expect(url.origin).toBe("https://loja.test");
    const bad = await app.inject({ method: "GET", url: `/api/marketing/unsubscribe?e=${url.searchParams.get("e")}&t=errado` });
    expect(bad.statusCode).toBe(400);
    const page = await app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("não receberá mais novidades");
    expect(emails(await marketing.audience("all"))).not.toContain(CUSTOMER.email);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${customerToken}` } });
    expect(me.json().user.marketingOptIn).toBe(false);

    // convidado (sem conta) também sai pelo one-click POST
    const gu = new URL(marketing.unsubscribeUrl(GUEST_EMAIL));
    const oneClick = await app.inject({ method: "POST", url: `${gu.pathname}${gu.search}`, payload: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(oneClick.statusCode).toBe(200);
    expect(emails(await marketing.audience("buyers"))).not.toContain(GUEST_EMAIL);

    // a caixa em /conta religa (e limpa o descadastro)
    const on = await app.inject({ method: "PATCH", url: "/api/auth/me", headers: { authorization: `Bearer ${customerToken}` }, payload: { marketingOptIn: true } });
    expect(on.statusCode).toBe(200);
    expect(on.json().user.marketingOptIn).toBe(true);
    expect(emails(await marketing.audience("accounts"))).toContain(CUSTOMER.email);
    const counts = await asAdmin({ method: "GET", url: "/api/admin/marketing/audience" });
    expect(counts.json().counts.unsubscribed).toBeGreaterThanOrEqual(1);
    expect(counts.json().counts.accounts).toBeGreaterThanOrEqual(2);
  });

  it("campanha: valida, prévia, teste para o admin, dispara em segundo plano e conta enviados/falhas", async () => {
    const base = { subject: `test-mkt-Drop ${STAMP}`, body: "Chegou o Kobe 6 Protro.\n\nÚltimos pares na pronta entrega.", ctaLabel: "Ver", ctaUrl: "https://loja.test/pronta-entrega", audience: "accounts" };
    const bad = await asAdmin({ method: "POST", url: "/api/admin/marketing/preview", payload: { ...base, ctaUrl: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);
    const prev = await asAdmin({ method: "POST", url: "/api/admin/marketing/preview", payload: base });
    expect(prev.statusCode).toBe(200);
    expect(prev.json().html).toContain("Chegou o Kobe 6 Protro.");
    expect(prev.json().html).toContain(">Dona</strong>"); // moldura nova: "Olá <strong>Nome</strong>, tudo bem?"

    const before = sentMails.length;
    const test = await asAdmin({ method: "POST", url: "/api/admin/marketing/test", payload: base });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ ok: true, to: ADMIN.email });
    expect(sentMails.at(-1).subject).toBe(`[TESTE] ${base.subject}`);
    expect(sentMails.at(-1).unsubscribeUrl).toContain("/api/marketing/unsubscribe?");
    expect(sentMails.length).toBe(before + 1);

    // uma conta cujo envio falha (fake mailer recusa "falha@"), para contar failed
    const failing = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: `test-mkt-falha@kulture.test`, password: "Senh@Fal12345", name: "Falha" } });
    expect(failing.statusCode).toBe(201);

    const start = sentMails.length;
    const r = await asAdmin({ method: "POST", url: "/api/admin/marketing/campaigns", payload: base });
    expect(r.statusCode).toBe(201);
    expect(r.json().campaign.status).toBe("sending");
    expect(r.json().campaign.total).toBeGreaterThanOrEqual(3);
    const id = r.json().campaign.id;
    let c = null;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      c = (await asAdmin({ method: "GET", url: `/api/admin/marketing/campaigns/${id}` })).json().campaign;
      if (c.status !== "sending") break;
    }
    expect(c.status).toBe("sent");
    expect(c.sent + c.failed).toBe(c.total);
    expect(c.failed).toBe(1);
    expect(c.lastError).toMatch(/mailbox/);
    expect(c.finishedAt).toBeTruthy();
    expect(sentMails.length - start).toBe(c.total);
    const toCustomer = sentMails.slice(start).find((m) => m.to === CUSTOMER.email);
    expect(toCustomer.subject).toBe(base.subject);
    expect(toCustomer.html).toContain(">Cliente</strong>"); // moldura nova
    expect(toCustomer.headers["X-Kulture-Campaign"]).toBe(id);
    // não dispara duas vezes
    const again = await asAdmin({ method: "POST", url: `/api/admin/marketing/campaigns/${id}/send` });
    expect(again.statusCode).toBe(400);
    const list = await asAdmin({ method: "GET", url: "/api/admin/marketing/campaigns" });
    expect(list.json().campaigns.some((x) => x.id === id)).toBe(true);

    // rascunho: só cria
    const d = await asAdmin({ method: "POST", url: "/api/admin/marketing/campaigns", payload: { ...base, subject: `test-mkt-Rascunho ${STAMP}`, draft: true } });
    expect(d.statusCode).toBe(201);
    expect(d.json().campaign.status).toBe("draft");
  });
});
