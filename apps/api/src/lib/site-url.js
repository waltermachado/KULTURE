/**
 * URL pública do site para links em e-mails, redirects de pagamento e descadastro.
 *
 * Regra de ouro: o cliente NUNCA pode receber um link com o domínio gerado pelo Railway
 * (kulture-api-production.up.railway.app) — o site é lojakulture.com.br. Isso já aconteceu com
 * PUBLIC_WEB_URL apontando para o domínio do Railway, então o código se defende:
 *
 *  - canonicalWebUrl(env): PUBLIC_WEB_URL, EXCETO se em produção ela for *.railway.app (ou localhost) —
 *    aí usa o 1º host de PUBLIC_WEB_HOSTS (padrão: lojakulture.com.br) com https.
 *  - resolveWebUrl(env, origin): a origem que o cliente está usando (Origin/Host do pedido), desde que esteja
 *    na allowlist (PUBLIC_WEB_URL, PUBLIC_API_URL, domínio do Railway, PUBLIC_WEB_HOSTS, localhost em dev);
 *    origem desconhecida → canonicalWebUrl. Nunca confia no Host puro (envenenamento de link de reset).
 *  - requestOrigin(request): origem de um request do Fastify (Origin, senão x-forwarded-proto/host).
 */
const RAILWAY_HOST_RE = /\.railway\.app$/i;
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };

/** true quando PUBLIC_WEB_URL aponta para o domínio gerado pelo Railway (ou localhost) em produção. */
export function publicWebUrlMisconfigured(env) {
  const host = hostOf(env.PUBLIC_WEB_URL);
  if (!host) return true;
  if (env.NODE_ENV !== "production") return false;
  return RAILWAY_HOST_RE.test(host) || host === "localhost" || host === "127.0.0.1";
}

export function canonicalWebUrl(env) {
  if (!publicWebUrlMisconfigured(env)) return env.PUBLIC_WEB_URL;
  const preferred = (env.PUBLIC_WEB_HOSTS || []).map((h) => String(h).trim().toLowerCase()).find((h) => h && !RAILWAY_HOST_RE.test(h));
  return preferred ? `https://${preferred}` : env.PUBLIC_WEB_URL;
}

export function resolveWebUrl(env, webOrigin) {
  if (!webOrigin) return canonicalWebUrl(env);
  try {
    const u = new URL(webOrigin);
    const allowed = new Set(
      [env.PUBLIC_WEB_URL, env.PUBLIC_API_URL]
        .map(hostOf)
        .concat(process.env.RAILWAY_PUBLIC_DOMAIN || null, ...(env.PUBLIC_WEB_HOSTS || []))
        .filter(Boolean)
        .map((h) => String(h).toLowerCase())
    );
    const host = u.hostname.toLowerCase();
    // o domínio gerado pelo Railway nunca vai para o cliente: quem chegou por ele recebe o link no domínio próprio
    if (RAILWAY_HOST_RE.test(host)) return canonicalWebUrl(env);
    // localhost só conta se for exatamente o host:porta do site (em dev a api é :3000 e o site :5173)
    if (host === "localhost" || host === "127.0.0.1") {
      const web = (() => { try { return new URL(env.PUBLIC_WEB_URL); } catch { return null; } })();
      return web && web.host.toLowerCase() === u.host.toLowerCase() ? `${u.protocol}//${u.host}` : canonicalWebUrl(env);
    }
    if (allowed.has(host)) return `${u.protocol}//${u.host}`;
  } catch {
    /* origem inválida → canônica */
  }
  return canonicalWebUrl(env);
}

/** Origem do request (Origin; senão proto/host encaminhados pelo proxy). null se não der para saber. */
export function requestOrigin(req) {
  const h = req?.headers || {};
  if (h.origin) return String(h.origin).split(",")[0].trim();
  const proto = String(h["x-forwarded-proto"] || req?.protocol || "https").split(",")[0].trim();
  const host = String(h["x-forwarded-host"] || h.host || req?.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : null;
}
