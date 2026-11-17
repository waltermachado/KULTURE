/** Resolve pelo vínculo da conta, sem associar clientes por coincidência de e-mail. */
export async function orderEmailRecipient(prisma, order) {
  if (order.userId) {
    const user = await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true } });
    if (user?.email) return user.email;
  }
  return order.customerEmail;
}
