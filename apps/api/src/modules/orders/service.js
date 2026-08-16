import { AppError } from '../../lib/errors.js';

import { buildOrderPaidEmail } from "../mail/mailer.js";

export function createOrderService(env, prisma, catalog, gateway, notifier, log, mailer = null) {
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
      msg += `\n- ${item.name} — tam. BR ${item.brLabel || item.nikeSize} (US ${item.nikeSize}) × ${item.quantity} — R$ ${item.unitPriceBrl}`;
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

  return {
    async checkout({ items, customer, address }, idempotencyKey, userId = null) {
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
        const rate = await catalog.getRate();

        for (const item of items) {
          const { product } = await catalog.getProductSizes(item.styleColor);
          if (!product) throw AppError.badRequest(`Produto ${item.styleColor} não encontrado`);
          
          const sizeInfo = product.sizes.find(s => s.nikeSize === item.nikeSize);
          if (!sizeInfo) throw AppError.badRequest(`Tamanho ${item.nikeSize} inválido para ${product.name}`);
          if (!sizeInfo.available) throw AppError.badRequest(`Tamanho ${item.nikeSize} do ${product.name} esgotado`);
          
          const qty = item.quantity || 1;
          const unitBrl = product.price.brl;
          subtotalBrl += unitBrl * qty;

          orderItemsData.push({
            styleColor: product.styleColor || product.id,
            name: product.name,
            colorDescription: product.colorDescription,
            image: product.images?.[0] || null,
            nikeSize: sizeInfo.nikeSize,
            brSize: sizeInfo.brSize,
            brLabel: sizeInfo.brLabel,
            unitPriceBrl: unitBrl,
            unitPriceUsd: product.priceUsd,
            quantity: qty,
            breakdown: product.price.breakdown || {}
          });
        }

        const shippingBrl = 0;
        const totalBrl = subtotalBrl + shippingBrl;

        const orderNumber = `KLT-${new Date().getFullYear()}-${Math.floor(Math.random()*1000000).toString().padStart(6,'0')}`;

        const order = await prisma.$transaction(async (tx) => {
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
              exchangeRate: rate.ask,
              pricingSnapshot: {}, 
              paymentProvider: env.PAYMENT_PROVIDER,
              items: {
                create: orderItemsData
              },
              events: {
                create: [{ type: 'created', payload: {} }]
              }
            },
            include: { items: true }
          });
          return created;
        });

        // Cliente logado: lembra telefone/CPF/endereço no perfil para não redigitar na próxima compra
        // (best-effort: falha aqui não pode impedir o checkout).
        if (userId) {
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

        const checkoutLink = await gateway.createCheckoutLink(order);

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
      if (order.status === 'paid') return { paid: true }; 

      const status = await gateway.confirmPayment({ orderNsu: orderNumber, transactionNsu, slug });
      
      if (status.paid) {
        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'paid',
            paidAt: new Date(),
            transactionNsu,
            receiptUrl,
            paidAmountBrl: Number(status.paidAmountCents) / 100,
            installments: status.installments,
            paymentMethod: status.captureMethod,
            events: {
              create: { type: 'payment_confirmed', payload: { transactionNsu, captureMethod, receiptUrl } }
            }
          },
          include: { items: true }
        });
        
        await notify(updatedOrder, 'paid');
        emailPaid(updatedOrder); // fire-and-forget
        return { paid: true };
      }
      return { paid: false };
    },

    async handleWebhook(body) {
      const parsed = gateway.parseWebhook(body);
      const orderNumber = parsed.order_nsu;
      if (!orderNumber) return { ok: true };

      const order = await prisma.order.findUnique({ where: { number: orderNumber } });
      if (!order || order.status === 'paid') return { ok: true };
      if (order.transactionNsu && order.transactionNsu === parsed.transaction_nsu) return { ok: true };

      try {
        const status = await gateway.confirmPayment({ 
          orderNsu: orderNumber, 
          transactionNsu: parsed.transaction_nsu, 
          slug: parsed.invoice_slug 
        });

        if (status.paid) {
          const updatedOrder = await prisma.order.update({
            where: { id: order.id },
            data: {
              status: 'paid',
              paidAt: new Date(),
              transactionNsu: parsed.transaction_nsu,
              receiptUrl: parsed.receipt_url,
              paidAmountBrl: Number(status.paidAmountCents) / 100,
              installments: status.installments,
              paymentMethod: status.captureMethod,
              events: {
                create: { type: 'webhook_received', payload: parsed }
              }
            },
            include: { items: true }
          });
          await notify(updatedOrder, 'paid');
        emailPaid(updatedOrder); // fire-and-forget
        }
      } catch (err) {
        log?.error({ err: err.message, body }, 'Erro no webhook');
      }
      return { ok: true };
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
          items: { select: { name: true, image: true, nikeSize: true, brLabel: true, quantity: true, unitPriceBrl: true, styleColor: true } }
        }
      });
      return { orders: rows };
    }
  };
}
