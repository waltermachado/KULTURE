// Seed de DEMONSTRAÇÃO para ver o backoffice com dados (SÓ banco de dev — nunca rodar em produção).
// Cria 1 admin (admin@smoke.kulture.test / Smoke!2026kulture), 3 clientes e 14 pedidos nos últimos 30 dias.
// Tudo marcado com @smoke.kulture.test e KLT-2026-9xxxxx. Uso: npm run seed:demo -w apps/api
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();
const daysAgo = (d, h = 12) => new Date(Date.now() - d * 86_400_000 - (12 - h) * 3_600_000);

const PRODUCTS = [
  { styleColor: "FQ3545-100", name: "Kobe 6 Protro 'Reverse Grinch'", usd: 190, image: "https://static.nike.com/a/images/t_PDP_936_v1/f_auto,q_auto:eco/kobe6.png" },
  { styleColor: "HF3696-401", name: "Sabrina 3", usd: 130, image: null },
  { styleColor: "FZ4131-001", name: "LeBron XXIII", usd: 200, image: null },
  { styleColor: "DZ5485-612", name: "Air Jordan 1 Low OG", usd: 140, image: null },
  { styleColor: "HQ2413-002", name: "G.T. Cut 3", usd: 190, image: null }
];
const RATE = 5.42;
const breakdown = (usd) => {
  const shippingUsd = 65;
  const subtotalBrl = (usd + shippingUsd) * RATE;
  const commissionBrl = subtotalBrl * 0.3;
  const finalPriceBrl = Math.round((subtotalBrl + commissionBrl) * 100) / 100;
  return { productPriceUsd: usd, shippingUsd, subtotalUsd: usd + shippingUsd, productPriceBrl: usd * RATE, shippingBrl: shippingUsd * RATE, subtotalBrl, importDutyBrl: 0, paymentFeeBrl: 0, commissionBrl, roundingAdjustmentBrl: 0, finalPriceBrl };
};

async function user(email, name, phone, city, state, role = "customer") {
  const passwordHash = await argon2.hash("Smoke!2026kulture");
  return prisma.user.upsert({
    where: { email },
    update: { role, name },
    create: { email, passwordHash, name, phone, cpf: "12345678909", role, address: { cep: "60000000", street: "Rua das Palmeiras", number: "120", neighborhood: "Aldeota", city, state } }
  });
}

const admin = await user("admin@smoke.kulture.test", "Walter (admin)", "85992578888", "Fortaleza", "CE", "admin");
const c1 = await user("ana@smoke.kulture.test", "Ana Beatriz Rocha", "85999110001", "Fortaleza", "CE");
const c2 = await user("bruno@smoke.kulture.test", "Bruno Carvalho", "11988220002", "São Paulo", "SP");
const c3 = await user("carla@smoke.kulture.test", "Carla Mendes", "21977330003", "Rio de Janeiro", "RJ");

await prisma.order.deleteMany({ where: { number: { startsWith: "KLT-2026-9" } } });

const plan = [
  // [dia, cliente, produtoIdx, qty, status, method]
  [29, c1, 0, 1, "delivered", "pix"],
  [26, c2, 3, 1, "delivered", "credit_card"],
  [24, null, 1, 1, "abandoned", null],
  [22, c3, 2, 1, "delivered", "pix"],
  [19, c1, 4, 1, "shipped", "credit_card"],
  [16, c2, 0, 2, "shipped", "pix"],
  [14, null, 3, 1, "cancelled", null],
  [11, c3, 1, 1, "sourcing", "pix"],
  [9, c1, 2, 1, "refunded", "credit_card"],
  [7, c2, 4, 1, "sourcing", "pix"],
  [5, null, 0, 1, "paid", "pix"],
  [3, c3, 3, 1, "paid", "credit_card"],
  [1, c1, 1, 1, "paid", "pix"],
  [0, c2, 2, 1, "pending_payment", null]
];

let i = 0;
for (const [d, cust, pIdx, qty, status, method] of plan) {
  i += 1;
  const p = PRODUCTS[pIdx];
  const b = breakdown(p.usd);
  const unit = b.finalPriceBrl;
  const total = unit * qty;
  const created = daysAgo(d, 10);
  const paidLike = ["paid", "sourcing", "shipped", "delivered", "refunded"].includes(status);
  const number = `KLT-2026-9${String(i).padStart(5, "0")}`;
  const name = cust?.name ?? ["Diego Convidado", "Fernanda Visitante"][i % 2];
  const email = cust?.email ?? `convidado${i}@smoke.kulture.test`;
  const events = [{ type: "created", payload: {}, createdAt: created }, { type: "link_created", payload: { providerRef: `mock_slug_${i}` }, createdAt: created }];
  const data = {
    number, status, userId: cust?.id ?? null,
    customerName: name, customerEmail: email, customerPhone: cust?.phone ?? "85900000000", customerCpf: "12345678909",
    address: cust?.address ?? { cep: "01001000", street: "Praça da Sé", number: "1", neighborhood: "Sé", city: "São Paulo", state: "SP" },
    subtotalBrl: total, shippingBrl: 0, totalBrl: total, exchangeRate: RATE, pricingSnapshot: {},
    paymentProvider: "mock", paymentMethod: method, infinitepaySlug: `mock_slug_${i}`, createdAt: created,
    items: { create: [{ styleColor: p.styleColor, name: p.name, colorDescription: "Multi-Color", image: p.image, nikeSize: "10", brSize: 41.5, brLabel: "41.5", unitPriceBrl: unit, unitPriceUsd: p.usd, quantity: qty, breakdown: b }] }
  };
  if (paidLike) {
    data.paidAt = daysAgo(d, 11);
    data.paidAmountBrl = total;
    data.installments = method === "credit_card" ? 3 : 1;
    data.transactionNsu = `nsu-smoke-${i}`;
    events.push({ type: "payment_confirmed", payload: { transactionNsu: `nsu-smoke-${i}`, captureMethod: method }, createdAt: daysAgo(d, 11) });
  }
  if (["sourcing", "shipped", "delivered"].includes(status)) events.push({ type: "status_changed", payload: { from: "paid", to: "sourcing", adminEmail: admin.email, note: "comprado na Nike US" }, createdAt: daysAgo(d - 1, 9) });
  if (["shipped", "delivered"].includes(status)) {
    data.carrier = "Correios"; data.trackingCode = `NL${String(100000000 + i * 7919).slice(0, 9)}BR`; data.shippedAt = daysAgo(Math.max(d - 8, 0), 15);
    data.trackingUrl = `https://rastreamento.correios.com.br/app/index.php?objetos=${data.trackingCode}`;
    events.push({ type: "tracking_updated", payload: { carrier: "Correios", trackingCode: data.trackingCode, adminEmail: admin.email }, createdAt: data.shippedAt });
    events.push({ type: "status_changed", payload: { from: "sourcing", to: "shipped", adminEmail: admin.email }, createdAt: data.shippedAt });
    events.push({ type: "email_shipped", payload: { ok: true, provider: "log" }, createdAt: data.shippedAt });
  }
  if (status === "delivered") { data.deliveredAt = daysAgo(Math.max(d - 14, 0), 16); events.push({ type: "status_changed", payload: { from: "shipped", to: "delivered", adminEmail: admin.email }, createdAt: data.deliveredAt }); }
  if (status === "cancelled") { data.cancelledAt = daysAgo(d - 1); events.push({ type: "status_changed", payload: { from: "pending_payment", to: "cancelled", adminEmail: admin.email, note: "cliente desistiu" }, createdAt: data.cancelledAt }); }
  if (status === "refunded") { data.refundedAt = daysAgo(d - 3); events.push({ type: "status_changed", payload: { from: "paid", to: "refunded", adminEmail: admin.email, note: "tamanho esgotou na Nike" }, createdAt: data.refundedAt }); }
  if (status === "abandoned") { data.abandonedAt = daysAgo(d, 8); events.push({ type: "abandoned", payload: { reason: "timeout" }, createdAt: data.abandonedAt }); }
  data.events = { create: events };
  await prisma.order.create({ data });
}
console.log(`ok: admin ${admin.email} / senha Smoke!2026kulture · ${plan.length} pedidos`);
await prisma.$disconnect();
