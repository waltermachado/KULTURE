import { paymentError } from "./errors.js";
import { canonicalWebUrl } from "../../lib/site-url.js";
// usa o fetch global do Node ≥18 (node-fetch não é dependência do projeto)

export function createInfinitePayGateway(env, log) {
  const BASE_URL = env.INFINITEPAY_API_BASE;
  const handle = env.INFINITEPAY_HANDLE;
  const timeoutMs = 10000;

  async function request(operation, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      // Classifica HTTP mesmo se a resposta for HTML ou vazia.
      if (!res.ok) throw paymentError({ status: res.status, operation });
      let data;
      try { data = JSON.parse(await res.text()); }
      catch (err) {
        if (controller.signal.aborted) throw err;
        throw paymentError({ operation, reason: "invalid_response" });
      }
      if (!data || typeof data !== "object" || Array.isArray(data) || data.success === false) {
        throw paymentError({ operation, reason: "invalid_response" });
      }
      return data;
    } catch (err) {
      const failure = err.paymentFailure ? err : paymentError({ operation, reason: controller.signal.aborted || err.name === "AbortError" ? "timeout" : "network" });
      log?.error({ order: payload.order_nsu, ...failure.paymentFailure }, "InfinitePay: falha na solicitação");
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async createCheckoutLink(order, { webUrl } = {}) {
      const siteUrl = webUrl || canonicalWebUrl(env);
      // 100 centavos = R$ 1,00. A soma dos itens é o que a InfinitePay COBRA — precisa bater com order.totalBrl
      // (o settle recusa valor divergente). Com cupom, o desconto não se distribui exato por item em centavos,
      // então o link vira UMA linha com o total do pedido; sem cupom, segue item a item (só BR — o US não vaza).
      const discountCents = Math.round(Number(order.discountBrl || 0) * 100);
      const totalCents = Math.round(Number(order.totalBrl) * 100);
      const itemCount = order.items.reduce((a, i) => a + (Number(i.quantity) || 1), 0);
      const items = discountCents > 0
        ? [{
            description: `Pedido ${order.number} — ${itemCount} item(ns)${order.couponCode ? ` · cupom ${order.couponCode}` : ""} (desconto de R$ ${(discountCents / 100).toFixed(2).replace(".", ",")} já aplicado)`,
            price: totalCents,
            quantity: 1
          }]
        : order.items.map(item => ({
            description: `${item.name} — tam. BR ${item.brLabel || item.nikeSize}`,
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

      const data = await request("links", payload);
      const url = data.url;
      try {
        if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error();
      } catch {
        throw paymentError({ reason: "invalid_response" });
      }
      let providerRef = data.slug || data.id || new URL(url).searchParams.get("lenc") || "link";
      return { url, providerRef };

    },

    async confirmPayment({ orderNsu, transactionNsu, slug }) {
      const payload = {
        handle,
        order_nsu: orderNsu,
        transaction_nsu: transactionNsu,
        slug
      };

      const data = await request("payment_check", payload);
      if (typeof data.paid !== "boolean") throw paymentError({ operation: "payment_check", reason: "invalid_response" });
      // `success` = a consulta deu certo; `paid` = o cliente pagou. Nunca confundir os dois.
      return {
        paid: data.paid === true,
        amountCents: data.amount != null && Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
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
