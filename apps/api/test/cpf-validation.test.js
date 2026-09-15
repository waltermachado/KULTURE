import { describe, it, expect, vi } from "vitest";
import { isValidCpf, normalizeCpf } from "@kulture/shared/cpf";
import { validatedCpf } from "../src/lib/cpf.js";
import { createAuthService } from "../src/modules/auth/service.js";
import { createOrderService } from "../src/modules/orders/service.js";

describe("CPF — dígitos verificadores e fronteiras de gravação", () => {
  it.each(["52998224725", "529.982.247-25", "12345678909", "01234567890"])("aceita CPF matematicamente válido: %s", cpf => {
    expect(isValidCpf(cpf)).toBe(true);
    expect(validatedCpf(cpf)).toBe(normalizeCpf(cpf));
  });
  it.each(["52998224724", "52998224715", "123", "123456789090", "abc52998224725", null, 52998224725, ...Array.from({length: 10}, (_, i) => String(i).repeat(11))])("rejeita %s", cpf => {
    expect(isValidCpf(cpf)).toBe(false);
    expect(() => validatedCpf(cpf, { required: true })).toThrow(expect.objectContaining({ code: "INVALID_CPF", statusCode: 400 }));
  });
  it("permite CPF ausente no perfil, mas exige no checkout", () => {
    expect(validatedCpf(null)).toBeNull();
    expect(validatedCpf("")).toBeNull();
    expect(() => validatedCpf("", { required: true })).toThrow();
  });
  it("bloqueia cadastro e edição antes de tocar no banco", async () => {
    const prisma = { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } };
    const auth = createAuthService({ prisma });
    await expect(auth.register({email:"a@example.test", password:"testpass", cpf:"11111111111"})).rejects.toMatchObject({code:"INVALID_CPF"});
    await expect(auth.updateProfile("u", {cpf:"52998224724"})).rejects.toMatchObject({code:"INVALID_CPF"});
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it("checkout inválido não cria lock, pedido nem chama gateway", async () => {
    const prisma = { idempotencyKey: { findUnique: vi.fn() } };
    const gateway = { createCheckoutLink: vi.fn() };
    const orders = createOrderService({}, prisma, {}, gateway);
    await expect(orders.checkout({customer:{cpf:"52998224724"}}, "key")).rejects.toMatchObject({code:"INVALID_CPF"});
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
    expect(gateway.createCheckoutLink).not.toHaveBeenCalled();
  });
});

it("painel bloqueia CPF inválido em edição e venda manual", async () => {
  const { createAdminService } = await import("../src/modules/admin/service.js");
  const prisma = { user: { findUnique: vi.fn(async()=>({id:"u"})), update: vi.fn() } };
  const admin = createAdminService({prisma, env:{}});
  await expect(admin.updateCustomer("u",{cpf:"11111111111"})).rejects.toMatchObject({code:"INVALID_CPF"});
  await expect(admin.createManualOrder({customer:{name:"Teste",email:"a@example.test",cpf:"11111111111"}})).rejects.toMatchObject({code:"INVALID_CPF"});
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it("falha no link guarda histórico seguro e devolve referência do pedido", async () => {
  const { paymentError } = await import("../src/modules/payments/errors.js");
  const created={id:"order-id", number:"KLT-TEST",items:[]};
  const prisma={
    user:{findUnique:vi.fn(async()=>null)},
    order:{create:vi.fn(async()=>created),update:vi.fn()},
    orderEvent:{create:vi.fn(async()=>({}))},
    $transaction:vi.fn(async cb=>cb(prisma))
  };
  const catalog={getRate:async()=>({usdToBrl:5}),getProductSizes:async()=>({product:{styleColor:"TEST",name:"Teste",sizes:[{nikeSize:"9",available:true,brLabel:"41"}],price:{brl:100},priceUsd:20}})};
  const gateway={createCheckoutLink:vi.fn(async()=>{throw paymentError({status:422});})};
  const orders=createOrderService({PAYMENT_PROVIDER:"infinitepay",PUBLIC_WEB_URL:"https://loja.test"},prisma,catalog,gateway);
  await expect(orders.checkout({customer:{name:"Teste",email:"a@example.test",cpf:"529.982.247-25"},items:[{styleColor:"TEST",nikeSize:"9",quantity:1}]})).rejects.toMatchObject({code:"PAYMENT_DATA_REJECTED",details:{orderNumber:"KLT-TEST"}});
  expect(prisma.order.create.mock.calls[0][0].data.customerCpf).toBe("52998224725");
  expect(prisma.orderEvent.create).toHaveBeenCalledWith({data:{orderId:"order-id",type:"payment_link_failed",payload:{operation:"links",code:"PAYMENT_DATA_REJECTED",providerStatus:422}}});
  expect(prisma.order.update).not.toHaveBeenCalled();
});
