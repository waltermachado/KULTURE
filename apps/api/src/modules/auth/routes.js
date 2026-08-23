import { requestOrigin } from "../../lib/site-url.js";
import { requireAuth } from "../../lib/guards.js";

const COOKIE_NAME = "kulture_refresh";

const ADDRESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cep: { type: "string" }, street: { type: "string" }, number: { type: "string" },
    complement: { type: "string" }, neighborhood: { type: "string" }, city: { type: "string" }, state: { type: "string" }
  }
};

/**
 * Auth routes — Fase 2 (+ backoffice).
 * POST /api/auth/register · /login · /refresh · /logout
 * GET  /api/auth/me · PATCH /api/auth/me · POST /api/auth/password
 * POST /api/auth/forgot · POST /api/auth/reset
 */
export async function authRoutes(app) {
  const env = app.env;
  const meta = (request) => ({ ip: request.ip, userAgent: request.headers["user-agent"] });
  // serviço criado em app.js (app.auth) para o módulo admin reusar createPasswordReset/safeUser
  const auth = app.auth;
  const sendResetEmail = app.sendPasswordResetEmail;

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
          cpf: { type: "string" },
          phone: { type: "string" },
          address: ADDRESS_SCHEMA
        }
      }
    }
  }, async (request, reply) => {
    const result = await auth.register(request.body, meta(request));
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
    const result = await auth.login(request.body, meta(request));
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
    onRequest: [requireAuth]
  }, async (request) => {
    const user = await auth.me(request.user.sub);
    return { user };
  });

  // ─── PATCH /api/auth/me — o cliente edita o próprio cadastro ─────────

  app.patch("/api/auth/me", {
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          phone: { type: ["string", "null"] },
          cpf: { type: ["string", "null"] },
          address: { anyOf: [ADDRESS_SCHEMA, { type: "null" }] },
          marketingOptIn: { type: "boolean" } // quer receber novidades/promoções por e-mail
        }
      }
    },
    onRequest: [requireAuth]
  }, async (request) => {
    const user = await auth.updateProfile(request.user.sub, request.body || {}, { marketing: app.marketing });
    return { user };
  });

  // ─── POST /api/auth/password — troca de senha logado ─────────────────

  app.post("/api/auth/password", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["currentPassword", "newPassword"],
        properties: {
          currentPassword: { type: "string", minLength: 1 },
          newPassword: { type: "string", minLength: 8 }
        }
      }
    },
    onRequest: [requireAuth]
  }, async (request) => {
    return auth.changePassword(request.user.sub, request.body);
  });

  // ─── POST /api/auth/forgot — "esqueci minha senha" ───────────────────
  // Responde 200 sempre (não revela se o e-mail existe). O link vai por e-mail.

  app.post("/api/auth/forgot", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["email"],
        properties: { email: { type: "string", format: "email" } }
      }
    }
  }, async (request) => {
    const reset = await auth.createPasswordReset({ email: request.body.email, requestedBy: "self" });
    if (reset) {
      sendResetEmail(reset, { webOrigin: requestOrigin(request) }).catch((err) => app.log.warn({ err: err.message }, "auth: falha ao enviar e-mail de reset"));
    }
    return { ok: true, message: "Se este e-mail tiver cadastro, enviamos um link para redefinir a senha." };
  });

  // ─── POST /api/auth/reset — define a nova senha a partir do token ────

  app.post("/api/auth/reset", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["auth"],
      body: {
        type: "object",
        required: ["token", "password"],
        properties: {
          token: { type: "string", minLength: 10 },
          password: { type: "string", minLength: 8 }
        }
      }
    }
  }, async (request) => {
    return auth.resetPassword(request.body, meta(request));
  });
}
