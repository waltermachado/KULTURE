import Hero from "../components/Hero.jsx";
import Marquee from "../components/Marquee.jsx";
import ProductGrid from "../components/ProductGrid.jsx";
import Features from "../components/Features.jsx";

export default function Home({ grid, setSelectedProductForSize, onCategory }) {
  // destaque do hero = 1º produto do top8 (só quando não é resultado de busca)
  const featured = grid.status === "ok" && !grid.query ? grid.products[0] : null;
  return (
    <>
      <Hero featured={featured} onPick={setSelectedProductForSize} />
      <Marquee />
      <ProductGrid state={grid} onAdd={setSelectedProductForSize} />
      <Features onCategory={onCategory} />
    </>
  );
}
