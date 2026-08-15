import { AppError } from '../../lib/errors.js';

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

  app.post('/api/webhooks/infinitepay', async (req) => {
    // Processamento assíncrono para liberar rápido o webhook
    // Na fase final, deveria ser enfileirado num Job.
    orders.handleWebhook(req.body).catch(() => {});
    return { ok: true };
  });

  app.get('/api/orders/:number', async (req) => {
    let userId = null;
    try {
      await req.jwtVerify();
      userId = req.user.sub; // o JWT carrega o id do usuário em `sub`
    } catch {
      // Guest access allowed for confirmation page
    }
    return orders.getOrder(req.params.number, userId);
  });
}
