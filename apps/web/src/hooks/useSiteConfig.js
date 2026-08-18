import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * Configuração pública do site (GET /api/config), carregada uma vez por sessão e compartilhada.
 * WhatsApp de atendimento: vem de WHATSAPP_CONTACT_PHONE na api; se a api não tiver, cai no número
 * do rodapé (DEFAULT_WHATSAPP) — assim o botão "chamar no WhatsApp" nunca some.
 */
export const DEFAULT_WHATSAPP = "5585992578888"; // mesmo do rodapé (Footer.jsx)

const FALLBACK = { whatsapp: { phone: DEFAULT_WHATSAPP, url: `https://wa.me/${DEFAULT_WHATSAPP}` }, installments: null, stock: { enabled: true }, loaded: false };
let cached = null;
let inflight = null;

function load() {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .config()
      .then((c) => {
        cached = { ...FALLBACK, ...c, whatsapp: c?.whatsapp || FALLBACK.whatsapp, loaded: true };
        return cached;
      })
      .catch(() => {
        cached = { ...FALLBACK, loaded: true };
        return cached;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useSiteConfig() {
  const [cfg, setCfg] = useState(cached || FALLBACK);
  useEffect(() => {
    let alive = true;
    load().then((c) => { if (alive) setCfg(c); });
    return () => { alive = false; };
  }, []);
  return cfg;
}

/** Link wa.me com mensagem pré-preenchida. */
export function whatsappLink(cfg, text) {
  const phone = cfg?.whatsapp?.phone || DEFAULT_WHATSAPP;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${phone}${q}`;
}
