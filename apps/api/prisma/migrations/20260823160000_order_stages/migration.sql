-- Etapas de rastreio do importado: Pagamento aprovado → Pedido comprado → Em trânsito internacional → Chegou no Brasil → Enviado pro seu endereço → Entregue
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'in_transit';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'arrived_br';
