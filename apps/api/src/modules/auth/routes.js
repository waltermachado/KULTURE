import { createAuthService } from "./service.js";

const COOKIE_NAME = "kulture_refresh";

/**
 * Auth routes — Fase 2.
 * POST /api/auth/register · /login · /refresh · /logout
 * GET  /api/auth/me
 */
export async function authRoutes(app) {
  const env = app.env;
  const prisma = app.prisma;

  const auth = createAuthService({
    prisma,
    jwtSign: (payload, opts) => app.jwt.sign(payload, opts),
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    refreshExpiresDays: env.REFRESH_EXPIRES_DAYS,
    log: app.log
  });

  // Helper: seta cookie httpOnly com o refresh token
  function setRefreshCookie(reply, token, expiresAt) {
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/api/auth",
      expires: expiresAt
    });
  }

  function clearRefreshCookie(reply) {
    reply.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/api/auth"
    });
  }

  // ─── POST /api/auth/register ─────────────────────────────────────────

  app.post("/api/auth/register", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      }
    },
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["email", "password", "name"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          name: { type: "string", minLength: 1 },
          cpf: { type: "string" }
        }
      }
    }
  }, async (request, reply) => {
    const result = await auth.register(request.body);
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return reply.status(201).send({
      user: result.user,
      accessToken: result.accessToken
    });
  });

  // ─── POST /api/auth/login ────────────────────────────────────────────

  app.post("/api/auth/login", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      }
    },
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const result = await auth.login(request.body);
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return reply.send({
      user: result.user,
      accessToken: result.accessToken
    });
  });

  // ─── POST /api/auth/refresh ──────────────────────────────────────────

  app.post("/api/auth/refresh", {
    schema: { tags: ["auth"] }
  }, async (request, reply) => {
    const oldToken = request.cookies[COOKIE_NAME];
    if (!oldToken) {
      return reply.status(401).send({ code: "NO_REFRESH_TOKEN", message: "Refresh token ausente" });
    }
    const result = await auth.refresh(oldToken);
    setRefreshCookie(reply, result.refreshToken, result.refreshExpiresAt);
    return reply.send({
      user: result.user,
      accessToken: result.accessToken
    });
  });

  // ─── POST /api/auth/logout ───────────────────────────────────────────

  app.post("/api/auth/logout", {
    schema: { tags: ["auth"] }
  }, async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    await auth.logout(token);
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });

  // ─── GET /api/auth/me ────────────────────────────────────────────────

  app.get("/api/auth/me", {
    schema: { tags: ["auth"] },
    onRequest: [verifyJwt]
  }, async (request) => {
    const user = await auth.me(request.user.sub);
    return { user };
  });
}

/**
 * Hook para verificar JWT no header Authorization: Bearer <token>.
 * Decodifica e disponibiliza em request.user = { sub, email, role }.
 */
async function verifyJwt(request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ code: "UNAUTHORIZED", message: "Token inválido ou expirado" });
  }
}
