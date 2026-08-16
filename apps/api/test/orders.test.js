import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";

describe("Orders & Checkout (Fase 4)", { timeout: 30000 }, () => {
  let app;
  let orderNumber;
  const mockIdempotencyKey = "uuid-test-123";

  beforeAll(async () => {
    const mockScraper = {
      // contrato do scraper-client: { pair, bid, ask, timestamp } (número puro quebra o câmbio)
      rate: async () => ({ pair: "USD-BRL", bid: 5.5, ask: 5.5, timestamp: "2026-01-01 00:00:00" }),
      health: async () => ({ ok: true }),
      search: async () => ({ products: [], total: 0 }),
      findOne: async () => null,
      getProductDetail: async (styleColor) => ({
        id: "mock-id",
        styleColor,
        name: "Test Sneaker",
        priceUsd: 100,
        sizes: [{ nikeSize: "10.5", localizedSize: "10.5", available: true, level: "HIGH" }],
        genders: ["MEN"]
      })
    };

    app = await buildApp({ 
      persistCache: true, 
      warmTop8: false, 
      startJobs: false,
      logger: false,
      scraper: mockScraper
    });
    
    await app.prisma.idempotencyKey.deleteMany();
    await app.prisma.orderEvent.deleteMany();
    await app.prisma.orderItem.deleteMany();
    await app.prisma.notification.deleteMany();
    await app.prisma.order.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/checkout - cria pedido com preço reprecificado pelo backend", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: { "idempotency-key": mockIdempotencyKey },
      payload: {
        items: [{ styleColor: "FV5029-141", nikeSize: "10.5", quantity: 1 }],
        customer: { name: "Test User", email: "test@kulture.br", cpf: "11122233344" },
        address: { cep: "01000-000", city: "São Paulo", state: "SP" }
      }
    });
    
    const data = res.json();
    if (res.statusCode !== 200) {
      console.log('CHECKOUT 400:', data);
    }
    expect(res.statusCode).toBe(200);
    expect(data.orderNumber).toBeDefined();
    expect(data.checkoutUrl).toBeDefined();
    expect(data.shipping).toBe("free");
    
    orderNumber = data.orderNumber;
  });

  it("POST /api/checkout - idempotência", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/checkout",
      headers: { "idempotency-key": mockIdempotencyKey },
      payload: {
        items: [{ styleColor: "FV5029-141", nikeSize: "10.5", quantity: 1 }],
        customer: { name: "Test User", email: "test@kulture.br", cpf: "11122233344" }
      }
    });
    
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.orderNumber).toBe(orderNumber); 
  });

  it("POST /api/orders/:number/confirm - confirmação de pagamento com adapter mock", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/orders/${orderNumber}/confirm`,
      payload: {
        transaction_nsu: "txn-12345",
        slug: "slug-mock",
        capture_method: "pix",
        receipt_url: "http://receipt"
      }
    });
    
    expect(res.statusCode).toBe(200);
    expect(res.json().paid).toBe(true);
    
    const order = await app.prisma.order.findUnique({ where: { number: orderNumber } });
    expect(order.status).toBe("paid");
    expect(order.paymentMethod).toBe("pix");
  });

  it("GET /api/orders/:number - não expõe campos internos", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/orders/${orderNumber}`
    });
    
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.pricingSnapshot).toBeUndefined();
    expect(data.items[0].breakdown).toBeUndefined();
    // convidado: visão mascarada — nada de CPF/e-mail/telefone/endereço completo (número é adivinhável)
    expect(data.scope).toBe("public");
    expect(data.customerCpf).toBeUndefined();
    expect(data.customerEmail).toBeUndefined();
    expect(data.customerPhone).toBeUndefined();
    expect(data.address.cep).toBeUndefined();
    expect(data.customerName).toBe("Test");
    expect(data.status).toBe("paid");
    expect(data.items[0].name).toBe("Test Sneaker");
  });

  it("GET /api/orders/mine - exige login", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders/mine" });
    expect(res.statusCode).toBe(401);
  });
});
