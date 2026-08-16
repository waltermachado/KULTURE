import { brl } from "../lib/format.js";
import SneakerSvg from "./SneakerSvg.jsx";

/**
 * Hero editorial: à esquerda o destaque (1º produto do grid), à direita o par flutuando sobre os anéis.
 * `featured` é um card já normalizado (toCard); enquanto carrega mostra o headline genérico.
 */
export default function Hero({ featured, onPick }) {
  const p = featured;
  const line1 = p ? p.name : "Sneakers com";
  // linha 2 = colorway curto (1º segmento antes da "/"), senão o subtítulo; evita quebrar em 3 linhas
  const colorway = (p?.colorDescription || "").split("/")[0].trim();
  const line2 = p ? (colorway && colorway.length <= 18 ? colorway : (p.subtitle || "Original")) : "atitude de rua";
  const cat = (p?.subtitle || "basketball shoes").replace(/shoes/i, "").trim().toUpperCase() || "BASQUETE";

  return (
    <section className="hero" id="top">
      <div className="hero-copy">
        <div className="hero-drop">
          <b>{p ? "DROP 01" : "KULTURE BR"}</b>
          {p?.launch?.comingSoon && <b className="pre">PRÉ-VENDA</b>}
          <span>{p ? `${cat} / importado dos EUA` : "Importados originais dos EUA"}</span>
        </div>
        <h1>
          {line1}
          <span className="stroke">{line2}</span>
        </h1>
        <p className="hero-desc">
          {p
            ? "Par original comprado na loja oficial nos EUA e entregue na sua porta, com numeração brasileira e preço final fechado — o que você vê é o que você paga."
            : "Os drops mais quentes de basquete, corrida e casual, importados dos EUA com preço final fechado, numeração BR e frete grátis."}
        </p>
        <div className="hero-cta">
          {p && (
            <div className="hero-price">
              <div className="label">Preço final · frete grátis</div>
              <strong>{brl(p.price)}</strong>
              <small>Pix ou cartão · numeração BR</small>
            </div>
          )}
          <button className="btn-cta" onClick={() => (p ? onPick?.(p) : document.getElementById("drops")?.scrollIntoView({ behavior: "smooth" }))}>
            <span>{p ? "Ver o par" : "Ver os drops"}</span>
            <span className="arrow">→</span>
          </button>
        </div>
      </div>

      <div className="hero-stage" aria-hidden="true">
        <div className="glow" />
        <div className="ring" />
        <div className="ring2" />
        <div className="halo" />
        <div className="shoe">
          {p?.img ? <img src={p.img} alt="" /> : <SneakerSvg color="#FFD31F" />}
        </div>
        <div className="hero-tag t1">{"100%\noriginal"}</div>
        <div className="hero-tag t2">{"Numeração\nBR"}</div>
        <div className="hero-tag t3">{"Frete\ngrátis"}</div>
        <div className="hero-sku">{p?.styleColor ? `SKU ${p.styleColor} · Kulture BR` : "Kulture BR"}</div>
      </div>
    </section>
  );
}
