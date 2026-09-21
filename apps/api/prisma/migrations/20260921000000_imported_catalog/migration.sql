CREATE TABLE "imported_products" (
  "style_color" TEXT NOT NULL,
  "raw" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "checked_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "imported_products_pkey" PRIMARY KEY ("style_color")
);
CREATE INDEX "imported_products_active_idx" ON "imported_products"("active");
