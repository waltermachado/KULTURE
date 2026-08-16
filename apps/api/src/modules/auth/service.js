import * as argon2 from "argon2";
import { randomBytes, createHash } from "node:crypto";

/**
 * Serviço de autenticação — registro, login, refresh com rotação, logout.
 *
 * Refresh token strategy:
 *  - Cada login cria uma "family" (sessionId).
 *  - Cada refresh gera um novo token, revoga o anterior.
 *  - Se um token já revogado for reutilizado → revoga toda a family (comprometida).
 */
export function createAuthService({
  prisma,
  jwtSign,
  jwtExpiresIn,
  refreshExpiresDays,
  log,
  adminEmails = [],
  resetTtlMin = 60
}) {
  const REFRESH_MS = refreshExpiresDays * 24 * 60 * 60 * 1000;
  const RESET_MS = resetTtlMin * 60 * 1000;
  const ADMIN_EMAILS = new Set(adminEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean));

  // ─── helpers ──────────────────────────────────────────────────────────

  function generateToken() {
    return randomBytes(40).toString("hex");
  }

  function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
  }

  function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
  }

  const digits = (v) => (v == null ? undefined : String(v).replace(/\D/g, "") || null);
  const cleanAddress = (address) =>
    address && typeof address === "object" && Object.values(address).some(Boolean) ? address : null;

  /**
   * Bootstrap do backoffice: e-mails listados em ADMIN_EMAILS viram admin no login/cadastro/refresh,
   * sem precisar de SQL na mão. Não rebaixa ninguém (promoção manual pelo painel continua valendo).
   */
  async function promoteIfListed(user) {
    if (!user || user.role === "admin" || !ADMIN_EMAILS.has(user.email)) return user;
    const updated = await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
    log?.info({ userId: user.id }, "auth: usuário promovido a admin via ADMIN_EMAILS");
    return updated;
  }

  async function createRefreshToken(userId, family) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + REFRESH_MS);
    await prisma.refreshToken.create({
      data: { token: hashToken(token), family, userId, expiresAt }
    });
    return { token, expiresAt };
  }

  function signAccess(user) {
    return jwtSign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: jwtExpiresIn }
    );
  }

  function safeUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      cpf: user.cpf ?? null,
      phone: user.phone ?? null,
      address: user.address ?? null,
      role: user.role,
      createdAt: user.createdAt
    };
  }

  // ─── public API ───────────────────────────────────────────────────────

  async function register({ email: rawEmail, password, name, cpf, phone, address }) {
    const email = rawEmail.trim().toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      const err = new Error("E-mail já cadastrado");
      err.statusCode = 409;
      err.code = "EMAIL_TAKEN";
      throw err;
    }

    const passwordHash = await argon2.hash(password);
    let user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        cpf: cpf ? String(cpf).replace(/\D/g, "") || null : null,
        phone: phone ? String(phone).replace(/\D/g, "") || null : null,
        address: address && typeof address === "object" && Object.values(address).some(Boolean) ? address : null
      }
    });
    user = await promoteIfListed(user);

    const family = randomBytes(16).toString("hex");
    const accessToken = signAccess(user);
    const refresh = await createRefreshToken(user.id, family);

    log?.info({ userId: user.id }, "auth: usuário registrado");
    return { user: safeUser(user), accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
  }

  async function login({ email: rawEmail, password }) {
    const email = rawEmail.trim().toLowerCase();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const err = new Error("Credenciais inválidas");
      err.statusCode = 401;
      err.code = "INVALID_CREDENTIALS";
      throw err;
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      const err = new Error("Credenciais inválidas");
      err.statusCode = 401;
      err.code = "INVALID_CREDENTIALS";
      throw err;
    }
    user = await promoteIfListed(user);

    const family = randomBytes(16).toString("hex");
    const accessToken = signAccess(user);
    const refresh = await createRefreshToken(user.id, family);

    log?.info({ userId: user.id }, "auth: login");
    return { user: safeUser(user), accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
  }

  async function refresh(oldToken) {
    const hashedToken = hashToken(oldToken);
    const record = await prisma.refreshToken.findUnique({ where: { token: hashedToken } });

    if (!record || record.expiresAt < new Date()) {
      const err = new Error("Refresh token inválido ou expirado");
      err.statusCode = 401;
      err.code = "INVALID_REFRESH";
      throw err;
    }

    // Token reutilizado (já revogado) → revogar toda a family (ataque)
    if (record.revoked) {
      log?.warn({ family: record.family, userId: record.userId }, "auth: reuso de refresh token — revogando family");
      await prisma.refreshToken.updateMany({
        where: { family: record.family },
        data: { revoked: true }
      });
      const err = new Error("Refresh token já utilizado — sessão revogada");
      err.statusCode = 401;
      err.code = "TOKEN_REUSE";
      throw err;
    }

    // Revogar o token atual (rotação)
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked: true }
    });

    let user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) {
      const err = new Error("Usuário não encontrado");
      err.statusCode = 401;
      err.code = "INVALID_REFRESH";
      throw err;
    }
    user = await promoteIfListed(user);

    const accessToken = signAccess(user);
    const newRefresh = await createRefreshToken(user.id, record.family);

    return { user: safeUser(user), accessToken, refreshToken: newRefresh.token, refreshExpiresAt: newRefresh.expiresAt };
  }

  async function logout(refreshTokenValue) {
    if (!refreshTokenValue) return;
    const hashedToken = hashToken(refreshTokenValue);
    const record = await prisma.refreshToken.findUnique({ where: { token: hashedToken } });
    if (!record) return;
    // Revogar toda a family da sessão
    await prisma.refreshToken.updateMany({
      where: { family: record.family },
      data: { revoked: true }
    });
    log?.info({ userId: record.userId }, "auth: logout (family revogada)");
  }

  async function me(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      const err = new Error("Usuário não encontrado");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    return safeUser(user);
  }

  // ─── perfil (edição de cadastro pelo próprio cliente) ─────────────────

  async function updateProfile(userId, { name, phone, cpf, address } = {}) {
    const data = {};
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (phone !== undefined) data.phone = digits(phone);
    if (cpf !== undefined) data.cpf = digits(cpf);
    if (address !== undefined) data.address = cleanAddress(address);
    if (!Object.keys(data).length) throw httpError(400, "NOTHING_TO_UPDATE", "Nada para atualizar");
    const user = await prisma.user.update({ where: { id: userId }, data });
    return safeUser(user);
  }

  async function changePassword(userId, { currentPassword, newPassword }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw httpError(404, "NOT_FOUND", "Usuário não encontrado");
    const ok = await argon2.verify(user.passwordHash, currentPassword || "");
    if (!ok) throw httpError(401, "INVALID_CREDENTIALS", "Senha atual incorreta");
    const passwordHash = await argon2.hash(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    log?.info({ userId }, "auth: senha alterada pelo usuário");
    return { ok: true };
  }

  // ─── redefinição de senha (esqueci / link gerado pelo admin) ──────────

  /**
   * Gera um token de uso único (guardado como sha256). Retorna null se o e-mail não existir —
   * a rota pública responde sempre 200 para não revelar quem tem conta.
   */
  async function createPasswordReset({ email: rawEmail, userId, requestedBy = "self" }) {
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findUnique({ where: { email: String(rawEmail || "").trim().toLowerCase() } });
    if (!user) return null;

    // invalida pedidos anteriores ainda abertos (só o último link vale)
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() }
    });

    const token = generateToken();
    const expiresAt = new Date(Date.now() + RESET_MS);
    await prisma.passwordResetToken.create({
      data: { tokenHash: hashToken(token), userId: user.id, requestedBy, expiresAt }
    });
    log?.info({ userId: user.id, requestedBy }, "auth: token de redefinição de senha criado");
    return { user: safeUser(user), token, expiresAt };
  }

  async function resetPassword({ token, password }) {
    if (!token) throw httpError(400, "INVALID_RESET_TOKEN", "Link inválido ou expirado");
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(String(token)) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw httpError(400, "INVALID_RESET_TOKEN", "Link inválido ou expirado");
    }
    const passwordHash = await argon2.hash(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // derruba todas as sessões antigas: quem redefiniu a senha quer o resto deslogado
      prisma.refreshToken.updateMany({ where: { userId: record.userId, revoked: false }, data: { revoked: true } })
    ]);
    log?.info({ userId: record.userId }, "auth: senha redefinida via token");
    return { ok: true };
  }

  return { register, login, refresh, logout, me, updateProfile, changePassword, createPasswordReset, resetPassword, safeUser };
}
