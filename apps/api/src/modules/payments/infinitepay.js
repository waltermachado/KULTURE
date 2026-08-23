import { canonicalWebUrl } from "../../lib/site-url.js";
// usa o fetch global do Node ≥18 (node-fetch não é dependência do projeto)

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
    async createCheckoutLink(order, { webUrl } = {}) {
      const siteUrl = webUrl || canonicalWebUrl(env);
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
        // sem query string: a InfinitePay anexa ?transaction_nsu=&slug=&capture_method=&receipt_url=&order_nsu=
        redirect_url: `${siteUrl}/pedido/confirmacao/${encodeURIComponent(order.number)}`,
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
          if (!url) throw new Error('InfinitePay /links sem "url" na resposta');
          let providerRef = data.slug || data.id || null;
          if (!providerRef) {
            try { providerRef = new URL(url).searchParams.get('lenc') || null; } catch { providerRef = null; }
          }
          return { url, providerRef: providerRef || 'link' };
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
      // `success` = a consulta deu certo; `paid` = o cliente pagou. Nunca confundir os dois.
      return {
        paid: data.paid === true,
        amountCents: Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
        paidAmountCents: Number(data.paid_amount ?? data.amount ?? 0) || 0,
        installments: Number(data.installments) || 1,
        captureMethod: data.capture_method || 'unknown',
        raw: data
      };
    },

    parseWebhook(body) {
      return body;
    }
  };
}
