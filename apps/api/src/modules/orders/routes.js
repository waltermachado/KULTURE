import { AppError } from '../../lib/errors.js';
import { requireAuth } from '../../lib/guards.js';

export async function orderRoutes(app) {
  const { orders } = app;

  app.post('/api/checkout', async (req) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) throw AppError.badRequest('Idempotency-Key é obrigatório no header');

    const { items, customer, address } = req.body;
    let userId = null;
    try {
      await req.jwtVerify();
      userId = req.user.sub; // o JWT carrega o id do usuário em `sub`
    } catch {
      // Guest
    }

    return orders.checkout({ items, customer, address }, idempotencyKey, userId);
  });

  app.post('/api/orders/:number/confirm', async (req) => {
    const { number } = req.params;
    const { transaction_nsu, slug, capture_method, receipt_url } = req.body;
    return orders.confirm({
      orderNumber: number,
      transactionNsu: transaction_nsu,
      slug,
      captureMethod: capture_method,
      receiptUrl: receipt_url
    });
  });

  // Webhook InfinitePay. Contrato deles: 200 {success:true,message:null} = recebido;
  // 400 {success:false,message} = falhou → eles retentam. Processamos síncrono (payment_check + update,
  // < 1 s típico) para poder devolver 400 em erro de infra e não perder o aviso.
  app.post('/api/webhooks/infinitepay', { config: { rateLimit: false } }, async (req, reply) => {
    try {
      const result = await orders.handleWebhook(req.body || {});
      req.log.info({ order: req.body?.order_nsu, result }, 'webhook infinitepay processado');
      return reply.code(200).send({ success: true, message: null });
    } catch (err) {
      req.log.error({ err: err.message, order: req.body?.order_nsu }, 'webhook infinitepay: falha (400 → retentativa)');
      return reply.code(400).send({ success: false, message: err.message || 'erro ao processar' });
    }
  });

  // "Meus pedidos" — precisa estar logado (rota estática vem antes de /:number no Fastify)
  app.get('/api/orders/mine', { onRequest: [requireAuth] }, async (req) => {
    return orders.listMine(req.user.sub, req.user.email);
  });

  app.get('/api/orders/:number', async (req) => {
    let userId = null;
    let isAdmin = false;
    try {
      await req.jwtVerify();
      userId = req.user.sub; // o JWT carrega o id do usuário em `sub`
      isAdmin = req.user.role === 'admin';
    } catch {
      // Convidado: recebe a visão mascarada (página de confirmação só precisa de status/itens)
    }
    return orders.getOrder(req.params.number, userId, { isAdmin });
  });
}
