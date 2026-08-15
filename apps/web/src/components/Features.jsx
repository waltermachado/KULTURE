const FEATURES = [
  { ico: "📦", title: "Rastreio integrado", text: "Acompanhe seu pedido logado na sua conta" },
  { ico: "💳", title: "InfinitePay", text: "Pix, cartão e parcelamento em até 12x" },
  { ico: "✅", title: "100% originais", text: "Comprados direto das lojas oficiais nos EUA" },
  { ico: "🔥", title: "Drops semanais", text: "Estoque atualizado toda semana via API" }
];

export default function Features() {
  return (
    <div className="features">
      <div className="features-inner">
        {FEATURES.map((f) => (
          <div className="feature" key={f.title}>
            <div className="ico" aria-hidden="true">
              {f.ico}
            </div>
            <div>
              <b>{f.title}</b>
              <small>{f.text}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
