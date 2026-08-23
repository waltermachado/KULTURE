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
  escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:)])/g, (u) => `<a href="${u}" style="color:#F6B234;text-decoration:underline">${u}</a>`);
const lines = (arr) => arr.filter((l) => l !== null && l !== undefined && l !== false).join("\n");

/**
 * Moldura com a cara da loja (preto + amarelo) para TODOS os e-mails — transacionais e campanhas.
 * `contentHtml` já vem escapado/montado. Tabela + estilos inline: é o que funciona em Gmail/Outlook/iOS.
 */
export function emailLayout({ contentHtml, preheader = "", footerHtml = "", siteUrl = "" }) {
  const home = siteUrl ? escapeHtml(siteUrl) : null;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kulture</title></head>
<body style="margin:0;padding:0;background:#0B0B0B;color:#F2EFE9;font-family:Archivo,Inter,Arial,Helvetica,sans-serif">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0B0B0B">${escapeHtml(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0B"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#0E0E0E;border-top:4px solid #F6B234">
  <tr><td style="padding:22px 28px;border-bottom:1px solid #1C1C1C">
    ${home ? `<a href="${home}" style="text-decoration:none">` : ""}<span style="font-size:20px;font-weight:800;letter-spacing:.22em;color:#F6B234;text-transform:uppercase">Kulture</span>${home ? "</a>" : ""}
    <span style="font-size:11px;letter-spacing:.18em;color:#8A877F;text-transform:uppercase;float:right;padding-top:6px">Sneakers &amp; street culture</span>
  </td></tr>
  <tr><td style="padding:28px 28px 8px;font-size:15px;line-height:1.6;color:#F2EFE9">${contentHtml}</td></tr>
  <tr><td style="padding:18px 28px 26px;border-top:1px solid #1C1C1C;font-size:12px;line-height:1.6;color:#8A877F">
    ${footerHtml || `— Equipe Kulture${home ? ` · <a href="${home}" style="color:#8A877F">${home.replace(/^https?:\/\//, "")}</a>` : ""}`}
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

/** Texto corrido (quebras de linha preservadas, links clicáveis) dentro da moldura da loja. */
const asHtml = (text, { siteUrl = "" } = {}) =>
  emailLayout({ contentHtml: `<div style="white-space:pre-wrap;font-size:15px;line-height:1.6">${linkify(escapeHtml(text))}</div>`, siteUrl });

/** Botão amarelo (CTA) — tabela para o Outlook respeitar o fundo. */
const ctaButton = (label, url) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="background:#F6B234;border-radius:2px">
  <a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 26px;font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#0B0B0B;text-decoration:none">${escapeHtml(label)} &rarr;</a>
  </td></tr></table>`;

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
  const contentHtml = [
    imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;margin:0 0 22px;border:0" />` : "",
    name ? `<p style="margin:0 0 14px;font-size:15px">Olá, <b>${escapeHtml(name)}</b>!</p>` : "",
    ...paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`),
    hasCta ? ctaButton(ctaLabel, ctaUrl) : ""
  ].join("\n");
  const footerHtml = `Você recebe este e-mail porque comprou ou se cadastrou na Kulture.${unsubscribeUrl ? ` <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8A877F;text-decoration:underline">Não quero mais receber novidades</a>.` : ""}`;
  return { subject, text, html: emailLayout({ contentHtml, footerHtml, siteUrl, preheader: paragraphs[0] || subject }) };
}

/** Link para redefinir a senha (esqueci a senha ou gerado pelo backoffice). */
export function buildPasswordResetEmail({ name, link, expiresMin = 60 }) {
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
  return { subject: "Redefinir senha — Kulture", text, html: asHtml(text) };
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
  return { subject: `Pedido ${order.number} enviado — Kulture`, text, html: asHtml(text, { siteUrl }) };
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
  return { subject: `Pedido ${order.number} entregue — Kulture`, text, html: asHtml(text, { siteUrl }) };
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
  return { subject: `Pedido ${order.number} ${refunded ? "estornado" : "cancelado"} — Kulture`, text, html: asHtml(text, { siteUrl }) };
}

/**
 * E-mails das etapas intermediárias do importado (o cliente acompanha o par a cada passo):
 *   sourcing   → Pedido comprado na loja oficial nos EUA
 *   in_transit → Em trânsito internacional
 *   arrived_br → Chegou no Brasil
 */
const STAGE_COPY = {
  sourcing: {
    subject: (n) => `Pedido ${n}: compramos o seu par 🛒 — Kulture`,
    title: "Seu par foi comprado na loja oficial nos EUA. 🛒",
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
  const text = lines([
    `Olá, ${order.customerName}!`,
    "",
    `${c.title} (pedido ${order.number})`,
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
  return { subject: c.subject(order.number), text, html: asHtml(text, { siteUrl }) };
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
    "Agora vamos comprar seu par na loja oficial nos EUA e te avisamos a cada etapa.",
    siteUrl ? `Acompanhe em: ${siteUrl}` : null,
    "",
    "— Equipe Kulture"
  ]
    .filter((l) => l !== null)
    .join("\n");
  return { subject: `Pedido ${order.number} confirmado — Kulture`, text, html: asHtml(text, { siteUrl }) };
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
  return { subject: `Pedido ${order.number} registrado — Kulture`, text, html: asHtml(text, { siteUrl }) };
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
  return { subject: `Nota fiscal do pedido ${order.number} — Kulture`, text, html: asHtml(text, { siteUrl }) };
}
