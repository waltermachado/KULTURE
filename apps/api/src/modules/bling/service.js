/**
 * Bling (v3) — conexão OAuth para a emissão de NF-e.
 *
 * Fluxo: /admin/bling → "Conectar ao Bling" (authorize com `state` assinado) → o Bling volta em
 * GET /api/bling/callback?code=…&state=… → troca por access_token (expira ~6h) + refresh_token (rotaciona a cada
 * renovação, validade ~30 dias). Tokens ficam em `settings` (chave "bling") e são renovados sozinhos antes das
 * chamadas. IMPORTANTE: o app no Bling precisa ter o "link de redirecionamento" IGUAL a
 * `${site}/api/bling/callback`, e BLING_CLIENT_ID/BLING_CLIENT_SECRET nas variáveis de ambiente.
 *
 * A emissão da NF-e em si (POST /nfe → enviar → DANFE) entra em cima desta conexão quando a conta estiver com a
 * parte fiscal pronta (certificado A1, série, natureza de operação, NCM) — ver o checklist em /admin/bling.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../lib/errors.js";
import { canonicalWebUrl } from "../../lib/site-url.js";

export const BLING_KEY = "bling";
const STATE_TTL_MS = 15 * 60 * 1000; // o dono tem 15 min entre clicar em "Conectar" e autorizar
const REFRESH_SKEW_MS = 5 * 60 * 1000; // renova quando faltar < 5 min

export function createBlingService({ prisma, env, log, fetchImpl = fetch }) {
  const configured = () => Boolean(env.BLING_CLIENT_ID && env.BLING_CLIENT_SECRET);
  const callbackUrl = () => `${canonicalWebUrl(env)}/api/bling/callback`;
  const basicAuth = () => `Basic ${Buffer.from(`${env.BLING_CLIENT_ID}:${env.BLING_CLIENT_SECRET}`).toString("base64")}`;

  // ---- state assinado (evita callback forjado) ----
  const sign = (ts) => createHmac("sha256", env.JWT_SECRET).update(`bling:${ts}`).digest("base64url").slice(0, 24);
  const newState = () => { const ts = Date.now(); return `${ts}.${sign(ts)}`; };
  function validState(state) {
    const [ts, sig] = String(state ?? "").split(".");
    if (!/^\d+$/.test(ts ?? "") || !sig) return false;
    const a = Buffer.from(sign(Number(ts)));
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    return Date.now() - Number(ts) < STATE_TTL_MS;
  }

  // ---- tokens em settings ----
  async function loadTokens() {
    const row = await prisma.setting.findUnique({ where: { key: BLING_KEY } });
    return row?.value && typeof row.value === "object" ? row.value : null;
  }
  async function saveTokens(value) {
    await prisma.setting.upsert({ where: { key: BLING_KEY }, create: { key: BLING_KEY, value }, update: { value } });
    return value;
  }

  async function tokenRequest(body) {
    const res = await fetchImpl(`${env.BLING_AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
    if (!res.ok || !json?.access_token) {
      const detail = json?.error_description || json?.error?.description || json?.error || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`Bling OAuth ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 200)}`);
    }
    return json;
  }

  function tokensFrom(json, previous = null) {
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || previous?.refreshToken || null,
      expiresAt: Date.now() + (Number(json.expires_in) || 21600) * 1000,
      scope: json.scope ?? previous?.scope ?? null,
      connectedAt: previous?.connectedAt || new Date().toISOString(),
      refreshedAt: new Date().toISOString()
    };
  }

  /** URL de autorização para o painel abrir. */
  function authorizeUrl() {
    if (!configured()) throw AppError.badRequest("Configure BLING_CLIENT_ID e BLING_CLIENT_SECRET nas variáveis de ambiente");
    const q = new URLSearchParams({ response_type: "code", client_id: env.BLING_CLIENT_ID, state: newState() });
    return { url: `${env.BLING_AUTH_BASE}/oauth/authorize?${q}`, callbackUrl: callbackUrl() };
  }

  /** Callback do Bling: valida o state e troca o code por tokens. */
  async function handleCallback({ code, state }) {
    if (!configured()) throw AppError.badRequest("Bling não configurado no servidor");
    if (!validState(state)) throw AppError.badRequest("Autorização expirada ou inválida — clique em “Conectar ao Bling” de novo");
    if (!code) throw AppError.badRequest("O Bling não devolveu o código de autorização");
    const json = await tokenRequest({ grant_type: "authorization_code", code });
    const tokens = await saveTokens(tokensFrom(json));
    log?.info({ scope: tokens.scope }, "bling: conectado");
    return tokens;
  }

  /** Access token válido (renova com o refresh_token quando está para vencer; o refresh rotaciona). */
  async function accessToken() {
    const t = await loadTokens();
    if (!t?.accessToken) throw AppError.badRequest("Bling não conectado — vá em /admin/bling e clique em “Conectar ao Bling”");
    if (Date.now() < Number(t.expiresAt) - REFRESH_SKEW_MS) return t.accessToken;
    if (!t.refreshToken) throw AppError.badRequest("Sessão do Bling expirou — conecte de novo em /admin/bling");
    try {
      const json = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken });
      const fresh = await saveTokens(tokensFrom(json, t));
      log?.info("bling: token renovado");
      return fresh.accessToken;
    } catch (err) {
      log?.warn({ err: err.message }, "bling: falha ao renovar token");
      throw AppError.badRequest(`Sessão do Bling expirou (${err.message}) — conecte de novo em /admin/bling`);
    }
  }

  /** Chamada autenticada à API do Bling. Devolve o JSON; erro vira mensagem legível. */
  async function apiFetch(path, { method = "GET", body = null } = {}) {
    const token = await accessToken();
    const res = await fetchImpl(`${env.BLING_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch { /* ok */ }
    if (!res.ok) {
      const detail = json?.error?.description || json?.error?.message || json?.message || text.slice(0, 200) || "";
      throw new Error(`Bling ${res.status} em ${path}: ${detail}`);
    }
    return json;
  }

  /** Estado da conexão para o painel (tenta um dado real da conta; erro não derruba o status). */
  async function status() {
    const base = { configured: configured(), callbackUrl: callbackUrl(), clientId: env.BLING_CLIENT_ID ? `${env.BLING_CLIENT_ID.slice(0, 8)}…` : null };
    const t = await loadTokens().catch(() => null);
    if (!t?.accessToken) return { ...base, connected: false };
    const out = {
      ...base,
      connected: true,
      connectedAt: t.connectedAt ?? null,
      refreshedAt: t.refreshedAt ?? null,
      expiresAt: t.expiresAt ? new Date(Number(t.expiresAt)).toISOString() : null,
      scope: t.scope ?? null
    };
    try {
      const company = await apiFetch("/empresas/me/dados-basicos");
      out.company = company?.data?.nome || company?.data?.razaoSocial || null;
      out.ok = true;
    } catch (err) {
      out.ok = false;
      out.error = err.message; // token pode estar ok e só faltar escopo do endpoint — o painel mostra o texto cru
    }
    return out;
  }

  async function disconnect() {
    await prisma.setting.deleteMany({ where: { key: BLING_KEY } });
    log?.info("bling: desconectado");
    return { ok: true };
  }

  return { configured, authorizeUrl, handleCallback, accessToken, apiFetch, status, disconnect, callbackUrl };
}

/** Página simples mostrada no fim do OAuth (a aba foi aberta a partir do painel). */
export function callbackPage({ ok, message = "", siteUrl = "" }) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const title = ok ? "Bling conectado!" : "Não deu para conectar ao Bling";
  const text = ok
    ? "Autorização concluída. Pode fechar esta aba e voltar ao painel — o status em /admin/bling deve aparecer como conectado."
    : `${esc(message)} — volte ao painel e clique em “Conectar ao Bling” de novo.`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Kulture</title></head>
<body style="margin:0;background:#0B0B0B;color:#F2EFE9;font-family:Archivo,Inter,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:56px 24px">
<div style="font-size:20px;font-weight:800;letter-spacing:.22em;color:#F6B234;text-transform:uppercase;margin-bottom:28px">Kulture</div>
<h1 style="font-size:28px;line-height:1.1;margin:0 0 16px">${esc(title)}</h1>
<p style="font-size:15px;line-height:1.6;color:#C9C5BC">${text}</p>
${siteUrl ? `<p style="margin-top:28px"><a href="${esc(siteUrl)}/admin/bling" style="display:inline-block;background:#F6B234;color:#0B0B0B;padding:14px 22px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;font-size:12px">Voltar ao painel</a></p>` : ""}
</div></body></html>`;
}
