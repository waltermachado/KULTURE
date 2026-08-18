import ProductMedia from "./ProductMedia.jsx";
import WhatsappCta from "./WhatsappCta.jsx";
import { brl } from "../lib/format.js";

function Card({ p, i, onAdd }) {
  const soldOut = p.stock && p.stockQty === 0;
  return (
    <article className={`card${p.stock ? " card-stock" : ""}`} onClick={() => onAdd(p)}>
      <div className="card-top">
        <span className="card-brand">{p.brand}</span>
        <span className={`badge${p.badgeRed ? " red" : ""}${p.launch?.comingSoon ? " pre" : ""}${p.stock && !p.badgeRed ? " stock" : ""}`}>{p.badge}</span>
      </div>
      <div className="card-ghost">{String(i + 1).padStart(2, "0")}</div>
      <div className="card-img">
        <ProductMedia src={p.img} alt={p.name} color={p.color} />
      </div>
      <div className="card-body">
        <span className="card-name">{p.name}</span>
        {(p.colorDescription || p.subtitle) && <span className="card-meta">{p.colorDescription || p.subtitle}</span>}
        <div className="card-price">
          <span className="price">{brl(p.price)}</span>
          {p.pix && <span className="pix-tag">no Pix</span>}
          {p.old && <span className="price-old">{brl(p.old)}</span>}
        </div>
        {p.installmentsLabel && <span className="card-installments">ou {p.installmentsLabel}</span>}
        <span className="card-foot">
          {p.stock
            ? (soldOut ? "Esgotado · " : p.stockQty === 1 ? "Último par · " : "Em estoque no Brasil · ") + "envio imediato · frete grátis"
            : `${p.launch?.comingSoon ? "Pré-venda · " : ""}Frete grátis · numeração BR`}
        </span>
        <div className="card-actions">
          <button className="btn-add" onClick={(e) => { e.stopPropagation(); onAdd(p); }} disabled={soldOut}>
            {soldOut ? "Esgotado" : "Escolher tamanho"} <span>→</span>
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * state: { status: 'loading'|'ok'|'empty'|'error', products, title, sub, query }
 * kicker/loadingMsg/emptyMsg/errorMsg: textos por página (importados × pronta entrega)
 * whatsapp: mostra o CTA "não achou? chama no WhatsApp" (banner no vazio/erro, faixa após os resultados)
 */
export default function ProductGrid({
  state,
  onAdd,
  kicker,
  filters = null,
  loadingMsg = "Buscando na Nike US…",
  emptyMsg,
  errorMsg = "Catálogo indisponível no momento. Tente de novo em instantes.",
  whatsapp = true,
  context = "importados"
}) {
  const { status, products, title, sub, query } = state;
  return (
    <>
      <section className="section" id="drops">
        <div className="section-title">
          <div>
            <div className="kicker">{kicker || (query ? "Resultado da busca" : "Em estoque agora")}</div>
            <h2 style={{ marginTop: 10 }}>{title}</h2>
          </div>
          <span className="sub">{sub}</span>
        </div>
        {filters}
      </section>
      <div className="grid">
        {status === "loading" && <p className="grid-msg">{loadingMsg}</p>}
        {status === "empty" && <p className="grid-msg">{emptyMsg || `Nada encontrado para "${query}".`}</p>}
        {status === "error" && <p className="grid-msg err">{errorMsg}</p>}
        {status === "ok" && products.map((p, i) => <Card key={p.key} p={p} i={i} onAdd={onAdd} />)}
      </div>
      {whatsapp && (status === "empty" || status === "error") && <WhatsappCta variant="banner" query={query} context={context} />}
      {whatsapp && status === "ok" && products.length > 0 && <WhatsappCta variant="strip" query={query} context={context} />}
    </>
  );
}
