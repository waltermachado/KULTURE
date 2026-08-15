import { useNavigate, useParams, useSearchParams } from "react-router-dom";

/**
 * Página LOCAL que simula o checkout da InfinitePay (PAYMENT_PROVIDER=mock).
 * Não fala com a InfinitePay: só imita o redirect que ela faz após o pagamento,
 * anexando os mesmos query params (transaction_nsu, slug, capture_method, receipt_url).
 * A página de confirmação então chama POST /api/orders/:number/confirm — o mesmo caminho do fluxo real.
 */
export default function MockInfinitePay() {
  const { number } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slug = params.get("slug") || `mock_slug_${number}`;

  const go = (outcome, method) => {
    const q = new URLSearchParams({ order: number });
    if (outcome === "paid") {
      q.set("transaction_nsu", `mock-tx-${Date.now()}`);
      q.set("slug", slug);
      q.set("capture_method", method);
      q.set("receipt_url", `https://example.invalid/comprovante/${number}`);
    }
    navigate(`/pedido/confirmacao?${q.toString()}`);
  };

  return (
    <main className="section" style={{ maxWidth: 560, minHeight: "70vh" }}>
      <div className="section-title">
        <h2>
          Simulador <em>InfinitePay</em>
        </h2>
        <span className="sub">// modo mock — nenhum pagamento real é feito</span>
      </div>
      <div className="track-result show" style={{ marginTop: 0 }}>
        <p>
          Pedido <b className="track-title">{number}</b>
        </p>
        <p style={{ color: "#999", marginTop: 8 }}>
          Em produção o cliente estaria na página da InfinitePay. Escolha o resultado para testar o retorno:
        </p>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <button className="btn-full" onClick={() => go("paid", "pix")}>
            ✅ Aprovar via Pix
          </button>
          <button className="btn-full" onClick={() => go("paid", "credit_card")}>
            ✅ Aprovar via cartão
          </button>
          <button className="btn-full" style={{ background: "#333", color: "#eee" }} onClick={() => go("cancel")}>
            ✖ Voltar sem pagar (fica pendente / abandona depois)
          </button>
        </div>
      </div>
    </main>
  );
}
