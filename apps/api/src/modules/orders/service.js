import { AppError } from '../../lib/errors.js';
import { pricingRateOf } from '../catalog/normalize.js';
import { sizeLabel as buildSizeLabel } from "@kulture/shared/sizes";

import { buildOrderPaidEmail } from "../mail/mailer.js";

/**
 * Só aceita como URL de retorno origens conhecidas: PUBLIC_WEB_URL/PUBLIC_API_URL, domínio do Railway,
 * hosts extras (PUBLIC_WEB_HOSTS) e localhost em dev. Qualquer outra → PUBLIC_WEB_URL.
 */
export function resolveWebUrl(env, webOrigin) {
  if (!webOrigin) return env.PUBLIC_WEB_URL;
  try {
    const u = new URL(webOrigin);
    const allowed = new Set(
      [env.PUBLIC_WEB_URL, env.PUBLIC_API_URL]
        .map((x) => { try { return new URL(x).hostname; } catch { return null; } })
        .concat(process.env.RAILWAY_PUBLIC_DOMAIN || null, ...(env.PUBLIC_WEB_HOSTS || []))
        .filter(Boolean)
        .map((h) => String(h).toLowerCase())
    );
    const host = u.hostname.toLowerCase();
    const isLocal = env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1');
    if (allowed.has(host) || isLocal) return `${u.protocol}//${u.host}`;
  } catch {
    /* origem inválida → canônica */
  }
  return env.PUBLIC_WEB_URL;
}

/** Rótulo do tamanho do item do pedido: o salvo no checkout ("BR 38 (US M 7)") ou, em pedidos antigos, "BR 41 (US 8.5)". */
export function sizeLabelOf(item) {
  if (item.sizeLabel) return item.sizeLabel;
  const br = item.brLabel ?? item.brSize ?? "?";
  return item.nikeSize && String(item.nikeSize) !== String(br) ? `BR ${br} (US ${item.nikeSize})` : `BR ${br}`;
}

/** Nike By You: "By You · pé E “KULTURE” nº 08 · pé D “MAMBA” nº 24" (só o que foi preenchido). */
export function customizationLabelOf(c) {
  if (!c || typeof c !== "object") return null;
  const foot = (t, n, lbl) => {
    const parts = [];
    if (t) parts.push(`“${t}”`);
    if (n) parts.push(`nº ${n}`);
    return parts.length ? `pé ${lbl} ${parts.join(" ")}` : null;
  };
  const items = [foot(c.textLeft, c.numberLeft, "E"), foot(c.textRight, c.numberRight, "D")].filter(Boolean);
  return items.length ? `By You · ${items.join(" · ")}` : "By You · sem gravação";
}

/** Número de pedido "KLT-AAAA-NNNNNN" — o mesmo para checkout do site e venda registrada no painel. */
export function newOrderNumber(now = new Date()) {
  return `KLT-${now.getFullYear()}-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;
}

const CUSTOM_TEXT_RE = /^[A-Za-z0-9 .,'&!?#\-]{0,8}$/;
/** Valida/normaliza a personalização enviada pelo cliente (texto ≤ 8 chars por pé, número 0–99 por pé). */
function normalizeCustomization(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (v) => (v == null ? "" : String(v).trim().slice(0, 40));
  const num = (v) => (v == null ? "" : String(v).trim().replace(/\D/g, "").slice(0, 2));
  const out = { textLeft: text(raw.textLeft), numberLeft: num(raw.numberLeft), textRight: text(raw.textRight), numberRight: num(raw.numberRight) };
  for (const k of ["textLeft", "textRight"]) {
    if (out[k].length > 8) throw AppError.badRequest(`Personalização: o texto do pé ${k === "textLeft" ? "esquerdo" : "direito"} tem no máximo 8 caracteres`);
    if (!CUSTOM_TEXT_RE.test(out[k])) throw AppError.badRequest("Personalização: use só letras, números, espaço e . , ' & ! ? # -");
  }
  const any = Object.values(out).some(Boolean);
  return any ? out : null;
}

/** `stock` (opcional) = serviço de pronta entrega: reserva por tamanho na criação do pedido. */
export function createOrderService(env, prisma, catalog, gateway, notifier, log, mailer = null, stock = null) {
  /** E-mail de confirmação ao cliente (não bloqueia; falha só loga). */
  async function emailPaid(order) {
    if (!mailer || !order?.customerEmail) return;
    try {
      const { subject, text, html } = buildOrderPaidEmail(order, { siteUrl: env.PUBLIC_WEB_URL });
      await mailer.send({ to: order.customerEmail, toName: order.customerName, subject, text, html });
    } catch (err) {
      log?.warn({ err: err.message, order: order.number }, "mail: falha ao enviar confirmação");
    }
  }


  const formatMsg = (order, text) => {
    let msg = text + `\n\nPedido: *${order.number}*\nCliente: ${order.customerName}\nLocal: ${order.address?.city || ''}/${order.address?.state || ''}\n\n*Itens:*`;
    for(const item of order.items) {
      msg += `\n- ${item.name} — tam. ${sizeLabelOf(item)} × ${item.quantity} — R$ ${item.unitPriceBrl}`;
      const cust = customizationLabelOf(item.customization);
      if (cust) msg += `\n  ${cust}`;
    }
    msg += `\n\n*Total:* R$ ${order.totalBrl}`;
    if (order.paymentMethod) msg += `\nForma de pagamento: ${order.paymentMethod === 'pix' ? 'Pix' : 'Cartão'}`;
    if (order.receiptUrl) msg += `\nComprovante: ${order.receiptUrl}`;
    return msg;
  };

  async function notify(order, eventType) {
    const to = env.WHATSAPP_TO || order.customerPhone;
    if (!to) return;
    
    let text = '';
    let eventName = '';
    
    if (eventType === 'pending' && !order.notifiedPendingAt) {
      text = '🟡 Novo checkout iniciado';
      eventName = 'pending';
    } else if (eventType === 'paid' && !order.notifiedPaidAt) {
      text = '🟢 Pagamento confirmado! Seu pedido está sendo processado.';
      eventName = 'paid';
    } else if (eventType === 'abandoned' && !order.notifiedAbandonedAt) {
      text = '🔴 Notamos que você não finalizou o pagamento do seu pedido.';
      eventName = 'abandoned';
    } else {
      return;
    }

    try {
      await notifier.sendText({
        to,
        text: formatMsg(order, text),
        event: eventName,
        orderId: order.id
      });
      
      const updateData = {};
      if (eventName === 'pending') updateData.notifiedPendingAt = new Date();
      else if (eventName === 'paid') updateData.notifiedPaidAt = new Date();
      else if (eventName === 'abandoned') updateData.notifiedAbandonedAt = new Date();
      
      await prisma.order.update({
        where: { id: order.id },
        data: updateData
      });
    } catch(e) {
      log?.error({ err: e.message, eventType, orderId: order.id }, 'Erro ao notificar WhatsApp');
    }
  }

  /**
   * Marca o pedido como pago depois de o gateway confirmar. Único ponto que muda para `paid`
   * (redirect do cliente, webhook e "reconsultar" do admin passam todos por aqui).
   * Regras: `paid` só se o gateway disser paid===true; se o gateway informar `amount`, ele tem
   * de bater com o total do pedido (tolerância R$ 1,00) — divergência vira evento e NÃO marca pago.
   */
  async function settle(order, { transactionNsu, slug, receiptUrl, captureMethod, source }) {
    const status = await gateway.confirmPayment({ orderNsu: order.number, transactionNsu, slug });
    const expectedCents = Math.round(Number(order.totalBrl) * 100);
    if (status.paid && Number.isFinite(status.amountCents) && Math.abs(status.amountCents - expectedCents) > 100) {
      log?.error({ order: order.number, expectedCents, amountCents: status.amountCents, source }, 'pagamento: valor divergente — NÃO marcado como pago');
      await prisma.orderEvent.create({
        data: { orderId: order.id, type: 'payment_amount_mismatch', payload: { source, transactionNsu, slug, expectedCents, amountCents: status.amountCents, paidAmountCents: status.paidAmountCents } }
      }).catch(() => {});
      return { paid: false, mismatch: true };
    }
    if (!status.paid) {
      await prisma.orderEvent.create({
        data: { orderId: order.id, type: 'payment_check_unpaid', payload: { source, transactionNsu, slug } }
      }).catch(() => {});
      return { paid: false };
    }
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        transactionNsu: transactionNsu || order.transactionNsu || null,
        infinitepaySlug: slug || order.infinitepaySlug || null,
        receiptUrl: receiptUrl || order.receiptUrl || null,
        paidAmountBrl: Number(status.paidAmountCents) / 100,
        installments: status.installments,
        paymentMethod: status.captureMethod || captureMethod || null,
        events: {
          create: { type: source === 'webhook' ? 'webhook_received' : 'payment_confirmed', payload: { source, transactionNsu, slug, captureMethod: status.captureMethod, receiptUrl, paidAmountCents: status.paidAmountCents, installments: status.installments } }
        }
      },
      include: { items: true }
    });
    // pronta entrega: pedido abandonado (estoque devolvido) que acabou pago → reserva de novo
    if (stock && order.stockReleasedAt) {
      await stock.ensureReservedForPaid(updatedOrder).catch((err) => log?.error({ err: err.message, order: order.number }, 'stock: falha ao re-reservar'));
    }
    await notify(updatedOrder, 'paid');
    emailPaid(updatedOrder); // fire-and-forget
    return { paid: true };
  }

  return {
    async checkout({ items, customer, address }, idempotencyKey, userId = null, { webOrigin = null } = {}) {
      if (idempotencyKey) {
        const existing = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
        if (existing) {
          if (!existing.response) throw AppError.conflict('Pedido já está sendo processado (lock)');
          return existing.response;
        }
        await prisma.idempotencyKey.create({ data: { key: idempotencyKey, response: null } });
      }

      try {
        if (!items || items.length === 0) throw AppError.badRequest('Carrinho vazio');
        if (!customer || !customer.name || !customer.email || !customer.cpf) throw AppError.badRequest('Dados do cliente incompletos');
        
        let subtotalBrl = 0;
        const orderItemsData = [];
        const reservations = []; // pronta entrega: decremento condicional dentro da transação do pedido
        const rate = await catalog.getRate();

        for (const item of items) {
          const { product } = await catalog.getProductSizes(item.styleColor);
          if (!product) throw AppError.badRequest(`Produto ${item.styleColor} não encontrado`);

          const sizeInfo = product.sizes.find(s => s.nikeSize === item.nikeSize);
          if (!sizeInfo) throw AppError.badRequest(`Tamanho ${item.nikeSize} inválido para ${product.name}`);
          if (!sizeInfo.available) throw AppError.badRequest(`Tamanho ${item.nikeSize} do ${product.name} esgotado`);
          // modelagem escolhida (aba Masculino/Feminino/Infantil): só vale se o tamanho tem esse US; senão a escala do SKU
          const gender = ["M", "W", "K"].includes(item.sizeGender) && sizeInfo.us?.[item.sizeGender] ? item.sizeGender : null;
          const sizeLabel = buildSizeLabel(sizeInfo, gender);
          // Nike By You: personalização por pé (texto ≤ 8, nº 2 dígitos); ignorada em produto que não é By You
          const customization = product.byYou ? normalizeCustomization(item.customization) : null;

          const qty = Math.max(1, Math.min(10, Number(item.quantity) || 1));
          const unitBrl = product.price.brl;
          subtotalBrl += unitBrl * qty;

          const isStock = product.source === 'stock';
          if (isStock) {
            if (!stock) throw AppError.badRequest(`Produto ${item.styleColor} indisponível`);
            if (Number(sizeInfo.qty) < qty) throw AppError.badRequest(`${product.name} (BR ${sizeInfo.brLabel}): só ${sizeInfo.qty} unidade(s) disponível(is)`);
            reservations.push({ stockSizeId: sizeInfo.stockSizeId, qty, label: `${product.name} (BR ${sizeInfo.brLabel})` });
          }

          orderItemsData.push({
            styleColor: product.styleColor || product.id,
            name: product.name,
            colorDescription: product.colorDescription,
            image: product.images?.[0] || null,
            nikeSize: sizeInfo.nikeSize,
            brSize: sizeInfo.brSize,
            brLabel: sizeInfo.brLabel,
            sizeLabel,
            customization,
            unitPriceBrl: unitBrl,
            unitPriceUsd: product.priceUsd ?? 0,
            quantity: qty,
            // pronta entrega: breakdown guarda a origem + ids do estoque (para devolver/re-reservar) e o custo
            // como `subtotalBrl` (mesmo campo que o dashboard usa para estimar custo/margem)
            breakdown: isStock
              ? { ...(product.price.breakdown || {}), source: 'stock', stockProductId: product.stockProductId, stockSizeId: sizeInfo.stockSizeId }
              : (product.price.breakdown || {})
          });
        }

        const shippingBrl = 0;
        const totalBrl = subtotalBrl + shippingBrl;

        // Convidado com e-mail já cadastrado: vincula a venda à conta (só o vínculo — o perfil do
        // usuário NÃO é alterado com dados digitados por quem não está autenticado).
        let linkedByEmail = false;
        if (!userId && customer.email) {
          const existing = await prisma.user.findUnique({ where: { email: String(customer.email).trim().toLowerCase() }, select: { id: true } });
          if (existing) {
            userId = existing.id;
            linkedByEmail = true;
          }
        }

        const orderNumber = newOrderNumber();

        const order = await prisma.$transaction(async (tx) => {
          // pronta entrega: reserva (qty >= n) na mesma transação — se dois clientes disputarem o último par,
          // só um pedido é criado; o outro recebe 409 STOCK_OUT
          if (reservations.length) await stock.reserve(tx, reservations);
          const created = await tx.order.create({
            data: {
              number: orderNumber,
              userId,
              customerName: customer.name,
              customerEmail: customer.email,
              customerPhone: customer.phone || '',
              customerCpf: customer.cpf,
              address: address || {},
              subtotalBrl,
              shippingBrl,
              totalBrl,
              exchangeRate: pricingRateOf(rate).usdToBrl, // dólar turismo usado na precificação
              pricingSnapshot: {}, 
              paymentProvider: env.PAYMENT_PROVIDER,
              items: {
                create: orderItemsData
              },
              events: {
                create: [{ type: 'created', payload: { userLink: userId ? (linkedByEmail ? 'email' : 'session') : 'guest' } }]
              }
            },
            include: { items: true }
          });
          return created;
        });

        // Cliente logado: lembra telefone/CPF/endereço no perfil para não redigitar na próxima compra
        // (best-effort: falha aqui não pode impedir o checkout).
        if (userId && !linkedByEmail) {
          try {
            await prisma.user.update({
              where: { id: userId },
              data: {
                phone: customer.phone ? String(customer.phone).replace(/\D/g, "") || undefined : undefined,
                cpf: customer.cpf ? String(customer.cpf).replace(/\D/g, "") || undefined : undefined,
                address: address && Object.values(address).some(Boolean) ? address : undefined
              }
            });
          } catch (err) {
            log?.warn({ err: err.message, userId }, "checkout: não foi possível atualizar o perfil");
          }
        }

        const checkoutLink = await gateway.createCheckoutLink(order, { webUrl: resolveWebUrl(env, webOrigin) });

        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: { 
            infinitepaySlug: checkoutLink.providerRef,
            events: {
              create: { type: 'link_created', payload: { providerRef: checkoutLink.providerRef } }
            }
          },
          include: { items: true }
        });

        await notify(updatedOrder, 'pending');

        const responseData = {
          orderNumber: order.number,
          checkoutUrl: checkoutLink.url,
          totalBrl,
          shipping: "free"
        };

        if (idempotencyKey) {
          await prisma.idempotencyKey.update({ where: { key: idempotencyKey }, data: { response: responseData } });
        }

        return responseData;
      } catch (err) {
        if (idempotencyKey) {
          await prisma.idempotencyKey.delete({ where: { key: idempotencyKey } }).catch(() => {});
        }
        throw err;
      }
    },

    async confirm({ orderNumber, transactionNsu, slug, captureMethod, receiptUrl }) {
      const order = await prisma.order.findUnique({
        where: { number: orderNumber },
        include: { items: true }
      });
      if (!order) throw AppError.notFound('Pedido não encontrado');
      if (['paid', 'sourcing', 'shipped', 'delivered'].includes(order.status)) return { paid: true };
      if (!transactionNsu && !slug && !order.transactionNsu && !order.infinitepaySlug) return { paid: false, reason: 'sem transação' };
      return settle(order, {
        transactionNsu: transactionNsu || order.transactionNsu,
        slug: slug || order.infinitepaySlug,
        receiptUrl,
        captureMethod,
        source: 'confirm'
      });
    },

    /**
     * Webhook da InfinitePay: { invoice_slug, amount, paid_amount, installments, capture_method,
     * transaction_nsu, order_nsu, receipt_url, items }. Idempotente. Lança em erro de infra para a
     * rota devolver 400 e a InfinitePay retentar.
     */
    async handleWebhook(body) {
      const parsed = gateway.parseWebhook(body) || {};
      const orderNumber = parsed.order_nsu;
      if (!orderNumber) return { ok: true, ignored: 'sem order_nsu' };

      const order = await prisma.order.findUnique({ where: { number: orderNumber }, include: { items: true } });
      if (!order) return { ok: true, ignored: 'pedido desconhecido' };
      if (['paid', 'sourcing', 'shipped', 'delivered'].includes(order.status)) return { ok: true, alreadyPaid: true };

      const result = await settle(order, {
        transactionNsu: parsed.transaction_nsu,
        slug: parsed.invoice_slug,
        receiptUrl: parsed.receipt_url,
        captureMethod: parsed.capture_method,
        source: 'webhook'
      });
      return { ok: true, ...result };
    },

    /**
     * Visão pública de um pedido.
     *  - Dono do pedido (userId bate) ou admin → dados completos do cliente (sem breakdown interno).
     *  - Convidado / outro usuário → só o necessário para a página de confirmação/rastreio:
     *    status, itens, total, pagamento, rastreio e primeiro nome. CPF, e-mail, telefone e
     *    endereço completo NÃO saem (o número do pedido é adivinhável).
     */
    async getOrder(number, userId, { isAdmin = false } = {}) {
      const order = await prisma.order.findUnique({
        where: { number },
        include: { items: true }
      });
      if (!order) throw AppError.notFound('Pedido não encontrado');

      const isOwner = Boolean(userId && order.userId && order.userId === userId);
      const full = isAdmin || isOwner;

      const { pricingSnapshot, events, id, userId: uid, items, internalNotes, ...rest } = order;
      const publicItems = items.map(i => {
        const { breakdown, orderId, id: iid, ...publicItem } = i;
        return publicItem;
      });

      if (full) return { ...rest, items: publicItems, scope: 'full' };

      const firstName = String(order.customerName || '').trim().split(/\s+/)[0] || null;
      const addr = order.address || {};
      return {
        number: order.number,
        status: order.status,
        customerName: firstName,
        totalBrl: order.totalBrl,
        subtotalBrl: order.subtotalBrl,
        shippingBrl: order.shippingBrl,
        paymentProvider: order.paymentProvider,
        paymentMethod: order.paymentMethod,
        installments: order.installments,
        receiptUrl: order.receiptUrl,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        carrier: order.carrier,
        trackingCode: order.trackingCode,
        trackingUrl: order.trackingUrl,
        shippedAt: order.shippedAt,
        deliveredAt: order.deliveredAt,
        address: { city: addr.city ?? null, state: addr.state ?? null },
        items: publicItems,
        scope: 'public'
      };
    },

    /** Pedidos do usuário logado ("Meus pedidos"): pelo userId OU pelo e-mail (compras como convidado). */
    async listMine(userId, email) {
      const or = [{ userId }];
      if (email) or.push({ userId: null, customerEmail: String(email).toLowerCase() });
      const rows = await prisma.order.findMany({
        where: { OR: or },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          number: true, status: true, totalBrl: true, paymentMethod: true, paidAt: true, createdAt: true,
          carrier: true, trackingCode: true, trackingUrl: true, shippedAt: true, deliveredAt: true, receiptUrl: true,
          items: { select: { name: true, image: true, nikeSize: true, brLabel: true, sizeLabel: true, customization: true, quantity: true, unitPriceBrl: true, styleColor: true } }
        }
      });
      return { orders: rows };
    }
  };
}
