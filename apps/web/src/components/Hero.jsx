import { brl } from "../lib/format.js";
import SneakerSvg from "./SneakerSvg.jsx";

/**
 * Hero editorial: à esquerda o destaque (1º produto do grid), à direita o par flutuando sobre os anéis.
 * `featured` é um card já normalizado (toCard); enquanto carrega mostra o headline genérico.
 * `variant`: "import" (padrão — importados dos EUA) | "stock" (pronta entrega) | "hypados" (drops hypados,
 * mesmo fluxo da pronta entrega — estoque no Brasil).
 */
export default function Hero({ featured, onPick, variant = "import" }) {
  const p = featured;
  const isHypados = variant === "hypados";
  const isStock = variant === "stock" || isHypados; // hypados usa o mesmo visual/fluxo da pronta entrega
  const line1 = p ? p.name : isHypados ? "Hypados" : isStock ? "Pronta entrega" : "Sneakers com";
  // linha 2 = colorway curto (1º segmento antes da "/"), senão o subtítulo; evita quebrar em 3 linhas
  const colorway = (p?.colorDescription || "").split("/")[0].trim();
  const line2 = p ? (colorway && colorway.length <= 18 ? colorway : (p.subtitle || "Original")) : isStock ? "no Brasil" : "atitude de rua";
  const cat = (p?.subtitle || "basketball shoes").replace(/shoes/i, "").trim().toUpperCase() || "BASQUETE";

  const drop = p ? (isHypados ? "HYPADOS" : isStock ? "PRONTA ENTREGA" : "DROP 01") : "KULTURE BR";
  const dropSub = p
    ? (isHypados ? `${cat} / garimpando direto dos EUA` : isStock ? `${cat} / em estoque no Brasil` : `${cat} / importado dos EUA`)
    : (isHypados ? "Garimpados nos EUA · importados pra você" : isStock ? "Estoque próprio · envio imediato" : "Importados originais dos EUA");
  const desc = p
    ? (isHypados
        ? "O par mais hypado e difícil de achar — original, garimpado nos EUA pelos contatos Kulture BR e importado pra você. Numeração BR e preço final fechado."
        : isStock
        ? "Par original já no Brasil: sai do nosso estoque assim que o pagamento cai, sem esperar importação. Numeração BR e preço final fechado."
        : "Par original comprado na loja oficial nos EUA e entregue na sua porta, com numeração brasileira e preço final fechado — o que você vê é o que você paga.")
    : (isHypados
        ? "Os pares mais hypados e difíceis de encontrar — originais, garimpados nos EUA pelos contatos Kulture BR e importados pra você, com numeração BR, preço final fechado e frete grátis."
        : isStock
        ? "Pares originais em estoque aqui no Brasil, prontos para sair. Sem espera de importação, numeração BR e frete grátis."
        : "Os drops mais quentes de basquete, corrida e casual, importados dos EUA com preço final fechado, numeração BR e frete grátis.");
  const priceSmall = `${p?.installmentsLabel ? `ou ${p.installmentsLabel} · ` : ""}${isHypados ? "importado pra você" : isStock ? "envio imediato" : "numeração BR"}`;

  return (
    <section className={`hero${isStock ? " hero-stock" : ""}${isHypados ? " hero-hypados" : ""}`} id="top">
      <div className="hero-copy">
        <div className="hero-drop">
          <b>{drop}</b>
          {p?.launch?.comingSoon && <b className="pre">PRÉ-VENDA</b>}
          {isStock && p?.stockQty === 1 && <b className="pre">ÚLTIMO PAR</b>}
          <span>{dropSub}</span>
        </div>
        <h1>
          {line1}
          <span className="stroke">{line2}</span>
        </h1>
        <p className="hero-desc">{desc}</p>
        <div className="hero-cta">
          {p && (
            <div className="hero-price">
              <div className="label">Preço final no Pix · frete grátis</div>
              <strong>{brl(p.price)}</strong>
              <small>{priceSmall}</small>
            </div>
          )}
          <button className="btn-cta" onClick={() => (p ? onPick?.(p) : document.getElementById("drops")?.scrollIntoView({ behavior: "smooth" }))}>
            <span>{p ? "Ver o par" : isHypados ? "Ver os hypados" : isStock ? "Ver o estoque" : "Ver os drops"}</span>
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
        <div className="hero-tag t3">{isStock ? "Envio\nimediato" : "Frete\ngrátis"}</div>
        <div className="hero-sku">{p?.styleColor ? `SKU ${p.styleColor} · Kulture BR` : "Kulture BR"}</div>
      </div>
    </section>
  );
}
