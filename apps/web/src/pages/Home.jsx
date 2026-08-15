import Hero from "../components/Hero.jsx";
import Marquee from "../components/Marquee.jsx";
import ProductGrid from "../components/ProductGrid.jsx";
import Features from "../components/Features.jsx";

export default function Home({ grid, setSelectedProductForSize }) {
  return (
    <>
      <Hero />
      <Marquee />
      <ProductGrid state={grid} onAdd={setSelectedProductForSize} />
      <Features />
    </>
  );
}
