const PROMISES = [
  { n: "01", t: "Comprado na loja oficial nos EUA", d: "Cada par é adquirido direto da Nike US — sem intermediário, sem réplica." },
  { n: "02", t: "Preço final fechado", d: "Frete internacional incluso, sem taxas extras." },
  { n: "03", t: "Numeração brasileira", d: "Você escolhe no BR; convertemos pela tabela oficial da Nike Brasil." },
  { n: "04", t: "Compra protegida", d: "Pagamento via InfinitePay (Pix ou cartão) e acompanhamento por e-mail." },
  { n: "05", t: "Devolução", d: "O tênis chegou e não serviu? Você tem até 7 dias após o recebimento para devolução. Sujeito a análise do suporte via WhatsApp." }
];

import { CATEGORIES } from "../lib/format.js";

const CATEGORY_COPY = {
  basketball: {
    eyebrow: "Domine a quadra",
    desc: "GT Cut, Sabrina, Ja e pares com resposta rápida para jogo e estilo."
  },
  lifestyle: {
    eyebrow: "Seu estilo, todo dia",
    desc: "Silhuetas versáteis para montar look com presença sem perder conforto."
  },
  running: {
    eyebrow: "Encontre seu ritmo",
    desc: "Modelos para treinar, correr leve ou encaixar performance na rotina."
  }
};

const CATS = CATEGORIES.map((c) => ({ ...c, ...CATEGORY_COPY[c.key] }));

/** Blocos Basquete / Casual / Corrida — `onCategory(cat)` decide se filtra a pronta entrega ou busca nos importados. */
export default function Features({ onCategory }) {
  return (
    <>
      <div className="cats">
        {CATS.map((c) => (
          <button key={c.label} onClick={() => onCategory?.(c)}>
            <div className="cats-copy">
              <span className="n">{c.eyebrow}</span>
              <span className="t">{c.label}</span>
              <small>{c.desc}</small>
            </div>
            <div className="cats-foot">
              <span>Explorar seleção</span>
              <span className="arr">↗</span>
            </div>
          </button>
        ))}
      </div>
      <section className="features">
        <div>
          <div className="kicker">Garantia Kulture</div>
          <h2>
            Seu estilo.
            <br />
            Nossa palavra.
          </h2>
          <p>Cada par sai da loja oficial e chega com numeração BR e preço final fechado. Se não for original, devolvemos o valor integral.</p>
          <div className="features-badges">
            <span>Loja oficial nos EUA</span>
            <span>Preço final transparente</span>
            <span>Suporte no WhatsApp</span>
          </div>
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
