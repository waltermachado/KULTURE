import { describe, it, expect, vi } from "vitest";
import { createAdminService } from "../src/modules/admin/service.js";
import { orderEmailRecipient } from "../src/lib/order-email.js";

const order = { id: "order-1", number: "K-TEST", userId: "user-1", customerEmail: "errado@example.com", customerName: "Cliente", items: [], totalBrl: 100, paymentProvider: "manual" };

describe("destinatário das notificações do pedido", () => {
  it("reenvia ao e-mail atualizado sem alterar o e-mail histórico da compra", async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ email: "corrigido@example.com" }) },
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      orderEvent: { create: vi.fn() }
    };
    const mailer = { provider: "fake", send: vi.fn().mockResolvedValue({ ok: true }) };
    const admin = createAdminService({ prisma, env: { PUBLIC_WEB_URL: "https://loja.test" }, mailer });
    const result = await admin.resendOrderEmail(order.number);
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: "corrigido@example.com" }));
    expect(result).toMatchObject({ ok: true, to: "corrigido@example.com" });
    expect(prisma.orderEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ to: "corrigido@example.com" }) }) }));
    expect(order.customerEmail).toBe("errado@example.com");
    prisma.user.findUnique.mockResolvedValue({ email: "mais-novo@example.com" });
    await admin.resendOrderEmail(order.number, "shipped");
    expect(mailer.send).toHaveBeenLastCalledWith(expect.objectContaining({ to: "mais-novo@example.com" }));
  });

  it("preserva o destinatário do pedido de convidado sem buscar outra conta por e-mail", async () => {
    const prisma = { user: { findUnique: vi.fn() } };
    expect(await orderEmailRecipient(prisma, { ...order, userId: null })).toBe(order.customerEmail);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("registra falha do provedor com o destinatário tentado", async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ email: "corrigido@example.com" }) },
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      orderEvent: { create: vi.fn() }
    };
    const admin = createAdminService({ prisma, env: { PUBLIC_WEB_URL: "https://loja.test" }, mailer: { send: vi.fn().mockRejectedValue(new Error("Indisponível")) } });
    expect(await admin.resendOrderEmail(order.number)).toMatchObject({ ok: false, to: "corrigido@example.com", error: "Indisponível" });
  });

  it("impede corrigir diretamente o e-mail de pedido com conta vinculada", async () => {
    const prisma = { order: { findUnique: vi.fn().mockResolvedValue(order) } };
    const admin = createAdminService({ prisma, env: {} });
    await expect(admin.updateOrder(order.number, { customerEmail: "outro@example.com" })).rejects.toThrow("Altere o e-mail no cadastro");
  });
});
