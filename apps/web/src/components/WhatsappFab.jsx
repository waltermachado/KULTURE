import { useSiteConfig, whatsappLink } from "../hooks/useSiteConfig.js";

/**
 * Botão FLUTUANTE do WhatsApp (canto inferior direito, sempre visível na loja) — o CTA de atendimento
 * mais evidente do site; as faixas "não achou?" nas vitrines continuam existindo.
 * z-index 80: acima do conteúdo, abaixo do overlay/sacola/modal (90+), que cobrem o botão quando abertos.
 * No desktop mostra o rótulo "Fale com a gente"; no celular vira só a bolinha verde.
 */
export default function WhatsappFab() {
  const cfg = useSiteConfig();
  const href = whatsappLink(cfg, "Oi, Kulture! Vim pelo site e quero um tênis. Pode me ajudar? Modelo: ___ · tamanho BR ___.");
  if (!href) return null;
  return (
    <a className="wa-fab" href={href} target="_blank" rel="noreferrer" aria-label="Fale com a gente no WhatsApp">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" />
      </svg>
      <span className="wa-fab-label">Fale com a gente</span>
    </a>
  );
}
