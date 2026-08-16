/**
 * Backoffice — /api/admin/*  (todas as rotas exigem JWT de usuário com role=admin)
 *
 *   GET   /api/admin/me                          quem sou (confirma acesso)
 *   GET   /api/admin/dashboard?days=30           KPIs financeiros + série diária + top produtos
 *   GET   /api/admin/orders?status&q&page        lista paginada
 *   GET   /api/admin/orders/:number              detalhe completo (itens, eventos, notificações, economics)
 *   PATCH /api/admin/orders/:number              status / rastreio / notas (gera eventos + e-mails)
 *   POST  /api/admin/orders/:number/recheck      reconsulta payment_check
 *   POST  /api/admin/orders/:number/resend-email reenvia e-mail (paid|shipped|delivered)
 *   GET   /api/admin/customers?q&page            clientes com nº de pedidos e total gasto
 *   GET   /api/admin/customers/:id               perfil + pedidos + resets
 *   PATCH /api/admin/customers/:id               edita cadastro / role
 *   POST  /api/admin/customers/:id/password-reset gera link de redefinição (e-mail + link para repassar)
 *   POST  /api/admin/customers/:id/revoke-sessions derruba sessões (refresh tokens)
 */
import { requireAdmin } from "../../lib/guards.js";
import { AppError } from "../../lib/errors.js";
import { createAdminService, ORDER_STATUS_LABELS, ORDER_TRANSITIONS } from "./service.js";

const STATUS_ENUM = Object.keys(ORDER_TRANSITIONS);

const ADDRESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cep: { type: "string" }, street: { type: "string" }, number: { type: "string" },
    complement: { type: "string" }, neighborhood: { type: "string" }, city: { type: "string" }, state: { type: "string" }
  }
};

export async function adminRoutes(app) {
  const admin = createAdminService({
    prisma: app.prisma,
    env: app.env,
    mailer: app.mailer,
    orders: app.orders,
    log: app.log
  });
  app.decorate("admin", admin);

  // todas as rotas deste plugin passam pelo guard
  app.addHook("onRequest", requireAdmin);

  const tags = ["admin"];

  app.get("/api/admin/me", { schema: { tags } }, async (request) => ({
    user: request.admin,
    statusLabels: ORDER_STATUS_LABELS,
    transitions: ORDER_TRANSITIONS,
    mailProvider: app.mailer?.provider ?? "log",
    paymentProvider: app.env.PAYMENT_PROVIDER
  }));

  // ─── dashboard ─────────────────────────────────────────────────────────
  app.get("/api/admin/dashboard", {
    schema: { tags, querystring: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 365 } } } }
  }, async (request) => admin.dashboard({ days: request.query.days ?? 30 }));

  // ─── pedidos ───────────────────────────────────────────────────────────
  app.get("/api/admin/orders", {
    schema: {
      tags,
      querystring: {
        type: "object",
        properties: {
          status: { type: "string" }, q: { type: "string" }, from: { type: "string" }, to: { type: "string" },
          page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, sort: { type: "string" }
        }
      }
    }
  }, async (request) => admin.listOrders(request.query));

  app.get("/api/admin/orders/:number", { schema: { tags } }, async (request) => admin.getOrder(request.params.number));

  app.patch("/api/admin/orders/:number", {
    schema: {
      tags,
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: STATUS_ENUM },
          carrier: { type: ["string", "null"] },
          trackingCode: { type: ["string", "null"] },
          trackingUrl: { type: ["string", "null"] },
          internalNotes: { type: ["string", "null"] },
          note: { type: "string" },
          paymentMethod: { type: "string" },
          allowNoTracking: { type: "boolean" },
          notifyCustomer: { type: "boolean" }
        }
      }
    }
  }, async (request) => admin.updateOrder(request.params.number, request.body || {}, request.admin));

  app.post("/api/admin/orders/:number/recheck", {
    schema: { tags, body: { type: "object", properties: { transactionNsu: { type: "string" }, slug: { type: "string" } } } }
  }, async (request) => admin.recheckPayment(request.params.number, request.body || {}));

  app.post("/api/admin/orders/:number/resend-email", {
    schema: { tags, body: { type: "object", properties: { kind: { type: "string", enum: ["paid", "shipped", "delivered"] } } } }
  }, async (request) => admin.resendOrderEmail(request.params.number, request.body?.kind || "paid"));

  // ─── clientes ──────────────────────────────────────────────────────────
  app.get("/api/admin/customers", {
    schema: {
      tags,
      querystring: {
        type: "object",
        properties: {
          q: { type: "string" }, role: { type: "string", enum: ["customer", "admin"] },
          page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request) => admin.listCustomers(request.query));

  app.get("/api/admin/customers/:id", { schema: { tags } }, async (request) => admin.getCustomer(request.params.id));

  app.patch("/api/admin/customers/:id", {
    schema: {
      tags,
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          email: { type: "string", format: "email" },
          phone: { type: ["string", "null"] },
          cpf: { type: ["string", "null"] },
          address: { anyOf: [ADDRESS_SCHEMA, { type: "null" }] },
          role: { type: "string", enum: ["customer", "admin"] }
        }
      }
    }
  }, async (request) => admin.updateCustomer(request.params.id, request.body || {}, request.admin));

  app.post("/api/admin/customers/:id/password-reset", { schema: { tags } }, async (request) => {
    const reset = await app.auth.createPasswordReset({ userId: request.params.id, requestedBy: "admin" });
    if (!reset) throw AppError.notFound("Cliente não encontrado");
    const sent = await app.sendPasswordResetEmail(reset);
    app.log.info({ userId: request.params.id, adminId: request.admin.id, mailed: sent.mailed }, "admin: link de reset gerado");
    // o link volta para o admin poder repassar por WhatsApp quando o e-mail não estiver configurado
    return { ok: true, email: reset.user.email, ...sent };
  });

  app.post("/api/admin/customers/:id/revoke-sessions", { schema: { tags } }, async (request) =>
    admin.revokeCustomerSessions(request.params.id)
  );
}
