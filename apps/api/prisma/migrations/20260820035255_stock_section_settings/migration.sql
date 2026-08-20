-- AlterTable
ALTER TABLE "stock_products" ADD COLUMN     "section" TEXT NOT NULL DEFAULT 'stock';

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "stock_products_section_idx" ON "stock_products"("section");
