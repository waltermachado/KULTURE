/**
 * E-mail transacional. Provedores por env MAIL_PROVIDER:
 *   - log        → só registra no log (padrão em dev/test)
 *   - mailersend → API HTTP da MailerSend (POST https://api.mailersend.com/v1/email, Bearer MAILERSEND_API_TOKEN)
 *
 * Nunca lança para o chamador: falha de e-mail não pode derrubar checkout/confirmação.
 * Observação MailerSend: o domínio do MAIL_FROM precisa estar verificado na conta; em trial,
 * só envia para o e-mail do administrador da conta.
 */
export function createMailer(env, log) {
  const provider = env.MAIL_PROVIDER || "log";
  const from = { email: env.MAIL_FROM || "no-reply@localhost", name: env.MAIL_FROM_NAME || "Kulture" };

  async function viaLog(msg) {
    log?.info({ mail: { to: msg.to, subject: msg.subject } }, "mail(log): e-mail simulado");
    return { ok: true, provider: "log" };
  }

  async function viaMailerSend(msg) {
    if (!env.MAILERSEND_API_TOKEN) throw new Error("MAILERSEND_API_TOKEN ausente");
    const res = await fetch(`${env.MAILERSEND_API_BASE || "https://api.mailersend.com/v1"}/email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.MAILERSEND_API_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        from,
        to: [{ email: msg.to, name: msg.toName || undefined }],
        subject: msg.subject,
        text: msg.text,
        html: msg.html || undefined
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok && res.status !== 202) {
      const body = await res.text().catch(() => "");
      throw new Error(`MailerSend ${res.status}: ${body.slice(0, 300)}`);
    }
    return { ok: true, provider: "mailersend", messageId: res.headers.get("x-message-id") };
  }

  /** @param {{to:string, toName?:string, subject:string, text:string, html?:string}} msg */
  async function send(msg) {
    if (!msg?.to) return { ok: false, skipped: "sem destinatário" };
    try {
      return provider === "mailersend" ? await viaMailerSend(msg) : await viaLog(msg);
    } catch (err) {
      log?.warn({ err: err.message, to: msg.to, subject: msg.subject }, "mail: falha ao enviar (ignorada)");
      return { ok: false, error: err.message };
    }
  }

  return { send, provider };
}

const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** "BR 41 (US 8.5)" — sem o US quando o item é de pronta entrega sem numeração US (chave = BR). */
const sizeLabel = (i) => {
  if (i.sizeLabel) return i.sizeLabel; // "BR 38 (US M 7)" — como o cliente escolheu (masc./fem./infantil)
  const br = i.brLabel ?? i.brSize ?? "?";
  return i.nikeSize && String(i.nikeSize) !== String(br) ? `BR ${br} (US ${i.nikeSize})` : `BR ${br}`;
};
/** Nike By You: gravação por pé, quando houver. */
const customLine = (i) => {
  const c = i.customization;
  if (!c || typeof c !== "object") return "";
  const foot = (t, n, lbl) => { const p = []; if (t) p.push(`“${t}”`); if (n) p.push(`nº ${n}`); return p.length ? `pé ${lbl} ${p.join(" ")}` : null; };
  const parts = [foot(c.textLeft, c.numberLeft, "E"), foot(c.textRight, c.numberRight, "D")].filter(Boolean);
  return parts.length ? ` — By You: ${parts.join(" · ")}` : " — By You";
};

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const asHtml = (text) =>
  `<pre style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
const lines = (arr) => arr.filter((l) => l !== null && l !== undefined && l !== false).join("\n");

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
    `Seu pedido ${order.number} foi enviado. 📦`,
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
  return { subject: `Pedido ${order.number} enviado — Kulture`, text, html: asHtml(text) };
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
  return { subject: `Pedido ${order.number} entregue — Kulture`, text, html: asHtml(text) };
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
  return { subject: `Pedido ${order.number} ${refunded ? "estornado" : "cancelado"} — Kulture`, text, html: asHtml(text) };
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
  const html = `<pre style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;
  return { subject: `Pedido ${order.number} confirmado — Kulture`, text, html };
}
