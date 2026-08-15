/**
 * Interface abstrata para o gateway de pagamento.
 * @typedef {Object} PaymentGateway
 * @property {(order: any) => Promise<{url: string, providerRef: string}>} createCheckoutLink
 * @property {(params: {orderNsu: string, transactionNsu: string, slug: string}) => Promise<{paid: boolean, paidAmountCents: number, installments: number, captureMethod: string}>} confirmPayment
 * @property {(body: any) => any} parseWebhook
 */

import { createInfinitePayGateway } from './infinitepay.js';
import { createMockGateway } from './mock.js';

export function createPaymentGateway(env, log) {
  if (env.PAYMENT_PROVIDER === 'infinitepay') {
    return createInfinitePayGateway(env, log);
  }
  return createMockGateway(env, log);
}
