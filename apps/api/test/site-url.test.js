import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { canonicalWebUrl, publicWebUrlMisconfigured, requestOrigin, resolveWebUrl } from "../src/lib/site-url.js";
import { createResetMailer } from "../src/modules/auth/reset-mail.js";

/** O cliente NUNCA pode receber um link com o domínio gerado pelo Railway — mesmo com PUBLIC_WEB_URL errada. */
const base = { JWT_SECRET: "test-jwt-secret-kulture-32chars-long!!", DATABASE_URL: "postgresql://x:y@localhost:5432/z", LOG_LEVEL: "silent" };
const RAILWAY = "https://kulture-api-production.up.railway.app";
const prod = (extra = {}) => loadEnv({ ...base, NODE_ENV: "production", PUBLIC_WEB_URL: RAILWAY, PUBLIC_API_URL: RAILWAY, ...extra });

describe("site-url: URL pública dos links", () => {
  it("PUBLIC_WEB_URL no domínio do Railway em produção → usa o domínio próprio (lojakulture.com.br, padrão de PUBLIC_WEB_HOSTS)", () => {
    const env = prod();
    expect(publicWebUrlMisconfigured(env)).toBe(true);
    expect(canonicalWebUrl(env)).toBe("https://lojakulture.com.br");
    // origem desconhecida (envenenamento do link de reset) → canônica, nunca o Host do atacante
    expect(resolveWebUrl(env, "https://atacante.com")).toBe("https://lojakulture.com.br");
    // quem navega pelo domínio do Railway também recebe o link no domínio próprio
    expect(resolveWebUrl(env, RAILWAY)).toBe("https://lojakulture.com.br");
    // o cliente no site de verdade (ou no www) recebe o link onde está
    expect(resolveWebUrl(env, "https://lojakulture.com.br")).toBe("https://lojakulture.com.br");
    expect(resolveWebUrl(env, "https://www.lojakulture.com.br")).toBe("https://www.lojakulture.com.br");
    expect(resolveWebUrl(env, null)).toBe("https://lojakulture.com.br");
  });

  it("PUBLIC_WEB_URL correta → fica como está; dev com localhost continua localhost", () => {
    const ok = prod({ PUBLIC_WEB_URL: "https://lojakulture.com.br", PUBLIC_API_URL: "https://lojakulture.com.br" });
    expect(publicWebUrlMisconfigured(ok)).toBe(false);
    expect(canonicalWebUrl(ok)).toBe("https://lojakulture.com.br");
    expect(resolveWebUrl(ok, RAILWAY)).toBe("https://lojakulture.com.br"); // Railway nunca
    const dev = loadEnv({ ...base, NODE_ENV: "development", PUBLIC_WEB_URL: "http://localhost:5173" });
    expect(publicWebUrlMisconfigured(dev)).toBe(false);
    expect(canonicalWebUrl(dev)).toBe("http://localhost:5173");
    expect(resolveWebUrl(dev, "http://localhost:5173")).toBe("http://localhost:5173");
    expect(resolveWebUrl(dev, "http://localhost:3000")).toBe("http://localhost:5173"); // host da api em dev ≠ site
    const test = loadEnv({ ...base, NODE_ENV: "test", PUBLIC_WEB_URL: "https://loja.test" });
    expect(resolveWebUrl(test, "http://localhost")).toBe("https://loja.test"); // app.inject
  });

  it("requestOrigin: Origin, senão x-forwarded-proto/host (atrás do proxy do Railway)", () => {
    expect(requestOrigin({ headers: { origin: "https://lojakulture.com.br" } })).toBe("https://lojakulture.com.br");
    expect(requestOrigin({ headers: { "x-forwarded-proto": "https", "x-forwarded-host": "lojakulture.com.br" }, protocol: "http" })).toBe("https://lojakulture.com.br");
    expect(requestOrigin({ headers: { host: "localhost:3000" }, protocol: "http" })).toBe("http://localhost:3000");
    expect(requestOrigin({ headers: {} })).toBeNull();
  });

  it("e-mail de 'esqueci minha senha' sai com o domínio próprio mesmo com PUBLIC_WEB_URL no Railway", async () => {
    const env = prod();
    const sent = [];
    const mailer = { provider: "fake", async send(m) { sent.push(m); return { ok: true }; } };
    const send = createResetMailer({ env, mailer, log: null });
    const reset = { token: "tok123", expiresAt: new Date(), user: { name: "Walter", email: "w@kulture.test" } };
    // pedido feito pelo site de verdade
    const r1 = await send(reset, { webOrigin: "https://lojakulture.com.br" });
    expect(r1.link).toBe("https://lojakulture.com.br/redefinir-senha?token=tok123");
    expect(sent.at(-1).text).toContain("https://lojakulture.com.br/redefinir-senha?token=tok123");
    expect(sent.at(-1).text).not.toContain("railway.app");
    // pedido chegando pelo domínio do Railway, ou sem origem (gerado no painel)
    expect((await send(reset, { webOrigin: RAILWAY })).link).toBe("https://lojakulture.com.br/redefinir-senha?token=tok123");
    expect((await send(reset)).link).toBe("https://lojakulture.com.br/redefinir-senha?token=tok123");
  });
});
