/**
 * Cupons de desconto.
 *  - Cadastro no painel (/admin/cupons): código, % ou R$ fixo, teto do desconto (para %), mínimo de compra,
 *    validade (início/fim), limite de usos, ativo, observação.
 *  - O cliente digita na sacola (POST /api/coupons/validate só confere e mostra o desconto) e o checkout manda
 *    `coupon`: o servidor revalida e calcula o desconto de novo — o front nunca decide valor.
 *  - `usedCount` só sobe quando o pedido é PAGO (settle); um checkout abandonado não consome o cupom.
 */
import { AppError } from "../../lib/errors.js";

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const round2 = (v) => Math.round(Number(v) * 100) / 100;
const num = (v) => (v == null || v === "" ? null : Number(String(v).replace(",", ".")));

export const normalizeCode = (c) => String(c ?? "").trim().toUpperCase().replace(/\s+/g, "");

/** Motivo (em português) pelo qual um cupom NÃO vale agora; null = válido. */
export function rejectionReason(coupon, { subtotalBrl = 0, now = new Date() } = {}) {
  if (!coupon) return "Cupom não encontrado";
  if (!coupon.active) return "Este cupom não está mais ativo";
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return "Este cupom ainda não começou a valer";
  if (coupon.endsAt && now > new Date(coupon.endsAt)) return "Este cupom expirou";
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) return "Este cupom já atingiu o limite de usos";
  const min = coupon.minSubtotalBrl != null ? Number(coupon.minSubtotalBrl) : null;
  if (min != null && Number(subtotalBrl) < min) return `Este cupom vale para compras a partir de ${min.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
  return null;
}

/** Desconto em R$ para um subtotal (nunca maior que o subtotal). */
export function discountFor(coupon, subtotalBrl) {
  const sub = Number(subtotalBrl) || 0;
  let d = coupon.kind === "fixed" ? Number(coupon.value) : sub * (Number(coupon.value) / 100);
  if (coupon.kind === "percent" && coupon.maxDiscountBrl != null) d = Math.min(d, Number(coupon.maxDiscountBrl));
  return round2(Math.max(0, Math.min(d, sub)));
}

export function describe(coupon) {
  return coupon.kind === "fixed"
    ? `${Number(coupon.value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de desconto`
    : `${Number(coupon.value)}% de desconto${coupon.maxDiscountBrl != null ? ` (até ${Number(coupon.maxDiscountBrl).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})` : ""}`;
}

function normalizeInput(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || body.code !== undefined) {
    out.code = normalizeCode(body.code);
    if (!CODE_RE.test(out.code)) throw AppError.badRequest("Código: 2 a 30 caracteres, só letras, números, - e _ (ex.: KULTURE10)");
  }
  if (!partial || body.kind !== undefined) {
    out.kind = body.kind === "fixed" ? "fixed" : body.kind === "percent" ? "percent" : null;
    if (!out.kind) throw AppError.badRequest("Tipo: % ou R$");
  }
  if (!partial || body.value !== undefined) {
    const v = num(body.value);
    if (v == null || !Number.isFinite(v) || v <= 0) throw AppError.badRequest("Valor do desconto deve ser maior que zero");
    const kind = out.kind ?? body.kind;
    if (kind === "percent" && v > 100) throw AppError.badRequest("Desconto em % vai até 100");
    if (kind === "fixed" && v > 100000) throw AppError.badRequest("Desconto em R$ muito alto");
    out.value = round2(v);
  }
  for (const [k, label] of [["minSubtotalBrl", "Mínimo de compra"], ["maxDiscountBrl", "Teto do desconto"]]) {
    if (!partial || body[k] !== undefined) {
      const v = num(body[k]);
      if (v != null && (!Number.isFinite(v) || v < 0)) throw AppError.badRequest(`${label}: valor inválido`);
      out[k] = v == null ? null : round2(v);
    }
  }
  for (const k of ["startsAt", "endsAt"]) {
    if (!partial || body[k] !== undefined) {
      if (body[k] == null || body[k] === "") out[k] = null;
      else {
        const d = new Date(body[k]);
        if (Number.isNaN(d.getTime())) throw AppError.badRequest(k === "startsAt" ? "Data de início inválida" : "Data de fim inválida");
        out[k] = d;
      }
    }
  }
  if (!partial || body.maxUses !== undefined) {
    const v = body.maxUses == null || body.maxUses === "" ? null : parseInt(body.maxUses, 10);
    if (v != null && (!Number.isFinite(v) || v < 1)) throw AppError.badRequest("Limite de usos: número inteiro maior que zero (ou vazio = sem limite)");
    out.maxUses = v;
  }
  if (!partial || body.active !== undefined) out.active = body.active !== false;
  if (!partial || body.note !== undefined) out.note = String(body.note ?? "").trim().slice(0, 300) || null;
  if (out.startsAt && out.endsAt && out.endsAt < out.startsAt) throw AppError.badRequest("A data de fim precisa ser depois do início");
  return out;
}

export function createCouponService({ prisma, log }) {
  async function findByCode(code) {
    const c = normalizeCode(code);
    if (!c) return null;
    return prisma.coupon.findUnique({ where: { code: c } });
  }

  /** Validação pública: { ok, code, discountBrl, description } ou { ok:false, message }. Nunca lança por cupom ruim. */
  async function validate(code, subtotalBrl) {
    const coupon = await findByCode(code);
    const reason = rejectionReason(coupon, { subtotalBrl });
    if (reason) return { ok: false, message: reason };
    return { ok: true, code: coupon.code, kind: coupon.kind, value: Number(coupon.value), description: describe(coupon), discountBrl: discountFor(coupon, subtotalBrl) };
  }

  /** Para o checkout: devolve { couponCode, discountBrl } ou lança 400 com o motivo. */
  async function applyForCheckout(code, subtotalBrl) {
    if (!normalizeCode(code)) return { couponCode: null, discountBrl: 0 };
    const r = await validate(code, subtotalBrl);
    if (!r.ok) throw AppError.badRequest(`Cupom ${normalizeCode(code)}: ${r.message.toLowerCase()}`);
    return { couponCode: r.code, discountBrl: r.discountBrl };
  }

  /** Pedido pago: consome 1 uso (idempotente por pedido — só conta uma vez). */
  async function consume(order, tx = prisma) {
    if (!order?.couponCode) return;
    await tx.coupon.updateMany({ where: { code: order.couponCode }, data: { usedCount: { increment: 1 } } }).catch((err) => log?.warn({ err: err.message, order: order.number }, "coupon: falha ao contar uso"));
  }

  // ---- admin ----
  const list = () => prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
  async function create(body, actor = null) {
    const data = normalizeInput(body);
    if (await prisma.coupon.findUnique({ where: { code: data.code } })) throw AppError.conflict(`Já existe um cupom ${data.code}`);
    const c = await prisma.coupon.create({ data: { ...data, createdBy: actor?.id ?? null } });
    log?.info({ code: c.code, by: actor?.email }, "coupon: criado");
    return c;
  }
  async function update(id, body, actor = null) {
    const current = await prisma.coupon.findUnique({ where: { id } });
    if (!current) throw AppError.notFound("Cupom não encontrado");
    const data = normalizeInput({ ...body, kind: body.kind ?? current.kind }, { partial: true });
    if (data.code && data.code !== current.code && (await prisma.coupon.findUnique({ where: { code: data.code } }))) throw AppError.conflict(`Já existe um cupom ${data.code}`);
    if (data.value != null && (data.kind ?? current.kind) === "percent" && data.value > 100) throw AppError.badRequest("Desconto em % vai até 100");
    const c = await prisma.coupon.update({ where: { id }, data });
    log?.info({ code: c.code, by: actor?.email }, "coupon: atualizado");
    return c;
  }
  async function remove(id) {
    const current = await prisma.coupon.findUnique({ where: { id } });
    if (!current) throw AppError.notFound("Cupom não encontrado");
    await prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  return { validate, applyForCheckout, consume, list, create, update, remove, findByCode };
}
