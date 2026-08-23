/**
 * Nota fiscal do pedido.
 *
 * Hoje (manual): o dono emite a NF-e fora do site (Bling, emissor da SEFAZ…) e anexa no painel o PDF (DANFE) e,
 * se quiser, o XML + número/série/chave. O botão "Enviar ao cliente" manda o e-mail com os anexos pelo mailer
 * (SMTP/MailerSend). O cliente também baixa o PDF em "Minha conta" (dono do pedido ou admin).
 *
 * Amanhã (Bling): `issueAutomatically(order)` é o gancho — quando houver credenciais do Bling (BLING_CLIENT_ID/SECRET
 * + OAuth), a emissão cria a nota lá, guarda `externalId`/`externalUrl`/`accessKey`, baixa o PDF para cá e dispara
 * o mesmo e-mail. `source` marca de onde a nota veio.
 */
import { AppError } from "../../lib/errors.js";
import { canonicalWebUrl } from "../../lib/site-url.js";
import { buildInvoiceEmail } from "../mail/mailer.js";

const MAX_PDF_BYTES = 6 * 1024 * 1024; // DANFE costuma ter < 300 KB
const MAX_XML_BYTES = 2 * 1024 * 1024;
const ACCESS_KEY_RE = /^\d{44}$/;

const digits = (v) => String(v ?? "").replace(/\D/g, "");

function decodeDataUrl(dataUrl, { mimes, max, label }) {
  if (dataUrl == null || dataUrl === "") return null;
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/is.exec(String(dataUrl));
  if (!m) throw AppError.badRequest(`${label}: arquivo inválido (esperado data URL base64)`);
  const mime = m[1].toLowerCase();
  if (mimes && !mimes.has(mime)) throw AppError.badRequest(`${label}: formato não suportado (${mime})`);
  let buf;
  try { buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64"); } catch { throw AppError.badRequest(`${label}: arquivo inválido`); }
  if (!buf.length) throw AppError.badRequest(`${label}: arquivo vazio`);
  if (buf.length > max) throw AppError.badRequest(`${label}: arquivo muito grande (${(buf.length / 1024 / 1024).toFixed(1)} MB; máx. ${Math.round(max / 1024 / 1024)} MB)`);
  return { mime, buf };
}

/** Visão da nota sem os binários (painel e "minha conta"). */
export function invoiceSummary(inv) {
  if (!inv) return null;
  const { pdfData, xmlData, ...rest } = inv;
  return { ...rest, hasPdf: Boolean(inv.pdfBytes), hasXml: Boolean(xmlData) };
}

export function createInvoiceService({ prisma, env, mailer, log }) {
  async function orderByNumber(number) {
    const order = await prisma.order.findUnique({ where: { number }, include: { items: true, invoice: true } });
    if (!order) throw AppError.notFound("Pedido não encontrado");
    return order;
  }

  async function get(number) {
    const order = await orderByNumber(number);
    return invoiceSummary(order.invoice);
  }

  /** Anexa/substitui a nota manual. Campos opcionais; precisa de pelo menos o PDF ou número/chave. */
  async function attach(number, body = {}, actor = null) {
    const order = await orderByNumber(number);
    const pdf = decodeDataUrl(body.pdfDataUrl, { mimes: new Set(["application/pdf"]), max: MAX_PDF_BYTES, label: "PDF" });
    const xml = decodeDataUrl(body.xmlDataUrl, { mimes: null, max: MAX_XML_BYTES, label: "XML" });
    let xmlText = xml ? xml.buf.toString("utf8") : (typeof body.xml === "string" && body.xml.trim() ? body.xml.trim() : null);
    if (xmlText && !/<\s*(nfeProc|NFe|enviNFe)[\s>]/i.test(xmlText)) throw AppError.badRequest("XML: não parece ser o XML de uma NF-e");
    const accessKey = digits(body.accessKey) || null;
    if (accessKey && !ACCESS_KEY_RE.test(accessKey)) throw AppError.badRequest("Chave de acesso: são 44 dígitos");
    const numberStr = String(body.number ?? "").trim() || null;
    const series = String(body.series ?? "").trim() || null;
    let issuedAt = null;
    if (body.issuedAt) {
      issuedAt = new Date(body.issuedAt);
      if (Number.isNaN(issuedAt.getTime())) throw AppError.badRequest("Data de emissão inválida");
    }
    const externalUrl = String(body.externalUrl ?? "").trim() || null;
    if (externalUrl && !/^https?:\/\//i.test(externalUrl)) throw AppError.badRequest("Link da nota inválido (use http:// ou https://)");

    const current = order.invoice;
    if (!pdf && !current?.pdfBytes && !accessKey && !numberStr && !externalUrl) throw AppError.badRequest("Anexe o PDF da nota ou informe número/chave de acesso");

    const data = {
      source: "manual",
      number: numberStr ?? current?.number ?? null,
      series: series ?? current?.series ?? null,
      accessKey: accessKey ?? current?.accessKey ?? null,
      issuedAt: issuedAt ?? current?.issuedAt ?? null,
      externalUrl: externalUrl ?? current?.externalUrl ?? null,
      ...(pdf ? { pdfData: pdf.buf, pdfBytes: pdf.buf.length } : {}),
      ...(xmlText ? { xmlData: xmlText } : {}),
      createdBy: actor?.id ?? current?.createdBy ?? null
    };
    const saved = await prisma.orderInvoice.upsert({ where: { orderId: order.id }, create: { orderId: order.id, ...data }, update: data });
    await prisma.orderEvent.create({
      data: { orderId: order.id, type: current ? "invoice_updated" : "invoice_attached", payload: { by: actor?.email ?? null, number: saved.number, accessKey: saved.accessKey, pdf: Boolean(saved.pdfBytes), xml: Boolean(saved.xmlData) } }
    }).catch(() => {});
    log?.info({ order: number, by: actor?.email }, "invoice: nota anexada");
    return invoiceSummary(saved);
  }

  async function remove(number, actor = null) {
    const order = await orderByNumber(number);
    if (!order.invoice) throw AppError.notFound("Este pedido não tem nota anexada");
    await prisma.orderInvoice.delete({ where: { orderId: order.id } });
    await prisma.orderEvent.create({ data: { orderId: order.id, type: "invoice_removed", payload: { by: actor?.email ?? null } } }).catch(() => {});
    return { ok: true };
  }

  /** PDF para download (painel, ou cliente dono do pedido). */
  async function pdf(number) {
    const order = await orderByNumber(number);
    if (!order.invoice?.pdfData) throw AppError.notFound("Este pedido não tem o PDF da nota");
    return { data: Buffer.from(order.invoice.pdfData), filename: `nota-fiscal-${order.number}${order.invoice.number ? `-${order.invoice.number}` : ""}.pdf`, order };
  }

  async function xml(number) {
    const order = await orderByNumber(number);
    if (!order.invoice?.xmlData) throw AppError.notFound("Este pedido não tem o XML da nota");
    return { data: order.invoice.xmlData, filename: `nota-fiscal-${order.number}${order.invoice.number ? `-${order.invoice.number}` : ""}.xml`, order };
  }

  /** Manda a nota ao cliente por e-mail (PDF + XML anexos). Resultado honesto: ok/erro do provedor. */
  async function send(number, actor = null, { to = null } = {}) {
    const order = await orderByNumber(number);
    const inv = order.invoice;
    if (!inv) throw AppError.badRequest("Anexe a nota antes de enviar");
    if (!inv.pdfData && !inv.externalUrl && !inv.accessKey) throw AppError.badRequest("A nota precisa ter o PDF (ou um link/chave) para ser enviada");
    const recipient = String(to || order.customerEmail || "").trim().toLowerCase();
    if (!recipient.includes("@")) throw AppError.badRequest("Pedido sem e-mail do cliente");
    if (!mailer || mailer.provider === "log") throw AppError.badRequest("E-mail não configurado (MAIL_PROVIDER=log): configure a MailerSend antes de enviar a nota");

    const mail = buildInvoiceEmail(order, inv, { siteUrl: canonicalWebUrl(env) });
    const attachments = [];
    if (inv.pdfData) attachments.push({ filename: `nota-fiscal-${order.number}.pdf`, content: Buffer.from(inv.pdfData), contentType: "application/pdf" });
    if (inv.xmlData) attachments.push({ filename: `nota-fiscal-${order.number}.xml`, content: Buffer.from(inv.xmlData, "utf8"), contentType: "application/xml" });
    const result = await mailer.send({ to: recipient, toName: order.customerName, ...mail, attachments });
    await prisma.orderEvent.create({
      data: { orderId: order.id, type: "email_invoice", payload: { ok: Boolean(result?.ok), to: recipient, provider: mailer.provider, error: result?.error ?? null, by: actor?.email ?? null } }
    }).catch(() => {});
    if (result?.ok) await prisma.orderInvoice.update({ where: { orderId: order.id }, data: { sentAt: new Date(), sentTo: recipient } });
    log?.info({ order: number, to: recipient, ok: Boolean(result?.ok), err: result?.error }, "invoice: e-mail da nota");
    return { ...result, to: recipient };
  }

  /**
   * Gancho da emissão automática (Bling). Sem credenciais configuradas não faz nada — e nunca derruba o fluxo de
   * pagamento. Quando existir: emitir no Bling → guardar externalId/accessKey/PDF → send().
   */
  async function issueAutomatically(order) {
    if (!env.BLING_CLIENT_ID) return { skipped: "bling não configurado" };
    return { skipped: "emissão automática pelo Bling ainda não implementada" };
  }

  return { get, attach, remove, pdf, xml, send, issueAutomatically, invoiceSummary };
}
