/**
 * Marketing por e-mail — campanhas enviadas pelo backoffice (/admin/marketing) pelo mesmo mailer dos e-mails
 * transacionais (SMTP da MailerSend em produção).
 *
 *  - Público da campanha: contas com `users.marketing_opt_in` + e-mails de quem já comprou (inclusive convidado),
 *    menos a lista de descadastros (`marketing_unsubscribes`). Dedupe por e-mail.
 *  - Todo e-mail de campanha sai com link de descadastro assinado (HMAC do JWT_SECRET sobre o e-mail) e com o
 *    cabeçalho List-Unsubscribe (um clique no Gmail/Apple Mail). Descadastrar grava na tabela e desliga o opt-in
 *    da conta, se houver.
 *  - O envio roda em segundo plano (setImmediate), 2 de cada vez; a campanha guarda total/sent/failed e o último
 *    erro. Erro de autenticação SMTP interrompe a campanha (não adianta insistir).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../lib/errors.js";
import { buildMarketingEmail } from "../mail/mailer.js";
import { canonicalWebUrl } from "../../lib/site-url.js";

export const AUDIENCES = {
  all: "Todos — contas + quem já comprou",
  buyers: "Só quem já comprou",
  accounts: "Só contas cadastradas"
};
import { PAID_STATUSES as BOUGHT_STATUSES } from "../orders/status.js";
const CONCURRENCY = 2;
const MAX_BODY = 8000;

const normEmail = (e) => String(e ?? "").trim().toLowerCase();
const b64url = (s) => Buffer.from(String(s), "utf8").toString("base64url");
const fromB64url = (s) => { try { return Buffer.from(String(s), "base64url").toString("utf8"); } catch { return ""; } };
const isUrl = (u) => { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch { return false; } };

export function createMarketingService({ prisma, env, mailer, log }) {
  const running = new Set(); // campanhas em envio neste processo (evita disparo duplo)

  // ---- descadastro assinado ----
  function tokenFor(email) {
    return createHmac("sha256", env.JWT_SECRET).update(`unsub:${normEmail(email)}`).digest("base64url").slice(0, 32);
  }
  function unsubscribeUrl(email) {
    return `${canonicalWebUrl(env)}/api/marketing/unsubscribe?e=${b64url(normEmail(email))}&t=${tokenFor(email)}`;
  }
  function verifyToken(email, token) {
    const a = Buffer.from(tokenFor(email));
    const b = Buffer.from(String(token || ""));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Link clicado (ou POST one-click): grava o descadastro e desliga o opt-in da conta, se existir. */
  async function unsubscribe({ e, t, reason = "link" }) {
    const email = normEmail(fromB64url(e));
    if (!email || !email.includes("@") || !verifyToken(email, t)) throw AppError.badRequest("Link de descadastro inválido");
    await prisma.marketingUnsubscribe.upsert({ where: { email }, create: { email, reason }, update: { reason } });
    await prisma.user.updateMany({ where: { email }, data: { marketingOptIn: false } });
    log?.info({ email, reason }, "marketing: descadastro");
    return { ok: true, email };
  }

  /** Caixa em /conta: liga/desliga o opt-in e mantém a lista de descadastros coerente. */
  async function setOptIn(userId, optIn) {
    const user = await prisma.user.update({ where: { id: userId }, data: { marketingOptIn: Boolean(optIn) }, select: { email: true, marketingOptIn: true } });
    const email = normEmail(user.email);
    if (optIn) await prisma.marketingUnsubscribe.deleteMany({ where: { email } });
    else await prisma.marketingUnsubscribe.upsert({ where: { email }, create: { email, reason: "account" }, update: { reason: "account" } });
    return user;
  }

  // ---- público ----
  async function audience(kind = "all") {
    if (!AUDIENCES[kind]) throw AppError.badRequest("Público inválido");
    const [unsubs, optedOut] = await Promise.all([
      prisma.marketingUnsubscribe.findMany({ select: { email: true } }),
      prisma.user.findMany({ where: { marketingOptIn: false }, select: { email: true } })
    ]);
    const blocked = new Set([...unsubs, ...optedOut].map((r) => normEmail(r.email)));
    const byEmail = new Map();
    if (kind === "all" || kind === "accounts") {
      const users = await prisma.user.findMany({ where: { marketingOptIn: true }, select: { email: true, name: true } });
      for (const u of users) {
        const email = normEmail(u.email);
        if (email && !blocked.has(email)) byEmail.set(email, { email, name: u.name || "" });
      }
    }
    if (kind === "all" || kind === "buyers") {
      const orders = await prisma.order.findMany({
        where: { status: { in: BOUGHT_STATUSES } },
        select: { customerEmail: true, customerName: true },
        orderBy: { createdAt: "desc" },
        distinct: ["customerEmail"]
      });
      for (const o of orders) {
        const email = normEmail(o.customerEmail);
        if (email && !blocked.has(email) && !byEmail.has(email)) byEmail.set(email, { email, name: o.customerName || "" });
      }
    }
    return [...byEmail.values()];
  }

  async function audienceCounts() {
    const [all, buyers, accounts, unsubscribed] = await Promise.all([
      audience("all"), audience("buyers"), audience("accounts"), prisma.marketingUnsubscribe.count()
    ]);
    return { all: all.length, buyers: buyers.length, accounts: accounts.length, unsubscribed };
  }

  // ---- campanhas ----
  function normalizeCampaign(body = {}) {
    const subject = String(body.subject ?? "").trim();
    const text = String(body.body ?? "").replace(/\r\n/g, "\n").trim();
    const ctaLabel = String(body.ctaLabel ?? "").trim() || null;
    const ctaUrl = String(body.ctaUrl ?? "").trim() || null;
    const imageUrl = String(body.imageUrl ?? "").trim() || null;
    const audienceKind = AUDIENCES[body.audience] ? body.audience : "all";
    if (!subject) throw AppError.badRequest("Assunto é obrigatório");
    if (subject.length > 150) throw AppError.badRequest("Assunto: no máximo 150 caracteres");
    if (!text) throw AppError.badRequest("Mensagem é obrigatória");
    if (text.length > MAX_BODY) throw AppError.badRequest(`Mensagem: no máximo ${MAX_BODY} caracteres`);
    if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) throw AppError.badRequest("Botão: informe texto e link (ou nenhum dos dois)");
    if (ctaUrl && !isUrl(ctaUrl)) throw AppError.badRequest("Link do botão inválido (use http:// ou https://)");
    if (imageUrl && !isUrl(imageUrl)) throw AppError.badRequest("Link da imagem inválido (use http:// ou https://)");
    return { subject, body: text, ctaLabel, ctaUrl, imageUrl, audience: audienceKind };
  }

  function render(campaign, recipient) {
    return buildMarketingEmail({
      subject: campaign.subject,
      body: campaign.body,
      ctaLabel: campaign.ctaLabel,
      ctaUrl: campaign.ctaUrl,
      imageUrl: campaign.imageUrl,
      unsubscribeUrl: unsubscribeUrl(recipient.email),
      siteUrl: canonicalWebUrl(env),
      name: String(recipient.name || "").trim().split(/\s+/)[0] || ""
    });
  }

  /** HTML de prévia (iframe no painel). */
  function preview(body, who = { email: "cliente@exemplo.com", name: "Cliente" }) {
    const c = normalizeCampaign(body);
    return { ...render(c, who), campaign: c };
  }

  /** Envia a campanha só para um e-mail (o admin testa na própria caixa antes de disparar). */
  async function sendTest(body, to, name = "") {
    const c = normalizeCampaign(body);
    const email = normEmail(to);
    if (!email.includes("@")) throw AppError.badRequest("E-mail de teste inválido");
    const mail = render(c, { email, name });
    const subject = `[TESTE] ${mail.subject}`;
    const result = await mailer.send({ to: email, toName: name || undefined, ...mail, subject, unsubscribeUrl: unsubscribeUrl(email), headers: { "X-Kulture-Campaign": "test" } });
    return { ...result, to: email, subject };
  }

  async function createCampaign(body, createdBy = null) {
    const c = normalizeCampaign(body);
    const total = (await audience(c.audience)).length;
    return prisma.marketingCampaign.create({ data: { ...c, total, createdBy } });
  }

  async function listCampaigns() {
    return prisma.marketingCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  async function getCampaign(id) {
    const c = await prisma.marketingCampaign.findUnique({ where: { id } });
    if (!c) throw AppError.notFound("Campanha não encontrada");
    return c;
  }

  /** Marca como "sending" e dispara em segundo plano. Só campanhas em rascunho ou que falharam. */
  async function startCampaign(id) {
    const c = await getCampaign(id);
    if (!["draft", "failed"].includes(c.status) || running.has(id)) throw AppError.badRequest(`Campanha já ${c.status === "sent" ? "enviada" : "em envio"}`);
    // com MAIL_PROVIDER=log nada sai de verdade — melhor recusar do que marcar "enviada" sem ninguém receber
    if (mailer.provider === "log") throw AppError.badRequest("E-mail não configurado (MAIL_PROVIDER=log): configure o SMTP da MailerSend antes de disparar");
    const recipients = await audience(c.audience);
    if (!recipients.length) throw AppError.badRequest("Ninguém no público escolhido (todos descadastrados ou lista vazia)");
    const updated = await prisma.marketingCampaign.update({
      where: { id },
      data: { status: "sending", total: recipients.length, sent: 0, failed: 0, lastError: null, errors: [], provider: mailer.provider, startedAt: new Date(), finishedAt: null }
    });
    running.add(id);
    setImmediate(() => runCampaign(updated, recipients).catch((err) => log?.error({ err: err.message, id }, "marketing: campanha falhou")).finally(() => running.delete(id)));
    return updated;
  }

  async function runCampaign(campaign, recipients) {
    let sent = 0, failed = 0, lastError = null, abort = false;
    const errors = []; // primeiras 50 falhas, para o painel
    const queue = [...recipients];
    const flush = () => prisma.marketingCampaign.update({ where: { id: campaign.id }, data: { sent, failed, lastError, errors } }).catch(() => {});
    const worker = async () => {
      while (queue.length && !abort) {
        const r = queue.shift();
        const mail = render(campaign, r);
        const res = await mailer.send({ to: r.email, toName: r.name || undefined, ...mail, unsubscribeUrl: unsubscribeUrl(r.email), headers: { "X-Kulture-Campaign": campaign.id } });
        if (res?.ok) sent += 1;
        else {
          failed += 1;
          lastError = res?.error || res?.skipped || "falha desconhecida";
          if (errors.length < 50) errors.push({ email: r.email, error: String(lastError).slice(0, 300) });
          log?.warn({ id: campaign.id, to: r.email, err: lastError }, "marketing: e-mail recusado");
          // credencial errada / conta bloqueada: parar em vez de falhar 200 vezes
          if (/auth|535|login|credential|invalid.*password/i.test(lastError)) abort = true;
        }
        if ((sent + failed) % 10 === 0) await flush();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, recipients.length) }, worker));
    const status = sent > 0 && !abort ? "sent" : "failed";
    await prisma.marketingCampaign.update({
      where: { id: campaign.id },
      data: { sent, failed, lastError, errors, status, finishedAt: new Date() }
    });
    log?.info({ id: campaign.id, sent, failed, status }, "marketing: campanha concluída");
  }

  return { AUDIENCES, unsubscribeUrl, unsubscribe, setOptIn, audience, audienceCounts, preview, sendTest, createCampaign, listCampaigns, getCampaign, startCampaign };
}

/** Página simples (HTML) mostrada ao clicar no link de descadastro. */
export function unsubscribePage({ ok, email, siteUrl }) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const title = ok ? "Pronto, você não receberá mais novidades" : "Link inválido";
  const text = ok
    ? `O e-mail <b>${esc(email)}</b> foi removido da nossa lista de novidades e promoções. E-mails sobre os seus pedidos continuam normalmente. Mudou de ideia? Ligue de novo em “Minha conta”.`
    : "Esse link de descadastro não é válido ou já expirou. Se quiser parar de receber novidades, responda qualquer e-mail nosso ou ajuste em “Minha conta”.";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Kulture</title></head>
<body style="margin:0;background:#0B0B0B;color:#F2EFE9;font-family:Archivo,Inter,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:56px 24px">
<div style="font-size:20px;font-weight:800;letter-spacing:.22em;color:#F6B234;text-transform:uppercase;margin-bottom:28px">Kulture</div>
<h1 style="font-size:28px;line-height:1.1;margin:0 0 16px">${esc(title)}</h1>
<p style="font-size:15px;line-height:1.6;color:#C9C5BC">${text}</p>
${siteUrl ? `<p style="margin-top:28px"><a href="${esc(siteUrl)}" style="display:inline-block;background:#F6B234;color:#0B0B0B;padding:14px 22px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;font-size:12px">Voltar para a loja</a></p>` : ""}
</div></body></html>`;
}
