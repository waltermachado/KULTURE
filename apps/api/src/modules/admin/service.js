/**
 * Serviço do backoffice (admin). Só é chamado por rotas protegidas por requireAdmin.
 * Aqui o breakdown interno PODE aparecer — é o painel do dono, não a API pública.
 */
import { AppError } from "../../lib/errors.js";
import { buildOrderPaidEmail, buildOrderShippedEmail, buildOrderDeliveredEmail, buildOrderCancelledEmail } from "../mail/mailer.js";

/** Pedidos que contam como receita (dinheiro entrou e não foi devolvido). */
export const PAID_STATUSES = ["paid", "sourcing", "shipped", "delivered"];

/** Transições permitidas no painel. `pending_payment → paid` = baixa manual (comprovante fora do fluxo). */
export const ORDER_TRANSITIONS = {
  pending_payment: ["paid", "cancelled", "abandoned"],
  abandoned: ["paid", "cancelled"],
  paid: ["sourcing", "shipped", "cancelled", "refunded"],
  sourcing: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: []
};

export const ORDER_STATUS_LABELS = {
  pending_payment: "Aguardando pagamento",
  paid: "Pago",
  sourcing: "Comprando nos EUA",
  shipped: "Enviado",
  delivered: "Entregue",
  abandoned: "Abandonado",
  cancelled: "Cancelado",
  refunded: "Estornado"
};

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

export function createAdminService({ prisma, env, mailer, gateway, orders, log }) {
  const siteUrl = env.PUBLIC_WEB_URL;

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
            paymentMethod: true, customerName: true, userId: true,
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
          select: { number: true, status: true, customerName: true, totalBrl: true, createdAt: true, paidAt: true }
        }),
        prisma.order.groupBy({ by: ["status"], _count: { _all: true } })
      ]);

    let revenue = 0, cost = 0, margin = 0, itemsSold = 0, withBreakdown = 0;
    const byDay = new Map();
    const productMap = new Map();
    const methodMap = new Map();
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
        customersNew
      },
      series,
      byStatus: Object.fromEntries(byStatusAll.map((r) => [r.status, r._count._all])),
      byStatusPeriod: Object.fromEntries(statusCounts.map((r) => [r.status, r._count._all])),
      byPaymentMethod: Object.fromEntries([...methodMap.entries()].map(([k, v]) => [k, round2(v)])),
      topProducts: [...productMap.values()].sort((a, b) => b.quantity - a.quantity || b.revenueBrl - a.revenueBrl).slice(0, 8),
      recentOrders: recent,
      statusLabels: ORDER_STATUS_LABELS
    };
  }

  // ─── Pedidos ──────────────────────────────────────────────────────────

  function orderWhere({ status, q, from, to } = {}) {
    const where = {};
    if (status) {
      const list = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length === 1) where.status = list[0];
      else if (list.length > 1) where.status = { in: list };
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

  async function listOrders({ status, q, from, to, page = 1, pageSize = 25, sort = "createdAt:desc" } = {}) {
    const take = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const p = Math.max(Number(page) || 1, 1);
    const [field, dir] = String(sort).split(":");
    const orderBy = { [["createdAt", "paidAt", "totalBrl", "status", "updatedAt"].includes(field) ? field : "createdAt"]: dir === "asc" ? "asc" : "desc" };
    const where = orderWhere({ status, q, from, to });
    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy,
        skip: (p - 1) * take,
        take,
        select: {
          id: true, number: true, status: true, customerName: true, customerEmail: true, customerPhone: true,
          totalBrl: true, paidAmountBrl: true, paymentMethod: true, paymentProvider: true,
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
        user: { select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true } }
      }
    });
    if (!order) throw AppError.notFound("Pedido não encontrado");
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

    if (mailKind && patch.notifyCustomer !== false) {
      const build =
        mailKind === "shipped" ? buildOrderShippedEmail
        : mailKind === "delivered" ? buildOrderDeliveredEmail
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
    const build = kind === "shipped" ? buildOrderShippedEmail : kind === "delivered" ? buildOrderDeliveredEmail : buildOrderPaidEmail;
    const result = await sendMail(order, build);
    await prisma.orderEvent.create({ data: { orderId: order.id, type: `email_${kind}_resent`, payload: { ok: Boolean(result?.ok), error: result?.error ?? null } } });
    return { ok: Boolean(result?.ok), provider: mailer?.provider ?? null, error: result?.error ?? null };
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
        select: { number: true, status: true, totalBrl: true, paidAt: true, createdAt: true, trackingCode: true, carrier: true, _count: { select: { items: true } } }
      }),
      // pedidos feitos como convidado com o mesmo e-mail (antes de criar conta, por exemplo)
      prisma.order.findMany({
        where: { userId: null, customerEmail: user.email },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { number: true, status: true, totalBrl: true, paidAt: true, createdAt: true, trackingCode: true, carrier: true, _count: { select: { items: true } } }
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
    updateOrder,
    recheckPayment,
    resendOrderEmail,
    listCustomers,
    getCustomer,
    updateCustomer,
    revokeCustomerSessions
  };
}
