import { useSiteConfig, whatsappLink } from "../hooks/useSiteConfig.js";

/**
 * "Não achou o tênis? Chama no WhatsApp."
 *  - variant="banner": bloco grande (busca sem resultado / erro / fim da lista de pronta entrega)
 *  - variant="strip":  faixa compacta abaixo dos resultados
 * `query` entra na mensagem pré-preenchida para o atendimento já saber o que a pessoa procurou.
 */
export default function WhatsappCta({ variant = "banner", query = "", context = "importados" }) {
  const cfg = useSiteConfig();
  const msg = query
    ? `Oi, Kulture! Procurei "${query}" no site e não encontrei. Vocês conseguem? Meu tamanho é BR ___.`
    : context === "stock"
      ? "Oi, Kulture! Vi a página de pronta entrega e não achei o modelo/tamanho que quero. Vocês conseguem importar? Meu tamanho é BR ___."
      : "Oi, Kulture! Estou procurando um tênis que não achei no site. Vocês conseguem? Meu tamanho é BR ___.";
  const href = whatsappLink(cfg, msg);

  if (variant === "strip") {
    return (
      <div className="wa-strip" role="note">
        <span className="wa-strip-text">
          <b>Não achou o seu?</b> Manda o modelo e o tamanho no WhatsApp — a gente busca nos EUA e responde com preço e prazo.
        </span>
        <a className="wa-btn sm" href={href} target="_blank" rel="noreferrer">
          <WaIcon /> Chamar no WhatsApp
        </a>
      </div>
    );
  }

  return (
    <section className="wa-banner" aria-label="Fale com a gente no WhatsApp">
      <div className="wa-banner-copy">
        <div className="kicker">Não achou?</div>
        <h3>
          {query ? <>Não encontramos <em>"{query}"</em>, mas a gente corre atrás.</> : <>Não encontrou o tênis que <em>procurava?</em></>}
        </h3>
        <p>
          Manda o modelo (e o tamanho) no WhatsApp: a gente procura direto na Nike US e responde com preço final e prazo — sem compromisso.
        </p>
      </div>
      <a className="wa-btn" href={href} target="_blank" rel="noreferrer">
        <WaIcon /> <span>Chamar no WhatsApp</span> <span className="arrow">→</span>
      </a>
    </section>
  );
}

function WaIcon() {
  return (
    <svg className="wa-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z" />
    </svg>
  );
}
