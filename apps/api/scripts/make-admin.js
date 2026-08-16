#!/usr/bin/env node
/**
 * Promove (ou rebaixa) um usuário a admin do backoffice.
 *
 *   node --env-file-if-exists=.env scripts/make-admin.js email@dominio.com          # vira admin
 *   node --env-file-if-exists=.env scripts/make-admin.js email@dominio.com --revoke # volta a customer
 *
 * Alternativa sem script: variável ADMIN_EMAILS=a@x.com,b@y.com (promove no próximo login).
 */
import { PrismaClient } from "@prisma/client";

const [, , rawEmail, flag] = process.argv;
if (!rawEmail) {
  console.error("uso: make-admin.js <email> [--revoke]");
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
const role = flag === "--revoke" ? "customer" : "admin";

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`usuário ${email} não existe — cadastre-se no site primeiro`);
    process.exit(2);
  }
  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log(`${email} agora é ${role}`);
} finally {
  await prisma.$disconnect();
}
