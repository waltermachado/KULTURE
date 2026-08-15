export function startAbandonedCheckoutJob(prisma, notifier, log) {
  const ABANDON_AFTER_MIN = 30; // 30 minutes
  const CHECK_INTERVAL_MIN = 5; // 5 minutes

  const checkAbandoned = async () => {
    try {
      const limitDate = new Date(Date.now() - ABANDON_AFTER_MIN * 60 * 1000);
      
      const abandonedOrders = await prisma.order.findMany({
        where: {
          status: 'pending_payment',
          createdAt: { lt: limitDate },
          paidAt: null,
          notifiedAbandonedAt: null
        },
        include: { items: true }
      });

      for (const order of abandonedOrders) {
        log?.info({ orderNumber: order.number }, 'AbandonedCheckoutJob: Marcando pedido como abandonado');
        
        const updated = await prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'abandoned',
            abandonedAt: new Date(),
            events: {
              create: { type: 'abandoned', payload: { reason: 'timeout' } }
            }
          },
          include: { items: true }
        });

        const to = order.customerPhone;
        if (to) {
          const text = '🔴 Notamos que você não finalizou o pagamento do seu pedido.';
          let msg = text + `\n\nPedido: *${order.number}*\nCliente: ${order.customerName}\nLocal: ${order.address?.city || ''}/${order.address?.state || ''}\n\n*Itens:*`;
          for(const item of order.items) {
            msg += `\n- ${item.name} — tam. BR ${item.brLabel || item.nikeSize} (US ${item.nikeSize}) × ${item.quantity} — R$ ${item.unitPriceBrl}`;
          }
          msg += `\n\n*Total:* R$ ${order.totalBrl}`;
          
          await notifier.sendText({
            to,
            text: msg,
            event: 'abandoned',
            orderId: order.id
          });

          await prisma.order.update({
            where: { id: order.id },
            data: { notifiedAbandonedAt: new Date() }
          });
        }
      }
    } catch (err) {
      log?.error({ err: err.message }, 'AbandonedCheckoutJob: Erro ao processar');
    }
  };

  const timer = setInterval(checkAbandoned, CHECK_INTERVAL_MIN * 60 * 1000);
  timer.unref(); // Não impede o Node de fechar

  return () => clearInterval(timer);
}
