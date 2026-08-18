import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Hero from "../components/Hero.jsx";
import Marquee from "../components/Marquee.jsx";
import ProductGrid from "../components/ProductGrid.jsx";
import Features from "../components/Features.jsx";
import { api } from "../lib/api.js";
import { toCard, CATEGORIES } from "../lib/format.js";

const TITLE = (
  <>
    Pronta <em>entrega</em>
  </>
);

/**
 * Pronta entrega — produtos em estoque no Brasil, cadastrados no backoffice (/admin/estoque).
 * Não consulta a Nike: GET /api/stock, uma vez por visita. Mesmos componentes visuais da home.
 * Filtro por categoria na URL (?cat=basketball|lifestyle|running): abas do topo, blocos, rodapé e os chips
 * acima da lista trocam o filtro SEM sair da página.
 */
export default function Stock({ setSelectedProductForSize, onCategory }) {
  const [params, setParams] = useSearchParams();
  const cat = CATEGORIES.some((c) => c.key === params.get("cat")) ? params.get("cat") : null;
  const [all, setAll] = useState({ status: "loading", products: [] });

  useEffect(() => {
    let alive = true;
    api
      .stock()
      .then((d) => { if (alive) setAll({ status: "ok", products: (d.products || []).map(toCard) }); })
      .catch(() => { if (alive) setAll({ status: "error", products: [] }); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => (cat ? all.products.filter((p) => p.category === cat) : all.products), [all.products, cat]);
  const catLabel = CATEGORIES.find((c) => c.key === cat)?.label || null;
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.key, all.products.filter((p) => p.category === c.key).length])), [all.products]);

  const grid = {
    status: all.status === "loading" ? "loading" : all.status === "error" ? "error" : filtered.length ? "ok" : "empty",
    products: filtered,
    title: catLabel ? <>Pronta entrega <em>· {catLabel}</em></> : TITLE,
    sub: all.status === "loading"
      ? "// carregando o estoque…"
      : all.status === "error"
        ? "// erro ao carregar o estoque"
        : filtered.length
          ? `// ${filtered.length} modelo(s)${catLabel ? ` de ${catLabel.toLowerCase()}` : ""} em estoque no Brasil · envio imediato`
          : catLabel ? `// nenhum ${catLabel.toLowerCase()} em estoque agora` : "// estoque em renovação",
    query: ""
  };

  const setCat = (key) => {
    const next = new URLSearchParams(params);
    if (key) next.set("cat", key); else next.delete("cat");
    setParams(next);
  };

  // hero destaca o 1º da lista filtrada (ou o 1º do estoque todo)
  const featured = all.status === "ok" ? (filtered[0] || all.products[0] || null) : null;

  const filters = all.status === "ok" && all.products.length > 0 ? (
    <div className="grid-filters" role="tablist" aria-label="Filtrar por categoria">
      <button type="button" role="tab" aria-selected={!cat} className={`cat-chip${!cat ? " on" : ""}`} onClick={() => setCat(null)}>Todos <i>{all.products.length}</i></button>
      {CATEGORIES.map((c) => (
        <button type="button" role="tab" key={c.key} aria-selected={cat === c.key} className={`cat-chip${cat === c.key ? " on" : ""}${counts[c.key] ? "" : " zero"}`} onClick={() => setCat(c.key)}>
          {c.label} <i>{counts[c.key]}</i>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <>
      <Hero featured={featured} onPick={setSelectedProductForSize} variant="stock" />
      <Marquee variant="stock" />
      <ProductGrid
        state={grid}
        onAdd={setSelectedProductForSize}
        kicker={catLabel ? `No Brasil · ${catLabel}` : "No Brasil · envio imediato"}
        filters={filters}
        loadingMsg="Carregando o estoque…"
        emptyMsg={
          catLabel && all.products.length
            ? `Nenhum par de ${catLabel.toLowerCase()} em estoque neste momento — veja "Todos" acima, ou chame no WhatsApp que a gente importa pra você.`
            : "Nenhum par em estoque neste momento — mas a gente importa pra você: veja os Importados ou chame no WhatsApp."
        }
        errorMsg="Não foi possível carregar o estoque agora. Tente de novo em instantes."
        context="stock"
      />
      <Features onCategory={onCategory} />
    </>
  );
}
