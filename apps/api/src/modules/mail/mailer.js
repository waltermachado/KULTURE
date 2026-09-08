/**
 * E-mail transacional + marketing. Provedores por env MAIL_PROVIDER:
 *   - log        → só registra no log (padrão em dev/test)
 *   - mailersend → API HTTP da MailerSend (POST https://api.mailersend.com/v1/email, Bearer MAILERSEND_API_TOKEN)
 *   - smtp       → SMTP (MailerSend: smtp.mailersend.net:587 STARTTLS, usuário/senha do painel) via nodemailer.
 *                  Vale para "esqueci minha senha", atualização de entrega e campanhas de marketing.
 *
 * Nunca lança para o chamador: falha de e-mail não pode derrubar checkout/confirmação.
 * Observação MailerSend: o domínio do MAIL_FROM precisa estar verificado na conta; em trial (domínio
 * test-….mlsender.net) só entrega para o e-mail do administrador da conta.
 */
import nodemailer from "nodemailer";
import { sizeLabelBr } from "@kulture/shared/sizes";
import { isInternationalOrder } from "../orders/status.js";

/** `transport` (só testes): um transporter do nodemailer já pronto (ex. jsonTransport) no lugar do SMTP real. */
export function createMailer(env, log, { transport = null } = {}) {
  const provider = env.MAIL_PROVIDER || "log";
  const from = { email: env.MAIL_FROM || "no-reply@localhost", name: env.MAIL_FROM_NAME || "Kulture" };
  const replyTo = env.MAIL_REPLY_TO || null;

  async function viaLog(msg) {
    log?.info({ mail: { to: msg.to, subject: msg.subject } }, "mail(log): e-mail simulado");
    return { ok: true, provider: "log" };
  }

  // SMTP: um pool de conexões, criado na primeira mensagem (campanha manda dezenas de e-mails em sequência)
  let smtp = transport;
  function smtpTransport() {
    if (smtp) return smtp;
    if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error("SMTP_USER/SMTP_PASS ausentes");
    smtp = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: Boolean(env.SMTP_SECURE), // false em 587 → STARTTLS (requireTLS abaixo); true em 465
      requireTLS: !env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      pool: true,
      maxConnections: 2,
      maxMessages: 200,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000
    });
    return smtp;
  }

  async function viaSmtp(msg) {
    const info = await smtpTransport().sendMail({
      from: { address: from.email, name: from.name },
      to: msg.toName ? { address: msg.to, name: msg.toName } : msg.to,
      replyTo: msg.replyTo || replyTo || undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html || undefined,
      headers: msg.headers || undefined,
      list: msg.unsubscribeUrl ? { unsubscribe: { url: msg.unsubscribeUrl, comment: "Descadastrar" } } : undefined,
      attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType || undefined }))
    });
    return { ok: true, provider: "smtp", messageId: info?.messageId || null, accepted: info?.accepted?.length ?? null };
  }

  /** Erro da API da MailerSend em uma frase legível (422 traz `errors: { campo: [msgs] }`). */
  function mailerSendError(status, body) {
    let detail = "";
    try {
      const j = JSON.parse(body);
      const list = j?.errors && typeof j.errors === "object" ? Object.values(j.errors).flat() : [];
      detail = [j?.message, ...list].filter(Boolean).join(" · ");
    } catch { detail = String(body || "").slice(0, 300); }
    const hint =
      status === 401 ? " (token inválido — MAILERSEND_API_TOKEN)"
      : status === 422 && /domain|from/i.test(detail) ? " (o MAIL_FROM precisa ser do domínio verificado na MailerSend)"
      : status === 422 && /trial|approved|recipient/i.test(detail) ? " (conta em trial/não aprovada: só entrega para o e-mail do dono da conta)"
      : status === 429 ? " (limite de envio da MailerSend — tente mais tarde)"
      : "";
    return new Error(`MailerSend ${status}: ${detail || "erro"}${hint}`);
  }

  async function viaMailerSend(msg) {
    if (!env.MAILERSEND_API_TOKEN) throw new Error("MAILERSEND_API_TOKEN ausente");
    const reply = msg.replyTo || replyTo;
    const res = await fetch(`${env.MAILERSEND_API_BASE || "https://api.mailersend.com/v1"}/email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.MAILERSEND_API_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        from,
        to: [{ email: msg.to, name: msg.toName || undefined }],
        reply_to: reply ? { email: reply } : undefined,
        subject: msg.subject,
        text: msg.text,
        html: msg.html || undefined,
        attachments: msg.attachments?.length
          ? msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64"), disposition: "attachment" }))
          : undefined
        // cabeçalhos customizados (List-Unsubscribe) só existem nos planos pagos da API — o link de descadastro vai no corpo
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok && res.status !== 202) {
      const body = await res.text().catch(() => "");
      throw mailerSendError(res.status, body);
    }
    return { ok: true, provider: "mailersend", messageId: res.headers.get("x-message-id") };
  }

  /**
   * @param {{to:string, toName?:string, subject:string, text:string, html?:string, headers?:object, replyTo?:string, unsubscribeUrl?:string,
   *          attachments?: Array<{ filename: string, content: Buffer|string, contentType?: string }>}} msg
   * Nunca lança: devolve { ok:false, error } — quem precisa saber (campanha, reset) lê o resultado.
   */
  async function send(msg) {
    if (!msg?.to) return { ok: false, skipped: "sem destinatário" };
    try {
      if (provider === "mailersend") return await viaMailerSend(msg);
      if (provider === "smtp") return await viaSmtp(msg);
      return await viaLog(msg);
    } catch (err) {
      log?.warn({ err: err.message, to: msg.to, subject: msg.subject }, "mail: falha ao enviar (ignorada)");
      return { ok: false, error: err.message };
    }
  }

  /** Testa a conexão (SMTP: EHLO + login). Para log/mailersend só confirma a configuração presente. */
  async function verify() {
    try {
      if (provider === "smtp") {
        await smtpTransport().verify();
        return { ok: true, provider, host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, from: from.email };
      }
      if (provider === "mailersend") {
        if (!env.MAILERSEND_API_TOKEN) return { ok: false, provider, from: from.email, error: "MAILERSEND_API_TOKEN ausente" };
        // a API não tem "ping" público para todo token: confere só que o token é aceito (401 = inválido)
        const res = await fetch(`${env.MAILERSEND_API_BASE || "https://api.mailersend.com/v1"}/domains?limit=1`, {
          headers: { Authorization: `Bearer ${env.MAILERSEND_API_TOKEN}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000)
        }).catch((err) => ({ status: 0, statusText: err.message }));
        if (res.status === 401) return { ok: false, provider, from: from.email, error: "MAILERSEND_API_TOKEN inválido (401)" };
        if (res.status === 0) return { ok: false, provider, from: from.email, error: `sem acesso à API da MailerSend: ${res.statusText}` };
        return { ok: true, provider, from: from.email, note: res.status === 403 ? "token aceito (sem permissão para listar domínios — normal em token só de envio); use “E-mail de teste para mim”" : "token aceito" };
      }
      return { ok: true, provider, from: from.email, note: "provedor log: e-mails só aparecem no log" };
    } catch (err) {
      return { ok: false, provider, host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, from: from.email, error: err.message };
    }
  }

  function close() {
    try { smtp?.close?.(); } catch { /* ok */ }
  }

  return { send, verify, close, provider, from };
}

const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Todos os e-mails daqui vão para o CLIENTE: o tamanho sai só em BR ("BR 38"); o US fica no backoffice. */
const sizeLabel = (i) => sizeLabelBr(i) || "BR ?";
const TZ = "America/Fortaleza";
const fmtDateTime = (d) => {
  const date = d ? new Date(d) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " às");
};
const fmtDate = (d) => {
  const date = d ? new Date(d) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { timeZone: TZ });
};
const fmtCpf = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(v ?? "").trim() || null;
};
const fmtPhoneBr = (v) => {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? "").trim() || null;
};
/** Nike By You: gravação por pé, quando houver. */
const customLine = (i) => {
  const c = i.customization;
  if (!c || typeof c !== "object") return "";
  const foot = (t, n, lbl) => { const p = []; if (t) p.push(`“${t}”`); if (n) p.push(`nº ${n}`); return p.length ? `pé ${lbl} ${p.join(" ")}` : null; };
  const parts = [foot(c.textLeft, c.numberLeft, "E"), foot(c.textRight, c.numberRight, "D")].filter(Boolean);
  return parts.length ? ` — By You: ${parts.join(" · ")}` : " — By You";
};

const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Texto já escapado → links clicáveis (http/https). */
const linkify = (escaped) =>
  escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:)])/g, (u) => `<a href="${u}" style="color:#FFD31F;text-decoration:underline">${u}</a>`);
const lines = (arr) => arr.filter((l) => l !== null && l !== undefined && l !== false).join("\n");

// ════════════════════════════════════════════════════════════════════════════
// Moldura Kulture — padrão visual definido pelos modelos 01–06 do dono (29/08):
// e-mail escuro (#0B0B0B) com amarelo #FFD31F (o mesmo --yellow do site), logo
// no topo sobre borda amarela, cartões de detalhe, rodapé completo e
// color-scheme "dark" declarado (evita o Gmail/Outlook inverterem as cores).
// Tabelas + estilos inline: é o que funciona em Gmail/Outlook/iOS.
// ════════════════════════════════════════════════════════════════════════════
const YELLOW = "#FFD31F";
const F = `Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const SITE_FALLBACK = "https://lojakulture.com.br";
const INSTAGRAM_URL = "https://instagram.com/kulturebr";

/** Contato/identidade do rodapé — lidos na hora do envio (envs opcionais têm fallback do site). */
function brand() {
  const whatsappPhone = process.env.WHATSAPP_CONTACT_PHONE || "5585992578888";
  return {
    fromEmail: process.env.MAIL_FROM || "no-reply@lojakulture.com.br",
    replyEmail: process.env.MAIL_REPLY_TO || "",
    whatsappPhone,
    whatsappUrl: `https://wa.me/${whatsappPhone}`,
    whatsappLabel: fmtPhoneBr(whatsappPhone) || whatsappPhone,
    companyLine: process.env.MAIL_COMPANY_LINE || "" // ex.: "Kulture LTDA · CNPJ 00.000.000/0001-00 · Fortaleza/CE"
  };
}

// ─── blocos (todos devolvem HTML pronto, já escapado) ───
const kicker = (text) =>
  `<p style="margin:0 0 12px 0;font-family:${F};font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2.6px;text-transform:uppercase;color:${YELLOW};">${escapeHtml(text)}</p>`;
/** H1 grande do padrão; `html` já escapado (aceita <br />). */
const h1 = (html) =>
  `<h1 style="margin:0 0 18px 0;font-family:${F};font-size:52px;line-height:46px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-2.2px;text-transform:uppercase;color:#F4F2ED;word-break:break-word;overflow-wrap:break-word;">${html}</h1>`;
/** Etiqueta amarela pequena (ex.: "Pedido KLT-…"). */
const badge = (text) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="auto" style="border-collapse:collapse;"><tr><td bgcolor="${YELLOW}" style="background-color:${YELLOW};padding:6px 12px;font-family:${F};font-size:10px;line-height:14px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2.2px;text-transform:uppercase;color:#0B0B0B;">${escapeHtml(text)}</td></tr></table><div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>`;
/** Parágrafo padrão; `html` já escapado/montado. */
const para = (html, { last = false } = {}) =>
  `<p style="margin:0 0 ${last ? "0" : "14px"} 0;font-family:${F};font-size:15px;line-height:25px;mso-line-height-rule:exactly;color:#8A8880;">${html}</p>`;
const strong = (text) => `<strong style="color:#F4F2ED;font-weight:bold;">${escapeHtml(text)}</strong>`;
/** Botão amarelo em largura total. */
const ctaPrimary = (label, url) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;"><tr><td bgcolor="${YELLOW}" style="background-color:${YELLOW};padding:0;"><a href="${escapeHtml(url)}" style="display:block;padding:20px 24px;font-family:${F};font-size:13px;line-height:18px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#0B0B0B;text-decoration:none;">${escapeHtml(label)} &nbsp;&rarr;</a></td></tr></table>`;
/** Botão secundário (contorno amarelo). */
const ctaOutline = (label, url) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;"><tr><td bgcolor="#0B0B0B" style="background-color:#0B0B0B;border:2px solid ${YELLOW};padding:0;"><a href="${escapeHtml(url)}" style="display:block;padding:16px 22px;font-family:${F};font-size:12px;line-height:18px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${YELLOW};text-decoration:none;">${escapeHtml(label)} &nbsp;&rarr;</a></td></tr></table>`;
/** Cartão escuro com linhas rótulo × valor. rows = [[label, valor]]: string é escapada; { html } entra como veio. */
function dataCard(rows) {
  const cells = rows
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(typeof v === "object" && !v.html))
    .map(([label, value], i, arr) => {
      const value_ = typeof value === "object" ? value.html : escapeHtml(String(value));
      const divider = i < arr.length - 1 ? `<tr><td colspan="2" height="1" bgcolor="#1C1C1C" style="height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>` : "";
      return `<tr><td width="42%" valign="top" style="width:42%;padding:14px 0;font-family:${F};font-size:10px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#7C7A73;">${escapeHtml(label)}</td><td width="58%" align="right" valign="top" style="width:58%;padding:14px 0;font-family:${F};font-size:14px;line-height:20px;mso-line-height-rule:exactly;color:#F4F2ED;">${value_}</td></tr>${divider}`;
    })
    .join("\n");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#131313" style="width:100%;background-color:#131313;border:1px solid #262626;"><tr><td style="padding:6px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${cells}</table></td></tr></table>`;
}
/** Destaque com barra amarela à esquerda. */
const callout = (text) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr><td width="2" bgcolor="${YELLOW}" style="width:2px;background-color:${YELLOW};font-size:0;line-height:0;">&nbsp;</td><td style="padding:2px 0 2px 16px;font-family:${F};font-size:13px;line-height:22px;mso-line-height-rule:exactly;color:#C9C6BE;">${escapeHtml(text)}</td></tr></table>`;
/** Lista numerada 01/02/03 (benefícios da conta). */
const numberedList = (items) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${items
    .map(
      (it, i) => `<tr>
    <td width="42" valign="top" style="width:42px;padding:16px 14px 16px 0;border-top:1px solid #1C1C1C;font-family:${F};font-size:11px;line-height:16px;font-weight:bold;letter-spacing:1.6px;color:${YELLOW};">${String(i + 1).padStart(2, "0")}</td>
    <td valign="top" style="padding:16px 0;border-top:1px solid #1C1C1C;">
      <p style="margin:0 0 5px 0;font-family:${F};font-size:16px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-0.4px;text-transform:uppercase;color:#F4F2ED;">${escapeHtml(it.title)}</p>
      <p style="margin:0;font-family:${F};font-size:13px;line-height:21px;mso-line-height-rule:exactly;color:#8A8880;">${escapeHtml(it.desc)}</p>
    </td></tr>`
    )
    .join("\n")}</table>`;
/** Bloco amarelo "Valor pago" (comprovante). */
const bigValueCard = ({ label, value, note }) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${YELLOW}" style="width:100%;background-color:${YELLOW};border-collapse:collapse;"><tr><td align="left" style="padding:26px 24px;">
   <p style="margin:0 0 8px 0;font-family:${F};font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2.4px;text-transform:uppercase;color:#0B0B0B;">${escapeHtml(label)}</p>
   <p class="big" style="margin:0;font-family:${F};font-size:52px;line-height:48px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-2.4px;color:#0B0B0B;">${escapeHtml(value)}</p>
   ${note ? `<p style="margin:10px 0 0 0;font-family:${F};font-size:11px;line-height:17px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:#0B0B0B;">${escapeHtml(note)}</p>` : ""}
  </td></tr></table>`;
/** Uma seção do corpo (célula com o respiro padrão). */
const section = (html, { padTop = 0, padBottom = 26 } = {}) =>
  `<tr><td class="pad" style="padding:${padTop}px 28px ${padBottom}px 28px;">\n${html}\n</td></tr>`;

/** Linhas de itens do pedido: foto · nome/cor/tamanho · preço (padrão do modelo 03). */
function itemRows(items, { siteUrl = "" } = {}) {
  const base = siteUrl || SITE_FALLBACK;
  const rows = (items || [])
    .map((i) => {
      const img = i.image ? (String(i.image).startsWith("http") ? i.image : `${base}${i.image}`) : null;
      const photo = img
        ? `<img src="${escapeHtml(img)}" width="72" alt="${escapeHtml(i.name)}" style="display:block;width:72px;height:auto;border:1px solid #262626;background-color:#131313;" />`
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="72" bgcolor="#131313" style="width:72px;border:1px solid #262626;"><tr><td height="72" align="center" valign="middle" style="height:72px;font-family:${F};font-size:9px;font-weight:bold;letter-spacing:1.4px;color:#5C5A54;">FOTO</td></tr></table>`;
      const cust = customLine(i).replace(/^ — /, "");
      return `<tr>
  <td width="72" valign="top" style="width:72px;padding:16px 16px 16px 0;border-top:1px solid #1C1C1C;">${photo}</td>
  <td valign="top" style="padding:16px 10px 16px 0;border-top:1px solid #1C1C1C;">
    <p style="margin:0 0 5px 0;font-family:${F};font-size:16px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-0.4px;text-transform:uppercase;color:#F4F2ED;word-break:break-word;">${escapeHtml(i.name)}</p>
    ${i.colorDescription ? `<p style="margin:0 0 4px 0;font-family:${F};font-size:13px;line-height:18px;mso-line-height-rule:exactly;color:${YELLOW};">&ldquo;${escapeHtml(i.colorDescription)}&rdquo;</p>` : ""}
    <p style="margin:0;font-family:${F};font-size:10px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:#7C7A73;">Tam. ${escapeHtml(sizeLabel(i))} &nbsp;&middot;&nbsp; Qtd. ${escapeHtml(String(i.quantity))}</p>
    ${cust ? `<p style="margin:5px 0 0 0;font-family:${F};font-size:11px;line-height:16px;mso-line-height-rule:exactly;color:#8A8880;">${escapeHtml(cust)}</p>` : ""}
  </td>
  <td width="112" align="right" valign="top" style="width:112px;padding:16px 0;border-top:1px solid #1C1C1C;font-family:${F};font-size:16px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-0.4px;white-space:nowrap;color:#F4F2ED;">${escapeHtml(brl(i.unitPriceBrl))}</td>
</tr>`;
    })
    .join("\n");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${rows}</table>`;
}

/** Subtotal · frete grátis · desconto (se houver) · TOTAL grande (modelo 03). */
function totalsBlock(order) {
  const row = (label, value) =>
    `<tr><td style="padding:8px 0;font-family:${F};font-size:10px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:#7C7A73;">${escapeHtml(label)}</td><td align="right" style="padding:8px 0;font-family:${F};font-size:14px;line-height:18px;mso-line-height-rule:exactly;color:#F4F2ED;white-space:nowrap;">${escapeHtml(value)}</td></tr>`;
  const discount = Number(order.discountBrl) > 0 ? row(`Desconto${order.couponCode ? ` (cupom ${order.couponCode})` : ""}`, `− ${brl(order.discountBrl)}`) : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-top:1px solid #262626;">
  ${order.subtotalBrl != null ? row("Subtotal", brl(order.subtotalBrl)) : ""}
  ${row("Frete", "Grátis")}
  ${discount}
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-top:2px solid ${YELLOW};margin-top:8px;"><tr>
    <td valign="bottom" style="padding:16px 0 0 0;font-family:${F};font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2.2px;text-transform:uppercase;color:#7C7A73;">Total</td>
    <td class="big" align="right" valign="bottom" style="padding:16px 0 0 0;font-family:${F};font-size:44px;line-height:42px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-2px;color:#F4F2ED;white-space:nowrap;">${escapeHtml(brl(order.totalBrl))}</td>
  </tr></table>`;
}

/** Linha do tempo do pedido (modelo 05): chips 01..N — feito (amarelo escuro) · atual (amarelo) · futuro (contorno). */
function timeline(steps) {
  const rows = steps
    .map((s, i) => {
      const n = String(i + 1).padStart(2, "0");
      const chip =
        s.state === "current"
          ? `bgcolor="${YELLOW}" style="width:26px;height:20px;background-color:${YELLOW};border:1px solid ${YELLOW};font-family:${F};font-size:10px;line-height:14px;font-weight:bold;letter-spacing:0.6px;color:#0B0B0B;"`
          : s.state === "done"
            ? `bgcolor="#4A3E0A" style="width:26px;height:20px;background-color:#4A3E0A;border:1px solid #4A3E0A;font-family:${F};font-size:10px;line-height:14px;font-weight:bold;letter-spacing:0.6px;color:${YELLOW};"`
            : `bgcolor="transparent" style="width:26px;height:20px;background-color:transparent;border:1px solid #262626;font-family:${F};font-size:10px;line-height:14px;font-weight:bold;letter-spacing:0.6px;color:#5C5A54;"`;
      const labelColor = s.state === "current" ? "#F4F2ED" : s.state === "done" ? "#8A8880" : "#5C5A54";
      return `<tr>
  <td width="26" valign="top" style="width:26px;padding:14px 14px 14px 0;border-top:1px solid #1C1C1C;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="26"><tr><td width="26" height="20" align="center" valign="middle" ${chip}>${n}</td></tr></table></td>
  <td valign="middle" style="padding:14px 8px 14px 0;border-top:1px solid #1C1C1C;font-family:${F};font-size:13px;line-height:18px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:${labelColor};">${escapeHtml(s.label)}</td>
  <td align="right" valign="middle" style="padding:14px 0;border-top:1px solid #1C1C1C;font-family:${F};font-size:11px;line-height:16px;mso-line-height-rule:exactly;color:#5C5A54;white-space:nowrap;">${escapeHtml(s.date || "")}</td>
</tr>`;
    })
    .join("\n");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">${rows}</table>`;
}

/**
 * Moldura completa (nav + faixa + conteúdo + rodapé) dos modelos do dono.
 * `sections` = HTML já montado com section(...); `ribbon` = frase da faixa amarela sob a logo.
 */
export function emailLayout({ contentHtml, sections = "", title = "Kulture", preheader = "", ribbon = "", footerHtml = "", marketingFooter = false, siteUrl = "" }) {
  const b = brand();
  const home = escapeHtml(siteUrl || SITE_FALLBACK);
  const body = sections || (contentHtml ? section(contentHtml, { padTop: 34, padBottom: 30 }) : "");
  const helpLine = marketingFooter
    ? `Dúvida sobre um par? Chama no WhatsApp <a href="${escapeHtml(b.whatsappUrl)}" style="color:${YELLOW};text-decoration:none;">${escapeHtml(b.whatsappLabel)}</a>.`
    : `Enviado automaticamente por <a href="mailto:${escapeHtml(b.fromEmail)}" style="color:${YELLOW};text-decoration:none;">${escapeHtml(b.fromEmail)}</a> &mdash; este endereço não recebe respostas. Precisa de ajuda? ${b.replyEmail ? `<a href="mailto:${escapeHtml(b.replyEmail)}" style="color:${YELLOW};text-decoration:none;">${escapeHtml(b.replyEmail)}</a> ou ` : ""}WhatsApp <a href="${escapeHtml(b.whatsappUrl)}" style="color:${YELLOW};text-decoration:none;">${escapeHtml(b.whatsappLabel)}</a>.`;
  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(title)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style type="text/css">
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;}
  a{color:${YELLOW};}
  a:hover{color:#FFF07A;}
  @media only screen and (max-width:620px){
    .wrap{width:100% !important;}
    .pad{padding-left:20px !important;padding-right:20px !important;}
    .stack{display:block !important;width:100% !important;padding:0 0 24px 0 !important;}
    h1{font-size:34px !important;line-height:31px !important;letter-spacing:-1.2px !important;}
    .big{font-size:40px !important;line-height:40px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#0B0B0B;">
${preheader ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</span>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#0B0B0B" style="width:100%;background-color:#0B0B0B;">
<tr><td align="center" style="padding:0 0 40px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width:600px;max-width:600px;background-color:#0B0B0B;">
  <tr><td align="center" class="pad" style="padding:14px 28px 10px 28px;border-bottom:2px solid ${YELLOW};">
    <a href="${home}" style="text-decoration:none;"><img src="${home}/logo.png" alt="Kulture" width="160" height="90" style="display:block;width:160px;height:90px;max-width:160px;border:0;margin:0 auto;" /></a>
  </td></tr>
${ribbon ? `<tr><td bgcolor="${YELLOW}" align="center" style="background-color:${YELLOW};padding:12px 20px;font-family:${F};font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2.4px;text-transform:uppercase;color:#0B0B0B;">${ribbon}</td></tr>` : ""}
${body}
  <tr><td class="pad" style="padding:34px 28px 30px 28px;border-top:1px solid #262626;">
    <p style="margin:0 0 16px 0;font-family:${F};font-size:26px;line-height:24px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-1px;text-transform:uppercase;color:${YELLOW};">Kulture</p>
    <p style="margin:0 0 12px 0;font-family:${F};font-size:12px;line-height:20px;mso-line-height-rule:exactly;color:#8A8880;">${helpLine}</p>
    <p style="margin:0 0 14px 0;font-family:${F};font-size:10px;line-height:16px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">
      <a href="${home}" style="color:#7C7A73;text-decoration:none;">Loja</a> &nbsp;&nbsp;
      <a href="${escapeHtml(INSTAGRAM_URL)}" style="color:#7C7A73;text-decoration:none;">Instagram</a> &nbsp;&nbsp;
      <a href="${escapeHtml(b.whatsappUrl)}" style="color:#7C7A73;text-decoration:none;">WhatsApp</a>
    </p>
    ${b.companyLine ? `<p style="margin:0 0 ${footerHtml ? "10px" : "0"} 0;font-family:${F};font-size:11px;line-height:18px;mso-line-height-rule:exactly;color:#5C5A54;">${escapeHtml(b.companyLine)}</p>` : ""}
    ${footerHtml ? `<p style="margin:0;font-family:${F};font-size:11px;line-height:18px;mso-line-height-rule:exactly;color:#5C5A54;">${footerHtml}</p>` : ""}
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/** Texto corrido (quebras preservadas, links clicáveis) dentro da moldura — fallback para e-mails futuros sem modelo próprio. */
// eslint-disable-next-line no-unused-vars
const asHtml = (text, { siteUrl = "", title = "Kulture", preheader = "" } = {}) =>
  emailLayout({
    contentHtml: `<div style="white-space:pre-wrap;font-family:${F};font-size:15px;line-height:25px;color:#C9C6BE;">${linkify(escapeHtml(text))}</div>`,
    siteUrl,
    title,
    preheader
  });

/**
 * Campanha de marketing: mensagem em parágrafos (linha em branco separa), imagem opcional, botão opcional e
 * rodapé com o motivo + link de descadastro (obrigatório — LGPD e reputação do domínio).
 */
export function buildMarketingEmail({ subject, body, ctaLabel, ctaUrl, imageUrl, unsubscribeUrl, siteUrl, name = "" }) {
  const paragraphs = String(body || "").replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const hasCta = Boolean(ctaLabel && ctaUrl);
  const text = lines([
    name ? `Olá, ${name}!` : null,
    name ? "" : null,
    ...paragraphs.flatMap((p) => [p, ""]),
    hasCta ? `${ctaLabel}: ${ctaUrl}` : null,
    hasCta ? "" : null,
    "— Equipe Kulture",
    "",
    "Você recebe este e-mail porque comprou ou se cadastrou na Kulture.",
    unsubscribeUrl ? `Não quer mais receber novidades? Descadastre-se: ${unsubscribeUrl}` : null
  ]);
  const sections = [
    imageUrl
      ? section(`<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(subject || "")}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:1px solid #262626;" />`, { padTop: 30, padBottom: 26 })
      : "",
    section(
      [
        h1(escapeHtml(subject || "Novidade Kulture")),
        name ? para(`Olá ${strong(name)}, tudo bem?`) : "",
        ...paragraphs.map((p, i) => para(linkify(escapeHtml(p)).replace(/\n/g, "<br />"), { last: i === paragraphs.length - 1 && !hasCta }))
      ].join("\n"),
      { padTop: imageUrl ? 0 : 30, padBottom: hasCta ? 26 : 32 }
    ),
    hasCta ? section(ctaPrimary(ctaLabel, ctaUrl), { padBottom: 32 }) : ""
  ].join("\n");
  const footerHtml = `Você recebe este e-mail porque comprou ou se cadastrou na Kulture.${unsubscribeUrl ? ` <a href="${escapeHtml(unsubscribeUrl)}" style="color:#5C5A54;text-decoration:underline;">Não quero mais receber novidades</a>.` : ""}`;
  return { subject, text, html: emailLayout({ sections, footerHtml, marketingFooter: true, siteUrl, title: `${subject || "Novidade"} - Kulture`, preheader: paragraphs[0] || subject }) };
}

/** Link para redefinir a senha (esqueci a senha ou gerado pelo backoffice) — modelo 01. */
export function buildPasswordResetEmail({ name, link, expiresMin = 60, email = "", requestedAt = null, siteUrl = "" }) {
  const text = lines([
    `Olá, ${name || ""}!`.replace(", !", "!"),
    "",
    "Recebemos um pedido para redefinir a senha da sua conta Kulture.",
    "Use o link abaixo (vale por " + expiresMin + " minutos e só uma vez):",
    "",
    link,
    "",
    "Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.",
    "",
    "— Equipe Kulture"
  ]);
  const sections = [
    section(
      [
        kicker("Segurança da conta"),
        h1("Nova<br />senha"),
        para(`Olá ${name ? strong(name) : "!"}${name ? "," : ""} recebemos um pedido para redefinir a senha da sua conta. Crie a nova senha pelo botão abaixo.`, { last: true })
      ].join("\n"),
      { padTop: 34, padBottom: 26 }
    ),
    section(ctaPrimary("Criar nova senha", link)),
    section(dataCard([
      ["Conta", email || null],
      ["Solicitado em", fmtDateTime(requestedAt || new Date())],
      ["Validade do link", `${expiresMin} minutos`]
    ])),
    section(
      [
        para("Se o botão não funcionar, copie este endereço no navegador:"),
        `<p style="margin:0 0 20px 0;font-family:${F};font-size:12px;line-height:20px;word-break:break-all;color:${YELLOW};"><a href="${escapeHtml(link)}" style="color:${YELLOW};text-decoration:none;">${escapeHtml(link)}</a></p>`,
        callout("Não foi você que pediu? Ignore este e-mail. Sua senha atual continua válida e nada muda na sua conta.")
      ].join("\n"),
      { padBottom: 30 }
    )
  ].join("\n");
  const html = emailLayout({
    sections,
    siteUrl,
    title: "Redefinir senha - Kulture",
    preheader: `Link para criar uma nova senha na sua conta Kulture. Válido por ${expiresMin} minutos.`
  });
  return { subject: "Redefinir senha — Kulture", text, html };
}

/** Boas-vindas na criação da conta (cadastro no site ou no checkout) — modelo 02. */
export function buildWelcomeEmail({ name, email, createdAt = null, siteUrl = "" }) {
  const base = siteUrl || SITE_FALLBACK;
  const text = lines([
    `Olá, ${name || ""}!`.replace(", !", "!"),
    "",
    "Sua conta Kulture foi criada. Pedidos, endereços e rastreio agora ficam todos em um lugar só.",
    "",
    `Acesse: ${base}/conta`,
    "",
    "O que você ganha:",
    "• Frete grátis — para todo o Brasil, já incluso no preço.",
    "• Drops antes do feed — você sabe do lançamento antes de ir para o Instagram.",
    "• Acompanhamento completo — cada etapa do pedido, da compra à entrega, na sua conta e no seu e-mail.",
    "",
    "— Equipe Kulture"
  ]);
  const sections = [
    section(
      [
        kicker("Conta criada"),
        h1("Bem-vindo<br />ao time"),
        para(`Olá ${name ? strong(name) : "!"}${name ? ", tudo bem?" : ""} Sua conta foi criada. Pedidos, endereços e rastreio agora ficam todos em um lugar só.`, { last: true })
      ].join("\n"),
      { padTop: 34, padBottom: 26 }
    ),
    section(dataCard([
      ["E-mail de acesso", email || null],
      ["Criada em", fmtDateTime(createdAt || new Date())]
    ])),
    section(ctaPrimary("Acessar minha conta", `${base}/conta`), { padBottom: 30 }),
    section(
      [
        kicker("O que você ganha"),
        numberedList([
          { title: "Frete grátis", desc: "Para todo o Brasil, já incluso no preço — sem surpresa na entrega." },
          { title: "Drops antes do feed", desc: "Você sabe do lançamento antes de ir para o Instagram." },
          { title: "Acompanhamento completo", desc: "Cada etapa do pedido — da compra à entrega — na sua conta e no seu e-mail." }
        ])
      ].join("\n"),
      { padBottom: 30 }
    )
  ].join("\n");
  const html = emailLayout({
    sections,
    siteUrl,
    ribbon: "Original, com nota &nbsp;&middot;&nbsp; sem taxa na entrega &nbsp;&middot;&nbsp; numeração conferida",
    title: "Bem-vindo à Kulture",
    preheader: "Sua conta Kulture está criada. Veja o que já dá para fazer com ela."
  });
  return { subject: "Bem-vindo à Kulture 🖤💛", text, html };
}

/** Endereço do pedido em linhas HTML (ou null). */
function addressHtml(a) {
  if (!a || typeof a !== "object") return null;
  const l1 = [[a.street, a.number].filter(Boolean).join(", "), a.complement].filter(Boolean).join(" — ");
  const l3 = [a.city && a.state ? `${a.city}/${a.state}` : a.city || a.state || null, a.cep ? `CEP ${a.cep}` : null].filter(Boolean).join(" · ");
  const out = [l1, a.neighborhood, l3].filter((s) => s && String(s).trim());
  return out.length ? out.map((s) => escapeHtml(s)).join("<br />") : null;
}

/** Etapas reais do pedido para a linha do tempo (importado tem as etapas internacionais). */
function orderSteps(order, current) {
  const defs = isInternationalOrder(order)
    ? [
        ["created", "Pedido confirmado", order.createdAt],
        ["paid", "Pagamento aprovado", order.paidAt],
        ["sourcing", "Comprado nos EUA", null],
        ["in_transit", "Trânsito internacional", null],
        ["arrived_br", "Chegou no Brasil", null],
        ["shipped", "Enviado pro seu endereço", order.shippedAt],
        ["delivered", "Entregue", order.deliveredAt]
      ]
    : [
        ["created", "Pedido confirmado", order.createdAt],
        ["paid", "Pagamento aprovado", order.paidAt],
        ["separation", "Em separação", null],
        ["shipped", "Enviado pro seu endereço", order.shippedAt],
        ["delivered", "Entregue", order.deliveredAt]
      ];
  const idx = Math.max(0, defs.findIndex(([k]) => k === current));
  return defs.map(([, label, date], i) => ({ label, date: fmtDate(date), state: i < idx ? "done" : i === idx ? "current" : "future" }));
}

/** Moldura comum dos e-mails de acompanhamento (modelo 05): badge + H1 + cartão + linha do tempo + CTA. */
function statusEmailHtml(order, { siteUrl = "", heading, currentStep, intro, note, preheader, title }) {
  const base = siteUrl || SITE_FALLBACK;
  const trackUrl = order.trackingUrl || `${base}/pedido/confirmacao/${order.number}`;
  const sections = [
    section(
      [badge(`Pedido ${order.number}`), h1(heading), para(`Olá ${strong(order.customerName || "")}, ${escapeHtml(intro)}`, { last: true })].join("\n"),
      { padTop: 34, padBottom: 26 }
    ),
    section(dataCard([
      ["Transportadora", order.carrier || null],
      ["Código de rastreio", order.trackingCode || null],
      ["Entregar em", { html: addressHtml(order.address) }]
    ])),
    section([kicker("Linha do tempo"), timeline(orderSteps(order, currentStep))].join("\n")),
    section(ctaPrimary("Acompanhar pedido", trackUrl)),
    note ? section(callout(note), { padBottom: 30 }) : ""
  ].join("\n");
  return emailLayout({
    sections,
    siteUrl,
    ribbon: "Acompanhamento do pedido",
    title: title || "Atualização de entrega - Kulture",
    preheader: preheader || `Pedido ${order.number}: atualização de entrega.`
  });
}

/** Pedido enviado: código de rastreio para o cliente. */
export function buildOrderShippedEmail(order, { siteUrl } = {}) {
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    `Seu pedido ${order.number} foi enviado pro seu endereço. 📦`,
    "",
    order.carrier ? `Transportadora: ${order.carrier}` : null,
    order.trackingCode ? `Código de rastreio: ${order.trackingCode}` : null,
    order.trackingUrl ? `Acompanhe: ${order.trackingUrl}` : null,
    "",
    "Itens:",
    (order.items || []).map((i) => `• ${i.name} — tam. ${sizeLabel(i)} × ${i.quantity}${customLine(i)}`).join("\n"),
    "",
    siteUrl ? `Veja seus pedidos em: ${siteUrl}/conta` : null,
    "",
    "— Equipe Kulture"
  ]);
  const html = statusEmailHtml(order, {
    siteUrl,
    heading: "Enviado pro<br />seu endereço",
    currentStep: "shipped",
    intro: "seu par saiu para o seu endereço. 📦 Acompanhe abaixo o caminho dele até você.",
    note: "Ninguém no endereço na hora da entrega? A transportadora tenta de novo antes de devolver o pacote — qualquer coisa, chama a gente no WhatsApp.",
    preheader: `Pedido ${order.number}: seu par foi enviado pro seu endereço.`
  });
  return { subject: `Pedido ${order.number} enviado — Kulture`, text, html };
}

/** Pedido entregue. */
export function buildOrderDeliveredEmail(order, { siteUrl } = {}) {
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    `Seu pedido ${order.number} consta como entregue. 🎉`,
    "",
    "Esperamos que tenha curtido o par. Qualquer problema, responda este e-mail ou fale com a gente no WhatsApp.",
    siteUrl ? `Seus pedidos: ${siteUrl}/conta` : null,
    "",
    "— Equipe Kulture"
  ]);
  const html = statusEmailHtml(order, {
    siteUrl,
    heading: "Entregue 🎉",
    currentStep: "delivered",
    intro: "seu pedido consta como entregue. Esperamos que tenha curtido o par!",
    note: "Algum problema com o par ou a numeração? Fala com a gente no WhatsApp que resolvemos.",
    preheader: `Pedido ${order.number}: entregue. Aproveite o par!`
  });
  return { subject: `Pedido ${order.number} entregue — Kulture`, text, html };
}

/** Pedido cancelado / estornado. */
export function buildOrderCancelledEmail(order, { siteUrl, refunded = false } = {}) {
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    refunded
      ? `O pedido ${order.number} foi estornado. O valor de ${brl(order.paidAmountBrl ?? order.totalBrl)} volta pelo mesmo meio de pagamento, no prazo da operadora.`
      : `O pedido ${order.number} foi cancelado.`,
    "",
    "Se tiver qualquer dúvida, responda este e-mail ou fale com a gente no WhatsApp.",
    siteUrl ? `Loja: ${siteUrl}` : null,
    "",
    "— Equipe Kulture"
  ]);
  const sections = [
    section(
      [
        badge(`Pedido ${order.number}`),
        h1(refunded ? "Pedido<br />estornado" : "Pedido<br />cancelado"),
        para(
          `Olá ${strong(order.customerName || "")}, ${
            refunded
              ? `o pedido foi estornado. O valor de ${strong(brl(order.paidAmountBrl ?? order.totalBrl))} volta pelo mesmo meio de pagamento, no prazo da operadora.`
              : "o pedido foi cancelado. Se não foi você que pediu, ou se quiser refazer a compra, é só chamar a gente."
          }`,
          { last: true }
        )
      ].join("\n"),
      { padTop: 34, padBottom: 26 }
    ),
    section(callout("Qualquer dúvida, responda este e-mail ou fale com a gente no WhatsApp — resolvemos rapidinho."), { padBottom: 30 })
  ].join("\n");
  const html = emailLayout({
    sections,
    siteUrl,
    title: `Pedido ${refunded ? "estornado" : "cancelado"} - Kulture`,
    preheader: `Pedido ${order.number} ${refunded ? "estornado — o valor volta pelo mesmo meio de pagamento" : "cancelado"}.`
  });
  return { subject: `Pedido ${order.number} ${refunded ? "estornado" : "cancelado"} — Kulture`, text, html };
}

/**
 * E-mails das etapas intermediárias do importado (o cliente acompanha o par a cada passo):
 *   sourcing   → Pedido comprado na loja oficial nos EUA
 *   in_transit → Em trânsito internacional
 *   arrived_br → Chegou no Brasil
 */
const hasHypados = (order) => (order?.items || []).some((i) => i?.breakdown?.section === "hypados");
const STAGE_COPY = {
  sourcing: {
    subject: (n) => `Pedido ${n}: compramos o seu par 🛒 — Kulture`,
    title: "Seu par foi comprado na loja oficial nos EUA. 🛒",
    titleHypados: "Seu par foi garimpado nos EUA pelos contatos Kulture. 🛒",
    body: "Agora ele segue para o trânsito internacional até o Brasil. Te avisamos assim que embarcar.",
    next: "Próxima etapa: em trânsito internacional."
  },
  in_transit: {
    subject: (n) => `Pedido ${n}: em trânsito internacional ✈️ — Kulture`,
    title: "Seu par saiu dos EUA e está em trânsito internacional. ✈️",
    body: "Essa etapa inclui o voo e a liberação na alfândega. Você não paga nada a mais — o preço já é final.",
    next: "Próxima etapa: chegou no Brasil."
  },
  arrived_br: {
    subject: (n) => `Pedido ${n}: chegou no Brasil 🇧🇷 — Kulture`,
    title: "Seu par chegou no Brasil! 🇧🇷",
    body: "Estamos preparando o envio para o seu endereço. Você recebe o código de rastreio assim que ele sair.",
    next: "Próxima etapa: enviado pro seu endereço."
  }
};
export function buildOrderStageEmail(order, stage, { siteUrl } = {}) {
  const c = STAGE_COPY[stage] || STAGE_COPY.sourcing;
  const title = c.titleHypados && hasHypados(order) ? c.titleHypados : c.title;
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    `${title} (pedido ${order.number})`,
    "",
    c.body,
    "",
    "Itens:",
    (order.items || []).map((i) => `• ${i.name} — tam. ${sizeLabel(i)} × ${i.quantity}${customLine(i)}`).join("\n"),
    "",
    c.next,
    siteUrl ? `Acompanhe cada etapa em: ${siteUrl}/conta` : null,
    "",
    "— Equipe Kulture"
  ]);
  const headings = {
    sourcing: hasHypados(order) ? "Par garimpado<br />nos EUA" : "Par comprado<br />nos EUA",
    in_transit: "Em trânsito<br />internacional",
    arrived_br: "Chegou<br />no Brasil"
  };
  const html = statusEmailHtml(order, {
    siteUrl,
    heading: headings[stage] || headings.sourcing,
    currentStep: stage,
    intro: `${title.replace(/\s*[🛒✈️🇧🇷]+\s*$/u, "").replace(/^Seu par/, "seu par")} ${c.body}`,
    note: c.next,
    preheader: `Pedido ${order.number}: ${title.replace(/\s*[🛒✈️🇧🇷]+\s*$/u, "")}`
  });
  return { subject: c.subject(order.number), text, html };
}

/** E-mail de confirmação de pagamento para o cliente. */
export function buildOrderPaidEmail(order, { siteUrl } = {}) {
  const items = (order.items || [])
    .map((i) => `• ${i.name} — tam. ${sizeLabel(i)} × ${i.quantity} — ${brl(i.unitPriceBrl)}${customLine(i)}`)
    .join("\n");
  const method = order.paymentMethod === "pix" ? "Pix" : order.paymentMethod === "credit_card" ? "Cartão" : order.paymentMethod || "-";
  const text = [
    `Olá, ${order.customerName}!`,
    "",
    `Recebemos o pagamento do seu pedido ${order.number}. 🎉`,
    "",
    "Itens:",
    items,
    "",
    `Frete: Grátis`,
    Number(order.discountBrl) > 0 ? `Desconto${order.couponCode ? ` (cupom ${order.couponCode})` : ""}: -${brl(order.discountBrl)}` : null,
    `Total: ${brl(order.totalBrl)}`,
    `Pagamento: ${method}`,
    order.receiptUrl ? `Comprovante: ${order.receiptUrl}` : null,
    "",
    isInternationalOrder(order)
      ? "Agora vamos buscar seu par nos EUA e te avisamos a cada etapa."
      : "Seu par já está separado no nosso estoque e sai pro seu endereço em breve.",
    siteUrl ? `Acompanhe em: ${siteUrl}` : null,
    "",
    "— Equipe Kulture"
  ]
    .filter((l) => l !== null)
    .join("\n");
  const intl = isInternationalOrder(order);
  const base = siteUrl || SITE_FALLBACK;
  const inst = order.installments > 1 ? ` em ${order.installments}x` : "";
  const sections = [
    section(
      [
        badge(`Pedido ${order.number}`),
        h1("Pedido<br />confirmado"),
        para(
          `Olá ${strong(order.customerName || "")}, tudo bem? Recebemos o pagamento e o pedido já está com a gente. ${
            intl ? "Agora vamos buscar seu par nos EUA e te avisamos a cada etapa." : "Seu par já está separado no estoque e sai pro seu endereço em breve."
          }`,
          { last: true }
        )
      ].join("\n"),
      { padTop: 34, padBottom: 24 }
    ),
    section([kicker("Os pares"), itemRows(order.items, { siteUrl: base })].join("\n"), { padBottom: 24 }),
    section(totalsBlock(order), { padBottom: 24 }),
    section(dataCard([
      ["Entregar em", { html: addressHtml(order.address) }],
      ["Pagamento", `${method}${inst}`],
      ["Pago em", fmtDateTime(order.paidAt)]
    ])),
    section(ctaPrimary("Acompanhar pedido", `${base}/pedido/confirmacao/${order.number}`), { padBottom: order.receiptUrl ? 14 : 30 }),
    order.receiptUrl ? section(ctaOutline("Ver comprovante", order.receiptUrl), { padBottom: 30 }) : ""
  ].join("\n");
  const html = emailLayout({
    sections,
    siteUrl,
    title: "Pedido confirmado - Kulture",
    preheader: `Recebemos seu pedido ${order.number}. Aqui estão todos os detalhes.`
  });
  return { subject: `Pedido ${order.number} confirmado — Kulture`, text, html };
}

/** Comprovante do pagamento (modelo 04) — reenvio pelo painel (Pedidos → e-mails). */
export function buildPaymentReceiptEmail(order, { siteUrl } = {}) {
  const method = PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "-";
  const inst = order.installments > 1 ? `em ${order.installments}x` : "à vista";
  const paid = order.paidAmountBrl ?? order.totalBrl;
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    `O pagamento do pedido ${order.number} foi aprovado. Guarde este e-mail: ele vale como comprovante da transação.`,
    "",
    `Valor pago: ${brl(paid)} (${method} · ${inst})`,
    fmtDateTime(order.paidAt) ? `Data do pagamento: ${fmtDateTime(order.paidAt)}` : null,
    order.transactionNsu ? `Autorização/NSU: ${order.transactionNsu}` : null,
    order.receiptUrl ? `Comprovante: ${order.receiptUrl}` : null,
    "",
    "— Equipe Kulture"
  ]);
  const sections = [
    section(
      [
        badge(`Comprovante · Pedido ${order.number}`),
        h1("Pagamento<br />aprovado"),
        para(`Olá ${strong(order.customerName || "")}, o pagamento do seu pedido foi aprovado. Guarde este e-mail: ele vale como comprovante da transação.`, { last: true })
      ].join("\n"),
      { padTop: 34, padBottom: 26 }
    ),
    section(bigValueCard({ label: "Valor pago", value: brl(paid), note: `${method} · ${inst}` })),
    section(dataCard([
      ["Data do pagamento", fmtDateTime(order.paidAt)],
      ["Pedido", order.number],
      ["Titular", order.customerName || null],
      ["CPF", fmtCpf(order.customerCpf)],
      ["Autorização / NSU", order.transactionNsu || null],
      ["Status", "Aprovado"]
    ])),
    order.receiptUrl ? section(ctaPrimary("Baixar comprovante", order.receiptUrl), { padBottom: 14 }) : "",
    section(callout("A nota fiscal eletrônica sai no CPF do comprador e chega neste mesmo e-mail."), { padBottom: 30 })
  ].join("\n");
  const html = emailLayout({
    sections,
    siteUrl,
    ribbon: "Nota fiscal no CPF do comprador &nbsp;&middot;&nbsp; comprovante de autenticidade",
    title: "Pagamento aprovado - Comprovante Kulture",
    preheader: `Pagamento do pedido ${order.number} aprovado. Guarde este comprovante.`
  });
  return { subject: `Comprovante de pagamento — pedido ${order.number} — Kulture`, text, html };
}

/** Rótulo da forma de pagamento (inclui as formas de venda fora do site). */
export const PAYMENT_METHOD_LABELS = {
  pix: "Pix",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  cash: "Dinheiro",
  transfer: "Transferência",
  other: "Outro"
};

/**
 * Venda registrada pelo backoffice (feita fora do site — WhatsApp, Instagram, presencial…): avisa o cliente
 * que o pedido existe no site e como acompanhar (conta com o mesmo e-mail ou "rastrear pedido" pelo número).
 */
export function buildOrderRegisteredEmail(order, { siteUrl } = {}) {
  const items = (order.items || [])
    .map((i) => `• ${i.name} — tam. ${sizeLabel(i)} × ${i.quantity} — ${brl(i.unitPriceBrl)}${customLine(i)}`)
    .join("\n");
  const method = PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "-";
  const inst = order.installments > 1 ? ` em ${order.installments}x` : "";
  const status = order.status;
  const stage =
    status === "delivered" ? "Consta como entregue. 🎉"
    : status === "shipped" ? `Já foi enviado${order.trackingCode ? ` — ${order.carrier ? `${order.carrier} ` : ""}${order.trackingCode}` : ""}.`
    : status === "arrived_br" ? "Seu par já chegou no Brasil — em breve sai para o seu endereço."
    : status === "in_transit" ? "Seu par está em trânsito internacional (EUA → Brasil)."
    : status === "sourcing" ? "Seu par já foi comprado na loja oficial nos EUA."
    : "Pagamento aprovado — vamos te avisar a cada etapa.";
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    `Registramos sua compra com a Kulture como o pedido ${order.number}. ✅`,
    "",
    "Itens:",
    items,
    "",
    "Frete: Grátis",
    Number(order.discountBrl) > 0 ? `Desconto${order.couponCode ? ` (cupom ${order.couponCode})` : ""}: -${brl(order.discountBrl)}` : null,
    `Total: ${brl(order.totalBrl)}`,
    `Pagamento: ${method}${inst}`,
    order.receiptUrl ? `Comprovante: ${order.receiptUrl}` : null,
    "",
    `Situação: ${stage}`,
    order.trackingUrl ? `Rastreio: ${order.trackingUrl}` : null,
    "",
    siteUrl ? `Acompanhe pelo site: ${siteUrl}/conta (entre ou crie sua conta com este e-mail — o pedido aparece em "Meus pedidos")` : null,
    siteUrl ? `Ou rastreie pelo número do pedido em ${siteUrl} (Conta → Rastrear pedido).` : null,
    "",
    "Qualquer dúvida, responda este e-mail ou fale com a gente no WhatsApp.",
    "",
    "— Equipe Kulture"
  ]);
  const base = siteUrl || SITE_FALLBACK;
  const sections = [
    section(
      [
        badge(`Pedido ${order.number}`),
        h1("Compra<br />registrada"),
        para(`Olá ${strong(order.customerName || "")}, tudo bem? Registramos sua compra com a Kulture como o pedido ${strong(order.number)}. ✅`, { last: true })
      ].join("\n"),
      { padTop: 34, padBottom: 24 }
    ),
    section([kicker("Os pares"), itemRows(order.items, { siteUrl: base })].join("\n"), { padBottom: 24 }),
    section(totalsBlock(order), { padBottom: 28 }),
    section(dataCard([
      ["Situação", stage],
      ["Pagamento", `${method}${inst}`],
      ["Entregar em", { html: addressHtml(order.address) }],
      order.trackingCode ? ["Rastreio", `${order.carrier ? `${order.carrier} ` : ""}${order.trackingCode}`] : ["Rastreio", null]
    ])),
    section(ctaPrimary("Acompanhar pelo site", `${base}/conta`), { padBottom: 14 }),
    section(callout("Entre (ou crie sua conta) com este mesmo e-mail — o pedido aparece em “Meus pedidos”. Dá também para rastrear pelo número em Conta → Rastrear pedido."), { padBottom: 30 })
  ].join("\n");
  const html = emailLayout({
    sections,
    siteUrl,
    title: "Pedido registrado - Kulture",
    preheader: `Registramos sua compra como o pedido ${order.number}.`
  });
  return { subject: `Pedido ${order.number} registrado — Kulture`, text, html };
}

/** E-mail com a nota fiscal (PDF e XML anexos) — disparado pelo painel (ou pela emissão automática, quando existir). */
export function buildInvoiceEmail(order, invoice, { siteUrl } = {}) {
  const n = invoice?.number ? `nº ${invoice.number}${invoice.series ? ` (série ${invoice.series})` : ""}` : "";
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    `Segue a nota fiscal ${n ? `${n} ` : ""}do seu pedido ${order.number}. 🧾`,
    "",
    invoice?.accessKey ? `Chave de acesso: ${invoice.accessKey}` : null,
    invoice?.issuedAt ? `Emitida em: ${new Date(invoice.issuedAt).toLocaleDateString("pt-BR")}` : null,
    invoice?.externalUrl ? `Consultar: ${invoice.externalUrl}` : null,
    "",
    "O PDF (DANFE)" + (invoice?.xmlData ? " e o XML vão" : " vai") + " em anexo. Guarde para garantia e eventuais trocas.",
    siteUrl ? `Ela também fica disponível em: ${siteUrl}/conta` : null,
    "",
    "— Equipe Kulture"
  ]);
  const base = siteUrl || SITE_FALLBACK;
  const sections = [
    section(
      [
        badge(`Pedido ${order.number}`),
        h1("Sua nota<br />fiscal"),
        para(`Olá ${strong(order.customerName || "")}, segue a nota fiscal ${n ? `${escapeHtml(n)} ` : ""}do seu pedido. 🧾`, { last: true })
      ].join("\n"),
      { padTop: 34, padBottom: 26 }
    ),
    section(dataCard([
      ["Nota fiscal", invoice?.number ? `nº ${invoice.number}${invoice.series ? ` · série ${invoice.series}` : ""}` : null],
      ["Chave de acesso", invoice?.accessKey ? { html: `<span style="word-break:break-all;">${escapeHtml(invoice.accessKey)}</span>` } : null],
      ["Emitida em", fmtDate(invoice?.issuedAt)]
    ])),
    section(callout(`O PDF (DANFE)${invoice?.xmlData ? " e o XML vão" : " vai"} em anexo. Guarde para garantia e eventuais trocas.`)),
    section(ctaOutline("Ver na minha conta", `${base}/conta`), { padBottom: 30 })
  ].join("\n");
  const html = emailLayout({
    sections,
    siteUrl,
    ribbon: "Nota fiscal no CPF do comprador",
    title: "Nota fiscal - Kulture",
    preheader: `Nota fiscal do pedido ${order.number} em anexo.`
  });
  return { subject: `Nota fiscal do pedido ${order.number} — Kulture`, text, html };
}
