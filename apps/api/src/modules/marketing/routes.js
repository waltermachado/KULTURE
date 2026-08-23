/**
 * Marketing por e-mail.
 *   Público:
 *     GET  /api/marketing/unsubscribe?e=<email b64url>&t=<assinatura>   página "você não receberá mais"
 *     POST /api/marketing/unsubscribe?e&t                                 one-click (List-Unsubscribe-Post)
 *   Backoffice (role=admin):
 *     GET  /api/admin/mail/status                 provedor + teste de conexão (SMTP: login real)
 *     POST /api/admin/mail/test                   manda um e-mail simples para o admin logado
 *     GET  /api/admin/marketing/audience          contagem por público + descadastrados
 *     GET  /api/admin/marketing/campaigns         últimas 50 campanhas
 *     GET  /api/admin/marketing/campaigns/:id     progresso (sent/failed/status)
 *     POST /api/admin/marketing/preview           HTML da campanha (prévia no painel)
 *     POST /api/admin/marketing/test              manda a campanha só para o admin (ou `to`)
 *     POST /api/admin/marketing/campaigns         cria e DISPARA (draft:true só cria)
 *     POST /api/admin/marketing/campaigns/:id/send dispara um rascunho / reenvia uma que falhou
 */
import { requireAdmin } from "../../lib/guards.js";
import { AUDIENCES, unsubscribePage } from "./service.js";
import { canonicalWebUrl, publicWebUrlMisconfigured } from "../../lib/site-url.js";

const CAMPAIGN_BODY = {
  type: "object",
  required: ["subject", "body"],
  additionalProperties: false,
  properties: {
    subject: { type: "string", minLength: 1, maxLength: 150 },
    body: { type: "string", minLength: 1, maxLength: 8000 },
    ctaLabel: { type: ["string", "null"], maxLength: 60 },
    ctaUrl: { type: ["string", "null"], maxLength: 2000 },
    imageUrl: { type: ["string", "null"], maxLength: 2000 },
    audience: { type: "string", enum: Object.keys(AUDIENCES) },
    draft: { type: "boolean" },
    to: { type: "string", maxLength: 200 }
  }
};
const UNSUB_QUERY = { type: "object", required: ["e", "t"], properties: { e: { type: "string", minLength: 1, maxLength: 400 }, t: { type: "string", minLength: 1, maxLength: 64 } } };

/** @param {import('fastify').FastifyInstance} app */
export async function marketingRoutes(app) {
  const marketing = app.marketing; // criado em app.js (precisa de Postgres)
  // one-click (RFC 8058): o provedor de e-mail faz POST com corpo "List-Unsubscribe=One-Click" em form-urlencoded
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));

  // ---- público: descadastro ----
  const unsubscribeHandler = async (request, reply) => {
    let ok = false, email = null;
    try {
      const r = await marketing.unsubscribe({ e: request.query.e, t: request.query.t, reason: request.method === "POST" ? "one-click" : "link" });
      ok = r.ok; email = r.email;
    } catch { /* link inválido → página explica */ }
    if (request.method === "POST") return reply.code(ok ? 200 : 400).send({ ok });
    return reply.code(ok ? 200 : 400).header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(unsubscribePage({ ok, email, siteUrl: canonicalWebUrl(app.env) }));
  };
  app.get("/api/marketing/unsubscribe", { schema: { tags: ["marketing"], summary: "Descadastrar e-mail das campanhas", querystring: UNSUB_QUERY } }, unsubscribeHandler);
  app.post("/api/marketing/unsubscribe", { schema: { tags: ["marketing"], summary: "Descadastro one-click (List-Unsubscribe-Post)", querystring: UNSUB_QUERY } }, unsubscribeHandler);

  // ---- backoffice ----
  const adminOpts = (extra = {}) => ({ onRequest: [requireAdmin], schema: { tags: ["admin"], ...extra } });

  app.get("/api/admin/mail/status", adminOpts({ summary: "Provedor de e-mail + teste de conexão" }), async () => marketing_mailStatus(app));

  app.post("/api/admin/mail/test", adminOpts({ summary: "E-mail simples de teste para o admin logado" }), async (request) => {
    const to = request.admin.email;
    const text = `Olá, ${request.admin.name}!\n\nEste é um e-mail de teste da Kulture (${app.mailer.provider}). Se você está lendo, o envio está funcionando.\n\n— Equipe Kulture`;
    const result = await app.mailer.send({ to, toName: request.admin.name, subject: "Teste de e-mail — Kulture", text });
    return { ...result, to };
  });

  app.get("/api/admin/marketing/audience", adminOpts({ summary: "Tamanho do público por tipo" }), async () => ({ audiences: AUDIENCES, counts: await marketing.audienceCounts() }));

  app.get("/api/admin/marketing/campaigns", adminOpts({ summary: "Últimas campanhas" }), async () => ({ campaigns: await marketing.listCampaigns() }));

  app.get("/api/admin/marketing/campaigns/:id", adminOpts({ summary: "Progresso de uma campanha" }), async (request) => ({ campaign: await marketing.getCampaign(request.params.id) }));

  app.post("/api/admin/marketing/preview", adminOpts({ summary: "HTML de prévia da campanha", body: CAMPAIGN_BODY }), async (request) => {
    const { html, text, subject, campaign } = marketing.preview(request.body, { email: request.admin.email, name: request.admin.name });
    return { subject, html, text, campaign };
  });

  app.post("/api/admin/marketing/test", adminOpts({ summary: "Envia a campanha só para o admin (ou `to`)", body: CAMPAIGN_BODY }), async (request) => {
    const to = request.body.to || request.admin.email;
    return marketing.sendTest(request.body, to, to === request.admin.email ? request.admin.name : "");
  });

  app.post("/api/admin/marketing/campaigns", adminOpts({ summary: "Cria a campanha e dispara (draft:true só cria)", body: CAMPAIGN_BODY }), async (request, reply) => {
    const { draft, to, ...body } = request.body;
    const created = await marketing.createCampaign(body, request.admin.id);
    const campaign = draft ? created : await marketing.startCampaign(created.id);
    app.log.info({ id: campaign.id, adminId: request.admin.id, total: campaign.total, draft: Boolean(draft) }, "marketing: campanha criada");
    return reply.code(201).send({ campaign });
  });

  app.post("/api/admin/marketing/campaigns/:id/send", adminOpts({ summary: "Dispara um rascunho / reenvia uma que falhou" }), async (request) => ({ campaign: await marketing.startCampaign(request.params.id) }));
}

async function marketing_mailStatus(app) {
  const status = await app.mailer.verify();
  return {
    ...status,
    from: app.env.MAIL_FROM, fromName: app.env.MAIL_FROM_NAME, replyTo: app.env.MAIL_REPLY_TO || null,
    siteUrl: canonicalWebUrl(app.env), publicWebUrl: app.env.PUBLIC_WEB_URL, publicWebUrlMisconfigured: publicWebUrlMisconfigured(app.env)
  };
}
