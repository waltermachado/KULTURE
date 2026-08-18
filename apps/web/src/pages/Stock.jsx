import { useEffect, useState } from "react";
import Hero from "../components/Hero.jsx";
import Marquee from "../components/Marquee.jsx";
import ProductGrid from "../components/ProductGrid.jsx";
import Features from "../components/Features.jsx";
import { api } from "../lib/api.js";
import { toCard } from "../lib/format.js";

const TITLE = (
  <>
    Pronta <em>entrega</em>
  </>
);

/**
 * Pronta entrega — produtos em estoque no Brasil, cadastrados no backoffice (/admin/estoque).
 * Não consulta a Nike: GET /api/stock, uma vez por visita. Mesmos componentes visuais da home.
 */
export default function Stock({ setSelectedProductForSize, onSearch }) {
  const [grid, setGrid] = useState({ status: "loading", products: [], title: TITLE, sub: "// carregando o estoque…", query: "" });

  useEffect(() => {
    let alive = true;
    api
      .stock()
      .then((d) => {
        if (!alive) return;
        const products = (d.products || []).map(toCard);
        setGrid({
          status: products.length ? "ok" : "empty",
          products,
          title: TITLE,
          sub: products.length ? `// ${products.length} modelo(s) em estoque no Brasil · envio imediato` : "// estoque em renovação",
          query: ""
        });
      })
      .catch(() => {
        if (alive) setGrid({ status: "error", products: [], title: TITLE, sub: "// erro ao carregar o estoque", query: "" });
      });
    return () => { alive = false; };
  }, []);

  const featured = grid.status === "ok" ? grid.products[0] : null;

  return (
    <>
      <Hero featured={featured} onPick={setSelectedProductForSize} variant="stock" />
      <Marquee variant="stock" />
      <ProductGrid
        state={grid}
        onAdd={setSelectedProductForSize}
        kicker="No Brasil · envio imediato"
        loadingMsg="Carregando o estoque…"
        emptyMsg="Nenhum par em estoque neste momento — mas a gente importa pra você: veja os Importados ou chame no WhatsApp."
        errorMsg="Não foi possível carregar o estoque agora. Tente de novo em instantes."
        context="stock"
      />
      <Features onSearch={onSearch} />
    </>
  );
}
