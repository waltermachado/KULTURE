/**
 * Nota fiscal do pedido.
 *   Backoffice (role=admin):
 *     GET    /api/admin/orders/:number/invoice          resumo (sem binários)
 *     PUT    /api/admin/orders/:number/invoice          anexa/substitui { pdfDataUrl?, xmlDataUrl?|xml?, number?, series?, accessKey?, issuedAt?, externalUrl? }
 *     DELETE /api/admin/orders/:number/invoice
 *     GET    /api/admin/orders/:number/invoice.pdf|.xml download
 *     POST   /api/admin/orders/:number/invoice/send     e-mail ao cliente com anexos (opcional `to` para outro destinatário)
 *   Cliente (dono do pedido logado, ou admin):
 *     GET    /api/orders/:number/invoice.pdf            download em "Minha conta"
 */
import { AppError } from "../../lib/errors.js";
import { requireAdmin, requireAuth } from "../../lib/guards.js";

const BODY = {
  type: "object",
  additionalProperties: false,
  properties: {
    pdfDataUrl: { type: ["string", "null"] },
    xmlDataUrl: { type: ["string", "null"] },
    xml: { type: ["string", "null"] },
    number: { type: ["string", "null"], maxLength: 20 },
    series: { type: ["string", "null"], maxLength: 10 },
    accessKey: { type: ["string", "null"], maxLength: 60 },
    issuedAt: { type: ["string", "null"] },
    externalUrl: { type: ["string", "null"], maxLength: 2000 }
  }
};

/** @param {import('fastify').FastifyInstance} app */
export async function invoiceRoutes(app) {
  const invoices = app.invoices;
  const tags = ["admin"];
  const adm = (extra = {}) => ({ onRequest: [requireAdmin], schema: { tags, ...extra } });

  app.get("/api/admin/orders/:number/invoice", adm({ summary: "Nota fiscal do pedido (resumo)" }), async (request) => ({ invoice: await invoices.get(request.params.number) }));

  app.put("/api/admin/orders/:number/invoice", { ...adm({ summary: "Anexa/substitui a nota fiscal (PDF/XML + dados)", body: BODY }), bodyLimit: 12 * 1024 * 1024 }, async (request) => ({
    invoice: await invoices.attach(request.params.number, request.body || {}, request.admin)
  }));

  app.delete("/api/admin/orders/:number/invoice", adm({ summary: "Remove a nota anexada" }), async (request) => invoices.remove(request.params.number, request.admin));

  app.get("/api/admin/orders/:number/invoice.pdf", adm({ summary: "PDF da nota" }), async (request, reply) => {
    const { data, filename } = await invoices.pdf(request.params.number);
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).header("Cache-Control", "private, no-store").send(data);
  });

  app.get("/api/admin/orders/:number/invoice.xml", adm({ summary: "XML da nota" }), async (request, reply) => {
    const { data, filename } = await invoices.xml(request.params.number);
    return reply.header("Content-Type", "application/xml; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`).header("Cache-Control", "private, no-store").send(data);
  });

  // corpo opcional: { to } para mandar a outro e-mail (ex. contador)
  app.post("/api/admin/orders/:number/invoice/send", adm({ summary: "Envia a nota ao cliente por e-mail" }), async (request) => {
    const to = request.body && typeof request.body === "object" && typeof request.body.to === "string" ? request.body.to.slice(0, 200) : null;
    return invoices.send(request.params.number, request.admin, { to });
  });

  // cliente: dono do pedido (ou admin) baixa o PDF em "Minha conta"
  app.get("/api/orders/:number/invoice.pdf", { onRequest: [requireAuth], schema: { tags: ["orders"], summary: "PDF da nota fiscal (dono do pedido)" } }, async (request, reply) => {
    const { data, filename, order } = await invoices.pdf(request.params.number);
    const isOwner = order.userId && order.userId === request.user.sub;
    const sameEmail = String(order.customerEmail || "").toLowerCase() === String(request.user.email || "").toLowerCase();
    if (!isOwner && !sameEmail && request.user.role !== "admin") throw AppError.forbidden("Esta nota não é sua");
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).header("Cache-Control", "private, no-store").send(data);
  });
}
