import ProductMedia from "./ProductMedia.jsx";
import { brl } from "../lib/format.js";

function Card({ p, i, onAdd }) {
  return (
    <article className="card" onClick={() => onAdd(p)}>
      <div className="card-top">
        <span className="card-brand">{p.brand}</span>
        <span className={`badge${p.badgeRed ? " red" : ""}${p.launch?.comingSoon ? " pre" : ""}`}>{p.badge}</span>
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
          {p.old && <span className="price-old">{brl(p.old)}</span>}
        </div>
        <span className="card-foot">{p.launch?.comingSoon ? "Pré-venda · " : ""}Frete grátis · numeração BR</span>
        <div className="card-actions">
          <button className="btn-add" onClick={(e) => { e.stopPropagation(); onAdd(p); }}>
            Escolher tamanho <span>→</span>
          </button>
        </div>
      </div>
    </article>
  );
}

/** state: { status: 'loading'|'ok'|'empty'|'error', products, title, sub, query } */
export default function ProductGrid({ state, onAdd }) {
  const { status, products, title, sub, query } = state;
  return (
    <>
      <section className="section" id="drops">
        <div className="section-title">
          <div>
            <div className="kicker">{query ? "Resultado da busca" : "Em estoque agora"}</div>
            <h2 style={{ marginTop: 10 }}>{title}</h2>
          </div>
          <span className="sub">{sub}</span>
        </div>
      </section>
      <div className="grid">
        {status === "loading" && <p className="grid-msg">Buscando na Nike US…</p>}
        {status === "empty" && <p className="grid-msg">Nada encontrado para "{query}".</p>}
        {status === "error" && <p className="grid-msg err">Catálogo indisponível no momento. Tente de novo em instantes.</p>}
        {status === "ok" && products.map((p, i) => <Card key={p.key} p={p} i={i} onAdd={onAdd} />)}
      </div>
    </>
  );
}
