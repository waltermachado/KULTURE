-- Cupons de desconto (cadastro no painel) + desconto aplicado no pedido
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'percent',
    "value" DECIMAL(65,30) NOT NULL,
    "min_subtotal_brl" DECIMAL(65,30),
    "max_discount_brl" DECIMAL(65,30),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

ALTER TABLE "orders" ADD COLUMN "coupon_code" TEXT,
ADD COLUMN "discount_brl" DECIMAL(65,30) NOT NULL DEFAULT 0;
