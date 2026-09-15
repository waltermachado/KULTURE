import { Link } from "react-router-dom";
import { brl } from "../lib/format.js";
import ProductMedia from "./ProductMedia.jsx";

const COPY = {
  import: {
    label: "Direto dos EUA",
    title: "Seu próximo",
    accent: "par favorito.",
    text: "Da quadra à rua. Sneakers originais, numeração BR e preço final fechado.",
    browse: "Explorar os drops",
    stamp: "Curadoria Kulture",
    detail: "Importado para você",
    orbit: ["Original verificado", "Preço final fechado", "Numeração BR"],
    proof: [
      { title: "Compra oficial", text: "pares adquiridos em loja autorizada" },
      { title: "Sem surpresa", text: "frete internacional incluído" },
      { title: "Atendimento real", text: "suporte no WhatsApp até a entrega" }
    ]
  },
  stock: {
    label: "Já está no Brasil",
    title: "Escolheu.",
    accent: "É seu.",
    text: "Seus próximos sneakers já estão por aqui. Pares originais, prontos para sair após a confirmação do pagamento.",
    browse: "Ver pronta entrega",
    stamp: "Pronta entrega",
    detail: "Envio direto do Brasil",
    orbit: ["Sai do Brasil", "Frete grátis", "Compra protegida"],
    proof: [
      { title: "Envio rápido", text: "postagem após confirmação do pagamento" },
      { title: "Estoque validado", text: "pares disponíveis para despacho imediato" },
      { title: "Pagamento seguro", text: "Pix ou cartão com acompanhamento" }
    ]
  },
  hypados: {
    label: "Fora do óbvio",
    title: "Difícil achar.",
    accent: "Fácil querer.",
    text: "Os pares que fazem a diferença. Originais, garimpados nos EUA e importados para você.",
    browse: "Explorar os hypados",
    stamp: "Seleção Hypados",
    detail: "Garimpado nos EUA",
    orbit: ["Garimpo raro", "Curadoria limitada", "Autenticidade garantida"],
    proof: [
      { title: "Seleção rara", text: "pares difíceis de achar no mercado local" },
      { title: "Origem confiável", text: "curadoria focada em autenticidade" },
      { title: "Compra assistida", text: "apoio da escolha ao pós-venda" }
    ]
  }
};

export default function Hero({ featured, onPick, variant = "import" }) {
  const p = featured;
  const copy = COPY[variant] || COPY.import;
  const browse = (event) => {
    const target = document.getElementById("drops");
    const instant = event?.detail === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
    if (event?.detail === 0) target?.focus({ preventScroll: true });
  };
  return (
    <section className={`fresh-hero fresh-hero-${variant}`} id="top" aria-labelledby="hero-title">
      <div className="fresh-hero-copy">
        <p className="hero-note"><span aria-hidden="true" /> {copy.label}</p>
        <h1 id="hero-title">{copy.title}<br /><em>{copy.accent}</em></h1>
        <p className="fresh-hero-desc">{copy.text}</p>
        <div className="fresh-hero-actions">
          <button type="button" className="btn-cta" onClick={browse}>{copy.browse}<span className="arrow" aria-hidden="true">↗</span></button>
          <span className="hero-delivery">Frete grátis para todo o Brasil</span>
        </div>
        <div className="hero-proof">
          {copy.proof.map((item) => (
            <span key={item.title}>
              <b>{item.title}</b>
              <small>{item.text}</small>
            </span>
          ))}
        </div>
      </div>
      <div className="fresh-stage">
        <div className="stage-orbit" aria-hidden="true">
          {copy.orbit.map((item, index) => (
            <span key={item} className={`stage-chip stage-chip-${index + 1}`}>{item}</span>
          ))}
        </div>
        <div className="stage-top"><span>{copy.stamp}</span></div>
        <span className="stage-word" aria-hidden="true">KULTURE</span>
        <div className="fresh-shoe" key={p?.img || variant}>
          <ProductMedia src={p?.img} alt={p ? `${p.name}${p.colorDescription ? ` — ${p.colorDescription}` : ''}` : ""} color="#272720" priority />
        </div>
        <div className="stage-bottom">
          <div className="stage-product"><span>{p?.brand || "Kulture BR"} · {copy.detail}</span><strong>{p?.name || "O próximo par pode ser seu."}</strong>{p && <small>{brl(p.price)} <span>no Pix</span></small>}</div>
          {p?.href ? <Link to={p.href} className="stage-open" aria-label={`Ver ${p.name}`}>↗</Link> : <button type="button" className="stage-open" onClick={() => p ? onPick?.(p) : browse()} aria-label={p ? `Ver ${p.name}` : copy.browse}>↗</button>}
        </div>
      </div>
    </section>
  );
}
