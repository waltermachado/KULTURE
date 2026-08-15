import crypto from 'crypto';

export function createMockGateway(env, log) {
  return {
    async createCheckoutLink(order) {
      // Retorna uma URL local para simular a aprovação/recusa
      const mockSlug = `mock_slug_${crypto.randomBytes(4).toString('hex')}`;
      const url = `${env.PUBLIC_WEB_URL}/mock/infinitepay/${order.number}?slug=${mockSlug}`;
      log?.info({ orderNumber: order.number, url }, 'MockGateway: createCheckoutLink');
      return { url, providerRef: mockSlug };
    },

    async confirmPayment({ orderNsu, transactionNsu, slug }) {
      log?.info({ orderNsu, transactionNsu, slug }, 'MockGateway: confirmPayment');
      // No mock, nós sempre vamos simular que foi pago se o transactionNsu for enviado
      return {
        paid: true,
        paidAmountCents: 10000, // 100 reais fake
        installments: 1,
        captureMethod: 'pix'
      };
    },

    parseWebhook(body) {
      // Simplesmente retorna o corpo pois o mock usará o mesmo formato
      return body;
    }
  };
}
