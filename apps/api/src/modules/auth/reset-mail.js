import { buildPasswordResetEmail } from "../mail/mailer.js";
import { resolveWebUrl } from "../../lib/site-url.js";

/**
 * Monta o link público de redefinição de senha e dispara o e-mail.
 * Usado pelo /api/auth/forgot (cliente) e pelo backoffice (admin gera link para o cliente).
 * Falha de e-mail nunca lança — devolve { mailed:false } e o link, para o admin repassar por WhatsApp.
 */
export function createResetMailer({ env, mailer, log }) {
  /** `webOrigin` = origem do request (site que o cliente estava usando); só vale se estiver na allowlist. */
  return async function sendPasswordResetEmail(reset, { webOrigin = null } = {}) {
    // NUNCA o domínio do Railway: resolveWebUrl cai em canonicalWebUrl (lojakulture.com.br) quando PUBLIC_WEB_URL estiver errada
    const siteUrl = resolveWebUrl(env, webOrigin);
    const link = `${siteUrl}/redefinir-senha?token=${encodeURIComponent(reset.token)}`;
    const mail = buildPasswordResetEmail({ name: reset.user.name, link, expiresMin: env.PASSWORD_RESET_TTL_MIN, email: reset.user.email, requestedAt: new Date(), siteUrl });
    let result = null;
    try {
      result = await mailer.send({ to: reset.user.email, toName: reset.user.name, ...mail });
    } catch (err) {
      log?.warn({ err: err.message }, "auth: falha ao enviar e-mail de reset");
    }
    return { link, mailed: Boolean(result?.ok), provider: mailer.provider, expiresAt: reset.expiresAt };
  };
}
