import fetch from 'node-fetch';

export function createInfinitePayGateway(env, log) {
  const BASE_URL = env.INFINITEPAY_API_BASE;
  const handle = env.INFINITEPAY_HANDLE;
  const timeoutMs = 10000;

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  return {
    async createCheckoutLink(order) {
      // 100 centavos = R$ 1,00
      const items = order.items.map(item => ({
        description: `${item.name} — tam. BR ${item.brLabel || item.nikeSize} (US ${item.nikeSize})`,
        price: Math.round(Number(item.unitPriceBrl) * 100),
        quantity: item.quantity
      }));

      const payload = {
        handle,
        order_nsu: order.number,
        items,
        redirect_url: `${env.PUBLIC_WEB_URL}/pedido/confirmacao?order=${order.number}`,
      };

      if (!env.PUBLIC_API_URL.includes('localhost')) {
        payload.webhook_url = `${env.PUBLIC_API_URL}/api/webhooks/infinitepay`;
      }

      if (order.customerName && order.customerEmail) {
        payload.customer = {
          name: order.customerName,
          email: order.customerEmail,
          phone_number: order.customerPhone || ''
        };
      }

      const addressData = order.address || {};
      if (addressData.cep) {
        payload.address = {
          cep: addressData.cep,
          street: addressData.street || '',
          neighborhood: addressData.neighborhood || '',
          number: addressData.number || '',
          complement: addressData.complement || ''
        };
      }

      let attempt = 0;
      let lastErr;
      while (attempt < 2) {
        try {
          const res = await fetchWithTimeout(`${BASE_URL}/links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const rawResponse = await res.text();
          let data;
          try {
            data = JSON.parse(rawResponse);
          } catch(e) {
            log?.error({ rawResponse }, 'Failed to parse InfinitePay /links response as JSON');
            throw new Error('Invalid JSON from InfinitePay');
          }
          if (!res.ok) {
            log?.error({ status: res.status, data }, 'InfinitePay /links failed');
            throw new Error(`InfinitePay error: ${data.message || 'Unknown'}`);
          }
          log?.info({ rawResponse }, 'InfinitePay /links RAW response');
          
          const url = data.url;
          const providerRef = data.slug || data.id || 'unknown'; 
          return { url, providerRef };
        } catch (err) {
          lastErr = err;
          attempt++;
        }
      }
      throw lastErr;
    },

    async confirmPayment({ orderNsu, transactionNsu, slug }) {
      const payload = {
        handle,
        order_nsu: orderNsu,
        transaction_nsu: transactionNsu,
        slug
      };

      const res = await fetchWithTimeout(`${BASE_URL}/payment_check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        log?.error({ status: res.status, data }, 'InfinitePay /payment_check failed');
        throw new Error(`InfinitePay payment_check error`);
      }
      return {
        paid: data.paid === true || data.success === true,
        paidAmountCents: data.paid_amount || data.amount || 0,
        installments: data.installments || 1,
        captureMethod: data.capture_method || 'unknown'
      };
    },

    parseWebhook(body) {
      return body;
    }
  };
}
