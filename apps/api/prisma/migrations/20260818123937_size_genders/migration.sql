-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "size_label" TEXT;

-- AlterTable
ALTER TABLE "stock_products" ADD COLUMN     "gender" TEXT NOT NULL DEFAULT 'M';
