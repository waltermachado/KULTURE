const ITEMS = [
  "Frete para todo o Brasil",
  "Importados direto dos EUA",
  "Pague com InfinitePay",
  "Rastreio em tempo real",
  "100% originais"
];

export default function Marquee() {
  const track = [...ITEMS, ...ITEMS]; // duplicado para o loop contínuo
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {track.map((t, i) => (
          <span key={i}>&#9733; {t}</span>
        ))}
      </div>
    </div>
  );
}
