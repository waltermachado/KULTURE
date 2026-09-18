import { useEffect, useState } from "react";
import Hero from "../components/Hero.jsx";
import Marquee from "../components/Marquee.jsx";
import ProductGrid from "../components/ProductGrid.jsx";
import Features from "../components/Features.jsx";
import { api } from "../lib/api.js";
import { toCard, CATEGORIES } from "../lib/format.js";

export default function Home({ grid, setSelectedProductForSize, onCategory }) {
  // hero configurável (backoffice → Vitrine): por categoria quando a "busca" atual é uma das abas
  // (Basquete/Casual/Corrida geram query "basketball shoes" etc.); senão o slot padrão dos importados
  const heroCat = CATEGORIES.find((c) => c.q === grid.query)?.key || null;
  const [pinned, setPinned] = useState(null);
  useEffect(() => {
    let alive = true;
    api
      .featured("import", heroCat)
      .then((d) => { if (alive) setPinned(d.product ? toCard(d.product) : null); })
      .catch(() => { if (alive) setPinned(null); });
    return () => { alive = false; };
  }, [heroCat]);

  // destaque do hero = o configurado no backoffice; senão o 1º do top8 (nunca em busca livre)
  const isFreeSearch = Boolean(grid.query) && !heroCat;
  const featured = !isFreeSearch && pinned ? pinned : grid.status === "ok" && !grid.query ? grid.products[0] : null;
  return (
    <>
      <Hero featured={featured} onPick={setSelectedProductForSize} />
      <Marquee />
      <ProductGrid state={grid} onAdd={setSelectedProductForSize} />
      <Features onCategory={onCategory} />
    </>
  );
}
