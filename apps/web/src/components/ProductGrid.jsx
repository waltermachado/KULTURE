import ProductMedia from "./ProductMedia.jsx";
import { brl } from "../lib/format.js";

function Card({ p, onAdd }) {
  return (
    <div className="card">
      <span className={`badge${p.badgeRed ? " red" : ""}`}>{p.badge}</span>
      <div className="card-img">
        <ProductMedia src={p.img} alt={p.name} color={p.color} />
      </div>
      <div className="card-body">
        <span className="card-brand">{p.brand}</span>
        <span className="card-name">{p.name}</span>
        {p.subtitle && <span className="card-meta">{p.subtitle}</span>}
        <div className="card-price">
          <span className="price">{brl(p.price)}</span>
          {p.old && <span className="price-old">{brl(p.old)}</span>}
        </div>
      </div>
      <div className="card-actions">
        <button className="btn-add" onClick={() => onAdd(p)}>
          + Adicionar ao carrinho
        </button>
      </div>
    </div>
  );
}

/**
 * state: { status: 'loading'|'ok'|'empty'|'error', products, title, sub, query }
 */
export default function ProductGrid({ state, onAdd }) {
  const { status, products, title, sub, query } = state;
  return (
    <section className="section" id="drops">
      <div className="section-title">
        <h2>{title}</h2>
        <span className="sub">{sub}</span>
      </div>
      <div className="grid">
        {status === "loading" && <p className="grid-msg">Buscando... 🔎</p>}
        {status === "empty" && <p className="grid-msg">Nada encontrado pra "{query}" 😕</p>}
        {status === "error" && <p className="grid-msg err">Backend indisponível. Suba a api e o scraper (npm run dev). 🔌</p>}
        {status === "ok" && products.map((p) => <Card key={p.key} p={p} onAdd={onAdd} />)}
      </div>
    </section>
  );
}
