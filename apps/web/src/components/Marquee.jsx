const ITEMS = {
  import: ["100% original", "Importado direto dos EUA", "Frete grátis para todo o Brasil", "Numeração BR", "Pix ou cartão via InfinitePay", "Compra protegida", "★"],
  stock: ["100% original", "Em estoque no Brasil", "Envio imediato", "Frete grátis para todo o Brasil", "Numeração BR", "Pix ou cartão via InfinitePay", "★"]
};

export default function Marquee({ variant = "import" }) {
  const items = ITEMS[variant] || ITEMS.import;
  const track = [...items, ...items];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {track.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}
