/**
 * Status do pedido — única fonte de verdade para rótulos, ordem das etapas e o que conta como "pago".
 *
 * Fluxo do importado (o que o cliente vê no rastreio):
 *   paid        → Pagamento aprovado
 *   sourcing    → Pedido comprado (na loja oficial nos EUA)
 *   in_transit  → Em trânsito internacional
 *   arrived_br  → Chegou no Brasil
 *   shipped     → Enviado pro seu endereço (com rastreio)
 *   delivered   → Entregue
 * Pronta entrega / hypados (estoque no Brasil): paid → shipped → delivered — as etapas dos EUA não aparecem.
 */
export const ORDER_STATUS_LABELS = {
  pending_payment: "Aguardando pagamento",
  paid: "Pagamento aprovado",
  sourcing: "Pedido comprado",
  in_transit: "Em trânsito internacional",
  arrived_br: "Chegou no Brasil",
  shipped: "Enviado pro seu endereço",
  delivered: "Entregue",
  abandoned: "Abandonado",
  cancelled: "Cancelado",
  refunded: "Estornado"
};

/** Etapas em ordem (importado). */
export const ORDER_STAGES = ["paid", "sourcing", "in_transit", "arrived_br", "shipped", "delivered"];
/** Etapas de um pedido só com estoque do Brasil. */
export const ORDER_STAGES_DOMESTIC = ["paid", "shipped", "delivered"];

/** Pedidos que contam como receita (dinheiro entrou e não foi devolvido). */
export const PAID_STATUSES = ["paid", "sourcing", "in_transit", "arrived_br", "shipped", "delivered"];
/** Pagos mas ainda não entregues — fila de entregas. */
export const OPEN_PAID_STATUSES = ["paid", "sourcing", "in_transit", "arrived_br", "shipped"];
/** Pagos ainda sem envio ao cliente ("para enviar"). */
export const TO_SHIP_STATUSES = ["paid", "sourcing", "in_transit", "arrived_br"];

/** Transições permitidas no painel. Pode pular etapas para a frente (pronta entrega vai de pago a enviado). */
export const ORDER_TRANSITIONS = {
  pending_payment: ["paid", "cancelled", "abandoned"],
  abandoned: ["paid", "cancelled"],
  paid: ["sourcing", "in_transit", "arrived_br", "shipped", "cancelled", "refunded"],
  sourcing: ["in_transit", "arrived_br", "shipped", "cancelled", "refunded"],
  in_transit: ["arrived_br", "shipped", "cancelled", "refunded"],
  arrived_br: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: []
};

/** true quando algum item vem da Nike (importado) — define se o rastreio mostra as etapas internacionais. */
export function isInternationalOrder(order) {
  const items = order?.items || [];
  if (!items.length) return true;
  return items.some((i) => i?.breakdown?.source !== "stock");
}
