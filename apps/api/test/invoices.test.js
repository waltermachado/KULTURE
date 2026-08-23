import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Nota fiscal manual: o admin anexa PDF/XML + dados no pedido, envia por e-mail (anexos) e o cliente baixa em "Minha conta".
 * Bate no banco de dev; prefixo "test-nf-" e limpeza no fim.
 */
const TEST_SECRET = "test-jwt-secret-kulture-32chars-long!!";
const STAMP = Date.now();
const ADMIN = { email: `test-nf-admin-${STAMP}@kulture.test`, password: "Senh@Admin123", name: "Dona Kulture" };
const CUSTOMER = { email: `test-nf-cli-${STAMP}@kulture.test`, password: "Senh@Cli12345", name: "Cliente Nota" };
const OTHER = { email: `test-nf-outro-${STAMP}@kulture.test`, password: "Senh@Out12345", name: "Outro Cliente" };
const PDF_B64 = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n").toString("base64");
const XML = `<?xml version="1.0"?><nfeProc versao="4.00"><NFe><infNFe Id="NFe${"1".repeat(44)}"><ide><nNF>123</nNF></ide></infNFe></NFe></nfeProc>`;

const fakeImages = { storageDir: process.cwd(), ensureImages: async (_id, urls) => urls };
const fakeScraper = {
  baseUrl: "mock",
  async search() { return { total: 0, products: [] }; },
  async findOne() { return null; },
  async rate() { return { pair: "USD-BRL", bid: 5, ask: 5, timestamp: "2026-01-01 00:00:00" }; },
  async health() { return { ok: true }; },
  async getProductDetail() { throw new Error("sem Nike"); }
};
const sentMails = [];
const fakeMailer = { provider: "fake", async send(msg) { sentMails.push(msg); return { ok: true, provider: "fake", messageId: "m1" }; } };

describe("nota fiscal do pedido (manual)", { timeout: 90000 }, () => {
  let app, prisma, adminToken, customerToken, otherToken, orderNumber;
  const asAdmin = (opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${adminToken}` } });

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test", LOG_LEVEL: "silent", TOP8_WARM: "false", CORS_ORIGINS: "",
      DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: TEST_SECRET, ADMIN_EMAILS: ADMIN.email,
      PAYMENT_PROVIDER: "mock", PUBLIC_WEB_URL: "https://loja.test"
    });
    app = await buildApp({ env, scraper: fakeScraper, images: fakeImages, mailer: fakeMailer, warmTop8: false, startJobs: false, logger: false });
    await app.ready();
    prisma = app.prisma;
    adminToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: ADMIN })).json().accessToken;
    customerToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: CUSTOMER })).json().accessToken;
    otherToken = (await app.inject({ method: "POST", url: "/api/auth/register", payload: OTHER })).json().accessToken;
    // venda externa registrada no painel para o cliente (vincula pelo e-mail)
    const o = await asAdmin({ method: "POST", url: "/api/admin/orders", payload: { customer: { name: CUSTOMER.name, email: CUSTOMER.email }, items: [{ kind: "manual", name: "Meia", brLabel: "M", unitPriceBrl: 50 }], notifyCustomer: false } });
    expect(o.statusCode).toBe(201);
    orderNumber = o.json().number;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.order.deleteMany({ where: { number: orderNumber } });
      await prisma.user.deleteMany({ where: { email: { startsWith: "test-nf-" } } });
    }
    await app?.close();
  });

  it("sem nota: resumo null; enviar sem anexar → 400; anexar sem nada → 400", async () => {
    expect((await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}/invoice` })).json().invoice).toBeNull();
    const noInv = await asAdmin({ method: "POST", url: `/api/admin/orders/${orderNumber}/invoice/send`, payload: {} });
    expect(noInv.statusCode).toBe(400);
    expect(noInv.json().message).toMatch(/Anexe a nota/);
    expect((await asAdmin({ method: "PUT", url: `/api/admin/orders/${orderNumber}/invoice`, payload: {} })).statusCode).toBe(400);
    expect((await asAdmin({ method: "PUT", url: `/api/admin/orders/${orderNumber}/invoice`, payload: { accessKey: "123" } })).statusCode).toBe(400); // chave com 44 dígitos
    expect((await asAdmin({ method: "PUT", url: `/api/admin/orders/${orderNumber}/invoice`, payload: { pdfDataUrl: `data:image/png;base64,${PDF_B64}` } })).statusCode).toBe(400); // só PDF
    expect((await app.inject({ method: "PUT", url: `/api/admin/orders/${orderNumber}/invoice`, headers: { authorization: `Bearer ${customerToken}` }, payload: {} })).statusCode).toBe(403);
  });

  it("anexa PDF + XML + dados, aparece no pedido (painel e cliente) e pode ser baixada pelo dono", async () => {
    const r = await asAdmin({
      method: "PUT", url: `/api/admin/orders/${orderNumber}/invoice`,
      payload: { pdfDataUrl: `data:application/pdf;base64,${PDF_B64}`, xml: XML, number: "123", series: "1", accessKey: "3526 0812 3456 7800 0199 5500 1000 0001 2310 0000 0001", issuedAt: "2026-08-23" }
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().invoice).toMatchObject({ source: "manual", number: "123", series: "1", accessKey: "35260812345678000199550010000001231000000001", hasPdf: true, hasXml: true, sentAt: null });
    expect(r.json().invoice.pdfData).toBeUndefined();

    const det = await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}` });
    expect(det.json().invoice).toMatchObject({ number: "123", hasPdf: true, hasXml: true });
    expect(det.json().events.some((e) => e.type === "invoice_attached")).toBe(true);

    const pdf = await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}/invoice.pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.toString("utf8")).toContain("%PDF-1.4");
    const xml = await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}/invoice.xml` });
    expect(xml.statusCode).toBe(200);
    expect(xml.body).toContain("<nNF>123</nNF>");

    // cliente dono (vínculo pelo e-mail): vê e baixa; outro cliente não; convidado sem token não
    const mine = await app.inject({ method: "GET", url: "/api/orders/mine", headers: { authorization: `Bearer ${customerToken}` } });
    expect(mine.json().orders.find((x) => x.number === orderNumber).invoice).toMatchObject({ number: "123", hasPdf: true });
    expect((await app.inject({ method: "GET", url: `/api/orders/${orderNumber}/invoice.pdf`, headers: { authorization: `Bearer ${customerToken}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/orders/${orderNumber}/invoice.pdf`, headers: { authorization: `Bearer ${otherToken}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/orders/${orderNumber}/invoice.pdf` })).statusCode).toBe(401);
    // visão pública (convidado) só diz que existe — sem binário
    const pub = await app.inject({ method: "GET", url: `/api/orders/${orderNumber}` });
    expect(pub.json().invoice).toBeUndefined(); // convidado não vê a nota (scope public)
  });

  it("envia por e-mail com PDF e XML anexos, registra sentAt e evento; remove", async () => {
    const before = sentMails.length;
    const s = await asAdmin({ method: "POST", url: `/api/admin/orders/${orderNumber}/invoice/send` });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ ok: true, to: CUSTOMER.email });
    expect(sentMails.length).toBe(before + 1);
    const m = sentMails.at(-1);
    expect(m.subject).toBe(`Nota fiscal do pedido ${orderNumber} — Kulture`);
    expect(m.text).toContain("Chave de acesso: 35260812345678000199550010000001231000000001");
    expect(m.text).toContain("https://loja.test/conta");
    expect(m.attachments.map((a) => a.filename)).toEqual([`nota-fiscal-${orderNumber}.pdf`, `nota-fiscal-${orderNumber}.xml`]);
    expect(m.attachments[0].content.toString("utf8")).toContain("%PDF-1.4");
    const inv = (await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}/invoice` })).json().invoice;
    expect(inv.sentTo).toBe(CUSTOMER.email);
    expect(inv.sentAt).toBeTruthy();
    const det = await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}` });
    expect(det.json().events.some((e) => e.type === "email_invoice" && e.payload.ok)).toBe(true);

    expect((await asAdmin({ method: "DELETE", url: `/api/admin/orders/${orderNumber}/invoice` })).statusCode).toBe(200);
    expect((await asAdmin({ method: "GET", url: `/api/admin/orders/${orderNumber}/invoice` })).json().invoice).toBeNull();
  });
});
