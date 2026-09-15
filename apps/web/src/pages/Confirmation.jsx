import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";

export default function Confirmation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const params = useParams();
  // /pedido/confirmacao/:number (redirect_url real da InfinitePay) · ?order= (mock/links antigos) · order_nsu (a InfinitePay também envia)
  const orderNumber = params.number || searchParams.get("order") || searchParams.get("order_nsu");
  // params que a InfinitePay anexa ao redirect_url após o pagamento
  const transactionNsu = searchParams.get("transaction_nsu");
  const slug = searchParams.get("slug");
  const captureMethod = searchParams.get("capture_method");
  const receiptUrl = searchParams.get("receipt_url");
  
  const [confirmationError, setConfirmationError] = useState(null);
  const [status, setStatus] = useState("loading"); // loading, paid, unpaid, error
  const pollTimer = useRef(null);
  
  useEffect(() => {
    if (!orderNumber) {
      navigate("/");
      return;
    }

    // 1) Se voltamos da InfinitePay com transaction_nsu/slug, confirmamos ATIVAMENTE via
    //    POST /confirm (a api chama o payment_check oficial). É o caminho principal —
    //    o webhook só chega quando a api tiver URL pública.
    const confirmFromRedirect = async () => {
      if (!transactionNsu || !slug) return;
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_nsu: transactionNsu, slug, capture_method: captureMethod, receipt_url: receiptUrl })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          setConfirmationError(data?.message || "Ainda não conseguimos confirmar seu pagamento. Se já pagou, não pague novamente. Aguarde e consulte seu pedido ou fale com a Kulture.");
        } else if (data.mismatch) {
          setConfirmationError("O valor recebido precisa ser conferido pela Kulture. Não pague novamente. Fale com a gente e informe o número do pedido.");
        }
      } catch {
        setConfirmationError("Não conseguimos consultar o pagamento agora. Confira sua conexão. Se já pagou, não pague novamente.");
      }
    };

    // 2) Polling do status (cobre webhook atrasado e o caso sem params)
    const checkOrder = async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`);
        if (!res.ok) throw new Error("Pedido não encontrado");
        const order = await res.json();
        
        if (["paid", "sourcing", "in_transit", "arrived_br", "shipped", "delivered"].includes(order.status)) {
          setStatus("paid");
          if (pollTimer.current) clearInterval(pollTimer.current);
        } else if (order.status === "abandoned" || order.status === "cancelled") {
          setStatus("unpaid");
          if (pollTimer.current) clearInterval(pollTimer.current);
        } else {
          setStatus("pending");
        }
      } catch (err) {
        setStatus("error");
        if (pollTimer.current) clearInterval(pollTimer.current);
      }
    };

    confirmFromRedirect().finally(checkOrder);
    pollTimer.current = setInterval(checkOrder, 5000); // Polling a cada 5s

    return () => clearInterval(pollTimer.current);
  }, [orderNumber, navigate]);

  return (
    <main style={{ padding: "120px 20px", textAlign: "center", minHeight: "70vh" }}>
      <div style={{ maxWidth: 600, margin: "0 auto", background: "#111", padding: 40, borderRadius: 16 }}>
        {status === "loading" && <h1>Verificando pedido...</h1>}
        
        {status === "pending" && (
          <>
            <h1 style={{ color: "var(--k-yellow)" }}>Aguardando confirmação de pagamento</h1>
            <p style={{ marginTop: 16, color: "#aaa" }}>
              Se você pagou via Pix, pode levar até 1 minuto para o sistema reconhecer.
              <br/>Pedido: <strong>{orderNumber}</strong>
            </p>
            {confirmationError && <div className="form-error" role="alert" style={{ marginTop: 20 }}>{confirmationError}</div>}
            {confirmationError && <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => window.location.reload()}>Consultar novamente</button>}
            <div style={{ marginTop: 24 }} className="loader" />
          </>
        )}
        
        {status === "paid" && (
          <>
            <h1 style={{ color: "var(--k-green)" }}>Pagamento Confirmado! 🎉</h1>
            <p style={{ marginTop: 16, color: "#ddd" }}>
              Recebemos o seu pagamento referente ao pedido <strong>{orderNumber}</strong>.
              <br/><br/>
              Acompanhe as atualizações pelo seu WhatsApp ou na aba de Perfil.
            </p>
            <button className="btn btn-primary" onClick={() => navigate("/")} style={{ marginTop: 32 }}>Voltar à Loja</button>
          </>
        )}

        {status === "unpaid" && (
          <>
            <h1 style={{ color: "var(--k-red)" }}>Pedido Cancelado/Expirado</h1>
            <p style={{ marginTop: 16, color: "#aaa" }}>
              O tempo para pagamento do pedido <strong>{orderNumber}</strong> expirou.
            </p>
            <button className="btn btn-primary" onClick={() => navigate("/")} style={{ marginTop: 32 }}>Tentar Novamente</button>
          </>
        )}

        {status === "error" && (
          <>
            <h1>Erro ao buscar pedido</h1>
            <p style={{ marginTop: 16, color: "#aaa" }}>Não foi possível carregar as informações.</p>
            <button className="btn btn-primary" onClick={() => navigate("/")} style={{ marginTop: 32 }}>Início</button>
          </>
        )}
      </div>
    </main>
  );
}
