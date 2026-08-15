import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";

export default function Confirmation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderNumber = searchParams.get("order");
  
  const [status, setStatus] = useState("loading"); // loading, paid, unpaid, error
  const pollTimer = useRef(null);
  
  useEffect(() => {
    if (!orderNumber) {
      navigate("/");
      return;
    }

    const checkOrder = async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/orders/${orderNumber}`);
        if (!res.ok) throw new Error("Pedido não encontrado");
        const order = await res.json();
        
        if (order.status === "paid") {
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

    checkOrder();
    pollTimer.current = setInterval(checkOrder, 5000); // Polling a cada 5s

    return () => clearInterval(pollTimer.current);
  }, [orderNumber, navigate]);

  return (
    <main style={{ padding: "120px 20px", textAlign: "center", minHeight: "70vh" }}>
      <div style={{ maxWidth: 600, margin: "0 auto", background: "#111", padding: 40, borderRadius: 16 }}>
        {status === "loading" && <h2>Verificando pedido...</h2>}
        
        {status === "pending" && (
          <>
            <h2 style={{ color: "var(--k-yellow)" }}>Aguardando confirmação de pagamento</h2>
            <p style={{ marginTop: 16, color: "#aaa" }}>
              Se você pagou via Pix, pode levar até 1 minuto para o sistema reconhecer.
              <br/>Pedido: <strong>{orderNumber}</strong>
            </p>
            <div style={{ marginTop: 24 }} className="loader" />
          </>
        )}
        
        {status === "paid" && (
          <>
            <h2 style={{ color: "var(--k-green)" }}>Pagamento Confirmado! 🎉</h2>
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
            <h2 style={{ color: "var(--k-red)" }}>Pedido Cancelado/Expirado</h2>
            <p style={{ marginTop: 16, color: "#aaa" }}>
              O tempo para pagamento do pedido <strong>{orderNumber}</strong> expirou.
            </p>
            <button className="btn btn-primary" onClick={() => navigate("/")} style={{ marginTop: 32 }}>Tentar Novamente</button>
          </>
        )}

        {status === "error" && (
          <>
            <h2>Erro ao buscar pedido</h2>
            <p style={{ marginTop: 16, color: "#aaa" }}>Não foi possível carregar as informações.</p>
            <button className="btn btn-primary" onClick={() => navigate("/")} style={{ marginTop: 32 }}>Início</button>
          </>
        )}
      </div>
    </main>
  );
}
