-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "stock_released_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "stock_products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "brand" TEXT NOT NULL DEFAULT 'Nike',
    "color_description" TEXT,
    "style_color" TEXT,
    "description" TEXT,
    "price_brl" DECIMAL(65,30) NOT NULL,
    "full_price_brl" DECIMAL(65,30),
    "cost_brl" DECIMAL(65,30),
    "badge" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "images" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_sizes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "br" TEXT NOT NULL,
    "us" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_products_code_key" ON "stock_products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_products_slug_key" ON "stock_products"("slug");

-- CreateIndex
CREATE INDEX "stock_products_active_sort_order_idx" ON "stock_products"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "stock_sizes_product_id_br_key" ON "stock_sizes"("product_id", "br");

-- CreateIndex
CREATE INDEX "stock_images_product_id_idx" ON "stock_images"("product_id");

-- AddForeignKey
ALTER TABLE "stock_sizes" ADD CONSTRAINT "stock_sizes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "stock_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_images" ADD CONSTRAINT "stock_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "stock_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
