/**
 * Linha do tempo do pedido (rastreio) — a mesma em "Rastrear pedido" e em "Meus pedidos".
 * Importado: Pagamento aprovado → Pedido comprado → Em trânsito internacional → Chegou no Brasil → Enviado pro seu endereço → Entregue.
 * Pronta entrega (order.international === false): Pagamento aprovado → Enviado pro seu endereço → Entregue.
 * Hypados são garimpados nos EUA → seguem o fluxo internacional completo, como os importados.
 * Cancelado / estornado / abandonado: uma frase em vez da linha.
 */
const STAGES = ["paid", "sourcing", "in_transit", "arrived_br", "shipped", "delivered"];
const LABELS = {
  paid: "Pagamento aprovado",
  sourcing: "Pedido comprado",
  in_transit: "Em trânsito internacional",
  arrived_br: "Chegou no Brasil",
  shipped: "Enviado pro seu endereço",
  delivered: "Entregue"
};
const DEAD = { abandoned: "expirado (pagamento não concluído)", cancelled: "cancelado", refunded: "estornado" };

export default function OrderTimeline({ order, compact = false }) {
  if (!order) return null;
  if (DEAD[order.status]) return <small className="track-note">Este pedido está {DEAD[order.status]}.</small>;
  const stages = order.international === false ? ["paid", "shipped", "delivered"] : STAGES;
  const reached = STAGES.indexOf(order.status); // -1 = aguardando pagamento
  const tracking = order.trackingCode ? ` — ${order.carrier ? `${order.carrier} ` : ""}${order.trackingCode}` : "";
  return (
    <div className={`track-steps${compact ? " compact" : ""}`}>
      {stages.map((s) => {
        const done = reached >= STAGES.indexOf(s);
        const current = order.status === s;
        return (
          <div className={`track-step${done ? "" : " pending"}${current ? " current" : ""}`} key={s}>
            <span className="dot" /> {LABELS[s]}{s === "shipped" && done ? tracking : ""}
          </div>
        );
      })}
    </div>
  );
}
