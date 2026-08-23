import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Hero from "../components/Hero.jsx";
import Marquee from "../components/Marquee.jsx";
import ProductGrid from "../components/ProductGrid.jsx";
import Features from "../components/Features.jsx";
import { api } from "../lib/api.js";
import { toCard, CATEGORIES } from "../lib/format.js";

/** Textos por seção de estoque próprio — o fluxo é o mesmo (estoque no Brasil, envio imediato). */
const COPY = {
  stock: {
    title: <>Pronta <em>entrega</em></>,
    catTitle: (label) => <>Pronta entrega <em>· {label}</em></>,
    kicker: "No Brasil · envio imediato",
    catKicker: (label) => `No Brasil · ${label}`,
    subOk: (n, label) => `// ${n} modelo(s)${label ? ` de ${label.toLowerCase()}` : ""} em estoque no Brasil · envio imediato`,
    subEmpty: (label) => (label ? `// nenhum ${label.toLowerCase()} em estoque agora` : "// estoque em renovação"),
    loading: "Carregando o estoque…",
    emptyCat: (label) => `Nenhum par de ${label.toLowerCase()} em estoque neste momento — veja "Todos" acima, ou chame no WhatsApp que a gente importa pra você.`,
    empty: "Nenhum par em estoque neste momento — mas a gente importa pra você: veja os Importados ou chame no WhatsApp.",
    error: "Não foi possível carregar o estoque agora. Tente de novo em instantes."
  },
  hypados: {
    title: <>HYPA<em>DOS</em></>,
    catTitle: (label) => <>Hypados <em>· {label}</em></>,
    kicker: "Os drops mais quentes · no Brasil",
    catKicker: (label) => `Hypados · ${label}`,
    subOk: (n, label) => `// ${n} par(es) hypado(s)${label ? ` de ${label.toLowerCase()}` : ""} em estoque no Brasil · envio imediato`,
    subEmpty: (label) => (label ? `// nenhum ${label.toLowerCase()} hypado agora` : "// novos drops chegando"),
    loading: "Carregando os hypados…",
    emptyCat: (label) => `Nenhum hypado de ${label.toLowerCase()} agora — veja "Todos" acima, ou chame no WhatsApp que a gente caça o seu grail.`,
    empty: "Nenhum hypado em estoque neste momento — novos drops chegando. Chame no WhatsApp que a gente caça o seu grail.",
    error: "Não foi possível carregar os hypados agora. Tente de novo em instantes."
  }
};

/**
 * Vitrine de estoque próprio — Pronta entrega (/pronta-entrega) ou Hypados (/hypados), conforme `section`.
 * Produtos cadastrados no backoffice; não consulta a Nike: GET /api/stock(?section=hypados), uma vez por visita.
 * Filtro por categoria na URL (?cat=basketball|lifestyle|running) — abas do topo, blocos, rodapé e chips trocam
 * o filtro SEM sair da página. O tênis do hero pode ser fixado no backoffice (Vitrine) por seção × categoria;
 * sem configuração, destaca o 1º da lista filtrada.
 * Clicar num par NÃO abre o modal: vai para a página própria do tênis (/pronta-entrega/:slug ou /hypados/:slug),
 * que é o link que o dono cola no Instagram. (Sem slug — não deveria acontecer — cai no modal de antes.)
 */
export default function Stock({ section = "stock", setSelectedProductForSize, onCategory }) {
  const copy = COPY[section] || COPY.stock;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openProduct = (p) => (p?.href ? navigate(p.href) : setSelectedProductForSize(p));
  const cat = CATEGORIES.some((c) => c.key === params.get("cat")) ? params.get("cat") : null;
  const size = /^\d{2}(\.5)?$/.test(params.get("tam") || "") ? params.get("tam") : null; // filtro por tamanho BR (?tam=41)
  const [all, setAll] = useState({ status: "loading", products: [] });
  const [pinned, setPinned] = useState(null); // destaque configurado no backoffice (Vitrine)

  useEffect(() => {
    let alive = true;
    setAll({ status: "loading", products: [] });
    api
      .stock(section)
      .then((d) => { if (alive) setAll({ status: "ok", products: (d.products || []).map(toCard) }); })
      .catch(() => { if (alive) setAll({ status: "error", products: [] }); });
    return () => { alive = false; };
  }, [section]);

  // hero configurável (backoffice → Vitrine): por seção × categoria; falha/sem config → fallback abaixo
  useEffect(() => {
    let alive = true;
    api
      .featured(section, cat)
      .then((d) => { if (alive) setPinned(d.product ? toCard(d.product) : null); })
      .catch(() => { if (alive) setPinned(null); });
    return () => { alive = false; };
  }, [section, cat]);

  const byCat = useMemo(() => (cat ? all.products.filter((p) => p.category === cat) : all.products), [all.products, cat]);
  const filtered = useMemo(() => (size ? byCat.filter((p) => p.sizesAvailable?.includes(size)) : byCat), [byCat, size]);
  const catLabel = CATEGORIES.find((c) => c.key === cat)?.label || null;
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.key, all.products.filter((p) => p.category === c.key).length])), [all.products]);
  // tamanhos com par disponível na categoria atual (ordem numérica) + quantos modelos têm cada um
  const sizeCounts = useMemo(() => {
    const m = new Map();
    for (const p of byCat) for (const s of new Set(p.sizesAvailable || [])) m.set(s, (m.get(s) || 0) + 1);
    return [...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [byCat]);

  const grid = {
    status: all.status === "loading" ? "loading" : all.status === "error" ? "error" : filtered.length ? "ok" : "empty",
    products: filtered,
    title: catLabel ? copy.catTitle(catLabel) : copy.title,
    sub: all.status === "loading"
      ? `// ${copy.loading.toLowerCase()}`
      : all.status === "error"
        ? "// erro ao carregar"
        : filtered.length
          ? `${copy.subOk(filtered.length, catLabel)}${size ? ` · tamanho ${size}` : ""}`
          : size
            ? `// nenhum par no tamanho ${size}${catLabel ? ` em ${catLabel.toLowerCase()}` : ""} agora`
            : copy.subEmpty(catLabel),
    query: ""
  };

  const setCat = (key) => {
    const next = new URLSearchParams(params);
    if (key) next.set("cat", key); else next.delete("cat");
    setParams(next);
  };
  const setSize = (br) => {
    const next = new URLSearchParams(params);
    if (br && br !== size) next.set("tam", br); else next.delete("tam"); // clicar de novo desmarca
    setParams(next);
  };

  // hero: o configurado no backoffice para (seção, categoria); senão o 1º da lista filtrada (ou do estoque todo)
  const featured = pinned || (all.status === "ok" ? (filtered[0] || all.products[0] || null) : null);

  const filters = all.status === "ok" && all.products.length > 0 ? (
    <>
      <div className="grid-filters" role="tablist" aria-label="Filtrar por categoria">
        <button type="button" role="tab" aria-selected={!cat} className={`cat-chip${!cat ? " on" : ""}`} onClick={() => setCat(null)}>Todos <i>{all.products.length}</i></button>
        {CATEGORIES.map((c) => (
          <button type="button" role="tab" key={c.key} aria-selected={cat === c.key} className={`cat-chip${cat === c.key ? " on" : ""}${counts[c.key] ? "" : " zero"}`} onClick={() => setCat(c.key)}>
            {c.label} <i>{counts[c.key]}</i>
          </button>
        ))}
      </div>
      {/* filtro por tamanho: só os BR com par disponível agora (na categoria escolhida); clicar de novo limpa */}
      {sizeCounts.length > 0 && (
        <div className="grid-filters size-filters" role="group" aria-label="Filtrar por tamanho">
          <span className="size-filters-label">Tamanho <small>BR</small></span>
          <button type="button" className={`cat-chip size-chip${!size ? " on" : ""}`} aria-pressed={!size} onClick={() => setSize(null)}>Todos</button>
          {sizeCounts.map(([br, n]) => (
            <button type="button" key={br} className={`cat-chip size-chip${size === br ? " on" : ""}`} aria-pressed={size === br} title={`${n} modelo(s) no ${br}`} onClick={() => setSize(br)}>
              {br}
            </button>
          ))}
          {size && !sizeCounts.some(([br]) => br === size) && (
            <button type="button" className="cat-chip size-chip on" aria-pressed onClick={() => setSize(null)}>{size} ✕</button>
          )}
        </div>
      )}
    </>
  ) : null;

  return (
    <>
      <Hero featured={featured} onPick={openProduct} variant={section} />
      <Marquee variant={section} />
      <ProductGrid
        state={grid}
        onAdd={openProduct}
        kicker={catLabel ? copy.catKicker(catLabel) : copy.kicker}
        filters={filters}
        loadingMsg={copy.loading}
        emptyMsg={size && all.products.length ? `Nenhum par no tamanho ${size}${catLabel ? ` em ${catLabel.toLowerCase()}` : ""} neste momento — veja “Todos” nos tamanhos, ou chame no WhatsApp que a gente importa pra você.` : catLabel && all.products.length ? copy.emptyCat(catLabel) : copy.empty}
        errorMsg={copy.error}
        context="stock"
      />
      <Features onCategory={onCategory} />
    </>
  );
}
