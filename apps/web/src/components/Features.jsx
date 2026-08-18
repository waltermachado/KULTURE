const PROMISES = [
  { n: "01", t: "Comprado na loja oficial nos EUA", d: "Cada par é adquirido direto da Nike US — sem intermediário, sem réplica." },
  { n: "02", t: "Preço final fechado", d: "Frete internacional já embutido. O valor do card é o valor que você paga." },
  { n: "03", t: "Numeração brasileira", d: "Você escolhe no BR; convertemos pela tabela oficial da Nike Brasil." },
  { n: "04", t: "Compra protegida", d: "Pagamento via InfinitePay (Pix ou cartão) e acompanhamento por e-mail." }
];

import { CATEGORIES } from "../lib/format.js";

const CATS = CATEGORIES.map((c, i) => ({ ...c, n: String(i + 1).padStart(2, "0") }));

/** Blocos Basquete / Casual / Corrida — `onCategory(cat)` decide se filtra a pronta entrega ou busca nos importados. */
export default function Features({ onCategory }) {
  return (
    <>
      <div className="cats">
        {CATS.map((c) => (
          <button key={c.label} onClick={() => onCategory?.(c)}>
            <div>
              <span className="n">{c.n}</span>
              <span className="t">{c.label}</span>
            </div>
            <span className="arr">↗</span>
          </button>
        ))}
      </div>
      <section className="features">
        <div>
          <div className="kicker">Garantia Kulture</div>
          <h2>
            100% original,
            <br />
            importado dos EUA,
            <br />
            na sua porta.
          </h2>
          <p>Cada par sai da loja oficial e chega com numeração BR e preço final fechado. Se não for original, devolvemos o valor integral.</p>
        </div>
        <div className="features-inner">
          {PROMISES.map((pr) => (
            <div className="feature" key={pr.n}>
              <div className="ico">{pr.n}</div>
              <div>
                <b>{pr.t}</b>
                <small>{pr.d}</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
