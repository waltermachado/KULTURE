/**
 * Serviço do backoffice (admin). Só é chamado por rotas protegidas por requireAdmin.
 * Aqui o breakdown interno PODE aparecer — é o painel do dono, não a API pública.
 */
import { canonicalWebUrl } from "../../lib/site-url.js";
import { AppError } from "../../lib/errors.js";
import { sizeLabel as buildSizeLabel } from "@kulture/shared/sizes";
import { pricingRateOf } from "../catalog/normalize.js";
import { newOrderNumber } from "../orders/service.js";
import { isStockCode } from "../stock/service.js";
import {
  buildOrderPaidEmail, buildOrderShippedEmail, buildOrderDeliveredEmail, buildOrderCancelledEmail, buildOrderRegisteredEmail, buildOrderStageEmail, PAYMENT_METHOD_LABELS
} from "../mail/mailer.js";

import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAID_STATUSES, TO_SHIP_STATUSES } from "../orders/status.js";
export { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAID_STATUSES, TO_SHIP_STATUSES };

/** Canal da venda (`orders.channel`). `site` = checkout normal; os demais = venda externa registrada no painel. */
export const SALE_CHANNELS = { site: "Site", whatsapp: "WhatsApp", instagram: "Instagram", presencial: "Presencial", outro: "Outro" };
export const MANUAL_CHANNELS = ["whatsapp", "instagram", "presencial", "outro"];
/** Formas de pagamento aceitas numa venda externa (o site só tem pix/credit_card, vindos do gateway). */
export const MANUAL_PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS);
/** Em que etapa a venda externa já entra (é sempre "dinheiro recebido"; nunca pending_payment). */
export const MANUAL_INITIAL_STATUSES = [...PAID_STATUSES];
export { PAYMENT_METHOD_LABELS };


const num = (v) => (v == null ? 0 : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;
const startOfDay = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** Custo estimado (produto + frete US + impostos/taxas) e margem (comissão) a partir do breakdown do item. */
function itemEconomics(item) {
  const b = item.breakdown || {};
  const qty = num(item.quantity) || 1;
  const cost = num(b.subtotalBrl) + num(b.importDutyBrl) + num(b.paymentFeeBrl);
  const revenue = num(item.unitPriceBrl);
  const hasBreakdown = Number.isFinite(b.subtotalBrl) && b.subtotalBrl > 0;
  return {
    costBrl: round2((hasBreakdown ? cost : 0) * qty),
    marginBrl: round2((hasBreakdown ? revenue - cost : 0) * qty),
    revenueBrl: round2(revenue * qty),
    hasBreakdown
  };
}

function orderRevenue(order) {
  return num(order.paidAmountBrl ?? order.totalBrl);
}

export function createAdminService({ prisma, env, mailer, gateway, orders, stock = null, catalog = null, log }) {
  const siteUrl = canonicalWebUrl(env); // nunca o domínio do Railway

  async function sendMail(order, build, extra = {}) {
    if (!mailer || !order?.customerEmail) return { ok: false, skipped: true };
    try {
      const msg = build(order, { siteUrl, ...extra });
      return await mailer.send({ to: order.customerEmail, toName: order.customerName, ...msg });
    } catch (err) {
      log?.warn({ err: err.message, order: order.number }, "admin: falha ao enviar e-mail (ignorada)");
      return { ok: false, error: err.message };
    }
  }

  // ─── Dashboard ────────────────────────────────────────────────────────

  async function dashboard({ days = 30 } = {}) {
    const d = Math.min(Math.max(Number(days) || 30, 1), 365);
    const now = new Date();
    const since = startOfDay(new Date(now.getTime() - (d - 1) * 86_400_000));
    const prevSince = new Date(since.getTime() - d * 86_400_000);

    const [paidOrders, prevPaid, statusCounts, customersTotal, customersNew, pendingCount, recent, byStatusAll] =
      await Promise.all([
        prisma.order.findMany({
          where: { status: { in: PAID_STATUSES }, paidAt: { gte: since } },
          select: {
            id: true, number: true, status: true, paidAt: true, createdAt: true, totalBrl: true, paidAmountBrl: true,
            paymentMethod: true, channel: true, customerName: true, userId: true,
            items: { select: { styleColor: true, name: true, image: true, quantity: true, unitPriceBrl: true, breakdown: true } }
          }
        }),
        prisma.order.findMany({
          where: { status: { in: PAID_STATUSES }, paidAt: { gte: prevSince, lt: since } },
          select: { totalBrl: true, paidAmountBrl: true }
        }),
        prisma.order.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.order.count({ where: { status: "pending_payment" } }),
        prisma.order.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { number: true, status: true, customerName: true, totalBrl: true, createdAt: true, paidAt: true, channel: true }
        }),
        prisma.order.groupBy({ by: ["status"], _count: { _all: true } })
      ]);

    let revenue = 0, cost = 0, margin = 0, itemsSold = 0, withBreakdown = 0;
    const byDay = new Map();
    const productMap = new Map();
    const methodMap = new Map();
    const channelMap = new Map(); // canal → { revenueBrl, orders } (site × vendas externas registradas no painel)
    for (const o of paidOrders) {
      const rev = orderRevenue(o);
      revenue += rev;
      const key = dayKey(o.paidAt ?? o.createdAt);
      const day = byDay.get(key) || { date: key, revenue: 0, orders: 0 };
      day.revenue = round2(day.revenue + rev);
      day.orders += 1;
      byDay.set(key, day);
      const m = o.paymentMethod || "outro";
      methodMap.set(m, (methodMap.get(m) || 0) + rev);
      const ch = o.channel || "site";
      const c = channelMap.get(ch) || { channel: ch, label: SALE_CHANNELS[ch] || ch, revenueBrl: 0, orders: 0 };
      c.revenueBrl = round2(c.revenueBrl + rev);
      c.orders += 1;
      channelMap.set(ch, c);
      for (const it of o.items) {
        const eco = itemEconomics(it);
        cost += eco.costBrl;
        margin += eco.marginBrl;
        itemsSold += num(it.quantity);
        if (eco.hasBreakdown) withBreakdown += 1;
        const p = productMap.get(it.styleColor) || { styleColor: it.styleColor, name: it.name, image: it.image, quantity: 0, revenueBrl: 0 };
        p.quantity += num(it.quantity);
        p.revenueBrl = round2(p.revenueBrl + eco.revenueBrl);
        productMap.set(it.styleColor, p);
      }
    }
    // série completa (dias sem venda aparecem zerados)
    const series = [];
    for (let i = 0; i < d; i++) {
      const key = dayKey(new Date(since.getTime() + i * 86_400_000));
      series.push(byDay.get(key) || { date: key, revenue: 0, orders: 0 });
    }
    const prevRevenue = prevPaid.reduce((s, o) => s + orderRevenue(o), 0);
    const createdInPeriod = statusCounts.reduce((s, r) => s + r._count._all, 0);
    const paidInPeriod = paidOrders.length;
    const externalRevenue = [...channelMap.values()].filter((c) => c.channel !== "site").reduce((a, c) => a + c.revenueBrl, 0);
    const externalOrders = [...channelMap.values()].filter((c) => c.channel !== "site").reduce((a, c) => a + c.orders, 0);

    return {
      period: { days: d, since: since.toISOString(), until: now.toISOString() },
      totals: {
        revenueBrl: round2(revenue),
        prevRevenueBrl: round2(prevRevenue),
        revenueDeltaPct: prevRevenue > 0 ? round2(((revenue - prevRevenue) / prevRevenue) * 100) : null,
        paidOrders: paidInPeriod,
        createdOrders: createdInPeriod,
        conversionPct: createdInPeriod ? round2((paidInPeriod / createdInPeriod) * 100) : null,
        avgTicketBrl: paidInPeriod ? round2(revenue / paidInPeriod) : 0,
        itemsSold,
        estimatedCostBrl: round2(cost),
        estimatedMarginBrl: round2(margin),
        estimatedMarginPct: revenue > 0 ? round2((margin / revenue) * 100) : null,
        marginCoverage: withBreakdown, // itens com breakdown salvo (base da estimativa)
        pendingPayment: pendingCount,
        customersTotal,
        customersNew,
        // vendas fora do site registradas no painel (WhatsApp, Instagram, presencial…) — já dentro de revenueBrl
        externalRevenueBrl: round2(externalRevenue),
        externalOrders,
        siteRevenueBrl: round2(revenue - externalRevenue),
        siteOrders: paidInPeriod - externalOrders
      },
      series,
      byStatus: Object.fromEntries(byStatusAll.map((r) => [r.status, r._count._all])),
      byStatusPeriod: Object.fromEntries(statusCounts.map((r) => [r.status, r._count._all])),
      byPaymentMethod: Object.fromEntries([...methodMap.entries()].map(([k, v]) => [k, round2(v)])),
      byChannel: [...channelMap.values()].sort((a, b) => b.revenueBrl - a.revenueBrl),
      channelLabels: SALE_CHANNELS,
      paymentMethodLabels: PAYMENT_METHOD_LABELS,
      topProducts: [...productMap.values()].sort((a, b) => b.quantity - a.quantity || b.revenueBrl - a.revenueBrl).slice(0, 8),
      recentOrders: recent,
      statusLabels: ORDER_STATUS_LABELS
    };
  }

  // ─── Pedidos ──────────────────────────────────────────────────────────

  function orderWhere({ status, q, from, to, channel } = {}) {
    const where = {};
    if (status) {
      const list = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length === 1) where.status = list[0];
      else if (list.length > 1) where.status = { in: list };
    }
    // channel=site (checkout) | external (qualquer venda registrada no painel) | whatsapp,instagram,… (lista)
    if (channel) {
      const list = String(channel).split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length === 1 && list[0] === "external") where.channel = { not: "site" };
      else if (list.length === 1) where.channel = list[0];
      else if (list.length > 1) where.channel = { in: list };
    }
    if (q) {
      const term = String(q).trim();
      where.OR = [
        { number: { contains: term, mode: "insensitive" } },
        { customerName: { contains: term, mode: "insensitive" } },
        { customerEmail: { contains: term, mode: "insensitive" } },
        { customerCpf: { contains: term.replace(/\D/g, "") || term } },
        { trackingCode: { contains: term, mode: "insensitive" } },
        { transactionNsu: { contains: term } }
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    return where;
  }

  async function listOrders({ status, q, from, to, channel, page = 1, pageSize = 25, sort = "createdAt:desc" } = {}) {
    const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const p = Math.max(Number(page) || 1, 1);
    const [field, dir] = String(sort).split(":");
    const orderBy = { [["createdAt", "paidAt", "totalBrl", "status", "updatedAt"].includes(field) ? field : "createdAt"]: dir === "asc" ? "asc" : "desc" };
    const where = orderWhere({ status, q, from, to, channel });
    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy,
        skip: (p - 1) * take,
        take,
        select: {
          id: true, number: true, status: true, customerName: true, customerEmail: true, customerPhone: true,
          totalBrl: true, paidAmountBrl: true, paymentMethod: true, paymentProvider: true, channel: true,
          carrier: true, trackingCode: true, shippedAt: true, deliveredAt: true, paidAt: true, createdAt: true, updatedAt: true,
          address: true, userId: true,
          _count: { select: { items: true } }
        }
      })
    ]);
    return {
      page: p,
      pageSize: take,
      total,
      pages: Math.max(Math.ceil(total / take), 1),
      orders: rows.map((o) => ({
        ...o,
        itemsCount: o._count.items,
        _count: undefined,
        channelLabel: SALE_CHANNELS[o.channel] || o.channel,
        external: o.channel !== "site",
        city: o.address?.city ?? null,
        state: o.address?.state ?? null
      }))
    };
  }

  async function getOrder(number) {
    const order = await prisma.order.findUnique({
      where: { number },
      include: {
        items: true,
        events: { orderBy: { createdAt: "asc" } },
        user: { select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true } },
        invoice: { select: { id: true, source: true, number: true, series: true, accessKey: true, issuedAt: true, pdfBytes: true, xmlData: true, externalId: true, externalUrl: true, sentAt: true, sentTo: true, createdAt: true, updatedAt: true } }
      }
    });
    if (!order) throw AppError.notFound("Pedido não encontrado");
    const invoice = order.invoice ? { ...order.invoice, xmlData: undefined, hasPdf: Boolean(order.invoice.pdfBytes), hasXml: Boolean(order.invoice.xmlData) } : null;
    const notifications = await prisma.notification.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    const economics = order.items.reduce(
      (acc, it) => {
        const e = itemEconomics(it);
        acc.costBrl = round2(acc.costBrl + e.costBrl);
        acc.marginBrl = round2(acc.marginBrl + e.marginBrl);
        return acc;
      },
      { costBrl: 0, marginBrl: 0 }
    );
    return {
      ...order,
      invoice,
      channelLabel: SALE_CHANNELS[order.channel] || order.channel,
      external: order.channel !== "site",
      economics,
      allowedTransitions: ORDER_TRANSITIONS[order.status] || [],
      notifications
    };
  }

  /**
   * Atualiza status/rastreio/notas. Transição inválida → 409. Cada mudança vira OrderEvent
   * (auditoria: quem, quando, o quê) e, quando faz sentido, e-mail ao cliente.
   */
  async function updateOrder(number, patch, admin) {
    const order = await prisma.order.findUnique({ where: { number }, include: { items: true } });
    if (!order) throw AppError.notFound("Pedido não encontrado");

    const data = {};
    const events = [];
    const actor = { adminId: admin?.id ?? null, adminEmail: admin?.email ?? null };

    for (const f of ["carrier", "trackingCode", "trackingUrl", "internalNotes"]) {
      if (patch[f] !== undefined) {
        const v = patch[f] === null ? null : String(patch[f]).trim() || null;
        if (v !== (order[f] ?? null)) data[f] = v;
      }
    }
    if (data.trackingCode !== undefined || data.carrier !== undefined || data.trackingUrl !== undefined) {
      events.push({
        type: "tracking_updated",
        payload: { ...actor, carrier: data.carrier ?? order.carrier, trackingCode: data.trackingCode ?? order.trackingCode, trackingUrl: data.trackingUrl ?? order.trackingUrl }
      });
    }
    if (data.internalNotes !== undefined) events.push({ type: "notes_updated", payload: { ...actor } });

    let mailKind = null;
    if (patch.status && patch.status !== order.status) {
      const allowed = ORDER_TRANSITIONS[order.status] || [];
      if (!allowed.includes(patch.status)) {
        throw AppError.conflict(`Transição ${order.status} → ${patch.status} não permitida`, { allowed });
      }
      data.status = patch.status;
      const now = new Date();
      if (patch.status === "paid") {
        data.paidAt = order.paidAt ?? now;
        if (order.paidAmountBrl == null) data.paidAmountBrl = order.totalBrl;
        if (patch.paymentMethod) data.paymentMethod = patch.paymentMethod;
      }
      if (patch.status === "shipped") {
        data.shippedAt = now;
        const code = data.trackingCode ?? order.trackingCode;
        if (!code && !patch.allowNoTracking) {
          throw AppError.badRequest("Informe o código de rastreio para marcar como enviado (ou allowNoTracking=true)");
        }
        mailKind = "shipped";
      }
      if (["sourcing", "in_transit", "arrived_br"].includes(patch.status)) mailKind = patch.status; // e-mail de etapa
      if (patch.status === "delivered") { data.deliveredAt = now; mailKind = "delivered"; }
      if (patch.status === "cancelled") { data.cancelledAt = now; mailKind = "cancelled"; }
      if (patch.status === "refunded") { data.refundedAt = now; mailKind = "refunded"; }
      if (patch.status === "abandoned") data.abandonedAt = now;
      events.push({ type: "status_changed", payload: { ...actor, from: order.status, to: patch.status, note: patch.note || null } });
    } else if (patch.note) {
      events.push({ type: "note", payload: { ...actor, note: patch.note } });
    }

    if (!Object.keys(data).length && !events.length) return getOrder(number);

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { ...data, ...(events.length ? { events: { create: events } } : {}) },
      include: { items: true }
    });

    // pronta entrega: cancelado/abandonado devolve a reserva ao estoque; baixa manual de um pedido que já
    // tinha devolvido (abandonado → pago) reserva de novo (ou registra stock_oversold para conferência)
    if (stock && data.status) {
      try {
        if (data.status === "cancelled" || data.status === "abandoned") await stock.releaseOrder(updated, data.status);
        else if (data.status === "paid" && updated.stockReleasedAt) await stock.ensureReservedForPaid(updated);
      } catch (err) {
        log?.error({ err: err.message, order: number }, "admin: falha ao ajustar estoque de pronta entrega");
      }
    }

    if (mailKind && patch.notifyCustomer !== false) {
      const build =
        mailKind === "shipped" ? buildOrderShippedEmail
        : mailKind === "delivered" ? buildOrderDeliveredEmail
        : ["sourcing", "in_transit", "arrived_br"].includes(mailKind) ? (o, opts) => buildOrderStageEmail(o, mailKind, opts)
        : buildOrderCancelledEmail;
      const result = await sendMail(updated, build, { refunded: mailKind === "refunded" });
      await prisma.orderEvent.create({
        data: { orderId: order.id, type: `email_${mailKind}`, payload: { ok: Boolean(result?.ok), provider: mailer?.provider ?? null, error: result?.error ?? null } }
      }).catch(() => {});
    }

    log?.info({ order: number, ...actor, changes: Object.keys(data) }, "admin: pedido atualizado");
    return getOrder(number);
  }

  /** Reconsulta o gateway (payment_check) para um pedido que ficou pendente. */
  async function recheckPayment(number, { transactionNsu, slug } = {}) {
    const order = await prisma.order.findUnique({ where: { number } });
    if (!order) throw AppError.notFound("Pedido não encontrado");
    if (PAID_STATUSES.includes(order.status)) return { paid: true, alreadyPaid: true };
    if (order.paymentProvider === "manual") throw AppError.badRequest("Venda externa: o pagamento foi registrado à mão, não há gateway para consultar");
    const nsu = transactionNsu || order.transactionNsu;
    const s = slug || order.infinitepaySlug;
    if (!nsu && env.PAYMENT_PROVIDER === "infinitepay") {
      throw AppError.badRequest("Sem transaction_nsu: informe o NSU da transação (aparece no painel da InfinitePay)");
    }
    const result = await orders.confirm({ orderNumber: number, transactionNsu: nsu, slug: s });
    await prisma.orderEvent.create({ data: { orderId: order.id, type: "payment_recheck", payload: { paid: result.paid, transactionNsu: nsu ?? null } } });
    return result;
  }

  async function resendOrderEmail(number, kind = "paid") {
    const order = await prisma.order.findUnique({ where: { number }, include: { items: true } });
    if (!order) throw AppError.notFound("Pedido não encontrado");
    // venda externa: o "e-mail de confirmação" é o de pedido registrado (não fala em gateway/link de pagamento)
    const build =
      kind === "shipped" ? buildOrderShippedEmail
      : kind === "delivered" ? buildOrderDeliveredEmail
      : ["sourcing", "in_transit", "arrived_br"].includes(kind) ? (o, opts) => buildOrderStageEmail(o, kind, opts)
      : kind === "registered" || order.paymentProvider === "manual" ? buildOrderRegisteredEmail
      : buildOrderPaidEmail;
    const result = await sendMail(order, build);
    await prisma.orderEvent.create({ data: { orderId: order.id, type: `email_${kind}_resent`, payload: { ok: Boolean(result?.ok), error: result?.error ?? null } } });
    return { ok: Boolean(result?.ok), provider: mailer?.provider ?? null, error: result?.error ?? null };
  }

  // ─── Venda externa (registrada no painel) ─────────────────────────────

  const digits = (v) => String(v ?? "").replace(/\D/g, "");
  const money = (v) => {
    if (v === "" || v == null) return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? round2(n) : NaN;
  };
  const parseDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const cleanAddress = (a) => {
    if (!a || typeof a !== "object") return {};
    const out = {};
    for (const k of ["cep", "street", "number", "complement", "neighborhood", "city", "state"]) {
      const v = a[k] == null ? "" : String(a[k]).trim();
      if (v) out[k] = k === "cep" ? digits(v) : k === "state" ? v.toUpperCase().slice(0, 2) : v;
    }
    return out;
  };
  /** Nike By You digitado no painel: mesmas regras do checkout (texto ≤ 8, nº 2 dígitos), sem estourar por excesso. */
  const cleanCustomization = (c) => {
    if (!c || typeof c !== "object") return null;
    const t = (v) => String(v ?? "").trim().slice(0, 8);
    const n = (v) => digits(v).slice(0, 2);
    const out = { textLeft: t(c.textLeft), numberLeft: n(c.numberLeft), textRight: t(c.textRight), numberRight: n(c.numberRight) };
    return Object.values(out).some(Boolean) ? out : null;
  };

  /**
   * Registra uma venda feita FORA do site (WhatsApp, Instagram, presencial…) como um pedido normal, já pago:
   *  - mesma tabela/fluxo dos pedidos do checkout → aparece para o cliente em /conta (pelo e-mail; vincula à conta
   *    se já existir) e em "Rastrear pedido", para o admin em Pedidos/Entregas e entra na receita do dashboard;
   *  - `paymentProvider = manual`, `channel` ≠ site; nunca passa pelo gateway;
   *  - itens: pronta entrega (code PE-… + tamanho → baixa o estoque, salvo `deductStock:false`), importado
   *    (SKU Nike + nome/tamanho/preço — pré-preenchidos pelo painel via GET /api/admin/catalog/:term) ou livre;
   *  - custo por item (opcional) alimenta custo/margem do dashboard (`breakdown.subtotalBrl`, como no checkout);
   *  - pode já entrar como "Comprando nos EUA", "Enviado" ou "Entregue" (registro de vendas antigas), com rastreio;
   *  - e-mail "pedido registrado" ao cliente (desligável com notifyCustomer=false).
   */
  async function createManualOrder(body = {}, admin) {
    const actor = { adminId: admin?.id ?? null, adminEmail: admin?.email ?? null };
    const customer = body.customer || {};
    const name = String(customer.name || "").trim();
    const email = String(customer.email || "").trim().toLowerCase();
    if (name.length < 2) throw AppError.badRequest("Informe o nome do cliente");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw AppError.badRequest("Informe um e-mail válido do cliente — é por ele que o pedido aparece na conta dele");
    const phone = digits(customer.phone);
    const cpf = digits(customer.cpf);
    if (cpf && cpf.length !== 11) throw AppError.badRequest("CPF inválido (11 dígitos) — ou deixe em branco");
    const address = cleanAddress(body.address);
    const channel = MANUAL_CHANNELS.includes(body.channel) ? body.channel : "outro";
    const status = MANUAL_INITIAL_STATUSES.includes(body.status) ? body.status : "paid";

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw AppError.badRequest("Adicione pelo menos um item à venda");
    if (rawItems.length > 20) throw AppError.badRequest("Máximo de 20 itens por venda");

    let subtotal = 0;
    const itemsData = [];
    const reservations = [];
    for (const raw of rawItems) {
      const qty = Math.max(1, Math.min(50, parseInt(raw.quantity, 10) || 1));
      const code = String(raw.code || raw.styleColor || "").trim().toUpperCase();
      const isStock = raw.kind === "stock" || (raw.kind !== "import" && raw.kind !== "manual" && isStockCode(code));
      let data;
      if (isStock) {
        const product = stock ? await stock.getProductByCode(code, { includeInactive: true }) : null;
        if (!product) throw AppError.badRequest(`Produto de pronta entrega ${code || "(sem código)"} não encontrado`);
        const br = String(raw.brLabel ?? raw.br ?? "").replace(",", ".").trim();
        const size = product.sizes.find((s) => s.brLabel === br) || (raw.nikeSize ? product.sizes.find((s) => s.nikeSize === String(raw.nikeSize)) : null);
        if (!size) throw AppError.badRequest(`${product.name}: tamanho BR ${br || "?"} não está cadastrado nesse produto`);
        const gender = ["M", "W", "K"].includes(raw.sizeGender) && size.us?.[raw.sizeGender] ? raw.sizeGender : null;
        const unit = money(raw.unitPriceBrl);
        if (Number.isNaN(unit) || (unit != null && unit < 0)) throw AppError.badRequest(`${product.name}: preço inválido`);
        const cost = money(raw.unitCostBrl);
        if (Number.isNaN(cost) || (cost != null && cost < 0)) throw AppError.badRequest(`${product.name}: custo inválido`);
        const deduct = raw.deductStock !== false;
        if (deduct) reservations.push({ stockSizeId: size.stockSizeId, qty, label: `${product.name} (BR ${size.brLabel})` });
        const costBrl = cost ?? product.price?.breakdown?.subtotalBrl ?? null;
        data = {
          styleColor: product.code,
          name: product.name,
          colorDescription: product.colorDescription || null,
          image: product.images?.[0] || null,
          nikeSize: size.nikeSize,
          brSize: size.brSize,
          brLabel: size.brLabel,
          sizeLabel: buildSizeLabel(size, gender),
          customization: null,
          unitPriceBrl: unit ?? product.price.brl,
          unitPriceUsd: 0,
          quantity: qty,
          breakdown: { source: "stock", manual: true, stockProductId: product.stockProductId, stockSizeId: size.stockSizeId, stockDeducted: deduct, ...(costBrl != null ? { subtotalBrl: costBrl } : {}) }
        };
      } else {
        const itemName = String(raw.name || "").trim();
        if (itemName.length < 2) throw AppError.badRequest("Informe o nome do produto em cada item");
        const br = String(raw.brLabel ?? raw.br ?? "").replace(",", ".").trim();
        if (!br) throw AppError.badRequest(`${itemName}: informe o tamanho (numeração BR)`);
        const us = raw.usSize != null && String(raw.usSize).trim() ? String(raw.usSize).trim() : null;
        const gender = ["M", "W", "K"].includes(raw.sizeGender) ? raw.sizeGender : null;
        const sizeLabel = us && gender ? buildSizeLabel({ brLabel: br, scale: gender, us: { [gender]: us } }, gender) : us ? `BR ${br} (US ${us})` : `BR ${br}`;
        const unit = money(raw.unitPriceBrl);
        if (unit == null || Number.isNaN(unit) || unit < 0) throw AppError.badRequest(`${itemName}: informe o preço unitário (R$)`);
        const cost = money(raw.unitCostBrl);
        if (Number.isNaN(cost) || (cost != null && cost < 0)) throw AppError.badRequest(`${itemName}: custo inválido`);
        const usd = money(raw.unitPriceUsd);
        const brNum = Number(br);
        const styleColor = String(raw.styleColor || "").trim();
        data = {
          styleColor: styleColor || "MANUAL",
          name: itemName,
          colorDescription: raw.colorDescription ? String(raw.colorDescription).trim().slice(0, 160) : null,
          image: raw.image && /^(https?:\/\/|\/)/.test(String(raw.image)) ? String(raw.image).slice(0, 2000) : null,
          nikeSize: us || br,
          brSize: Number.isFinite(brNum) ? brNum : null,
          brLabel: br,
          sizeLabel,
          customization: cleanCustomization(raw.customization),
          unitPriceBrl: unit,
          unitPriceUsd: usd != null && !Number.isNaN(usd) ? usd : 0,
          quantity: qty,
          breakdown: { source: styleColor ? "import" : "manual", manual: true, ...(cost != null ? { subtotalBrl: cost } : {}) }
        };
      }
      subtotal = round2(subtotal + data.unitPriceBrl * qty);
      itemsData.push(data);
    }

    const discount = money(body.discountBrl) ?? 0;
    if (Number.isNaN(discount) || discount < 0 || discount > subtotal) throw AppError.badRequest("Desconto inválido (não pode passar do subtotal)");
    const total = round2(subtotal - discount);

    const payment = body.payment || {};
    const method = MANUAL_PAYMENT_METHODS.includes(payment.method) ? payment.method : "other";
    const paidAmount = money(payment.paidAmountBrl);
    if (Number.isNaN(paidAmount) || (paidAmount != null && paidAmount < 0)) throw AppError.badRequest("Valor recebido inválido");
    const installments = method === "credit_card" ? Math.max(1, Math.min(24, parseInt(payment.installments, 10) || 1)) : null;
    const now = new Date();
    const paidAt = parseDate(payment.paidAt) || now;
    if (paidAt.getTime() > now.getTime() + 86_400_000) throw AppError.badRequest("Data do pagamento no futuro");
    const reference = payment.reference ? String(payment.reference).trim().slice(0, 120) || null : null;
    const receiptUrl = payment.receiptUrl && /^https?:\/\//i.test(String(payment.receiptUrl)) ? String(payment.receiptUrl).trim().slice(0, 2000) : null;

    const shipping = body.shipping || {};
    const carrier = shipping.carrier ? String(shipping.carrier).trim().slice(0, 60) || null : null;
    const trackingCode = shipping.trackingCode ? String(shipping.trackingCode).trim().slice(0, 80) || null : null;
    const trackingUrl = shipping.trackingUrl && /^https?:\/\//i.test(String(shipping.trackingUrl)) ? String(shipping.trackingUrl).trim().slice(0, 2000) : null;
    const shippedAt = ["shipped", "delivered"].includes(status) ? parseDate(shipping.shippedAt) || paidAt : null;
    const deliveredAt = status === "delivered" ? parseDate(shipping.deliveredAt) || shippedAt : null;

    // vincula à conta do cliente pelo e-mail (se existir); senão fica como convidado e aparece em /conta quando ele
    // criar a conta com esse e-mail (listMine casa por customerEmail)
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    // câmbio só informativo (a venda foi negociada em BRL)
    let exchangeRate = 0;
    if (catalog?.getRate) {
      try { exchangeRate = pricingRateOf(await catalog.getRate()).usdToBrl || 0; } catch { exchangeRate = 0; }
    }

    const note = body.note ? String(body.note).trim().slice(0, 1000) || null : null;
    const internalNotes = body.internalNotes ? String(body.internalNotes).trim().slice(0, 4000) || null : null;
    const events = [
      { type: "created", payload: { ...actor, manual: true, channel, userLink: user ? "email" : "guest" } },
      { type: "payment_registered", payload: { ...actor, method, paidAmountBrl: paidAmount ?? total, installments, reference, receiptUrl, paidAt: paidAt.toISOString() } }
    ];
    if (status !== "paid") events.push({ type: "status_changed", payload: { ...actor, from: "paid", to: status, note: "venda externa registrada já nesta etapa" } });
    if (carrier || trackingCode) events.push({ type: "tracking_updated", payload: { ...actor, carrier, trackingCode, trackingUrl } });
    if (reservations.length) events.push({ type: "stock_reserved", payload: { items: reservations } });
    if (note) events.push({ type: "note", payload: { ...actor, note } });

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        if (reservations.length) await stock.reserve(tx, reservations);
        return tx.order.create({
          data: {
            number: newOrderNumber(),
            status,
            userId: user?.id ?? null,
            customerName: name,
            customerEmail: email,
            customerPhone: phone || "",
            customerCpf: cpf || "",
            address,
            subtotalBrl: subtotal,
            shippingBrl: 0,
            discountBrl: discount,
            totalBrl: total,
            exchangeRate,
            pricingSnapshot: { manual: true, channel, discountBrl: discount, registeredBy: actor },
            paymentProvider: "manual",
            channel,
            paymentMethod: method,
            transactionNsu: reference,
            receiptUrl,
            paidAmountBrl: paidAmount ?? total,
            installments,
            paidAt,
            carrier,
            trackingCode,
            trackingUrl,
            shippedAt,
            deliveredAt,
            internalNotes,
            items: { create: itemsData },
            events: { create: events }
          },
          include: { items: true }
        });
      });
    } catch (err) {
      if (err?.details?.code === "STOCK_OUT") {
        const r = reservations.find((x) => x.stockSizeId === err.details.stockSizeId);
        throw AppError.conflict(
          `Sem estoque suficiente para ${r?.label || "um dos tamanhos"}. Ajuste a quantidade em Pronta entrega ou desmarque "baixar do estoque" nesse item.`,
          { code: "STOCK_OUT", stockSizeId: err.details.stockSizeId }
        );
      }
      throw err;
    }

    if (body.notifyCustomer !== false) {
      const result = await sendMail(order, buildOrderRegisteredEmail);
      await prisma.orderEvent.create({
        data: { orderId: order.id, type: "email_registered", payload: { ok: Boolean(result?.ok), provider: mailer?.provider ?? null, error: result?.error ?? null } }
      }).catch(() => {});
    }

    log?.info({ order: order.number, ...actor, channel, status, items: itemsData.length, totalBrl: total }, "admin: venda externa registrada");
    return getOrder(order.number);
  }

  // ─── Clientes ─────────────────────────────────────────────────────────

  async function listCustomers({ q, page = 1, pageSize = 25, role } = {}) {
    const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const p = Math.max(Number(page) || 1, 1);
    const where = {};
    if (role) where.role = role;
    if (q) {
      const term = String(q).trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { phone: { contains: term.replace(/\D/g, "") || term } },
        { cpf: { contains: term.replace(/\D/g, "") || term } }
      ];
    }
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * take,
        take,
        select: { id: true, name: true, email: true, phone: true, cpf: true, role: true, address: true, createdAt: true, lastLoginAt: true, _count: { select: { orders: true } } }
      })
    ]);
    const ids = users.map((u) => u.id);
    const spent = ids.length
      ? await prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: { in: PAID_STATUSES } },
          _sum: { totalBrl: true },
          _count: { _all: true },
          _max: { paidAt: true }
        })
      : [];
    const spentMap = new Map(spent.map((s) => [s.userId, s]));
    return {
      page: p,
      pageSize: take,
      total,
      pages: Math.max(Math.ceil(total / take), 1),
      customers: users.map((u) => {
        const s = spentMap.get(u.id);
        return {
          ...u,
          _count: undefined,
          ordersCount: u._count.orders,
          paidOrders: s?._count._all ?? 0,
          spentBrl: round2(num(s?._sum.totalBrl)),
          lastPaidAt: s?._max.paidAt ?? null,
          city: u.address?.city ?? null,
          state: u.address?.state ?? null
        };
      })
    };
  }

  async function getCustomer(id) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, phone: true, cpf: true, role: true, address: true, createdAt: true, updatedAt: true, lastLoginAt: true }
    });
    if (!user) throw AppError.notFound("Cliente não encontrado");
    const [orders, guestOrders, resets, sessions, accessLog, accessTotals] = await Promise.all([
      prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { number: true, status: true, channel: true, totalBrl: true, paidAt: true, createdAt: true, trackingCode: true, carrier: true, _count: { select: { items: true } } }
      }),
      // pedidos feitos como convidado com o mesmo e-mail (antes de criar conta, por exemplo) — inclui vendas externas
      prisma.order.findMany({
        where: { userId: null, customerEmail: user.email },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { number: true, status: true, channel: true, totalBrl: true, paidAt: true, createdAt: true, trackingCode: true, carrier: true, _count: { select: { items: true } } }
      }),
      prisma.passwordResetToken.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 5, select: { requestedBy: true, expiresAt: true, usedAt: true, createdAt: true } }),
      prisma.refreshToken.count({ where: { userId: id, revoked: false, expiresAt: { gt: new Date() } } }),
      // acessos: por userId (logins) + por e-mail (tentativas com senha errada antes de existir vínculo)
      prisma.loginEvent.findMany({
        where: { OR: [{ userId: id }, { email: user.email }] },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { kind: true, ok: true, reason: true, ip: true, userAgent: true, createdAt: true }
      }),
      prisma.loginEvent.groupBy({ by: ["ok"], where: { OR: [{ userId: id }, { email: user.email }] }, _count: { _all: true } })
    ]);
    const all = [...orders, ...guestOrders];
    const paid = all.filter((o) => PAID_STATUSES.includes(o.status));
    return {
      ...user,
      stats: {
        ordersCount: all.length,
        paidOrders: paid.length,
        spentBrl: round2(paid.reduce((s, o) => s + num(o.totalBrl), 0)),
        activeSessions: sessions,
        loginsOk: accessTotals.find((r) => r.ok)?._count._all ?? 0,
        loginsFailed: accessTotals.find((r) => !r.ok)?._count._all ?? 0
      },
      accessLog,
      orders: orders.map((o) => ({ ...o, itemsCount: o._count.items, _count: undefined, guest: false })),
      guestOrders: guestOrders.map((o) => ({ ...o, itemsCount: o._count.items, _count: undefined, guest: true })),
      passwordResets: resets
    };
  }

  async function updateCustomer(id, patch, admin) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw AppError.notFound("Cliente não encontrado");
    const data = {};
    if (typeof patch.name === "string" && patch.name.trim()) data.name = patch.name.trim();
    if (typeof patch.email === "string" && patch.email.trim()) {
      const email = patch.email.trim().toLowerCase();
      if (email !== user.email) {
        const taken = await prisma.user.findUnique({ where: { email } });
        if (taken) throw AppError.conflict("E-mail já usado por outro cliente");
        data.email = email;
      }
    }
    if (patch.phone !== undefined) data.phone = patch.phone == null ? null : String(patch.phone).replace(/\D/g, "") || null;
    if (patch.cpf !== undefined) data.cpf = patch.cpf == null ? null : String(patch.cpf).replace(/\D/g, "") || null;
    if (patch.address !== undefined) {
      data.address = patch.address && typeof patch.address === "object" && Object.values(patch.address).some(Boolean) ? patch.address : null;
    }
    if (patch.role !== undefined) {
      if (!["customer", "admin"].includes(patch.role)) throw AppError.badRequest("role inválido");
      if (patch.role !== "admin" && admin?.id === id) throw AppError.badRequest("Você não pode remover seu próprio acesso admin");
      data.role = patch.role;
    }
    if (!Object.keys(data).length) throw AppError.badRequest("Nada para atualizar");
    const updated = await prisma.user.update({ where: { id }, data });
    log?.info({ userId: id, adminId: admin?.id, changes: Object.keys(data) }, "admin: cliente atualizado");
    return getCustomer(updated.id);
  }

  async function revokeCustomerSessions(id) {
    const r = await prisma.refreshToken.updateMany({ where: { userId: id, revoked: false }, data: { revoked: true } });
    return { revoked: r.count };
  }

  return {
    dashboard,
    listOrders,
    getOrder,
    createManualOrder,
    updateOrder,
    recheckPayment,
    resendOrderEmail,
    listCustomers,
    getCustomer,
    updateCustomer,
    revokeCustomerSessions
  };
}
