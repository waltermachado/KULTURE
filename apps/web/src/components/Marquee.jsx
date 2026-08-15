const ITEMS = ["100% original", "Importado direto dos EUA", "Frete grátis para todo o Brasil", "Numeração BR", "Pix ou cartão via InfinitePay", "Compra protegida", "★"];

export default function Marquee() {
  const track = [...ITEMS, ...ITEMS];
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
