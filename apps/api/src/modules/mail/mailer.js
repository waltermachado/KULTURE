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

/** E-mail de confirmação de pagamento para o cliente. */
export function buildOrderPaidEmail(order, { siteUrl } = {}) {
  const items = (order.items || [])
    .map((i) => `• ${i.name} — tam. BR ${i.brLabel ?? i.brSize ?? "?"} (US ${i.nikeSize}) × ${i.quantity} — ${brl(i.unitPriceBrl)}`)
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
