/**
 * Guards de rota (hooks `onRequest`).
 *
 *   requireAuth  → exige Bearer JWT válido; request.user = { sub, email, role }
 *   requireAdmin → requireAuth + confere no banco que o usuário ainda é admin
 *                  (o JWT dura 15 min; conferir no banco fecha a janela de um admin rebaixado)
 *   optionalAuth → tenta o JWT, mas segue como convidado se não houver/for inválido
 */
export async function requireAuth(request, reply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ code: "UNAUTHORIZED", message: "Token inválido ou expirado" });
  }
}

export async function optionalAuth(request) {
  try {
    await request.jwtVerify();
  } catch {
    request.user = null;
  }
}

export async function requireAdmin(request, reply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ code: "UNAUTHORIZED", message: "Token inválido ou expirado" });
  }
  const prisma = request.server.prisma;
  const user = prisma
    ? await prisma.user.findUnique({ where: { id: request.user.sub }, select: { id: true, role: true, email: true, name: true } })
    : null;
  if (!user || user.role !== "admin") {
    return reply.status(403).send({ code: "FORBIDDEN", message: "Acesso restrito ao backoffice" });
  }
  request.admin = user;
}
