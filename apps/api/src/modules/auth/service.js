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
export function createAuthService({ prisma, jwtSign, jwtExpiresIn, refreshExpiresDays, log }) {
  const REFRESH_MS = refreshExpiresDays * 24 * 60 * 60 * 1000;

  // ─── helpers ──────────────────────────────────────────────────────────

  function generateToken() {
    return randomBytes(40).toString("hex");
  }

  function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
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
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        cpf: cpf ? String(cpf).replace(/\D/g, "") || null : null,
        phone: phone ? String(phone).replace(/\D/g, "") || null : null,
        address: address && typeof address === "object" && Object.values(address).some(Boolean) ? address : null
      }
    });

    const family = randomBytes(16).toString("hex");
    const accessToken = signAccess(user);
    const refresh = await createRefreshToken(user.id, family);

    log?.info({ userId: user.id }, "auth: usuário registrado");
    return { user: safeUser(user), accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
  }

  async function login({ email: rawEmail, password }) {
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
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

    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) {
      const err = new Error("Usuário não encontrado");
      err.statusCode = 401;
      err.code = "INVALID_REFRESH";
      throw err;
    }

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

  return { register, login, refresh, logout, me };
}
